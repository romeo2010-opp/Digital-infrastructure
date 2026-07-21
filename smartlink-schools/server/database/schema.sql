CREATE DATABASE IF NOT EXISTS smartlink_schools CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smartlink_schools;

CREATE TABLE IF NOT EXISTS schools (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(40) NOT NULL UNIQUE,
  school_prefix VARCHAR(20) NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  city VARCHAR(120),
  country VARCHAR(120) DEFAULT 'Malawi',
  status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NULL,
  role ENUM('super_admin', 'school_owner', 'director', 'owner', 'headteacher', 'bursar', 'librarian', 'teacher', 'parent', 'student') NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email VARCHAR(180) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  password_changed_at TIMESTAMP NULL,
  phone VARCHAR(40),
  gender VARCHAR(30),
  date_of_birth DATE NULL,
  national_id VARCHAR(80),
  employee_id VARCHAR(80),
  qualification VARCHAR(160),
  specialization VARCHAR(160),
  address VARCHAR(255),
  profile_photo_url VARCHAR(255),
  employment_status ENUM('active', 'inactive', 'suspended', 'left') NOT NULL DEFAULT 'active',
  role_type ENUM('teacher', 'headteacher', 'deputy_headteacher', 'admin_teacher') NOT NULL DEFAULT 'teacher',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_school_employee (school_id, employee_id),
  CONSTRAINT fk_users_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS classes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  grade_level VARCHAR(40),
  teacher_user_id BIGINT UNSIGNED NULL,
  max_capacity INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_classes_school_name (school_id, name),
  CONSTRAINT fk_classes_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_classes_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS subjects (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(40),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subjects_school_name (school_id, name),
  CONSTRAINT fk_subjects_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS academic_years (
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
);

CREATE TABLE IF NOT EXISTS terms (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  term_number INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  revision_start_date DATE NULL,
  revision_end_date DATE NULL,
  exam_start_date DATE NULL,
  exam_end_date DATE NULL,
  marking_start_date DATE NULL,
  marking_end_date DATE NULL,
  closing_date DATE NULL,
  status ENUM('upcoming', 'open', 'marking', 'closed', 'archived') NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_terms_school_year_number (school_id, academic_year_id, term_number),
  KEY idx_terms_school_status (school_id, status),
  CONSTRAINT fk_terms_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_terms_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
);

CREATE TABLE IF NOT EXISTS teacher_class_subject_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  stream_section VARCHAR(80),
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  academic_year VARCHAR(20) NOT NULL,
  term VARCHAR(80) NOT NULL DEFAULT '',
  role ENUM('subject_teacher', 'class_teacher') NOT NULL DEFAULT 'subject_teacher',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_teacher_assignments_scope (school_id, class_id, academic_year, term, is_active),
  KEY idx_teacher_assignments_teacher (school_id, teacher_id, is_active),
  KEY idx_teacher_assignments_session (school_id, academic_year_id, term_id, class_id, subject_id, is_active),
  CONSTRAINT fk_teacher_assignments_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_teacher_assignments_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_teacher_assignments_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_teacher_assignments_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS students (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NULL,
  student_id VARCHAR(80) NULL,
  admission_no VARCHAR(80) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender VARCHAR(30) NOT NULL,
  national_id VARCHAR(80),
  profile_photo_url VARCHAR(255),
  stream_section VARCHAR(80),
  enrollment_date DATE NULL,
  student_type ENUM('new', 'returning', 'transfer') NOT NULL DEFAULT 'new',
  previous_school VARCHAR(160),
  status ENUM('active', 'suspended', 'transferred_out', 'withdrawn', 'graduated', 'archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_students_school_student_id (school_id, student_id),
  UNIQUE KEY uq_students_school_admission (school_id, admission_no),
  KEY idx_students_school_class (school_id, class_id),
  CONSTRAINT fk_students_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES classes(id)
);

CREATE TABLE IF NOT EXISTS school_student_sequences (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  sequence_year INT NOT NULL,
  last_sequence INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_student_sequence (school_id, sequence_year),
  CONSTRAINT fk_student_sequences_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS student_guardians (
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
);

CREATE TABLE IF NOT EXISTS student_fee_profiles (
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
);

CREATE TABLE IF NOT EXISTS student_enrollments (
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
);

CREATE TABLE IF NOT EXISTS student_withdrawals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  notes TEXT NULL,
  withdrawal_type ENUM('temporary', 'permanent') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('active', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  cancelled_by BIGINT UNSIGNED NULL,
  cancelled_at TIMESTAMP NULL,
  cancel_reason VARCHAR(255) NULL,
  KEY idx_student_withdrawals_student (school_id, student_id, status, start_date, end_date),
  KEY idx_student_withdrawals_school_status (school_id, status, withdrawal_type, start_date),
  KEY idx_student_withdrawals_created_by (school_id, created_by),
  CONSTRAINT fk_student_withdrawals_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_student_withdrawals_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_student_withdrawals_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_student_withdrawals_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS parent_student_links (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  parent_user_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  relationship VARCHAR(60) NOT NULL DEFAULT 'guardian',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_parent_student_school (school_id, parent_user_id, student_id),
  CONSTRAINT fk_parent_links_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_parent_links_parent FOREIGN KEY (parent_user_id) REFERENCES users(id),
  CONSTRAINT fk_parent_links_student FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS fee_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  term_name VARCHAR(80) NOT NULL,
  amount_due DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('unpaid', 'paid', 'partial', 'overdue') NOT NULL DEFAULT 'unpaid',
  due_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fee_account_term (school_id, student_id, term_name),
  CONSTRAINT fk_fee_accounts_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_fee_accounts_student FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS fee_payments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  fee_account_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_method VARCHAR(60) NOT NULL DEFAULT 'cash',
  reference VARCHAR(120),
  receipt_no VARCHAR(80) NOT NULL UNIQUE,
  recorded_by BIGINT UNSIGNED NOT NULL,
  paid_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fee_payments_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_fee_payments_account FOREIGN KEY (fee_account_id) REFERENCES fee_accounts(id),
  CONSTRAINT fk_fee_payments_user FOREIGN KEY (recorded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_sequences (
  school_id BIGINT UNSIGNED NOT NULL,
  sequence_key VARCHAR(120) NOT NULL,
  next_value BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id, sequence_key),
  CONSTRAINT fk_finance_sequences_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  status ENUM('present', 'absent', 'late', 'sick') NOT NULL,
  note VARCHAR(255),
  marked_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_student_date (school_id, student_id, attendance_date),
  KEY idx_attendance_school_date (school_id, attendance_date),
  CONSTRAINT fk_attendance_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_attendance_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_attendance_user FOREIGN KEY (marked_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS homework (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  instructions TEXT,
  due_date DATE NOT NULL,
  status ENUM('pending', 'submitted', 'late', 'closed') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_homework_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_homework_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_homework_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_homework_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS homework_submissions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  homework_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'submitted', 'late') NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMP NULL,
  UNIQUE KEY uq_homework_submission (school_id, homework_id, student_id),
  CONSTRAINT fk_homework_submissions_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_homework_submissions_homework FOREIGN KEY (homework_id) REFERENCES homework(id),
  CONSTRAINT fk_homework_submissions_student FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  message_type ENUM('fee_reminder', 'homework_reminder', 'announcement', 'attendance_alert') NOT NULL,
  subject VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  recipient_scope JSON NOT NULL,
  channel ENUM('sms_ready', 'whatsapp_ready', 'in_app') NOT NULL DEFAULT 'sms_ready',
  delivery_status ENUM('sent', 'pending', 'failed') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_messages_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS school_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  event_type ENUM('school_event', 'academic_deadline', 'holiday', 'closure', 'meeting', 'sports', 'exam_session', 'exam_paper', 'recurring_assessment', 'weekly_test', 'revision_week', 'exam_week', 'marking_week', 'term_closing_week', 'custom') NOT NULL DEFAULT 'school_event',
  start_datetime DATETIME NOT NULL,
  end_datetime DATETIME NULL,
  all_day TINYINT(1) NOT NULL DEFAULT 0,
  class_id BIGINT UNSIGNED NULL,
  stream_section VARCHAR(80) NULL,
  subject_id BIGINT UNSIGNED NULL,
  teacher_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  visibility ENUM('whole_school', 'teachers_only', 'students', 'parents', 'class_only', 'staff_only') NOT NULL DEFAULT 'whole_school',
  recurrence_rule VARCHAR(255) NULL,
  recurrence_end_date DATE NULL,
  source_type ENUM('manual', 'recurring_template', 'exam_session', 'exam_timetable', 'academic_timeline') NULL DEFAULT 'manual',
  source_id BIGINT UNSIGNED NULL,
  status ENUM('draft', 'scheduled', 'active', 'completed', 'cancelled', 'archived') NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_school_events_scope (school_id, academic_year_id, term_id, status),
  KEY idx_school_events_date (school_id, start_datetime, status),
  KEY idx_school_events_class_subject (school_id, class_id, subject_id, teacher_id),
  KEY idx_school_events_type (school_id, event_type, status),
  CONSTRAINT fk_school_events_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_school_events_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_school_events_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_school_events_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_school_events_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_school_events_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_school_events_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS recurring_assessment_templates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  assessment_type ENUM('weekly_spelling_test', 'weekly_test', 'quiz', 'reading_check', 'mental_maths', 'vocabulary_test', 'custom') NOT NULL DEFAULT 'weekly_test',
  class_id BIGINT UNSIGNED NOT NULL,
  stream_section VARCHAR(80) NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  total_marks DECIMAL(8,2) NOT NULL DEFAULT 10,
  frequency ENUM('weekly', 'biweekly', 'monthly', 'custom') NOT NULL DEFAULT 'weekly',
  day_of_week TINYINT UNSIGNED NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  default_start_time TIME NULL,
  default_duration_minutes INT NULL,
  status ENUM('draft', 'active', 'paused', 'completed', 'archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_recurring_templates_scope (school_id, academic_year_id, term_id, status),
  KEY idx_recurring_templates_class_subject (school_id, class_id, subject_id, teacher_id),
  CONSTRAINT fk_recurring_templates_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_recurring_templates_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_recurring_templates_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_recurring_templates_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_recurring_templates_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_recurring_templates_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_recurring_templates_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assessment_instances (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  template_id BIGINT UNSIGNED NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  stream_section VARCHAR(80) NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  instance_date DATE NOT NULL,
  start_time TIME NULL,
  duration_minutes INT NULL,
  total_marks DECIMAL(8,2) NOT NULL DEFAULT 10,
  status ENUM('upcoming', 'draft', 'in_progress', 'completed', 'cancelled', 'archived') NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_instance_template (school_id, template_id, instance_date, class_id, subject_id),
  KEY idx_assessment_instances_scope (school_id, academic_year_id, term_id, status),
  KEY idx_assessment_instances_date (school_id, instance_date, class_id, subject_id),
  KEY idx_assessment_instances_teacher (school_id, teacher_id, academic_year_id, term_id),
  CONSTRAINT fk_assessment_instances_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_instances_template FOREIGN KEY (template_id) REFERENCES recurring_assessment_templates(id),
  CONSTRAINT fk_assessment_instances_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_assessment_instances_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_assessment_instances_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_assessment_instances_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_assessment_instances_teacher FOREIGN KEY (teacher_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assessment_instance_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_instance_id BIGINT UNSIGNED NOT NULL,
  item_text VARCHAR(255) NOT NULL,
  item_type ENUM('word', 'question', 'instruction') NOT NULL DEFAULT 'word',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_instance_items (school_id, assessment_instance_id, sort_order),
  CONSTRAINT fk_assessment_instance_items_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_instance_items_instance FOREIGN KEY (assessment_instance_id) REFERENCES assessment_instances(id)
);

CREATE TABLE IF NOT EXISTS assessment_instance_results (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_instance_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  enrollment_id BIGINT UNSIGNED NULL,
  score DECIMAL(8,2) NULL,
  comment VARCHAR(255) NULL,
  status ENUM('draft', 'submitted', 'completed', 'locked') NOT NULL DEFAULT 'draft',
  last_saved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_instance_result_student (school_id, assessment_instance_id, student_id),
  KEY idx_assessment_instance_results_student (school_id, student_id),
  KEY idx_assessment_instance_results_enrollment (school_id, enrollment_id),
  CONSTRAINT fk_assessment_instance_results_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_instance_results_instance FOREIGN KEY (assessment_instance_id) REFERENCES assessment_instances(id),
  CONSTRAINT fk_assessment_instance_results_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_assessment_instance_results_enrollment FOREIGN KEY (enrollment_id) REFERENCES student_enrollments(id)
);

CREATE TABLE IF NOT EXISTS term_timeline_markers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  marker_type ENUM('normal_week', 'revision_week', 'exam_week', 'marking_week', 'closing_week', 'holiday', 'custom') NOT NULL DEFAULT 'custom',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('draft', 'scheduled', 'active', 'completed', 'cancelled', 'archived') NOT NULL DEFAULT 'scheduled',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_term_marker_range (school_id, term_id, marker_type, start_date, end_date),
  KEY idx_term_markers_scope (school_id, academic_year_id, term_id, status),
  CONSTRAINT fk_term_markers_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_term_markers_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_term_markers_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_term_markers_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_sessions (
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
);

CREATE TABLE IF NOT EXISTS assessments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  exam_session_id BIGINT UNSIGNED NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  stream_section VARCHAR(80) NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  teacher_id BIGINT UNSIGNED NULL,
  administering_teacher_id BIGINT UNSIGNED NULL,
  name VARCHAR(180) NOT NULL,
  assessment_type ENUM('class_test', 'quiz', 'assignment', 'mid_term', 'end_of_term_exam', 'mock_exam', 'final_exam') NOT NULL DEFAULT 'class_test',
  term_name VARCHAR(80) NOT NULL,
  total_marks DECIMAL(8,2) NOT NULL,
  duration_minutes INT NULL,
  instructions TEXT NULL,
  expected_difficulty ENUM('Easy', 'Medium', 'Hard') NOT NULL DEFAULT 'Medium',
  status ENUM('draft', 'open', 'ready_for_review', 'approved', 'scheduled', 'marking', 'results_submitted', 'results_approved', 'returned', 'locked', 'archived') NOT NULL DEFAULT 'open',
  return_reason VARCHAR(255) NULL,
  returned_by BIGINT UNSIGNED NULL,
  returned_at TIMESTAMP NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessments_session (school_id, academic_year_id, term_id, class_id, subject_id, status),
  KEY idx_assessments_exam_session (school_id, exam_session_id, assessment_type, status),
  KEY idx_assessments_teacher_scope (school_id, teacher_id, academic_year_id, term_id, status),
  CONSTRAINT fk_assessments_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessments_exam_session FOREIGN KEY (exam_session_id) REFERENCES exam_sessions(id),
  CONSTRAINT fk_assessments_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_assessments_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_assessments_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assessment_questions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  question_number INT NOT NULL,
  display_number VARCHAR(80) NULL,
  source_import_question_id BIGINT UNSIGNED NULL,
  question_text TEXT NOT NULL,
  question_type ENUM('multiple_choice', 'true_false', 'short_answer', 'structured', 'essay', 'calculation', 'fill_blank') NOT NULL DEFAULT 'short_answer',
  marks DECIMAL(8,2) NOT NULL,
  topic_id BIGINT UNSIGNED NULL,
  topic_text VARCHAR(160) NULL,
  subtopic_id BIGINT UNSIGNED NULL,
  subtopic_text VARCHAR(160) NULL,
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
  cognitive_skill ENUM('recall', 'understanding', 'application', 'analysis') NULL,
  question_instructions TEXT NULL,
  attachment_url VARCHAR(255) NULL,
  correct_answer TEXT NULL,
  marking_scheme TEXT NULL,
  explanation TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_questions_scope (school_id, assessment_id, sort_order),
  KEY idx_assessment_questions_source_import (source_import_question_id),
  CONSTRAINT fk_assessment_questions_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_questions_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id)
);

CREATE TABLE IF NOT EXISTS assessment_question_options (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  option_label VARCHAR(8) NOT NULL,
  option_text TEXT NOT NULL,
  is_correct TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_question_options_scope (school_id, question_id, sort_order),
  CONSTRAINT fk_assessment_question_options_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_question_options_question FOREIGN KEY (question_id) REFERENCES assessment_questions(id)
);

CREATE TABLE IF NOT EXISTS assessment_blocks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  parent_block_id BIGINT UNSIGNED NULL,
  block_type ENUM(
    'cover_field',
    'heading',
    'paragraph',
    'instructions',
    'section',
    'question',
    'sub_question',
    'mcq_options',
    'answer_space',
    'image',
    'shape',
    'table',
    'equation',
    'page_break',
    'text_box',
    'marking_scheme',
    'teacher_note'
  ) NOT NULL,
  content_json JSON NOT NULL,
  style_json JSON NULL,
  metadata_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_printable TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_blocks_scope (school_id, assessment_id, sort_order),
  KEY idx_assessment_blocks_parent (school_id, parent_block_id),
  CONSTRAINT fk_assessment_blocks_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_blocks_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  CONSTRAINT fk_assessment_blocks_parent FOREIGN KEY (parent_block_id) REFERENCES assessment_blocks(id)
);

CREATE TABLE IF NOT EXISTS assessment_media (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(180) NOT NULL,
  file_type VARCHAR(80) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  storage_path VARCHAR(255) NOT NULL,
  alt_text VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_media_scope (school_id, assessment_id, created_at),
  CONSTRAINT fk_assessment_media_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_media_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  CONSTRAINT fk_assessment_media_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_timetable_entries (
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
);

CREATE TABLE IF NOT EXISTS assessment_topics (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  topic_name VARCHAR(160) NOT NULL,
  marks_allocated DECIMAL(8,2) NOT NULL,
  expected_difficulty ENUM('Easy', 'Medium', 'Hard') NOT NULL DEFAULT 'Medium',
  CONSTRAINT fk_assessment_topics_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_topics_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id)
);

CREATE TABLE IF NOT EXISTS result_batches (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  exam_session_id BIGINT UNSIGNED NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  stream_section VARCHAR(80),
  subject_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft', 'absent', 'submitted', 'approved', 'returned', 'locked') NOT NULL DEFAULT 'draft',
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
  KEY idx_result_batches_exam_session (school_id, exam_session_id, status),
  CONSTRAINT fk_result_batches_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_result_batches_exam_session FOREIGN KEY (exam_session_id) REFERENCES exam_sessions(id),
  CONSTRAINT fk_result_batches_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  CONSTRAINT fk_result_batches_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_result_batches_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_result_batches_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_result_batches_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_result_batches_teacher FOREIGN KEY (teacher_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS result_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  result_batch_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  enrollment_id BIGINT UNSIGNED NULL,
  score DECIMAL(8,2) NULL,
  grade VARCHAR(20),
  comment VARCHAR(255),
  status ENUM('draft', 'submitted', 'approved', 'returned', 'locked') NOT NULL DEFAULT 'draft',
  last_saved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_result_entry_student (school_id, result_batch_id, student_id),
  KEY idx_result_entries_student (school_id, student_id),
  KEY idx_result_entries_enrollment (school_id, enrollment_id),
  CONSTRAINT fk_result_entries_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_result_entries_batch FOREIGN KEY (result_batch_id) REFERENCES result_batches(id),
  CONSTRAINT fk_result_entries_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_result_entries_enrollment FOREIGN KEY (enrollment_id) REFERENCES student_enrollments(id)
);

CREATE TABLE IF NOT EXISTS term_results (
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
);

CREATE TABLE IF NOT EXISTS subject_results (
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
);

CREATE TABLE IF NOT EXISTS report_cards (
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
);

CREATE TABLE IF NOT EXISTS assessment_topic_marks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_topic_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  marks_obtained DECIMAL(8,2) NOT NULL,
  UNIQUE KEY uq_topic_mark_student (school_id, assessment_topic_id, student_id),
  CONSTRAINT fk_assessment_marks_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_marks_topic FOREIGN KEY (assessment_topic_id) REFERENCES assessment_topics(id),
  CONSTRAINT fk_assessment_marks_student FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS daily_drills (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  topic_name VARCHAR(160) NOT NULL,
  prompt TEXT NOT NULL,
  status ENUM('queued', 'in_progress', 'complete') NOT NULL DEFAULT 'queued',
  score DECIMAL(5,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_daily_drills_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_daily_drills_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_daily_drills_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS exam_forecast_topics (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  exam_track VARCHAR(80) NOT NULL,
  subject_name VARCHAR(120) NOT NULL,
  topic_name VARCHAR(160) NOT NULL,
  frequency_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  marks_weight DECIMAL(5,2) NOT NULL DEFAULT 0,
  recency_gap DECIMAL(5,2) NOT NULL DEFAULT 0,
  weakness_level DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_forecast_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS school_settings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  setting_key VARCHAR(120) NOT NULL,
  setting_value JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_setting (school_id, setting_key),
  CONSTRAINT fk_school_settings_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS director_settings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  setting_key VARCHAR(120) NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_director_settings_key (school_id, setting_key),
  CONSTRAINT fk_director_settings_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_director_settings_user FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS admission_leads (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_name VARCHAR(160) NOT NULL,
  guardian_name VARCHAR(160) NULL,
  guardian_phone VARCHAR(40) NULL,
  intended_class_id BIGINT UNSIGNED NULL,
  stage ENUM('inquiry', 'assessment', 'accepted', 'registered', 'lost') NOT NULL DEFAULT 'inquiry',
  expected_fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_admission_leads_scope (school_id, stage, intended_class_id, created_at),
  CONSTRAINT fk_admission_leads_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_admission_leads_class FOREIGN KEY (intended_class_id) REFERENCES classes(id),
  CONSTRAINT fk_admission_leads_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  attendance_date DATE NOT NULL,
  status ENUM('present', 'absent', 'late', 'excused') NOT NULL DEFAULT 'present',
  check_in_time TIME NULL,
  notes VARCHAR(255) NULL,
  recorded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_staff_attendance_day (school_id, staff_user_id, attendance_date),
  KEY idx_staff_attendance_scope (school_id, attendance_date, status),
  CONSTRAINT fk_staff_attendance_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_staff_attendance_staff FOREIGN KEY (staff_user_id) REFERENCES users(id),
  CONSTRAINT fk_staff_attendance_recorded FOREIGN KEY (recorded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS school_incidents (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  incident_type VARCHAR(80) NOT NULL DEFAULT 'other',
  severity ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  student_id BIGINT UNSIGNED NULL,
  staff_id BIGINT UNSIGNED NULL,
  incident_date DATE NOT NULL,
  status ENUM('open', 'investigating', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  description TEXT NULL,
  action_taken TEXT NULL,
  reported_by BIGINT UNSIGNED NULL,
  resolved_by BIGINT UNSIGNED NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_school_incidents_scope (school_id, incident_date, status, severity),
  CONSTRAINT fk_school_incidents_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_school_incidents_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_school_incidents_staff FOREIGN KEY (staff_id) REFERENCES users(id),
  CONSTRAINT fk_school_incidents_reported FOREIGN KEY (reported_by) REFERENCES users(id),
  CONSTRAINT fk_school_incidents_resolved FOREIGN KEY (resolved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS school_complaints (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  complainant_name VARCHAR(160) NOT NULL,
  complainant_contact VARCHAR(80) NULL,
  student_id BIGINT UNSIGNED NULL,
  category ENUM('fees', 'teacher', 'academics', 'bullying', 'transport', 'communication', 'other') NOT NULL DEFAULT 'other',
  priority ENUM('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'medium',
  status ENUM('open', 'in_progress', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  description TEXT NOT NULL,
  resolution_notes TEXT NULL,
  assigned_to BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_school_complaints_scope (school_id, status, priority, category, created_at),
  CONSTRAINT fk_school_complaints_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_school_complaints_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_school_complaints_assignee FOREIGN KEY (assigned_to) REFERENCES users(id),
  CONSTRAINT fk_school_complaints_created FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS director_approvals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  approval_type ENUM('fee_discount', 'bursary', 'expense', 'student_deletion', 'withdrawal_cancel', 'report_publish', 'term_closure', 'other') NOT NULL DEFAULT 'other',
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  requested_by BIGINT UNSIGNED NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  urgency ENUM('normal', 'urgent') NOT NULL DEFAULT 'normal',
  reason TEXT NULL,
  decision_notes TEXT NULL,
  decided_by BIGINT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_director_approvals_scope (school_id, status, approval_type, created_at),
  CONSTRAINT fk_director_approvals_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_director_approvals_requested FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_director_approvals_decided FOREIGN KEY (decided_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_role VARCHAR(60) NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  before_value JSON NULL,
  after_value JSON NULL,
  ip_address VARCHAR(80) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_logs_scope (school_id, created_at, entity_type),
  KEY idx_audit_logs_action (school_id, action, created_at),
  CONSTRAINT fk_audit_logs_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS class_progression_rules (
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
);

CREATE TABLE IF NOT EXISTS term_closures (
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
);

CREATE TABLE IF NOT EXISTS promotion_decisions (
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
);

CREATE OR REPLACE VIEW assessment_topic_summaries AS
SELECT
  at.school_id,
  subj.name AS subject_name,
  at.topic_name,
  ROUND(AVG((atm.marks_obtained / NULLIF(at.marks_allocated, 0)) * 100), 1) AS average_score,
  SUM(CASE WHEN (atm.marks_obtained / NULLIF(at.marks_allocated, 0)) * 100 < 50 THEN 1 ELSE 0 END) AS students_needing_support
FROM assessment_topics at
JOIN assessments a ON a.id = at.assessment_id AND a.school_id = at.school_id
JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
LEFT JOIN assessment_topic_marks atm ON atm.assessment_topic_id = at.id AND atm.school_id = at.school_id
GROUP BY at.school_id, subj.name, at.topic_name;
