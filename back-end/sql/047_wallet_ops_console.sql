-- 047_wallet_ops_console.sql
-- Internal wallet operations console schema, permissions, and policy defaults.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_wallet_is_under_review := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'is_under_review'
);
SET @wallet_is_under_review_sql := IF(
  @has_wallet_is_under_review = 0,
  'ALTER TABLE wallets ADD COLUMN is_under_review TINYINT(1) NOT NULL DEFAULT 0 AFTER status',
  'SELECT 1'
);
PREPARE wallet_is_under_review_stmt FROM @wallet_is_under_review_sql;
EXECUTE wallet_is_under_review_stmt;
DEALLOCATE PREPARE wallet_is_under_review_stmt;

SET @has_wallet_under_review_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'under_review_at'
);
SET @wallet_under_review_at_sql := IF(
  @has_wallet_under_review_at = 0,
  'ALTER TABLE wallets ADD COLUMN under_review_at TIMESTAMP(3) NULL AFTER is_under_review',
  'SELECT 1'
);
PREPARE wallet_under_review_at_stmt FROM @wallet_under_review_at_sql;
EXECUTE wallet_under_review_at_stmt;
DEALLOCATE PREPARE wallet_under_review_at_stmt;

SET @has_wallet_under_review_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'under_review_by_user_id'
);
SET @wallet_under_review_by_sql := IF(
  @has_wallet_under_review_by = 0,
  'ALTER TABLE wallets ADD COLUMN under_review_by_user_id BIGINT UNSIGNED NULL AFTER under_review_at',
  'SELECT 1'
);
PREPARE wallet_under_review_by_stmt FROM @wallet_under_review_by_sql;
EXECUTE wallet_under_review_by_stmt;
DEALLOCATE PREPARE wallet_under_review_by_stmt;

SET @has_wallet_under_review_reason := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'under_review_reason_code'
);
SET @wallet_under_review_reason_sql := IF(
  @has_wallet_under_review_reason = 0,
  'ALTER TABLE wallets ADD COLUMN under_review_reason_code VARCHAR(96) NULL AFTER under_review_by_user_id',
  'SELECT 1'
);
PREPARE wallet_under_review_reason_stmt FROM @wallet_under_review_reason_sql;
EXECUTE wallet_under_review_reason_stmt;
DEALLOCATE PREPARE wallet_under_review_reason_stmt;

SET @has_wallet_under_review_note := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'under_review_note'
);
SET @wallet_under_review_note_sql := IF(
  @has_wallet_under_review_note = 0,
  'ALTER TABLE wallets ADD COLUMN under_review_note TEXT NULL AFTER under_review_reason_code',
  'SELECT 1'
);
PREPARE wallet_under_review_note_stmt FROM @wallet_under_review_note_sql;
EXECUTE wallet_under_review_note_stmt;
DEALLOCATE PREPARE wallet_under_review_note_stmt;

SET @has_wallet_last_activity := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'last_activity_at'
);
SET @wallet_last_activity_sql := IF(
  @has_wallet_last_activity = 0,
  'ALTER TABLE wallets ADD COLUMN last_activity_at TIMESTAMP(3) NULL AFTER updated_at',
  'SELECT 1'
);
PREPARE wallet_last_activity_stmt FROM @wallet_last_activity_sql;
EXECUTE wallet_last_activity_stmt;
DEALLOCATE PREPARE wallet_last_activity_stmt;

SET @has_wallet_suspended_reason := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'suspended_reason_code'
);
SET @wallet_suspended_reason_sql := IF(
  @has_wallet_suspended_reason = 0,
  'ALTER TABLE wallets ADD COLUMN suspended_reason_code VARCHAR(96) NULL AFTER suspended_at',
  'SELECT 1'
);
PREPARE wallet_suspended_reason_stmt FROM @wallet_suspended_reason_sql;
EXECUTE wallet_suspended_reason_stmt;
DEALLOCATE PREPARE wallet_suspended_reason_stmt;

SET @has_wallet_suspended_note := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'suspended_note'
);
SET @wallet_suspended_note_sql := IF(
  @has_wallet_suspended_note = 0,
  'ALTER TABLE wallets ADD COLUMN suspended_note TEXT NULL AFTER suspended_reason_code',
  'SELECT 1'
);
PREPARE wallet_suspended_note_stmt FROM @wallet_suspended_note_sql;
EXECUTE wallet_suspended_note_stmt;
DEALLOCATE PREPARE wallet_suspended_note_stmt;

SET @has_wallet_suspended_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'suspended_by_user_id'
);
SET @wallet_suspended_by_sql := IF(
  @has_wallet_suspended_by = 0,
  'ALTER TABLE wallets ADD COLUMN suspended_by_user_id BIGINT UNSIGNED NULL AFTER suspended_note',
  'SELECT 1'
);
PREPARE wallet_suspended_by_stmt FROM @wallet_suspended_by_sql;
EXECUTE wallet_suspended_by_stmt;
DEALLOCATE PREPARE wallet_suspended_by_stmt;

SET @has_wallet_reinstated_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'reinstated_at'
);
SET @wallet_reinstated_at_sql := IF(
  @has_wallet_reinstated_at = 0,
  'ALTER TABLE wallets ADD COLUMN reinstated_at TIMESTAMP(3) NULL AFTER suspended_by_user_id',
  'SELECT 1'
);
PREPARE wallet_reinstated_at_stmt FROM @wallet_reinstated_at_sql;
EXECUTE wallet_reinstated_at_stmt;
DEALLOCATE PREPARE wallet_reinstated_at_stmt;

SET @has_wallet_reinstated_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'reinstated_by_user_id'
);
SET @wallet_reinstated_by_sql := IF(
  @has_wallet_reinstated_by = 0,
  'ALTER TABLE wallets ADD COLUMN reinstated_by_user_id BIGINT UNSIGNED NULL AFTER reinstated_at',
  'SELECT 1'
);
PREPARE wallet_reinstated_by_stmt FROM @wallet_reinstated_by_sql;
EXECUTE wallet_reinstated_by_stmt;
DEALLOCATE PREPARE wallet_reinstated_by_stmt;

SET @has_hold_placed_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_reservation_holds'
    AND COLUMN_NAME = 'placed_by_user_id'
);
SET @hold_placed_by_sql := IF(
  @has_hold_placed_by = 0,
  'ALTER TABLE wallet_reservation_holds ADD COLUMN placed_by_user_id BIGINT UNSIGNED NULL AFTER currency_code',
  'SELECT 1'
);
PREPARE hold_placed_by_stmt FROM @hold_placed_by_sql;
EXECUTE hold_placed_by_stmt;
DEALLOCATE PREPARE hold_placed_by_stmt;

SET @has_hold_released_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_reservation_holds'
    AND COLUMN_NAME = 'released_by_user_id'
);
SET @hold_released_by_sql := IF(
  @has_hold_released_by = 0,
  'ALTER TABLE wallet_reservation_holds ADD COLUMN released_by_user_id BIGINT UNSIGNED NULL AFTER placed_by_user_id',
  'SELECT 1'
);
PREPARE hold_released_by_stmt FROM @hold_released_by_sql;
EXECUTE hold_released_by_stmt;
DEALLOCATE PREPARE hold_released_by_stmt;

SET @has_hold_reason := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_reservation_holds'
    AND COLUMN_NAME = 'reason_code'
);
SET @hold_reason_sql := IF(
  @has_hold_reason = 0,
  'ALTER TABLE wallet_reservation_holds ADD COLUMN reason_code VARCHAR(96) NULL AFTER released_by_user_id',
  'SELECT 1'
);
PREPARE hold_reason_stmt FROM @hold_reason_sql;
EXECUTE hold_reason_stmt;
DEALLOCATE PREPARE hold_reason_stmt;

SET @has_hold_note := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_reservation_holds'
    AND COLUMN_NAME = 'note'
);
SET @hold_note_sql := IF(
  @has_hold_note = 0,
  'ALTER TABLE wallet_reservation_holds ADD COLUMN note TEXT NULL AFTER reason_code',
  'SELECT 1'
);
PREPARE hold_note_stmt FROM @hold_note_sql;
EXECUTE hold_note_stmt;
DEALLOCATE PREPARE hold_note_stmt;

SET @has_wallet_audit_actor_role := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'actor_role'
);
SET @wallet_audit_actor_role_sql := IF(
  @has_wallet_audit_actor_role = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN actor_role VARCHAR(64) NULL AFTER actor_user_id',
  'SELECT 1'
);
PREPARE wallet_audit_actor_role_stmt FROM @wallet_audit_actor_role_sql;
EXECUTE wallet_audit_actor_role_stmt;
DEALLOCATE PREPARE wallet_audit_actor_role_stmt;

SET @has_wallet_audit_capability := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'capability_used'
);
SET @wallet_audit_capability_sql := IF(
  @has_wallet_audit_capability = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN capability_used VARCHAR(96) NULL AFTER actor_role',
  'SELECT 1'
);
PREPARE wallet_audit_capability_stmt FROM @wallet_audit_capability_sql;
EXECUTE wallet_audit_capability_stmt;
DEALLOCATE PREPARE wallet_audit_capability_stmt;

SET @has_wallet_audit_target_user := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'target_user_id'
);
SET @wallet_audit_target_user_sql := IF(
  @has_wallet_audit_target_user = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN target_user_id BIGINT UNSIGNED NULL AFTER capability_used',
  'SELECT 1'
);
PREPARE wallet_audit_target_user_stmt FROM @wallet_audit_target_user_sql;
EXECUTE wallet_audit_target_user_stmt;
DEALLOCATE PREPARE wallet_audit_target_user_stmt;

SET @has_wallet_audit_entity_type := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'entity_type'
);
SET @wallet_audit_entity_type_sql := IF(
  @has_wallet_audit_entity_type = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN entity_type VARCHAR(64) NULL AFTER action_summary',
  'SELECT 1'
);
PREPARE wallet_audit_entity_type_stmt FROM @wallet_audit_entity_type_sql;
EXECUTE wallet_audit_entity_type_stmt;
DEALLOCATE PREPARE wallet_audit_entity_type_stmt;

SET @has_wallet_audit_entity_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'entity_id'
);
SET @wallet_audit_entity_id_sql := IF(
  @has_wallet_audit_entity_id = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN entity_id VARCHAR(96) NULL AFTER entity_type',
  'SELECT 1'
);
PREPARE wallet_audit_entity_id_stmt FROM @wallet_audit_entity_id_sql;
EXECUTE wallet_audit_entity_id_stmt;
DEALLOCATE PREPARE wallet_audit_entity_id_stmt;

SET @has_wallet_audit_amount_delta := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'amount_delta_mwk'
);
SET @wallet_audit_amount_delta_sql := IF(
  @has_wallet_audit_amount_delta = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN amount_delta_mwk DECIMAL(18,2) NULL AFTER entity_id',
  'SELECT 1'
);
PREPARE wallet_audit_amount_delta_stmt FROM @wallet_audit_amount_delta_sql;
EXECUTE wallet_audit_amount_delta_stmt;
DEALLOCATE PREPARE wallet_audit_amount_delta_stmt;

SET @has_wallet_audit_points_delta := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'points_delta'
);
SET @wallet_audit_points_delta_sql := IF(
  @has_wallet_audit_points_delta = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN points_delta INT NULL AFTER amount_delta_mwk',
  'SELECT 1'
);
PREPARE wallet_audit_points_delta_stmt FROM @wallet_audit_points_delta_sql;
EXECUTE wallet_audit_points_delta_stmt;
DEALLOCATE PREPARE wallet_audit_points_delta_stmt;

SET @has_wallet_audit_balance_before := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'balance_before_json'
);
SET @wallet_audit_balance_before_sql := IF(
  @has_wallet_audit_balance_before = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN balance_before_json LONGTEXT NULL AFTER points_delta',
  'SELECT 1'
);
PREPARE wallet_audit_balance_before_stmt FROM @wallet_audit_balance_before_sql;
EXECUTE wallet_audit_balance_before_stmt;
DEALLOCATE PREPARE wallet_audit_balance_before_stmt;

SET @has_wallet_audit_balance_after := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'balance_after_json'
);
SET @wallet_audit_balance_after_sql := IF(
  @has_wallet_audit_balance_after = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN balance_after_json LONGTEXT NULL AFTER balance_before_json',
  'SELECT 1'
);
PREPARE wallet_audit_balance_after_stmt FROM @wallet_audit_balance_after_sql;
EXECUTE wallet_audit_balance_after_stmt;
DEALLOCATE PREPARE wallet_audit_balance_after_stmt;

SET @has_wallet_audit_reason := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'reason_code'
);
SET @wallet_audit_reason_sql := IF(
  @has_wallet_audit_reason = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN reason_code VARCHAR(96) NULL AFTER balance_after_json',
  'SELECT 1'
);
PREPARE wallet_audit_reason_stmt FROM @wallet_audit_reason_sql;
EXECUTE wallet_audit_reason_stmt;
DEALLOCATE PREPARE wallet_audit_reason_stmt;

SET @has_wallet_audit_note := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'note'
);
SET @wallet_audit_note_sql := IF(
  @has_wallet_audit_note = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN note TEXT NULL AFTER reason_code',
  'SELECT 1'
);
PREPARE wallet_audit_note_stmt FROM @wallet_audit_note_sql;
EXECUTE wallet_audit_note_stmt;
DEALLOCATE PREPARE wallet_audit_note_stmt;

SET @has_wallet_audit_approval_request := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'approval_request_id'
);
SET @wallet_audit_approval_request_sql := IF(
  @has_wallet_audit_approval_request = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN approval_request_id BIGINT UNSIGNED NULL AFTER note',
  'SELECT 1'
);
PREPARE wallet_audit_approval_request_stmt FROM @wallet_audit_approval_request_sql;
EXECUTE wallet_audit_approval_request_stmt;
DEALLOCATE PREPARE wallet_audit_approval_request_stmt;

SET @has_wallet_audit_correlation := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'correlation_id'
);
SET @wallet_audit_correlation_sql := IF(
  @has_wallet_audit_correlation = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN correlation_id VARCHAR(96) NULL AFTER approval_request_id',
  'SELECT 1'
);
PREPARE wallet_audit_correlation_stmt FROM @wallet_audit_correlation_sql;
EXECUTE wallet_audit_correlation_stmt;
DEALLOCATE PREPARE wallet_audit_correlation_stmt;

SET @has_wallet_audit_debit_entry := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'debit_ledger_entry_id'
);
SET @wallet_audit_debit_entry_sql := IF(
  @has_wallet_audit_debit_entry = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN debit_ledger_entry_id BIGINT UNSIGNED NULL AFTER correlation_id',
  'SELECT 1'
);
PREPARE wallet_audit_debit_entry_stmt FROM @wallet_audit_debit_entry_sql;
EXECUTE wallet_audit_debit_entry_stmt;
DEALLOCATE PREPARE wallet_audit_debit_entry_stmt;

SET @has_wallet_audit_credit_entry := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_audit_logs'
    AND COLUMN_NAME = 'credit_ledger_entry_id'
);
SET @wallet_audit_credit_entry_sql := IF(
  @has_wallet_audit_credit_entry = 0,
  'ALTER TABLE wallet_audit_logs ADD COLUMN credit_ledger_entry_id BIGINT UNSIGNED NULL AFTER debit_ledger_entry_id',
  'SELECT 1'
);
PREPARE wallet_audit_credit_entry_stmt FROM @wallet_audit_credit_entry_sql;
EXECUTE wallet_audit_credit_entry_stmt;
DEALLOCATE PREPARE wallet_audit_credit_entry_stmt;

CREATE TABLE IF NOT EXISTS wallet_operation_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  request_key VARCHAR(96) NOT NULL UNIQUE,
  wallet_id BIGINT UNSIGNED NOT NULL,
  destination_wallet_id BIGINT UNSIGNED NULL,
  operation_type VARCHAR(64) NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  requested_by_role VARCHAR(64) NULL,
  status ENUM('PENDING','APPROVED','REJECTED','EXECUTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  amount_mwk DECIMAL(18,2) NULL,
  points_delta INT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'MWK',
  source_transaction_public_id VARCHAR(96) NULL,
  source_ledger_transaction_id BIGINT UNSIGNED NULL,
  reason_code VARCHAR(96) NOT NULL,
  note TEXT NULL,
  approval_required TINYINT(1) NOT NULL DEFAULT 1,
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP(3) NULL,
  rejected_by_user_id BIGINT UNSIGNED NULL,
  rejected_at TIMESTAMP(3) NULL,
  rejection_reason TEXT NULL,
  executed_at TIMESTAMP(3) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_wallet_operation_requests_wallet_status (wallet_id, status, created_at),
  KEY idx_wallet_operation_requests_status_created (status, created_at),
  KEY idx_wallet_operation_requests_actor_created (requested_by_user_id, created_at),
  CONSTRAINT fk_wallet_operation_requests_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_operation_requests_destination_wallet FOREIGN KEY (destination_wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_operation_requests_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_wallet_operation_requests_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_wallet_operation_requests_rejected_by FOREIGN KEY (rejected_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_points_profiles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  wallet_id BIGINT UNSIGNED NOT NULL,
  points_balance BIGINT NOT NULL DEFAULT 0,
  current_tier VARCHAR(64) NOT NULL DEFAULT 'STANDARD',
  tier_progress_percent DECIMAL(5,2) NULL,
  last_activity_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wallet_points_profiles_wallet (wallet_id),
  CONSTRAINT fk_wallet_points_profiles_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_points_adjustments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  wallet_id BIGINT UNSIGNED NOT NULL,
  operation_request_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  delta_points INT NOT NULL,
  direction ENUM('CREDIT','DEBIT') NOT NULL,
  reason_code VARCHAR(96) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_wallet_points_adjustments_wallet_created (wallet_id, created_at),
  KEY idx_wallet_points_adjustments_actor_created (created_by_user_id, created_at),
  CONSTRAINT fk_wallet_points_adjustments_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_points_adjustments_operation_request FOREIGN KEY (operation_request_id) REFERENCES wallet_operation_requests(id),
  CONSTRAINT fk_wallet_points_adjustments_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO wallet_points_profiles (
  wallet_id,
  points_balance,
  current_tier,
  tier_progress_percent,
  last_activity_at
)
SELECT
  w.id,
  0,
  'STANDARD',
  NULL,
  NULL
FROM wallets w
LEFT JOIN wallet_points_profiles wpp ON wpp.wallet_id = w.id
WHERE wpp.id IS NULL;

INSERT INTO internal_permissions (id, code, module_key, action_key, description) VALUES
(43, 'wallet.lookup', 'wallet', 'lookup', 'Look up wallets by display id'),
(44, 'wallet.balance.view', 'wallet', 'balance_view', 'View wallet balances and status'),
(45, 'wallet.transactions.view', 'wallet', 'transactions_view', 'View wallet transactions'),
(46, 'wallet.points.view', 'wallet', 'points_view', 'View wallet points and loyalty profile'),
(47, 'wallet.points.adjust', 'wallet', 'points_adjust', 'Adjust wallet points'),
(48, 'wallet.refund.request', 'wallet', 'refund_request', 'Create wallet refund requests'),
(49, 'wallet.wallet_credit.issue', 'wallet', 'wallet_credit_issue', 'Issue wallet credits'),
(50, 'wallet.ledger.adjust', 'wallet', 'ledger_adjust', 'Create ledger-backed wallet adjustments'),
(51, 'wallet.balance.transfer', 'wallet', 'balance_transfer', 'Transfer wallet balance'),
(52, 'wallet.audit.view', 'wallet', 'audit_view', 'View wallet audit trail'),
(53, 'wallet.freeze', 'wallet', 'freeze', 'Freeze wallet access'),
(54, 'wallet.unfreeze', 'wallet', 'unfreeze', 'Unfreeze wallet access'),
(55, 'wallet.review.mark', 'wallet', 'review_mark', 'Mark wallets under review'),
(56, 'wallet.statement.export', 'wallet', 'statement_export', 'Export wallet statements'),
(57, 'wallet.hold.place', 'wallet', 'hold_place', 'Place manual wallet holds'),
(58, 'wallet.hold.release', 'wallet', 'hold_release', 'Release manual wallet holds')
ON DUPLICATE KEY UPDATE
  module_key = VALUES(module_key),
  action_key = VALUES(action_key),
  description = VALUES(description);

INSERT INTO internal_role_permissions (role_id, permission_id)
SELECT ir.id, ip.id
FROM internal_roles ir
INNER JOIN internal_permissions ip ON ip.code IN (
  'wallet.lookup',
  'wallet.balance.view',
  'wallet.transactions.view',
  'wallet.points.view'
)
WHERE ir.code = 'CUSTOMER_SUPPORT_AGENT'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), permission_id = VALUES(permission_id);

INSERT INTO internal_role_permissions (role_id, permission_id)
SELECT ir.id, ip.id
FROM internal_roles ir
INNER JOIN internal_permissions ip ON ip.code IN (
  'wallet.lookup',
  'wallet.balance.view',
  'wallet.transactions.view',
  'wallet.points.view',
  'wallet.points.adjust',
  'wallet.refund.request',
  'wallet.wallet_credit.issue',
  'wallet.audit.view',
  'wallet.review.mark',
  'wallet.statement.export',
  'wallet.freeze',
  'wallet.unfreeze'
)
WHERE ir.code IN ('FINANCE_MANAGER', 'RISK_COMPLIANCE_OFFICER')
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), permission_id = VALUES(permission_id);

INSERT INTO internal_role_permissions (role_id, permission_id)
SELECT ir.id, ip.id
FROM internal_roles ir
INNER JOIN internal_permissions ip ON ip.code IN (
  'wallet.lookup',
  'wallet.balance.view',
  'wallet.transactions.view',
  'wallet.points.view',
  'wallet.points.adjust',
  'wallet.refund.request',
  'wallet.wallet_credit.issue',
  'wallet.audit.view',
  'wallet.review.mark',
  'wallet.statement.export',
  'wallet.freeze',
  'wallet.unfreeze',
  'wallet.ledger.adjust',
  'wallet.balance.transfer',
  'wallet.hold.place',
  'wallet.hold.release'
)
WHERE ir.code IN ('PLATFORM_OWNER', 'PLATFORM_INFRASTRUCTURE_ENGINEER')
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), permission_id = VALUES(permission_id);

INSERT INTO internal_settings (setting_key, setting_value)
VALUES
('wallet.credit.approval_threshold_mwk', '25000'),
('wallet.ledger_adjustment.requires_approval', '1'),
('wallet.balance_transfer.requires_approval', '1'),
('wallet.self_approval.allowed', '0')
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  updated_at = CURRENT_TIMESTAMP(3);
