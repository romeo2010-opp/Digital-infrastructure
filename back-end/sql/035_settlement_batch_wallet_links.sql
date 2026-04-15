-- 035_settlement_batch_wallet_links.sql
-- Adds reservation and wallet payment linkage fields to finance settlement batches.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_source_reference := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settlement_batches'
    AND COLUMN_NAME = 'source_reference'
);
SET @sql := IF(
  @has_source_reference = 0,
  'ALTER TABLE settlement_batches ADD COLUMN source_reference VARCHAR(96) NULL AFTER public_id',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_related_entity_type := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settlement_batches'
    AND COLUMN_NAME = 'related_entity_type'
);
SET @sql := IF(
  @has_related_entity_type = 0,
  'ALTER TABLE settlement_batches ADD COLUMN related_entity_type VARCHAR(64) NULL AFTER station_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_related_entity_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settlement_batches'
    AND COLUMN_NAME = 'related_entity_id'
);
SET @sql := IF(
  @has_related_entity_id = 0,
  'ALTER TABLE settlement_batches ADD COLUMN related_entity_id VARCHAR(96) NULL AFTER related_entity_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_transaction_reference := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settlement_batches'
    AND COLUMN_NAME = 'source_transaction_reference'
);
SET @sql := IF(
  @has_source_transaction_reference = 0,
  'ALTER TABLE settlement_batches ADD COLUMN source_transaction_reference VARCHAR(96) NULL AFTER related_entity_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_metadata_json := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settlement_batches'
    AND COLUMN_NAME = 'metadata_json'
);
SET @sql := IF(
  @has_metadata_json = 0,
  'ALTER TABLE settlement_batches ADD COLUMN metadata_json LONGTEXT NULL AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_settlement_batches_related_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settlement_batches'
    AND INDEX_NAME = 'idx_settlement_batches_related'
);
SET @sql := IF(
  @idx_settlement_batches_related_exists = 0,
  'CREATE INDEX idx_settlement_batches_related ON settlement_batches (related_entity_type, related_entity_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_settlement_batches_source_tx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'settlement_batches'
    AND INDEX_NAME = 'idx_settlement_batches_source_tx'
);
SET @sql := IF(
  @idx_settlement_batches_source_tx_exists = 0,
  'CREATE INDEX idx_settlement_batches_source_tx ON settlement_batches (source_transaction_reference)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
