-- 017_user_reservations_rules.sql
-- Reservation rule support fields and status extensions.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

-- Extend reservation status enum with CHECKED_IN if missing.
SET @status_has_checked_in := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND COLUMN_NAME = 'status'
    AND COLUMN_TYPE LIKE '%CHECKED_IN%'
);
SET @sql := IF(
  @status_has_checked_in = 0,
  'ALTER TABLE user_reservations MODIFY COLUMN status ENUM(''PENDING'',''CONFIRMED'',''CHECKED_IN'',''FULFILLED'',''CANCELLED'',''EXPIRED'') NOT NULL DEFAULT ''PENDING''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- deposit_amount
SET @has_deposit_amount := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND COLUMN_NAME = 'deposit_amount'
);
SET @sql := IF(
  @has_deposit_amount = 0,
  'ALTER TABLE user_reservations ADD COLUMN deposit_amount DECIMAL(12,2) NULL AFTER requested_litres',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- check_in_time
SET @has_check_in_time := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND COLUMN_NAME = 'check_in_time'
);
SET @sql := IF(
  @has_check_in_time = 0,
  'ALTER TABLE user_reservations ADD COLUMN check_in_time TIMESTAMP(3) NULL AFTER confirmed_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- expires_at (hard timeout for no-show)
SET @has_expires_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND COLUMN_NAME = 'expires_at'
);
SET @sql := IF(
  @has_expires_at = 0,
  'ALTER TABLE user_reservations ADD COLUMN expires_at TIMESTAMP(3) NULL AFTER slot_end',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Reservation controls in station settings.
SET @has_reservations_enabled := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'reservations_enabled'
);
SET @sql := IF(
  @has_reservations_enabled = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN reservations_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER diesel_enabled',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_reservation_slot_capacity := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'reservation_slot_capacity'
);
SET @sql := IF(
  @has_reservation_slot_capacity = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN reservation_slot_capacity INT UNSIGNED NULL AFTER reservations_enabled',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_reservation_geo_lock_km := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'reservation_geo_lock_km'
);
SET @sql := IF(
  @has_reservation_geo_lock_km = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN reservation_geo_lock_km DECIMAL(6,2) NOT NULL DEFAULT 15.00 AFTER reservation_slot_capacity',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Helpful indexes.
SET @idx_user_status_slot_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND INDEX_NAME = 'idx_user_reservations_user_status_slot'
);
SET @sql := IF(
  @idx_user_status_slot_exists = 0,
  'CREATE INDEX idx_user_reservations_user_status_slot ON user_reservations (user_id, status, slot_start)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_station_slot_status_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND INDEX_NAME = 'idx_user_reservations_station_slot_status'
);
SET @sql := IF(
  @idx_station_slot_status_exists = 0,
  'CREATE INDEX idx_user_reservations_station_slot_status ON user_reservations (station_id, slot_start, status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
