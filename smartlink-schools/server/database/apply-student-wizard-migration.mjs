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

async function addColumn(tableName, columnName, definition) {
  if (await hasColumn(tableName, columnName)) return false
  await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  return true
}

async function addIndex(tableName, indexName, definition) {
  if (await hasIndex(tableName, indexName)) return false
  await connection.query(`ALTER TABLE ${tableName} ADD ${definition}`)
  return true
}

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

async function createTable(tableName, sql) {
  if (await tableExists(tableName)) return false
  await connection.query(sql)
  return true
}

const changes = []

try {
  if (await addColumn("schools", "school_prefix", "VARCHAR(20) NULL")) changes.push("schools.school_prefix")
  if (await addIndex("schools", "uq_schools_school_prefix", "UNIQUE KEY uq_schools_school_prefix (school_prefix)")) changes.push("uq_schools_school_prefix")

  if (await addColumn("students", "student_id", "VARCHAR(80) NULL AFTER user_id")) changes.push("students.student_id")
  if (await addColumn("students", "national_id", "VARCHAR(80) NULL AFTER gender")) changes.push("students.national_id")
  if (await addColumn("students", "profile_photo_url", "VARCHAR(255) NULL AFTER national_id")) changes.push("students.profile_photo_url")
  if (await addColumn("students", "stream_section", "VARCHAR(80) NULL AFTER profile_photo_url")) changes.push("students.stream_section")
  if (await addColumn("students", "enrollment_date", "DATE NULL AFTER stream_section")) changes.push("students.enrollment_date")
  if (await addColumn("students", "student_type", "ENUM('new', 'returning', 'transfer') NOT NULL DEFAULT 'new' AFTER enrollment_date")) changes.push("students.student_type")
  if (await addColumn("students", "previous_school", "VARCHAR(160) NULL AFTER student_type")) changes.push("students.previous_school")
  if (await addColumn("students", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at")) changes.push("students.updated_at")
  if (await addIndex("students", "uq_students_school_student_id", "UNIQUE KEY uq_students_school_student_id (school_id, student_id)")) changes.push("uq_students_school_student_id")

  if (await createTable(
    "school_student_sequences",
    `CREATE TABLE school_student_sequences (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      sequence_year INT NOT NULL,
      last_sequence INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_school_student_sequence (school_id, sequence_year),
      CONSTRAINT fk_student_sequences_school FOREIGN KEY (school_id) REFERENCES schools(id)
    )`,
  )) changes.push("school_student_sequences")

  if (await createTable(
    "student_guardians",
    `CREATE TABLE student_guardians (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      guardian_number TINYINT UNSIGNED NOT NULL DEFAULT 1,
      full_name VARCHAR(160) NOT NULL,
      relationship VARCHAR(60) NOT NULL,
      primary_phone VARCHAR(40),
      secondary_phone VARCHAR(40),
      email VARCHAR(180),
      national_id VARCHAR(80),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_student_guardian_number (school_id, student_id, guardian_number),
      CONSTRAINT fk_student_guardians_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_student_guardians_student FOREIGN KEY (student_id) REFERENCES students(id)
    )`,
  )) changes.push("student_guardians")

  if (await createTable(
    "student_fee_profiles",
    `CREATE TABLE student_fee_profiles (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      fee_category ENUM('standard', 'bursary', 'scholarship', 'staff_child') NOT NULL DEFAULT 'standard',
      payment_plan ENUM('monthly', 'termly', 'annual') NOT NULL DEFAULT 'termly',
      discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      discount_reason VARCHAR(255),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_student_fee_profile (school_id, student_id),
      CONSTRAINT fk_student_fee_profiles_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_student_fee_profiles_student FOREIGN KEY (student_id) REFERENCES students(id)
    )`,
  )) changes.push("student_fee_profiles")

  if (await createTable(
    "teacher_class_subject_assignments",
    `CREATE TABLE teacher_class_subject_assignments (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      teacher_id BIGINT UNSIGNED NOT NULL,
      class_id BIGINT UNSIGNED NOT NULL,
      subject_id BIGINT UNSIGNED NULL,
      stream_section VARCHAR(80),
      academic_year VARCHAR(20) NOT NULL,
      term VARCHAR(80) NOT NULL DEFAULT '',
      role ENUM('subject_teacher', 'class_teacher') NOT NULL DEFAULT 'subject_teacher',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_teacher_assignments_scope (school_id, class_id, academic_year, term, is_active),
      KEY idx_teacher_assignments_teacher (school_id, teacher_id, is_active),
      CONSTRAINT fk_teacher_assignments_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_teacher_assignments_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
      CONSTRAINT fk_teacher_assignments_class FOREIGN KEY (class_id) REFERENCES classes(id),
      CONSTRAINT fk_teacher_assignments_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
    )`,
  )) changes.push("teacher_class_subject_assignments")

  await connection.query("UPDATE schools SET school_prefix = COALESCE(school_prefix, 'GPS') WHERE id = 1")
  await connection.query(
    `INSERT INTO teacher_class_subject_assignments
      (id, school_id, teacher_id, class_id, subject_id, academic_year, term, role, is_active)
     VALUES
      (1, 1, 5, 1, NULL, '2026', 'Term 2', 'class_teacher', 1),
      (2, 1, 5, 1, 1, '2026', 'Term 2', 'subject_teacher', 1),
      (3, 1, 5, 1, 2, '2026', 'Term 2', 'subject_teacher', 1),
      (4, 1, 5, 2, 1, '2026', 'Term 2', 'subject_teacher', 1),
      (5, 1, 5, 3, 2, '2026', 'Term 2', 'subject_teacher', 1)
     ON DUPLICATE KEY UPDATE teacher_id = VALUES(teacher_id), subject_id = VALUES(subject_id), is_active = VALUES(is_active)`,
  )

  console.log(JSON.stringify({ ok: true, changes }, null, 2))
} finally {
  await connection.end()
}
