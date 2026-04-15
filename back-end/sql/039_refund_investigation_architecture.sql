-- 039_refund_investigation_architecture.sql
-- Refund evidence chain architecture for transaction -> pump session -> telemetry -> review.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_tx_payment_reference := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'payment_reference'
);
SET @sql := IF(
  @has_tx_payment_reference = 0,
  'ALTER TABLE transactions ADD COLUMN payment_reference VARCHAR(128) NULL AFTER reservation_public_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_requested_litres := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'requested_litres'
);
SET @sql := IF(
  @has_tx_requested_litres = 0,
  'ALTER TABLE transactions ADD COLUMN requested_litres DECIMAL(12,3) NULL AFTER total_amount',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_authorized_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'authorized_at'
);
SET @sql := IF(
  @has_tx_authorized_at = 0,
  'ALTER TABLE transactions ADD COLUMN authorized_at TIMESTAMP(3) NULL AFTER occurred_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_dispensed_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'dispensed_at'
);
SET @sql := IF(
  @has_tx_dispensed_at = 0,
  'ALTER TABLE transactions ADD COLUMN dispensed_at TIMESTAMP(3) NULL AFTER authorized_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_settled_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'settled_at'
);
SET @sql := IF(
  @has_tx_settled_at = 0,
  'ALTER TABLE transactions ADD COLUMN settled_at TIMESTAMP(3) NULL AFTER dispensed_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_tx_payment_reference_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND INDEX_NAME = 'idx_tx_payment_reference'
);
SET @sql := IF(
  @idx_tx_payment_reference_exists = 0,
  'CREATE INDEX idx_tx_payment_reference ON transactions (payment_reference)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS pump_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  transaction_id BIGINT UNSIGNED NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  pump_id BIGINT UNSIGNED NOT NULL,
  nozzle_id BIGINT UNSIGNED NULL,
  session_reference VARCHAR(64) NOT NULL UNIQUE,
  session_status ENUM('CREATED','STARTED','DISPENSING','FAILED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  start_time TIMESTAMP(3) NOT NULL,
  end_time TIMESTAMP(3) NULL,
  dispense_duration_seconds INT UNSIGNED NULL,
  dispensed_litres DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(255) NULL,
  telemetry_correlation_id VARCHAR(96) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pump_sessions_transaction (transaction_id),
  KEY idx_pump_sessions_station_time (station_id, start_time),
  KEY idx_pump_sessions_correlation (telemetry_correlation_id),
  CONSTRAINT fk_pump_sessions_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  CONSTRAINT fk_pump_sessions_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_pump_sessions_pump FOREIGN KEY (pump_id) REFERENCES pumps(id),
  CONSTRAINT fk_pump_sessions_nozzle FOREIGN KEY (nozzle_id) REFERENCES pump_nozzles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pump_telemetry_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NOT NULL,
  pump_id BIGINT UNSIGNED NOT NULL,
  nozzle_id BIGINT UNSIGNED NULL,
  pump_session_id BIGINT UNSIGNED NULL,
  telemetry_correlation_id VARCHAR(96) NULL,
  event_type VARCHAR(64) NOT NULL,
  severity ENUM('INFO','LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'INFO',
  litres_value DECIMAL(12,3) NULL,
  flow_rate DECIMAL(12,3) NULL,
  raw_error_code VARCHAR(64) NULL,
  message VARCHAR(255) NOT NULL,
  payload_json LONGTEXT NULL,
  source_type VARCHAR(64) NOT NULL,
  happened_at TIMESTAMP(3) NOT NULL,
  ingested_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_pump_telemetry_session_time (pump_session_id, happened_at),
  KEY idx_pump_telemetry_station_pump_time (station_id, pump_id, happened_at),
  KEY idx_pump_telemetry_correlation (telemetry_correlation_id, happened_at),
  CONSTRAINT fk_pump_telemetry_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_pump_telemetry_pump FOREIGN KEY (pump_id) REFERENCES pumps(id),
  CONSTRAINT fk_pump_telemetry_nozzle FOREIGN KEY (nozzle_id) REFERENCES pump_nozzles(id),
  CONSTRAINT fk_pump_telemetry_session FOREIGN KEY (pump_session_id) REFERENCES pump_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_refund_transaction_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'transaction_id'
);
SET @sql := IF(
  @has_refund_transaction_id = 0,
  'ALTER TABLE refund_requests ADD COLUMN transaction_id BIGINT UNSIGNED NULL AFTER support_case_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_reason_code := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'refund_reason_code'
);
SET @sql := IF(
  @has_refund_reason_code = 0,
  'ALTER TABLE refund_requests ADD COLUMN refund_reason_code VARCHAR(64) NULL AFTER reason',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_user_statement := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'user_statement'
);
SET @sql := IF(
  @has_refund_user_statement = 0,
  'ALTER TABLE refund_requests ADD COLUMN user_statement TEXT NULL AFTER refund_reason_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_requested_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'requested_at'
);
SET @sql := IF(
  @has_refund_requested_at = 0,
  'ALTER TABLE refund_requests ADD COLUMN requested_at TIMESTAMP(3) NULL AFTER user_statement',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_investigation_status := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'investigation_status'
);
SET @sql := IF(
  @has_refund_investigation_status = 0,
  'ALTER TABLE refund_requests ADD COLUMN investigation_status ENUM(''REQUESTED'',''UNDER_REVIEW'',''ESCALATED'',''APPROVED'',''REJECTED'',''PROCESSING'',''COMPLETED'') NOT NULL DEFAULT ''REQUESTED'' AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_review_stage := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'review_stage'
);
SET @sql := IF(
  @has_refund_review_stage = 0,
  'ALTER TABLE refund_requests ADD COLUMN review_stage ENUM(''SUPPORT'',''FINANCE'',''COMPLIANCE'',''CLOSED'') NOT NULL DEFAULT ''SUPPORT'' AFTER investigation_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_support_reviewed_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'support_reviewed_by_user_id'
);
SET @sql := IF(
  @has_refund_support_reviewed_by = 0,
  'ALTER TABLE refund_requests ADD COLUMN support_reviewed_by_user_id BIGINT UNSIGNED NULL AFTER reviewed_by_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_finance_reviewed_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'finance_reviewed_by_user_id'
);
SET @sql := IF(
  @has_refund_finance_reviewed_by = 0,
  'ALTER TABLE refund_requests ADD COLUMN finance_reviewed_by_user_id BIGINT UNSIGNED NULL AFTER support_reviewed_by_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_compliance_case_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'compliance_case_id'
);
SET @sql := IF(
  @has_refund_compliance_case_id = 0,
  'ALTER TABLE refund_requests ADD COLUMN compliance_case_id BIGINT UNSIGNED NULL AFTER finance_reviewed_by_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_refund_final_decision_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'final_decision_at'
);
SET @sql := IF(
  @has_refund_final_decision_at = 0,
  'ALTER TABLE refund_requests ADD COLUMN final_decision_at TIMESTAMP(3) NULL AFTER compliance_case_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @refund_tx_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND CONSTRAINT_NAME = 'fk_refund_requests_transaction'
);
SET @sql := IF(
  @refund_tx_fk_exists = 0,
  'ALTER TABLE refund_requests ADD CONSTRAINT fk_refund_requests_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @refund_support_review_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND CONSTRAINT_NAME = 'fk_refund_requests_support_reviewed_by'
);
SET @sql := IF(
  @refund_support_review_fk_exists = 0,
  'ALTER TABLE refund_requests ADD CONSTRAINT fk_refund_requests_support_reviewed_by FOREIGN KEY (support_reviewed_by_user_id) REFERENCES users(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @refund_finance_review_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND CONSTRAINT_NAME = 'fk_refund_requests_finance_reviewed_by'
);
SET @sql := IF(
  @refund_finance_review_fk_exists = 0,
  'ALTER TABLE refund_requests ADD CONSTRAINT fk_refund_requests_finance_reviewed_by FOREIGN KEY (finance_reviewed_by_user_id) REFERENCES users(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @refund_compliance_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND CONSTRAINT_NAME = 'fk_refund_requests_compliance_case'
);
SET @sql := IF(
  @refund_compliance_fk_exists = 0,
  'ALTER TABLE refund_requests ADD CONSTRAINT fk_refund_requests_compliance_case FOREIGN KEY (compliance_case_id) REFERENCES compliance_cases(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_refund_transaction_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND INDEX_NAME = 'idx_refund_requests_transaction'
);
SET @sql := IF(
  @idx_refund_transaction_exists = 0,
  'CREATE INDEX idx_refund_requests_transaction ON refund_requests (transaction_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_refund_investigation_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND INDEX_NAME = 'idx_refund_requests_investigation'
);
SET @sql := IF(
  @idx_refund_investigation_exists = 0,
  'CREATE INDEX idx_refund_requests_investigation ON refund_requests (investigation_status, review_stage, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS refund_evidence (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  refund_request_id BIGINT UNSIGNED NOT NULL,
  evidence_type VARCHAR(64) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(96) NULL,
  summary VARCHAR(255) NOT NULL,
  confidence_weight DECIMAL(5,2) NULL,
  attached_by_user_id BIGINT UNSIGNED NOT NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_refund_evidence_ref_source (refund_request_id, evidence_type, source_type, source_id),
  KEY idx_refund_evidence_refund_created (refund_request_id, created_at),
  CONSTRAINT fk_refund_evidence_refund FOREIGN KEY (refund_request_id) REFERENCES refund_requests(id),
  CONSTRAINT fk_refund_evidence_attached_by FOREIGN KEY (attached_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refund_reviews (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  refund_request_id BIGINT UNSIGNED NOT NULL,
  reviewer_user_id BIGINT UNSIGNED NOT NULL,
  reviewer_role VARCHAR(64) NOT NULL,
  decision VARCHAR(64) NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_refund_reviews_refund_created (refund_request_id, created_at),
  CONSTRAINT fk_refund_reviews_refund FOREIGN KEY (refund_request_id) REFERENCES refund_requests(id),
  CONSTRAINT fk_refund_reviews_reviewer FOREIGN KEY (reviewer_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE refund_requests rr
LEFT JOIN transactions tx
  ON tx.public_id = rr.transaction_public_id
SET
  rr.transaction_id = COALESCE(rr.transaction_id, tx.id),
  rr.requested_at = COALESCE(rr.requested_at, rr.created_at),
  rr.refund_reason_code = COALESCE(rr.refund_reason_code, 'CUSTOMER_REFUND_REQUEST'),
  rr.user_statement = COALESCE(rr.user_statement, rr.reason),
  rr.investigation_status = CASE
    WHEN rr.status = 'PENDING_FINANCE_APPROVAL' THEN 'ESCALATED'
    WHEN rr.status = 'APPROVED' THEN 'APPROVED'
    WHEN rr.status = 'REJECTED' THEN 'REJECTED'
    WHEN rr.status = 'PAID' THEN 'COMPLETED'
    ELSE 'REQUESTED'
  END,
  rr.review_stage = CASE
    WHEN rr.status = 'PENDING_FINANCE_APPROVAL' THEN 'FINANCE'
    WHEN rr.status IN ('APPROVED', 'REJECTED', 'PAID') THEN 'CLOSED'
    ELSE 'SUPPORT'
  END,
  rr.final_decision_at = CASE
    WHEN rr.status IN ('APPROVED', 'REJECTED', 'PAID') THEN COALESCE(rr.final_decision_at, rr.reviewed_at, rr.credited_at)
    ELSE rr.final_decision_at
  END
WHERE rr.id IS NOT NULL;
