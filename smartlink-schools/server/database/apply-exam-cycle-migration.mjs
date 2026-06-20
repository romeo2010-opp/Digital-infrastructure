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
  changes.push(tableName)
  return true
}

async function addColumn(tableName, columnName, definition) {
  if (await hasColumn(tableName, columnName)) return false
  await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
  changes.push(`${tableName}.${columnName}`)
  return true
}

async function addIndex(tableName, indexName, definition) {
  if (await hasIndex(tableName, indexName)) return false
  await connection.query(`ALTER TABLE ${tableName} ADD ${definition}`)
  changes.push(`${tableName}.${indexName}`)
  return true
}

try {
  await createTable(
    "exam_sessions",
    `CREATE TABLE exam_sessions (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      term_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(180) NOT NULL,
      exam_type ENUM('end_of_term', 'mid_term', 'mock', 'final', 'custom') NOT NULL DEFAULT 'end_of_term',
      status ENUM('draft', 'scheduled', 'in_progress', 'marking', 'results_submitted', 'results_approved', 'locked', 'archived') NOT NULL DEFAULT 'draft',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      notes TEXT NULL,
      created_by BIGINT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_exam_sessions_scope (school_id, academic_year_id, term_id, status),
      UNIQUE KEY uq_exam_session_name (school_id, academic_year_id, term_id, name),
      CONSTRAINT fk_exam_sessions_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_exam_sessions_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_exam_sessions_term FOREIGN KEY (term_id) REFERENCES terms(id),
      CONSTRAINT fk_exam_sessions_created_by FOREIGN KEY (created_by) REFERENCES users(id)
    )`,
  )

  await addColumn("assessments", "exam_session_id", "BIGINT UNSIGNED NULL AFTER school_id")
  await addColumn("assessments", "assessment_type", "ENUM('class_test', 'quiz', 'assignment', 'mid_term', 'end_of_term_exam', 'mock_exam', 'final_exam') NOT NULL DEFAULT 'class_test' AFTER name")
  await addColumn("assessments", "duration_minutes", "INT NULL AFTER total_marks")
  await addColumn("assessments", "instructions", "TEXT NULL AFTER duration_minutes")
  await addColumn("assessments", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at")
  await connection.query(
    "ALTER TABLE assessments MODIFY COLUMN status ENUM('draft', 'open', 'ready_for_review', 'approved', 'scheduled', 'marking', 'results_submitted', 'results_approved', 'returned', 'locked', 'archived') NOT NULL DEFAULT 'open'",
  )
  await addIndex("assessments", "idx_assessments_exam_session", "KEY idx_assessments_exam_session (school_id, exam_session_id, assessment_type, status)")

  await createTable(
    "exam_timetable_entries",
    `CREATE TABLE exam_timetable_entries (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      exam_session_id BIGINT UNSIGNED NOT NULL,
      assessment_id BIGINT UNSIGNED NOT NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      term_id BIGINT UNSIGNED NOT NULL,
      class_id BIGINT UNSIGNED NOT NULL,
      stream_section VARCHAR(80),
      subject_id BIGINT UNSIGNED NOT NULL,
      exam_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      room VARCHAR(120),
      invigilator_teacher_id BIGINT UNSIGNED NULL,
      status ENUM('scheduled', 'written', 'cancelled') NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_exam_timetable_session (school_id, exam_session_id, exam_date),
      KEY idx_exam_timetable_conflict (school_id, exam_date, start_time, end_time, class_id, invigilator_teacher_id),
      CONSTRAINT fk_exam_timetable_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_exam_timetable_session FOREIGN KEY (exam_session_id) REFERENCES exam_sessions(id),
      CONSTRAINT fk_exam_timetable_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
      CONSTRAINT fk_exam_timetable_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_exam_timetable_term FOREIGN KEY (term_id) REFERENCES terms(id),
      CONSTRAINT fk_exam_timetable_class FOREIGN KEY (class_id) REFERENCES classes(id),
      CONSTRAINT fk_exam_timetable_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
      CONSTRAINT fk_exam_timetable_invigilator FOREIGN KEY (invigilator_teacher_id) REFERENCES users(id)
    )`,
  )

  await addColumn("result_batches", "exam_session_id", "BIGINT UNSIGNED NULL AFTER school_id")
  await addColumn("result_batches", "stream_section", "VARCHAR(80) NULL AFTER class_id")
  await connection.query("ALTER TABLE result_batches MODIFY COLUMN status ENUM('draft', 'submitted', 'approved', 'returned', 'locked') NOT NULL DEFAULT 'draft'")
  await addIndex("result_batches", "idx_result_batches_exam_session", "KEY idx_result_batches_exam_session (school_id, exam_session_id, status)")

  await addColumn("result_entries", "enrollment_id", "BIGINT UNSIGNED NULL AFTER student_id")
  await connection.query("ALTER TABLE result_entries MODIFY COLUMN status ENUM('draft', 'submitted', 'approved', 'returned', 'locked') NOT NULL DEFAULT 'draft'")
  await addIndex("result_entries", "idx_result_entries_enrollment", "KEY idx_result_entries_enrollment (school_id, enrollment_id)")

  await createTable(
    "term_results",
    `CREATE TABLE term_results (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      enrollment_id BIGINT UNSIGNED NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      term_id BIGINT UNSIGNED NOT NULL,
      class_id BIGINT UNSIGNED NOT NULL,
      stream_section VARCHAR(80),
      total_score DECIMAL(8,2) NOT NULL DEFAULT 0,
      average_score DECIMAL(8,2) NOT NULL DEFAULT 0,
      grade VARCHAR(20),
      position INT NULL,
      status ENUM('draft', 'generated', 'approved', 'locked') NOT NULL DEFAULT 'generated',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_term_result_student_term (school_id, student_id, academic_year_id, term_id, enrollment_id),
      KEY idx_term_results_scope (school_id, academic_year_id, term_id, class_id, status),
      CONSTRAINT fk_term_results_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_term_results_student FOREIGN KEY (student_id) REFERENCES students(id),
      CONSTRAINT fk_term_results_enrollment FOREIGN KEY (enrollment_id) REFERENCES student_enrollments(id),
      CONSTRAINT fk_term_results_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_term_results_term FOREIGN KEY (term_id) REFERENCES terms(id),
      CONSTRAINT fk_term_results_class FOREIGN KEY (class_id) REFERENCES classes(id)
    )`,
  )

  await createTable(
    "subject_results",
    `CREATE TABLE subject_results (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      term_result_id BIGINT UNSIGNED NOT NULL,
      subject_id BIGINT UNSIGNED NOT NULL,
      teacher_id BIGINT UNSIGNED NULL,
      assessment_id BIGINT UNSIGNED NULL,
      result_batch_id BIGINT UNSIGNED NULL,
      score DECIMAL(8,2) NOT NULL DEFAULT 0,
      grade VARCHAR(20),
      comment VARCHAR(255),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_subject_result_source (school_id, term_result_id, subject_id, assessment_id),
      KEY idx_subject_results_batch (school_id, result_batch_id),
      CONSTRAINT fk_subject_results_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_subject_results_term FOREIGN KEY (term_result_id) REFERENCES term_results(id),
      CONSTRAINT fk_subject_results_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
      CONSTRAINT fk_subject_results_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
      CONSTRAINT fk_subject_results_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
      CONSTRAINT fk_subject_results_batch FOREIGN KEY (result_batch_id) REFERENCES result_batches(id)
    )`,
  )

  await createTable(
    "report_cards",
    `CREATE TABLE report_cards (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
      school_id BIGINT UNSIGNED NOT NULL,
      student_id BIGINT UNSIGNED NOT NULL,
      enrollment_id BIGINT UNSIGNED NULL,
      academic_year_id BIGINT UNSIGNED NOT NULL,
      term_id BIGINT UNSIGNED NOT NULL,
      exam_session_id BIGINT UNSIGNED NULL,
      term_result_id BIGINT UNSIGNED NULL,
      status ENUM('generated', 'approved', 'locked', 'archived') NOT NULL DEFAULT 'generated',
      generated_by BIGINT UNSIGNED NULL,
      generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_report_card_term_session (school_id, student_id, academic_year_id, term_id, exam_session_id),
      KEY idx_report_cards_scope (school_id, academic_year_id, term_id, exam_session_id, status),
      CONSTRAINT fk_report_cards_school FOREIGN KEY (school_id) REFERENCES schools(id),
      CONSTRAINT fk_report_cards_student FOREIGN KEY (student_id) REFERENCES students(id),
      CONSTRAINT fk_report_cards_enrollment FOREIGN KEY (enrollment_id) REFERENCES student_enrollments(id),
      CONSTRAINT fk_report_cards_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
      CONSTRAINT fk_report_cards_term FOREIGN KEY (term_id) REFERENCES terms(id),
      CONSTRAINT fk_report_cards_session FOREIGN KEY (exam_session_id) REFERENCES exam_sessions(id),
      CONSTRAINT fk_report_cards_term_result FOREIGN KEY (term_result_id) REFERENCES term_results(id),
      CONSTRAINT fk_report_cards_generated_by FOREIGN KEY (generated_by) REFERENCES users(id)
    )`,
  )

  console.log(changes.length ? `Applied: ${changes.join(", ")}` : "No exam cycle changes needed.")
} finally {
  await connection.end()
}
