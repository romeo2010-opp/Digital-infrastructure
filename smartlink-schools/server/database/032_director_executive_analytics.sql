USE smartlink_schools;

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS max_capacity INT UNSIGNED NULL AFTER teacher_user_id;

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
