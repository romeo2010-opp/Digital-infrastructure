USE smartlink_schools;

-- Additive migration for student setup wizard and subject-teacher assignments.
-- Existing admission_no values are preserved; new wizard-created students also receive student_id.

ALTER TABLE schools ADD COLUMN school_prefix VARCHAR(20) NULL UNIQUE;

ALTER TABLE students
  ADD COLUMN student_id VARCHAR(80) NULL,
  ADD COLUMN national_id VARCHAR(80) NULL,
  ADD COLUMN profile_photo_url VARCHAR(255) NULL,
  ADD COLUMN stream_section VARCHAR(80) NULL,
  ADD COLUMN enrollment_date DATE NULL,
  ADD COLUMN student_type ENUM('new', 'returning', 'transfer') NOT NULL DEFAULT 'new',
  ADD COLUMN previous_school VARCHAR(160) NULL,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD UNIQUE KEY uq_students_school_student_id (school_id, student_id);

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

CREATE TABLE IF NOT EXISTS teacher_class_subject_assignments (
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
);
