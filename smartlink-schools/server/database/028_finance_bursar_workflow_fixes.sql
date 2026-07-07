ALTER TABLE fee_accounts
  MODIFY COLUMN status ENUM('unpaid', 'paid', 'partial', 'overdue') NOT NULL DEFAULT 'unpaid';

UPDATE fee_accounts
SET status = CASE
  WHEN amount_due + penalty_amount - discount_amount - amount_paid <= 0 THEN 'paid'
  WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE THEN 'overdue'
  WHEN amount_paid > 0 THEN 'partial'
  ELSE 'unpaid'
END;

ALTER TABLE finance_discounts
  ADD COLUMN IF NOT EXISTS applied_amount DECIMAL(14,2) NULL AFTER amount_value,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP NULL AFTER approved_at,
  ADD KEY IF NOT EXISTS idx_finance_discounts_applied (school_id, status, applied_at);
