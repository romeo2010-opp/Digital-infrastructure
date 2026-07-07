CREATE TABLE IF NOT EXISTS finance_sequences (
  school_id BIGINT UNSIGNED NOT NULL,
  sequence_key VARCHAR(120) NOT NULL,
  next_value BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (school_id, sequence_key),
  CONSTRAINT fk_finance_sequences_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

ALTER TABLE finance_bank_transactions
  ADD COLUMN IF NOT EXISTS matched_by BIGINT UNSIGNED NULL AFTER matched_payment_id,
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMP NULL AFTER matched_by,
  ADD COLUMN IF NOT EXISTS ignored_reason VARCHAR(1000) NULL AFTER status,
  ADD KEY IF NOT EXISTS idx_finance_bank_payment (school_id, matched_payment_id, status);
