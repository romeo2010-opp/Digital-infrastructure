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

async function createTable(tableName, sql) {
  if (await tableExists(tableName)) return false
  await connection.query(sql)
  return true
}

const changes = []

try {
  if (await addColumn("users", "first_name", "VARCHAR(100) NULL AFTER full_name")) changes.push("users.first_name")
  if (await addColumn("users", "last_name", "VARCHAR(100) NULL AFTER first_name")) changes.push("users.last_name")
  if (await addColumn("users", "gender", "VARCHAR(30) NULL AFTER phone")) changes.push("users.gender")
  if (await addColumn("users", "date_of_birth", "DATE NULL AFTER gender")) changes.push("users.date_of_birth")
  if (await addColumn("users", "national_id", "VARCHAR(80) NULL AFTER date_of_birth")) changes.push("users.national_id")
  if (await addColumn("users", "employee_id", "VARCHAR(80) NULL AFTER national_id")) changes.push("users.employee_id")
  if (await addColumn("users", "qualification", "VARCHAR(160) NULL AFTER employee_id")) changes.push("users.qualification")
  if (await addColumn("users", "specialization", "VARCHAR(160) NULL AFTER qualification")) changes.push("users.specialization")
  if (await addColumn("users", "address", "VARCHAR(255) NULL AFTER specialization")) changes.push("users.address")
  if (await addColumn("users", "profile_photo_url", "VARCHAR(255) NULL AFTER address")) changes.push("users.profile_photo_url")
  if (await addColumn("users", "employment_status", "ENUM('active', 'inactive', 'suspended', 'left') NOT NULL DEFAULT 'active' AFTER profile_photo_url")) changes.push("users.employment_status")
  if (await addColumn("users", "role_type", "ENUM('teacher', 'headteacher', 'deputy_headteacher', 'admin_teacher') NOT NULL DEFAULT 'teacher' AFTER employment_status")) changes.push("users.role_type")
  if (await addColumn("users", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at")) changes.push("users.updated_at")
  if (await addIndex("users", "uq_users_school_employee", "UNIQUE KEY uq_users_school_employee (school_id, employee_id)")) changes.push("uq_users_school_employee")

  if (await createTable(
    "academic_years",
    `CREATE TABLE academic_years (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(80) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status ENUM('upcoming', 'active', 'closed', 'archived') NOT NULL DEFAULT 'upcoming',
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_academic_year_school_name (school_id, name),
      KEY idx_academic_year_school_status (school_id, status, is_active),
      CONSTRAINT fk_academic_years_school FOREIGN KEY (school_id) REFERENCES schools(id)
    )`,
  )) changes.push("academic_years")

  if (await createTable(
    "terms",
    `CREATE TABLE terms (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(80) NOT NULL,
      term_number INT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status ENUM('upcoming', 'open', 'marking', 'closed', 'archived') NOT NULL DEFAULT 'upcoming',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_terms_school_year_number (school_id, academic_year_id, term_number),
      KEY idx_terms_school_status (school_id, status),
      CONSTRAINT fk_terms_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_terms_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
    )`,
  )) changes.push("terms")

  if (await createTable(
    "student_enrollments",
    `CREATE TABLE student_enrollments (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      term_id BIGINT UNSIGNED NOT NULL,
      class_id BIGINT UNSIGNED NOT NULL,
      stream_section VARCHAR(80),
      enrollment_type ENUM('new', 'returning', 'transfer', 'promoted', 'repeated', 'continued') NOT NULL DEFAULT 'continued',
      enrollment_status ENUM('active', 'transferred_out', 'withdrawn', 'suspended', 'graduated', 'superseded') NOT NULL DEFAULT 'active',
      start_date DATE NOT NULL,
      end_date DATE NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_student_enrollment_term (school_id, student_id, academic_year_id, term_id),
      KEY idx_student_enrollment_class (school_id, class_id, academic_year_id, term_id, enrollment_status),
      CONSTRAINT fk_student_enrollments_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_student_enrollments_student FOREIGN KEY (student_id) REFERENCES students(id),
      CONSTRAINT fk_student_enrollments_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_student_enrollments_term FOREIGN KEY (term_id) REFERENCES terms(id),
      CONSTRAINT fk_student_enrollments_class FOREIGN KEY (class_id) REFERENCES classes(id)
    )`,
  )) changes.push("student_enrollments")

  if (await createTable(
    "term_closures",
    `CREATE TABLE term_closures (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      term_id BIGINT UNSIGNED NOT NULL,
      closed_by BIGINT UNSIGNED NOT NULL,
      closed_at TIMESTAMP NULL,
      reopened_by BIGINT UNSIGNED NULL,
      reopened_at TIMESTAMP NULL,
      status ENUM('closed', 'reopened') NOT NULL DEFAULT 'closed',
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_term_closures_scope (school_id, academic_year_id, term_id, status),
      CONSTRAINT fk_term_closures_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_term_closures_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_term_closures_term FOREIGN KEY (term_id) REFERENCES terms(id),
      CONSTRAINT fk_term_closures_closed_by FOREIGN KEY (closed_by) REFERENCES users(id),
      CONSTRAINT fk_term_closures_reopened_by FOREIGN KEY (reopened_by) REFERENCES users(id)
    )`,
  )) changes.push("term_closures")

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

  if (await createTable(
    "promotion_decisions",
    `CREATE TABLE promotion_decisions (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      from_academic_year_id BIGINT UNSIGNED NOT NULL,
      to_academic_year_id BIGINT UNSIGNED NOT NULL,
      from_class_id BIGINT UNSIGNED NOT NULL,
      to_class_id BIGINT UNSIGNED NULL,
      decision ENUM('promoted', 'repeated', 'graduated', 'transferred_out', 'withdrawn', 'suspended', 'pending_review') NOT NULL DEFAULT 'pending_review',
      recommended_decision VARCHAR(60),
      reason VARCHAR(255),
      approved_by BIGINT UNSIGNED NULL,
      approved_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_promotion_student_year (school_id, student_id, from_academic_year_id, to_academic_year_id),
      KEY idx_promotion_scope (school_id, from_academic_year_id, to_academic_year_id, decision),
      CONSTRAINT fk_promotion_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_promotion_student FOREIGN KEY (student_id) REFERENCES students(id),
      CONSTRAINT fk_promotion_from_year FOREIGN KEY (from_academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_promotion_to_year FOREIGN KEY (to_academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_promotion_from_class FOREIGN KEY (from_class_id) REFERENCES classes(id),
      CONSTRAINT fk_promotion_to_class FOREIGN KEY (to_class_id) REFERENCES classes(id),
      CONSTRAINT fk_promotion_approved_by FOREIGN KEY (approved_by) REFERENCES users(id)
    )`,
  )) changes.push("promotion_decisions")

  if (await addColumn("teacher_class_subject_assignments", "academic_year_id", "BIGINT UNSIGNED NULL AFTER stream_section")) changes.push("teacher_assignments.academic_year_id")
  if (await addColumn("teacher_class_subject_assignments", "term_id", "BIGINT UNSIGNED NULL AFTER academic_year_id")) changes.push("teacher_assignments.term_id")
  if (await addColumn("teacher_class_subject_assignments", "notes", "VARCHAR(255) NULL AFTER is_active")) changes.push("teacher_assignments.notes")
  if (await addIndex("teacher_class_subject_assignments", "idx_teacher_assignments_session", "KEY idx_teacher_assignments_session (school_id, academic_year_id, term_id, class_id, subject_id, is_active)")) changes.push("idx_teacher_assignments_session")

  if (await addColumn("assessments", "academic_year_id", "BIGINT UNSIGNED NULL AFTER subject_id")) changes.push("assessments.academic_year_id")
  if (await addColumn("assessments", "term_id", "BIGINT UNSIGNED NULL AFTER academic_year_id")) changes.push("assessments.term_id")
  if (await addColumn("assessments", "teacher_id", "BIGINT UNSIGNED NULL AFTER term_id")) changes.push("assessments.teacher_id")
  if (await addColumn("assessments", "status", "ENUM('draft', 'open', 'locked', 'archived') NOT NULL DEFAULT 'open' AFTER expected_difficulty")) changes.push("assessments.status")
  if (await addIndex("assessments", "idx_assessments_session", "KEY idx_assessments_session (school_id, academic_year_id, term_id, class_id, subject_id, status)")) changes.push("idx_assessments_session")

  if (await createTable(
    "result_batches",
    `CREATE TABLE result_batches (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      assessment_id BIGINT UNSIGNED NOT NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      term_id BIGINT UNSIGNED NOT NULL,
      class_id BIGINT UNSIGNED NOT NULL,
      subject_id BIGINT UNSIGNED NOT NULL,
      teacher_id BIGINT UNSIGNED NOT NULL,
      status ENUM('draft', 'submitted', 'approved', 'returned') NOT NULL DEFAULT 'draft',
      submitted_at TIMESTAMP NULL,
      submitted_by BIGINT UNSIGNED NULL,
      approved_at TIMESTAMP NULL,
      approved_by BIGINT UNSIGNED NULL,
      returned_at TIMESTAMP NULL,
      returned_by BIGINT UNSIGNED NULL,
      return_reason VARCHAR(255),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_result_batch_scope (school_id, assessment_id, class_id, subject_id, teacher_id, term_id),
      KEY idx_result_batches_status (school_id, academic_year_id, term_id, status),
      CONSTRAINT fk_result_batches_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_result_batches_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
      CONSTRAINT fk_result_batches_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_result_batches_term FOREIGN KEY (term_id) REFERENCES terms(id),
      CONSTRAINT fk_result_batches_class FOREIGN KEY (class_id) REFERENCES classes(id),
      CONSTRAINT fk_result_batches_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
      CONSTRAINT fk_result_batches_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
      CONSTRAINT fk_result_batches_submitted_by FOREIGN KEY (submitted_by) REFERENCES users(id),
      CONSTRAINT fk_result_batches_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
      CONSTRAINT fk_result_batches_returned_by FOREIGN KEY (returned_by) REFERENCES users(id)
    )`,
  )) changes.push("result_batches")

  if (await createTable(
    "result_entries",
    `CREATE TABLE result_entries (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      result_batch_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      score DECIMAL(8,2) NULL,
      grade VARCHAR(20),
      comment VARCHAR(255),
      status ENUM('draft', 'submitted', 'approved', 'returned') NOT NULL DEFAULT 'draft',
      last_saved_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_result_entry_student (school_id, result_batch_id, student_id),
      KEY idx_result_entries_student (school_id, student_id),
      CONSTRAINT fk_result_entries_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_result_entries_batch FOREIGN KEY (result_batch_id) REFERENCES result_batches(id),
      CONSTRAINT fk_result_entries_student FOREIGN KEY (student_id) REFERENCES students(id)
    )`,
  )) changes.push("result_entries")

  await connection.query(
    `UPDATE users
     SET first_name = COALESCE(first_name, SUBSTRING_INDEX(full_name, ' ', 1)),
       last_name = COALESCE(last_name, CASE WHEN LOCATE(' ', full_name) > 0 THEN SUBSTRING_INDEX(full_name, ' ', -1) ELSE full_name END),
       role_type = CASE WHEN role = 'headteacher' THEN 'headteacher' ELSE COALESCE(role_type, 'teacher') END,
       employment_status = COALESCE(employment_status, 'active')
     WHERE role IN ('teacher', 'headteacher')`,
  )

  await connection.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, status, is_active)
     SELECT id, '2026', '2026-01-01', '2026-12-31', 'active', 1
     FROM schools
     WHERE NOT EXISTS (
       SELECT 1 FROM academic_years ay WHERE ay.school_id = schools.id
     )`,
  )

  await connection.query(
    `INSERT INTO terms (school_id, academic_year_id, name, term_number, start_date, end_date, status)
     SELECT ay.school_id, ay.id, 'Term 2', 2, '2026-05-05', '2026-08-01', 'open'
     FROM academic_years ay
     WHERE ay.is_active = 1
       AND NOT EXISTS (
         SELECT 1 FROM terms t WHERE t.school_id = ay.school_id AND t.academic_year_id = ay.id
       )`,
  )

  await connection.query(
    `INSERT INTO student_enrollments (
       school_id, student_id, academic_year_id, term_id, class_id, stream_section,
       enrollment_type, enrollment_status, start_date
     )
     SELECT s.school_id, s.id, ay.id, t.id, s.class_id, s.stream_section,
       COALESCE(s.student_type, 'continued'), 'active', COALESCE(s.enrollment_date, t.start_date)
     FROM students s
     JOIN academic_years ay ON ay.school_id = s.school_id AND ay.is_active = 1
     JOIN terms t ON t.school_id = s.school_id AND t.academic_year_id = ay.id AND t.status IN ('open', 'marking')
     WHERE s.status = 'active' AND s.class_id IS NOT NULL
     ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), stream_section = VALUES(stream_section), enrollment_status = VALUES(enrollment_status)`,
  )

  await connection.query(
    `UPDATE teacher_class_subject_assignments a
     JOIN academic_years ay ON ay.school_id = a.school_id AND ay.is_active = 1
     LEFT JOIN terms t ON t.school_id = a.school_id AND t.academic_year_id = ay.id AND t.status IN ('open', 'marking')
     SET a.academic_year_id = COALESCE(a.academic_year_id, ay.id),
       a.term_id = COALESCE(a.term_id, t.id)`,
  )

  await connection.query(
    `UPDATE assessments a
     JOIN academic_years ay ON ay.school_id = a.school_id AND ay.is_active = 1
     LEFT JOIN terms t ON t.school_id = a.school_id AND t.academic_year_id = ay.id AND t.status IN ('open', 'marking')
     SET a.academic_year_id = COALESCE(a.academic_year_id, ay.id),
       a.term_id = COALESCE(a.term_id, t.id),
       a.teacher_id = COALESCE(a.teacher_id, a.created_by)`,
  )

  console.log(JSON.stringify({ ok: true, changes }, null, 2))
} finally {
  await connection.end()
}
