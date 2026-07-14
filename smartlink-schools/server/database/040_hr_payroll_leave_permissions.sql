USE smartlink_schools;

CREATE TABLE IF NOT EXISTS user_permissions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  permission_code VARCHAR(80) NOT NULL,
  is_allowed TINYINT(1) NOT NULL DEFAULT 1,
  granted_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_permission (school_id, user_id, permission_code),
  UNIQUE KEY uq_user_permission_ref (public_ref),
  KEY idx_user_permission_scope (school_id, permission_code, is_allowed),
  CONSTRAINT fk_user_permission_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_user_permission_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_permission_granter FOREIGN KEY (granted_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS school_hr_settings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  payroll_frequency ENUM('monthly','weekly','termly','custom') NOT NULL DEFAULT 'monthly',
  default_currency CHAR(3) NOT NULL DEFAULT 'MWK',
  payroll_requires_director_approval TINYINT(1) NOT NULL DEFAULT 1,
  allow_bursar_payroll_access TINYINT(1) NOT NULL DEFAULT 0,
  allow_teacher_payslip_view TINYINT(1) NOT NULL DEFAULT 0,
  default_annual_leave_days DECIMAL(6,2) NOT NULL DEFAULT 0,
  default_sick_leave_days DECIMAL(6,2) NOT NULL DEFAULT 0,
  allow_teacher_leave_requests TINYINT(1) NOT NULL DEFAULT 0,
  require_leave_coverage TINYINT(1) NOT NULL DEFAULT 1,
  notify_director_leave_request TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_hr_settings (school_id),
  CONSTRAINT fk_school_hr_settings_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS staff_salary_profiles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  base_salary DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'MWK',
  payment_frequency ENUM('monthly','weekly','termly','custom') NOT NULL DEFAULT 'monthly',
  bank_name VARCHAR(120) NULL,
  bank_account_name VARCHAR(160) NULL,
  bank_account_number VARCHAR(120) NULL,
  mobile_money_provider VARCHAR(80) NULL,
  mobile_money_number VARCHAR(60) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_salary_profile_staff (school_id, staff_user_id),
  UNIQUE KEY uq_salary_profile_ref (public_ref),
  KEY idx_salary_profile_scope (school_id, is_active),
  CONSTRAINT fk_salary_profile_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_salary_profile_staff FOREIGN KEY (staff_user_id) REFERENCES users(id),
  CONSTRAINT fk_salary_profile_creator FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  payroll_period_start DATE NOT NULL,
  payroll_period_end DATE NOT NULL,
  title VARCHAR(180) NOT NULL,
  status ENUM('draft','pending_approval','approved','paid','cancelled') NOT NULL DEFAULT 'draft',
  currency CHAR(3) NOT NULL DEFAULT 'MWK',
  total_gross_pay DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_allowances DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_net_pay DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  paid_by BIGINT UNSIGNED NULL,
  paid_at TIMESTAMP NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payroll_run_ref (public_ref),
  KEY idx_payroll_run_scope (school_id, payroll_period_end, status),
  CONSTRAINT fk_payroll_run_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_payroll_run_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_payroll_run_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_payroll_run_payer FOREIGN KEY (paid_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  payroll_run_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  base_salary DECIMAL(14,2) NOT NULL,
  allowances_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  deductions_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  gross_pay DECIMAL(14,2) NOT NULL,
  net_pay DECIMAL(14,2) NOT NULL,
  unpaid_leave_days DECIMAL(6,2) NOT NULL DEFAULT 0,
  status ENUM('draft','approved','paid','withheld','cancelled') NOT NULL DEFAULT 'draft',
  payment_reference VARCHAR(160) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payroll_item_staff (school_id, payroll_run_id, staff_user_id),
  UNIQUE KEY uq_payroll_item_ref (public_ref),
  KEY idx_payroll_item_scope (school_id, payroll_run_id, status),
  CONSTRAINT fk_payroll_item_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_payroll_item_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id),
  CONSTRAINT fk_payroll_item_staff FOREIGN KEY (staff_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payroll_allowances (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  payroll_item_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(140) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payroll_allowance_ref (public_ref),
  CONSTRAINT fk_payroll_allowance_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_payroll_allowance_item FOREIGN KEY (payroll_item_id) REFERENCES payroll_items(id)
);

CREATE TABLE IF NOT EXISTS payroll_deductions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  payroll_item_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(140) NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payroll_deduction_ref (public_ref),
  CONSTRAINT fk_payroll_deduction_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_payroll_deduction_item FOREIGN KEY (payroll_item_id) REFERENCES payroll_items(id)
);

CREATE TABLE IF NOT EXISTS staff_leave_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  leave_type ENUM('sick','annual','maternity','paternity','compassionate','unpaid','study','other') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days DECIMAL(6,2) NOT NULL,
  reason TEXT NOT NULL,
  status ENUM('pending','approved','rejected','cancelled','completed') NOT NULL DEFAULT 'pending',
  coverage_staff_user_id BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  decision_notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_staff_leave_ref (public_ref),
  KEY idx_staff_leave_scope (school_id, status, start_date, end_date),
  KEY idx_staff_leave_staff (school_id, staff_user_id, start_date, end_date),
  CONSTRAINT fk_staff_leave_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_staff_leave_staff FOREIGN KEY (staff_user_id) REFERENCES users(id),
  CONSTRAINT fk_staff_leave_coverage FOREIGN KEY (coverage_staff_user_id) REFERENCES users(id),
  CONSTRAINT fk_staff_leave_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_staff_leave_creator FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS staff_leave_balances (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  staff_user_id BIGINT UNSIGNED NOT NULL,
  leave_type ENUM('sick','annual','maternity','paternity','compassionate','unpaid','study','other') NOT NULL,
  leave_year YEAR NOT NULL,
  entitlement_days DECIMAL(6,2) NOT NULL DEFAULT 0,
  used_days DECIMAL(6,2) NOT NULL DEFAULT 0,
  remaining_days DECIMAL(6,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_staff_leave_balance (school_id, staff_user_id, leave_type, leave_year),
  UNIQUE KEY uq_staff_leave_balance_ref (public_ref),
  CONSTRAINT fk_staff_leave_balance_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_staff_leave_balance_staff FOREIGN KEY (staff_user_id) REFERENCES users(id)
);

ALTER TABLE staff_attendance
  MODIFY COLUMN status ENUM('present','absent','late','excused','on_leave','unrecorded') NOT NULL DEFAULT 'present';
