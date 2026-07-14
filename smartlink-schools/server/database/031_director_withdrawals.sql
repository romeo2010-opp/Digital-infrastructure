USE smartlink_schools;

ALTER TABLE users
  MODIFY role ENUM('super_admin', 'school_owner', 'director', 'owner', 'headteacher', 'bursar', 'teacher', 'parent', 'student') NOT NULL;

ALTER TABLE result_entries
  MODIFY status ENUM('draft', 'absent', 'submitted', 'approved', 'returned', 'locked') NOT NULL DEFAULT 'draft';

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
