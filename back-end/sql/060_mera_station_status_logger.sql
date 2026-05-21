-- 060_mera_station_status_logger.sql
-- Derived MERA station status current-state and rollup tables.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS station_current_status (
  station_id BIGINT UNSIGNED PRIMARY KEY,
  availability_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  diesel_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  petrol_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  petrol_live_litres DECIMAL(14,3) NULL,
  diesel_live_litres DECIMAL(14,3) NULL,
  total_live_litres DECIMAL(14,3) NULL,
  total_capacity_litres DECIMAL(14,3) NULL,
  known_fuel_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tank_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  delivery_verified TINYINT(1) NOT NULL DEFAULT 0,
  petrol_delivery_verified TINYINT(1) NOT NULL DEFAULT 0,
  diesel_delivery_verified TINYINT(1) NOT NULL DEFAULT 0,
  delivered_litres_since_baseline DECIMAL(14,3) NOT NULL DEFAULT 0,
  petrol_delivered_litres_since_baseline DECIMAL(14,3) NULL,
  diesel_delivered_litres_since_baseline DECIMAL(14,3) NULL,
  latest_delivery_time TIMESTAMP(3) NULL,
  reported_source ENUM('STATION','USER','MERA_INSPECTION','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
  last_derived_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_logged_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_station_current_status_availability (availability_status, updated_at),
  KEY idx_station_current_status_last_logged (last_logged_at),
  CONSTRAINT fk_station_current_status_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_status_rollups (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  bucket_start TIMESTAMP(3) NOT NULL,
  bucket_minutes SMALLINT UNSIGNED NOT NULL,
  district_key VARCHAR(96) NOT NULL DEFAULT '__NATIONAL__',
  district_label VARCHAR(96) NULL,
  available_count INT UNSIGNED NOT NULL DEFAULT 0,
  limited_count INT UNSIGNED NOT NULL DEFAULT 0,
  dry_count INT UNSIGNED NOT NULL DEFAULT 0,
  unknown_count INT UNSIGNED NOT NULL DEFAULT 0,
  total_stations INT UNSIGNED NOT NULL DEFAULT 0,
  stations_with_fuel INT UNSIGNED NOT NULL DEFAULT 0,
  delivery_verified_stations_with_fuel INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_station_status_rollups_bucket_scope (bucket_minutes, bucket_start, district_key),
  KEY idx_station_status_rollups_scope_time (district_key, bucket_minutes, bucket_start),
  KEY idx_station_status_rollups_bucket_time (bucket_minutes, bucket_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_delivery_verified := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_current_status'
    AND COLUMN_NAME = 'delivery_verified'
);
SET @sql := IF(
  @has_delivery_verified = 0,
  'ALTER TABLE station_current_status ADD COLUMN delivery_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER tank_count',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_petrol_delivery_verified := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_current_status'
    AND COLUMN_NAME = 'petrol_delivery_verified'
);
SET @sql := IF(
  @has_petrol_delivery_verified = 0,
  'ALTER TABLE station_current_status ADD COLUMN petrol_delivery_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER delivery_verified',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_diesel_delivery_verified := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_current_status'
    AND COLUMN_NAME = 'diesel_delivery_verified'
);
SET @sql := IF(
  @has_diesel_delivery_verified = 0,
  'ALTER TABLE station_current_status ADD COLUMN diesel_delivery_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER petrol_delivery_verified',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_delivered_litres_since_baseline := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_current_status'
    AND COLUMN_NAME = 'delivered_litres_since_baseline'
);
SET @sql := IF(
  @has_delivered_litres_since_baseline = 0,
  'ALTER TABLE station_current_status ADD COLUMN delivered_litres_since_baseline DECIMAL(14,3) NOT NULL DEFAULT 0 AFTER diesel_delivery_verified',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_petrol_delivered_litres_since_baseline := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_current_status'
    AND COLUMN_NAME = 'petrol_delivered_litres_since_baseline'
);
SET @sql := IF(
  @has_petrol_delivered_litres_since_baseline = 0,
  'ALTER TABLE station_current_status ADD COLUMN petrol_delivered_litres_since_baseline DECIMAL(14,3) NULL AFTER delivered_litres_since_baseline',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_diesel_delivered_litres_since_baseline := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_current_status'
    AND COLUMN_NAME = 'diesel_delivered_litres_since_baseline'
);
SET @sql := IF(
  @has_diesel_delivered_litres_since_baseline = 0,
  'ALTER TABLE station_current_status ADD COLUMN diesel_delivered_litres_since_baseline DECIMAL(14,3) NULL AFTER petrol_delivered_litres_since_baseline',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_latest_delivery_time := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_current_status'
    AND COLUMN_NAME = 'latest_delivery_time'
);
SET @sql := IF(
  @has_latest_delivery_time = 0,
  'ALTER TABLE station_current_status ADD COLUMN latest_delivery_time TIMESTAMP(3) NULL AFTER diesel_delivered_litres_since_baseline',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_delivery_verified_rollup := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_status_rollups'
    AND COLUMN_NAME = 'delivery_verified_stations_with_fuel'
);
SET @sql := IF(
  @has_delivery_verified_rollup = 0,
  'ALTER TABLE station_status_rollups ADD COLUMN delivery_verified_stations_with_fuel INT UNSIGNED NOT NULL DEFAULT 0 AFTER stations_with_fuel',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
