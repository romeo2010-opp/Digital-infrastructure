-- 037_refund_request_wallet_payout_links.sql
-- Tracks wallet payout references for approved refund requests.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_wallet_transaction_reference := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'wallet_transaction_reference'
);
SET @sql := IF(
  @has_wallet_transaction_reference = 0,
  'ALTER TABLE refund_requests ADD COLUMN wallet_transaction_reference VARCHAR(96) NULL AFTER transaction_public_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_credited_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND COLUMN_NAME = 'credited_at'
);
SET @sql := IF(
  @has_credited_at = 0,
  'ALTER TABLE refund_requests ADD COLUMN credited_at TIMESTAMP(3) NULL AFTER reviewed_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_refund_wallet_tx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refund_requests'
    AND INDEX_NAME = 'idx_refund_requests_wallet_tx'
);
SET @sql := IF(
  @idx_refund_wallet_tx_exists = 0,
  'CREATE INDEX idx_refund_requests_wallet_tx ON refund_requests (wallet_transaction_reference)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
