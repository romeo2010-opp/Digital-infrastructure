-- 036_transaction_user_reservation_links.sql
-- Adds user and reservation linkage fields to station transactions.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_user_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'user_id'
);
SET @sql := IF(
  @has_user_id = 0,
  'ALTER TABLE transactions ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER nozzle_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_reservation_public_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'reservation_public_id'
);
SET @sql := IF(
  @has_reservation_public_id = 0,
  'ALTER TABLE transactions ADD COLUMN reservation_public_id VARCHAR(64) NULL AFTER user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @tx_user_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND CONSTRAINT_NAME = 'fk_tx_user'
);
SET @sql := IF(
  @tx_user_fk_exists = 0,
  'ALTER TABLE transactions ADD CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_tx_user_time_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND INDEX_NAME = 'idx_tx_user_time'
);
SET @sql := IF(
  @idx_tx_user_time_exists = 0,
  'CREATE INDEX idx_tx_user_time ON transactions (user_id, occurred_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_tx_reservation_public_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND INDEX_NAME = 'idx_tx_reservation_public_id'
);
SET @sql := IF(
  @idx_tx_reservation_public_id_exists = 0,
  'CREATE INDEX idx_tx_reservation_public_id ON transactions (reservation_public_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
