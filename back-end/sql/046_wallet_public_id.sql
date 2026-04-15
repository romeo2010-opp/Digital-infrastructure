-- 046_wallet_public_id.sql
-- Add a short user-facing wallet identifier while preserving internal wallet_number.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_wallet_public_id_column := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND COLUMN_NAME = 'wallet_public_id'
);

SET @wallet_public_id_column_sql := IF(
  @has_wallet_public_id_column = 0,
  'ALTER TABLE wallets ADD COLUMN wallet_public_id VARCHAR(16) NULL AFTER wallet_number',
  'SELECT 1'
);

PREPARE wallet_public_id_column_stmt FROM @wallet_public_id_column_sql;
EXECUTE wallet_public_id_column_stmt;
DEALLOCATE PREPARE wallet_public_id_column_stmt;

SET @has_wallet_public_id_index := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallets'
    AND INDEX_NAME = 'uq_wallets_public_id'
);

SET @wallet_public_id_index_sql := IF(
  @has_wallet_public_id_index = 0,
  'CREATE UNIQUE INDEX uq_wallets_public_id ON wallets (wallet_public_id)',
  'SELECT 1'
);

PREPARE wallet_public_id_index_stmt FROM @wallet_public_id_index_sql;
EXECUTE wallet_public_id_index_stmt;
DEALLOCATE PREPARE wallet_public_id_index_stmt;
