import mysql from "mysql2/promise"

const config = process.env.DATABASE_URL || {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "smartlink_schools",
  multipleStatements: false,
}

const connection = await mysql.createConnection(config)
const changes = []

async function tableExists(tableName) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName],
  )
  return rows.length > 0
}

async function hasColumn(tableName, columnName) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName],
  )
  return rows.length > 0
}

async function hasIndex(tableName, indexName) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName],
  )
  return rows.length > 0
}

async function createTable(tableName, sql) {
  if (await tableExists(tableName)) return false
  await connection.query(sql)
  return true
}

async function addIndex(tableName, indexName, definition) {
  if (await hasIndex(tableName, indexName)) return false
  await connection.query(`ALTER TABLE ${tableName} ADD ${definition}`)
  return true
}

async function countReferencingForeignKeys(tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ?`,
    [tableName],
  )
  return Number(rows[0]?.total || 0)
}

async function cleanupDuplicateEnrollments() {
  if (!(await tableExists("student_enrollments"))) return { groups: 0, deleted: 0 }

  await createTable(
    "student_enrollment_cleanup_audit",
    `CREATE TABLE student_enrollment_cleanup_audit (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      term_id BIGINT UNSIGNED NOT NULL,
      kept_enrollment_id BIGINT UNSIGNED NOT NULL,
      duplicate_enrollment_id BIGINT UNSIGNED NOT NULL,
      duplicate_snapshot JSON NOT NULL,
      action_taken VARCHAR(40) NOT NULL DEFAULT 'deleted_duplicate',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_enrollment_cleanup_scope (school_id, student_id, academic_year_id, term_id)
    )`,
  )

  const [groups] = await connection.query(
    `SELECT school_id, student_id, academic_year_id, term_id, COUNT(*) AS total
     FROM student_enrollments
     GROUP BY school_id, student_id, academic_year_id, term_id
     HAVING COUNT(*) > 1`,
  )

  const fkReferences = await countReferencingForeignKeys("student_enrollments")
  if (fkReferences > 0 && groups.length) {
    throw new Error("Duplicate student_enrollments exist, but foreign keys reference student_enrollments.id. Review before cleanup.")
  }

  let deleted = 0
  for (const group of groups) {
    const [rows] = await connection.query(
      `SELECT *
       FROM student_enrollments
       WHERE school_id = ? AND student_id = ? AND academic_year_id = ? AND term_id = ?
       ORDER BY enrollment_status = 'active' DESC, updated_at DESC, id DESC`,
      [group.school_id, group.student_id, group.academic_year_id, group.term_id],
    )
    const [canonical, ...duplicates] = rows
    for (const duplicate of duplicates) {
      await connection.query(
        `INSERT INTO student_enrollment_cleanup_audit (
          school_id, student_id, academic_year_id, term_id, kept_enrollment_id, duplicate_enrollment_id, duplicate_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          duplicate.school_id,
          duplicate.student_id,
          duplicate.academic_year_id,
          duplicate.term_id,
          canonical.id,
          duplicate.id,
          JSON.stringify(duplicate),
        ],
      )
      await connection.query("DELETE FROM student_enrollments WHERE id = ?", [duplicate.id])
      deleted += 1
    }
  }

  return { groups: groups.length, deleted }
}

async function cleanupDuplicatePromotionDecisions() {
  if (!(await tableExists("promotion_decisions"))) return { groups: 0, deleted: 0 }

  await createTable(
    "promotion_decision_cleanup_audit",
    `CREATE TABLE promotion_decision_cleanup_audit (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      from_academic_year_id BIGINT UNSIGNED NOT NULL,
      to_academic_year_id BIGINT UNSIGNED NOT NULL,
      kept_decision_id BIGINT UNSIGNED NOT NULL,
      duplicate_decision_id BIGINT UNSIGNED NOT NULL,
      duplicate_snapshot JSON NOT NULL,
      action_taken VARCHAR(40) NOT NULL DEFAULT 'deleted_duplicate',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_promotion_cleanup_scope (school_id, student_id, from_academic_year_id, to_academic_year_id)
    )`,
  )

  const [groups] = await connection.query(
    `SELECT school_id, student_id, from_academic_year_id, to_academic_year_id, COUNT(*) AS total
     FROM promotion_decisions
     GROUP BY school_id, student_id, from_academic_year_id, to_academic_year_id
     HAVING COUNT(*) > 1`,
  )

  let deleted = 0
  for (const group of groups) {
    const [rows] = await connection.query(
      `SELECT *
       FROM promotion_decisions
       WHERE school_id = ? AND student_id = ? AND from_academic_year_id = ? AND to_academic_year_id = ?
       ORDER BY approved_at DESC, updated_at DESC, id DESC`,
      [group.school_id, group.student_id, group.from_academic_year_id, group.to_academic_year_id],
    )
    const [canonical, ...duplicates] = rows
    for (const duplicate of duplicates) {
      await connection.query(
        `INSERT INTO promotion_decision_cleanup_audit (
          school_id, student_id, from_academic_year_id, to_academic_year_id, kept_decision_id, duplicate_decision_id, duplicate_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          duplicate.school_id,
          duplicate.student_id,
          duplicate.from_academic_year_id,
          duplicate.to_academic_year_id,
          canonical.id,
          duplicate.id,
          JSON.stringify(duplicate),
        ],
      )
      await connection.query("DELETE FROM promotion_decisions WHERE id = ?", [duplicate.id])
      deleted += 1
    }
  }

  return { groups: groups.length, deleted }
}

try {
  await connection.beginTransaction()

  if (await hasColumn("students", "status")) {
    await connection.query(
      "ALTER TABLE students MODIFY status ENUM('active', 'transferred', 'inactive', 'suspended', 'transferred_out', 'withdrawn', 'graduated', 'archived') NOT NULL DEFAULT 'active'",
    )
    await connection.query("UPDATE students SET status = 'transferred_out' WHERE status = 'transferred'")
    await connection.query("UPDATE students SET status = 'archived' WHERE status = 'inactive'")
    await connection.query(
      "ALTER TABLE students MODIFY status ENUM('active', 'suspended', 'transferred_out', 'withdrawn', 'graduated', 'archived') NOT NULL DEFAULT 'active'",
    )
    changes.push("students.status enum")
  }

  if (await hasColumn("student_enrollments", "enrollment_status")) {
    await connection.query(
      "ALTER TABLE student_enrollments MODIFY enrollment_status ENUM('active', 'transferred_out', 'withdrawn', 'suspended', 'graduated', 'superseded') NOT NULL DEFAULT 'active'",
    )
    changes.push("student_enrollments.enrollment_status enum")
  }

  if (await createTable(
    "class_progression_rules",
    `CREATE TABLE class_progression_rules (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      from_class_id BIGINT UNSIGNED NOT NULL,
      to_class_id BIGINT UNSIGNED NULL,
      is_terminal_class TINYINT(1) NOT NULL DEFAULT 0,
      default_decision ENUM('promote', 'graduate') NOT NULL DEFAULT 'promote',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_class_progression_from (school_id, from_class_id),
      KEY idx_class_progression_next (school_id, to_class_id, is_active),
      CONSTRAINT fk_class_progression_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_class_progression_from_class FOREIGN KEY (from_class_id) REFERENCES classes(id),
      CONSTRAINT fk_class_progression_to_class FOREIGN KEY (to_class_id) REFERENCES classes(id)
    )`,
  )) changes.push("class_progression_rules")

  if (await tableExists("promotion_decisions")) {
    await connection.query(
      "ALTER TABLE promotion_decisions MODIFY decision ENUM('promoted', 'repeated', 'graduated', 'transferred_out', 'withdrawn', 'suspended', 'pending_review') NOT NULL DEFAULT 'pending_review'",
    )
    changes.push("promotion_decisions.decision enum")
  }

  const enrollmentCleanup = await cleanupDuplicateEnrollments()
  if ((await tableExists("student_enrollments")) && await addIndex(
    "student_enrollments",
    "uq_student_enrollment_term",
    "UNIQUE KEY uq_student_enrollment_term (school_id, student_id, academic_year_id, term_id)",
  )) changes.push("uq_student_enrollment_term")

  const promotionCleanup = await cleanupDuplicatePromotionDecisions()
  if ((await tableExists("promotion_decisions")) && await addIndex(
    "promotion_decisions",
    "uq_promotion_student_year",
    "UNIQUE KEY uq_promotion_student_year (school_id, student_id, from_academic_year_id, to_academic_year_id)",
  )) changes.push("uq_promotion_student_year")

  await connection.commit()

  console.log(JSON.stringify({
    ok: true,
    changes,
    cleanup: {
      enrollment_duplicates: enrollmentCleanup,
      promotion_duplicates: promotionCleanup,
    },
  }, null, 2))
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
