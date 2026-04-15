-- 020_demand_anomaly_detection.sql
-- Demand anomaly detection persistence + station-level thresholds.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_anomaly_warning_z := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'anomaly_warning_z'
);
SET @sql := IF(
  @has_anomaly_warning_z = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN anomaly_warning_z DECIMAL(6,3) NOT NULL DEFAULT 2.500 AFTER diesel_enabled',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_anomaly_critical_z := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'anomaly_critical_z'
);
SET @sql := IF(
  @has_anomaly_critical_z = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN anomaly_critical_z DECIMAL(6,3) NOT NULL DEFAULT 3.500 AFTER anomaly_warning_z',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_anomaly_ewma_alpha := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'anomaly_ewma_alpha'
);
SET @sql := IF(
  @has_anomaly_ewma_alpha = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN anomaly_ewma_alpha DECIMAL(5,3) NOT NULL DEFAULT 0.200 AFTER anomaly_critical_z',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_anomaly_persistence_minutes := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'anomaly_persistence_minutes'
);
SET @sql := IF(
  @has_anomaly_persistence_minutes = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN anomaly_persistence_minutes INT UNSIGNED NOT NULL DEFAULT 10 AFTER anomaly_ewma_alpha',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_anomaly_enable_cusum := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'anomaly_enable_cusum'
);
SET @sql := IF(
  @has_anomaly_enable_cusum = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN anomaly_enable_cusum TINYINT(1) NOT NULL DEFAULT 0 AFTER anomaly_persistence_minutes',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_anomaly_cusum_threshold := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'station_queue_settings'
    AND COLUMN_NAME = 'anomaly_cusum_threshold'
);
SET @sql := IF(
  @has_anomaly_cusum_threshold = 0,
  'ALTER TABLE station_queue_settings ADD COLUMN anomaly_cusum_threshold DECIMAL(8,3) NOT NULL DEFAULT 5.000 AFTER anomaly_enable_cusum',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS demand_anomaly_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  fuel_type VARCHAR(16) NOT NULL,
  severity ENUM('WARNING', 'CRITICAL') NOT NULL,
  start_time TIMESTAMP(3) NOT NULL,
  end_time TIMESTAMP(3) NULL,
  current_velocity DECIMAL(14,4) NOT NULL,
  expected_mean DECIMAL(14,4) NOT NULL,
  expected_std DECIMAL(14,4) NOT NULL,
  z_score DECIMAL(14,6) NULL,
  ewma_value DECIMAL(14,6) NULL,
  cusum_value DECIMAL(14,6) NULL,
  rules_triggered_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_demand_anomaly_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @idx_demand_anomaly_station_time_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'demand_anomaly_events'
    AND INDEX_NAME = 'idx_demand_anomaly_station_time'
);
SET @sql := IF(
  @idx_demand_anomaly_station_time_exists = 0,
  'CREATE INDEX idx_demand_anomaly_station_time ON demand_anomaly_events (station_id, start_time)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_demand_anomaly_station_open_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'demand_anomaly_events'
    AND INDEX_NAME = 'idx_demand_anomaly_station_open'
);
SET @sql := IF(
  @idx_demand_anomaly_station_open_exists = 0,
  'CREATE INDEX idx_demand_anomaly_station_open ON demand_anomaly_events (station_id, fuel_type, end_time)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
