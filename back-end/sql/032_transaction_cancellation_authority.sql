ALTER TABLE transactions
  ADD COLUMN status ENUM('RECORDED','UNDER_REVIEW','FROZEN','CANCELLED','REVERSED') NOT NULL DEFAULT 'RECORDED' AFTER note,
  ADD COLUMN settlement_impact_status ENUM('UNCHANGED','ADJUSTED','REVERSED') NOT NULL DEFAULT 'UNCHANGED' AFTER status,
  ADD COLUMN workflow_reason_code VARCHAR(64) NULL AFTER settlement_impact_status,
  ADD COLUMN workflow_note TEXT NULL AFTER workflow_reason_code,
  ADD COLUMN status_updated_at TIMESTAMP(3) NULL AFTER workflow_note,
  ADD COLUMN status_updated_by_role_code VARCHAR(64) NULL AFTER status_updated_at,
  ADD COLUMN cancelled_at TIMESTAMP(3) NULL AFTER status_updated_by_role_code;

ALTER TABLE compliance_cases
  MODIFY COLUMN status ENUM('OPEN','INVESTIGATING','FROZEN','FRAUD_CONFIRMED','RESOLVED') NOT NULL DEFAULT 'OPEN';
