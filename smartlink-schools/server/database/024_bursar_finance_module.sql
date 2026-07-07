ALTER TABLE fee_accounts
  ADD COLUMN IF NOT EXISTS academic_year_id BIGINT UNSIGNED NULL AFTER student_id,
  ADD COLUMN IF NOT EXISTS term_id BIGINT UNSIGNED NULL AFTER academic_year_id,
  ADD COLUMN IF NOT EXISTS class_id BIGINT UNSIGNED NULL AFTER term_id,
  ADD COLUMN IF NOT EXISTS fee_structure_id BIGINT UNSIGNED NULL AFTER class_id,
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER amount_due,
  ADD COLUMN IF NOT EXISTS penalty_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER discount_amount,
  ADD COLUMN IF NOT EXISTS finance_notes TEXT NULL AFTER due_date,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD KEY IF NOT EXISTS idx_fee_accounts_session (school_id, academic_year_id, term_id, class_id, status),
  ADD KEY IF NOT EXISTS idx_fee_accounts_balance (school_id, due_date, status);

ALTER TABLE fee_payments
  ADD COLUMN IF NOT EXISTS invoice_id BIGINT UNSIGNED NULL AFTER fee_account_id,
  ADD COLUMN IF NOT EXISTS status ENUM('posted', 'reversed', 'void') NOT NULL DEFAULT 'posted' AFTER amount,
  ADD COLUMN IF NOT EXISTS paid_on DATE NULL AFTER reference,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL AFTER paid_on,
  ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(255) NULL AFTER notes,
  ADD COLUMN IF NOT EXISTS balance_before DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER attachment_url,
  ADD COLUMN IF NOT EXISTS balance_after DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER balance_before,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP NULL AFTER paid_at,
  ADD COLUMN IF NOT EXISTS reversed_by BIGINT UNSIGNED NULL AFTER reversed_at,
  ADD KEY IF NOT EXISTS idx_fee_payments_invoice (school_id, invoice_id),
  ADD KEY IF NOT EXISTS idx_fee_payments_paid_on (school_id, paid_on, status);

CREATE TABLE IF NOT EXISTS finance_fee_structures (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  class_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  due_date DATE NULL,
  late_penalty_type ENUM('none', 'fixed', 'percent') NOT NULL DEFAULT 'none',
  late_penalty_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount_rules_json JSON NULL,
  status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_finance_fee_structure_scope (school_id, academic_year_id, term_id, class_id, name),
  KEY idx_finance_fee_structures_scope (school_id, academic_year_id, term_id, class_id, status),
  CONSTRAINT fk_finance_fee_structures_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_fee_structures_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_finance_fee_structures_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_finance_fee_structures_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_finance_fee_structures_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_fee_structure_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  fee_structure_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(120) NOT NULL,
  item_type ENUM('tuition', 'boarding', 'transport', 'uniform', 'exam', 'development', 'other') NOT NULL DEFAULT 'other',
  amount DECIMAL(14,2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_finance_structure_items (school_id, fee_structure_id, sort_order),
  CONSTRAINT fk_finance_items_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_items_structure FOREIGN KEY (fee_structure_id) REFERENCES finance_fee_structures(id)
);

CREATE TABLE IF NOT EXISTS finance_fee_structure_applications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  fee_structure_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  class_id BIGINT UNSIGNED NULL,
  applied_by BIGINT UNSIGNED NOT NULL,
  accounts_created INT NOT NULL DEFAULT 0,
  accounts_skipped INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_finance_structure_application (school_id, fee_structure_id, academic_year_id, term_id, class_id),
  CONSTRAINT fk_finance_applications_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_applications_structure FOREIGN KEY (fee_structure_id) REFERENCES finance_fee_structures(id),
  CONSTRAINT fk_finance_applications_user FOREIGN KEY (applied_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_sequences (
  school_id BIGINT UNSIGNED NOT NULL,
  sequence_key VARCHAR(120) NOT NULL,
  next_value BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id, sequence_key),
  CONSTRAINT fk_finance_sequences_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS finance_invoices (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  fee_account_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  invoice_no VARCHAR(80) NOT NULL UNIQUE,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  status ENUM('unpaid', 'partial', 'paid', 'cancelled', 'reversed') NOT NULL DEFAULT 'unpaid',
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  penalty_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  payment_instructions TEXT NULL,
  generated_by BIGINT UNSIGNED NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_finance_invoices_scope (school_id, academic_year_id, term_id, status),
  KEY idx_finance_invoices_account (school_id, fee_account_id, status),
  CONSTRAINT fk_finance_invoices_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_invoices_account FOREIGN KEY (fee_account_id) REFERENCES fee_accounts(id),
  CONSTRAINT fk_finance_invoices_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_finance_invoices_user FOREIGN KEY (generated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_invoice_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  invoice_id BIGINT UNSIGNED NOT NULL,
  item_name VARCHAR(120) NOT NULL,
  item_type VARCHAR(60) NOT NULL DEFAULT 'other',
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_amount DECIMAL(14,2) NOT NULL,
  line_total DECIMAL(14,2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_finance_invoice_items (school_id, invoice_id, sort_order),
  CONSTRAINT fk_finance_invoice_items_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES finance_invoices(id)
);

CREATE TABLE IF NOT EXISTS finance_payment_reversals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  payment_id BIGINT UNSIGNED NOT NULL,
  fee_account_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reason TEXT NOT NULL,
  reversed_by BIGINT UNSIGNED NOT NULL,
  reversed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_finance_reversals_payment (school_id, payment_id),
  CONSTRAINT fk_finance_reversals_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_reversals_payment FOREIGN KEY (payment_id) REFERENCES fee_payments(id),
  CONSTRAINT fk_finance_reversals_account FOREIGN KEY (fee_account_id) REFERENCES fee_accounts(id),
  CONSTRAINT fk_finance_reversals_user FOREIGN KEY (reversed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_discounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  fee_account_id BIGINT UNSIGNED NULL,
  invoice_id BIGINT UNSIGNED NULL,
  discount_type ENUM('scholarship', 'staff_child', 'sibling', 'hardship', 'manual') NOT NULL DEFAULT 'manual',
  amount_type ENUM('amount', 'percent') NOT NULL DEFAULT 'amount',
  amount_value DECIMAL(14,2) NOT NULL,
  reason TEXT NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_finance_discounts_scope (school_id, status, student_id),
  CONSTRAINT fk_finance_discounts_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_discounts_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_finance_discounts_account FOREIGN KEY (fee_account_id) REFERENCES fee_accounts(id),
  CONSTRAINT fk_finance_discounts_invoice FOREIGN KEY (invoice_id) REFERENCES finance_invoices(id),
  CONSTRAINT fk_finance_discounts_requested FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_finance_discounts_approved FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_payment_plans (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  fee_account_id BIGINT UNSIGNED NULL,
  total_balance DECIMAL(14,2) NOT NULL,
  installment_amount DECIMAL(14,2) NOT NULL,
  installment_count INT NOT NULL,
  status ENUM('active', 'completed', 'defaulted', 'cancelled') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_finance_payment_plans_scope (school_id, status, student_id),
  CONSTRAINT fk_finance_plans_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_plans_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_finance_plans_account FOREIGN KEY (fee_account_id) REFERENCES fee_accounts(id),
  CONSTRAINT fk_finance_plans_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_payment_plan_installments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  payment_plan_id BIGINT UNSIGNED NOT NULL,
  installment_no INT NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  status ENUM('upcoming', 'paid', 'overdue', 'cancelled') NOT NULL DEFAULT 'upcoming',
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_finance_plan_installment (school_id, payment_plan_id, installment_no),
  CONSTRAINT fk_finance_installments_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_installments_plan FOREIGN KEY (payment_plan_id) REFERENCES finance_payment_plans(id)
);

CREATE TABLE IF NOT EXISTS finance_expenses (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  category ENUM('salaries', 'utilities', 'stationery', 'maintenance', 'transport', 'food_catering', 'exam_expenses', 'sports_events', 'other') NOT NULL DEFAULT 'other',
  supplier VARCHAR(160) NULL,
  amount DECIMAL(14,2) NOT NULL,
  expense_date DATE NOT NULL,
  payment_method VARCHAR(60) NOT NULL DEFAULT 'cash',
  reference VARCHAR(120) NULL,
  attachment_url VARCHAR(255) NULL,
  description TEXT NULL,
  status ENUM('draft', 'pending_approval', 'approved', 'paid', 'rejected') NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_finance_expenses_scope (school_id, expense_date, status, category),
  CONSTRAINT fk_finance_expenses_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_expenses_created FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_finance_expenses_approved FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_bank_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  transaction_date DATE NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reference VARCHAR(120) NULL,
  payer_name VARCHAR(160) NULL,
  channel VARCHAR(80) NULL,
  matched_payment_id BIGINT UNSIGNED NULL,
  matched_by BIGINT UNSIGNED NULL,
  matched_at TIMESTAMP NULL,
  status ENUM('unmatched', 'matched', 'ignored') NOT NULL DEFAULT 'unmatched',
  ignored_reason VARCHAR(1000) NULL,
  imported_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_finance_bank_scope (school_id, transaction_date, status),
  KEY idx_finance_bank_payment (school_id, matched_payment_id, status),
  CONSTRAINT fk_finance_bank_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_bank_payment FOREIGN KEY (matched_payment_id) REFERENCES fee_payments(id),
  CONSTRAINT fk_finance_bank_matched_by FOREIGN KEY (matched_by) REFERENCES users(id),
  CONSTRAINT fk_finance_bank_user FOREIGN KEY (imported_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  user_role VARCHAR(60) NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  old_value_json JSON NULL,
  new_value_json JSON NULL,
  ip_address VARCHAR(80) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_finance_audit_scope (school_id, entity_type, entity_id, created_at),
  KEY idx_finance_audit_action (school_id, action, created_at),
  CONSTRAINT fk_finance_audit_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_finance_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
);
