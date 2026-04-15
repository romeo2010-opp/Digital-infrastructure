-- 043_promotions_pricing_receipts.sql
-- Discount, flash pricing, cashback, and immutable transaction pricing snapshots.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS promotion_campaigns (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  campaign_label VARCHAR(120) NOT NULL,
  promotion_kind ENUM('DISCOUNT','FLASH_PRICE','CASHBACK') NOT NULL DEFAULT 'DISCOUNT',
  fuel_type_id TINYINT UNSIGNED NULL,
  funding_source ENUM('STATION','SMARTLINK','SHARED') NOT NULL DEFAULT 'STATION',
  station_share_pct DECIMAL(7,4) NOT NULL DEFAULT 100.0000,
  smartlink_share_pct DECIMAL(7,4) NOT NULL DEFAULT 0.0000,
  discount_mode ENUM('PERCENTAGE_PER_LITRE','FIXED_PER_LITRE','FIXED_BASKET','FLASH_PRICE_PER_LITRE') NULL,
  discount_value DECIMAL(14,4) NULL,
  cashback_mode ENUM('PERCENTAGE','FIXED_AMOUNT') NULL,
  cashback_value DECIMAL(14,4) NULL,
  cashback_destination ENUM('WALLET','LOYALTY','NONE') NOT NULL DEFAULT 'WALLET',
  flash_price_per_litre DECIMAL(14,4) NULL,
  starts_at TIMESTAMP(3) NOT NULL,
  ends_at TIMESTAMP(3) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('DRAFT','ACTIVE','INACTIVE','EXPIRED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  max_redemptions INT UNSIGNED NULL,
  max_litres DECIMAL(14,3) NULL,
  redeemed_count INT UNSIGNED NOT NULL DEFAULT 0,
  redeemed_litres DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  eligibility_rules_json LONGTEXT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_promotion_campaigns_station_time (station_id, starts_at, ends_at),
  KEY idx_promotion_campaigns_station_status (station_id, status, is_active),
  KEY idx_promotion_campaigns_station_fuel (station_id, fuel_type_id, status),
  CONSTRAINT fk_promotion_campaigns_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_promotion_campaigns_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
  CONSTRAINT fk_promotion_campaigns_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  transaction_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  litres_covered DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  direct_discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cashback_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  station_funded_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  smartlink_funded_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cashback_status ENUM('NONE','EARNED','CREDITED','PENDING_LOYALTY','FAILED') NOT NULL DEFAULT 'NONE',
  cashback_destination ENUM('WALLET','LOYALTY','NONE') NOT NULL DEFAULT 'NONE',
  cashback_credited_at TIMESTAMP(3) NULL,
  snapshot_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_promotion_redemptions_transaction (transaction_id, created_at),
  KEY idx_promotion_redemptions_campaign (campaign_id, created_at),
  KEY idx_promotion_redemptions_user (user_id, created_at),
  CONSTRAINT fk_promotion_redemptions_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  CONSTRAINT fk_promotion_redemptions_campaign FOREIGN KEY (campaign_id) REFERENCES promotion_campaigns(id),
  CONSTRAINT fk_promotion_redemptions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_tx_base_price_per_litre := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'base_price_per_litre'
);
SET @sql := IF(
  @has_tx_base_price_per_litre = 0,
  'ALTER TABLE transactions ADD COLUMN base_price_per_litre DECIMAL(14,4) NULL AFTER price_per_litre',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_subtotal := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'subtotal'
);
SET @sql := IF(
  @has_tx_subtotal = 0,
  'ALTER TABLE transactions ADD COLUMN subtotal DECIMAL(14,2) NULL AFTER total_amount',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_total_direct_discount := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'total_direct_discount'
);
SET @sql := IF(
  @has_tx_total_direct_discount = 0,
  'ALTER TABLE transactions ADD COLUMN total_direct_discount DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER subtotal',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_station_discount_total := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'station_discount_total'
);
SET @sql := IF(
  @has_tx_station_discount_total = 0,
  'ALTER TABLE transactions ADD COLUMN station_discount_total DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER total_direct_discount',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_smartlink_discount_total := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'smartlink_discount_total'
);
SET @sql := IF(
  @has_tx_smartlink_discount_total = 0,
  'ALTER TABLE transactions ADD COLUMN smartlink_discount_total DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER station_discount_total',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_cashback_total := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'cashback_total'
);
SET @sql := IF(
  @has_tx_cashback_total = 0,
  'ALTER TABLE transactions ADD COLUMN cashback_total DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER smartlink_discount_total',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_final_amount_paid := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'final_amount_paid'
);
SET @sql := IF(
  @has_tx_final_amount_paid = 0,
  'ALTER TABLE transactions ADD COLUMN final_amount_paid DECIMAL(14,2) NULL AFTER cashback_total',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_effective_price_per_litre := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'effective_price_per_litre'
);
SET @sql := IF(
  @has_tx_effective_price_per_litre = 0,
  'ALTER TABLE transactions ADD COLUMN effective_price_per_litre DECIMAL(14,4) NULL AFTER final_amount_paid',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_promo_labels_applied := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'promo_labels_applied'
);
SET @sql := IF(
  @has_tx_promo_labels_applied = 0,
  'ALTER TABLE transactions ADD COLUMN promo_labels_applied LONGTEXT NULL AFTER effective_price_per_litre',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_pricing_snapshot_json := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'pricing_snapshot_json'
);
SET @sql := IF(
  @has_tx_pricing_snapshot_json = 0,
  'ALTER TABLE transactions ADD COLUMN pricing_snapshot_json LONGTEXT NULL AFTER promo_labels_applied',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_receipt_verification_ref := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'receipt_verification_ref'
);
SET @sql := IF(
  @has_tx_receipt_verification_ref = 0,
  'ALTER TABLE transactions ADD COLUMN receipt_verification_ref VARCHAR(96) NULL AFTER pricing_snapshot_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_cashback_status := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'cashback_status'
);
SET @sql := IF(
  @has_tx_cashback_status = 0,
  'ALTER TABLE transactions ADD COLUMN cashback_status ENUM(''NONE'',''EARNED'',''CREDITED'',''PENDING_LOYALTY'',''FAILED'') NOT NULL DEFAULT ''NONE'' AFTER receipt_verification_ref',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_cashback_destination := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'cashback_destination'
);
SET @sql := IF(
  @has_tx_cashback_destination = 0,
  'ALTER TABLE transactions ADD COLUMN cashback_destination ENUM(''WALLET'',''LOYALTY'',''NONE'') NOT NULL DEFAULT ''NONE'' AFTER cashback_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_tx_cashback_credited_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'cashback_credited_at'
);
SET @sql := IF(
  @has_tx_cashback_credited_at = 0,
  'ALTER TABLE transactions ADD COLUMN cashback_credited_at TIMESTAMP(3) NULL AFTER cashback_destination',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_tx_receipt_verification_ref_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND INDEX_NAME = 'idx_tx_receipt_verification_ref'
);
SET @sql := IF(
  @idx_tx_receipt_verification_ref_exists = 0,
  'CREATE INDEX idx_tx_receipt_verification_ref ON transactions (receipt_verification_ref)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
