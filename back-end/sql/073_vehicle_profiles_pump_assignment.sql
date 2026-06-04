-- 073_vehicle_profiles_pump_assignment.sql
-- Personal vehicle profiles, pump compatibility, pump assignment, kiosk pump scope, and operational audit logs.
-- Safe to rerun. Existing data is not dropped or rewritten.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS vehicles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  nickname VARCHAR(120) NULL,
  vehicle_type ENUM('SEDAN','HATCHBACK','SUV','PICKUP','MINIBUS','TRUCK','MOTORCYCLE','OTHER') NOT NULL DEFAULT 'OTHER',
  usage_type ENUM('PRIVATE','TAXI','FLEET','COMPANY','PUBLIC_TRANSPORT','OTHER') NULL,
  make VARCHAR(80) NOT NULL,
  model VARCHAR(120) NOT NULL,
  year SMALLINT UNSIGNED NULL,
  number_plate VARCHAR(32) NOT NULL,
  fuel_type ENUM('PETROL','DIESEL','PARAFFIN_KEROSENE','OTHER') NOT NULL DEFAULT 'PETROL',
  tank_capacity_litres DECIMAL(8,2) NULL,
  is_full_tank TINYINT(1) NOT NULL DEFAULT 0,
  tank_side ENUM('DRIVER_SIDE','PASSENGER_SIDE','UNKNOWN','BOTH_OR_CENTER') NOT NULL DEFAULT 'UNKNOWN',
  tank_side_source ENUM('USER_CONFIRMED','SYSTEM_SUGGESTED','ATTENDANT_CONFIRMED','FLEET_MANAGER_CONFIRMED') NOT NULL DEFAULT 'USER_CONFIRMED',
  tank_side_confidence ENUM('LOW','MEDIUM','HIGH','VERIFIED') NOT NULL DEFAULT 'LOW',
  visual_mockup_key VARCHAR(96) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  verification_status ENUM('UNVERIFIED','PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
  archived_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_vehicles_user_active (user_id, archived_at, is_default),
  KEY idx_vehicles_plate (number_plate),
  KEY idx_vehicles_fuel (fuel_type),
  KEY idx_vehicles_tank_side (tank_side),
  CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pump_configurations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  pump_id BIGINT UNSIGNED NOT NULL,
  kiosk_id BIGINT UNSIGNED NULL,
  display_name VARCHAR(120) NOT NULL,
  fuel_types_supported_json LONGTEXT NULL,
  lane_side_supported ENUM('DRIVER_SIDE','PASSENGER_SIDE','BOTH_SIDES','MANUAL_ONLY') NOT NULL DEFAULT 'BOTH_SIDES',
  supported_vehicle_types_json LONGTEXT NULL,
  max_vehicle_size ENUM('SMALL','MEDIUM','LARGE','EXTRA_LARGE') NOT NULL DEFAULT 'LARGE',
  entry_direction VARCHAR(120) NULL,
  exit_direction VARCHAR(120) NULL,
  is_smartlink_enabled TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  accepts_walkins_when_idle TINYINT(1) NOT NULL DEFAULT 1,
  max_standby_walkins INT UNSIGNED NOT NULL DEFAULT 1,
  clear_lane_buffer_minutes INT UNSIGNED NOT NULL DEFAULT 7,
  current_mode ENUM('OPEN_WALKIN','CLEARING_FOR_SMARTLINK','SMARTLINK_ONLY','PAUSED','MAINTENANCE') NOT NULL DEFAULT 'OPEN_WALKIN',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pump_configurations_pump (pump_id),
  KEY idx_pump_configurations_station_active (station_id, is_active, current_mode),
  KEY idx_pump_configurations_kiosk (kiosk_id),
  CONSTRAINT fk_pump_configurations_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_pump_configurations_pump FOREIGN KEY (pump_id) REFERENCES pumps(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS smartlink_operational_audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  actor_type ENUM('USER','KIOSK','ATTENDANT','MANAGER','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
  actor_id BIGINT UNSIGNED NULL,
  station_id BIGINT UNSIGNED NULL,
  pump_id BIGINT UNSIGNED NULL,
  kiosk_id BIGINT UNSIGNED NULL,
  queue_ticket_id BIGINT UNSIGNED NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  action VARCHAR(96) NOT NULL,
  reason VARCHAR(500) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_smartlink_audit_station_time (station_id, created_at),
  KEY idx_smartlink_audit_pump_time (pump_id, created_at),
  KEY idx_smartlink_audit_queue (queue_ticket_id, created_at),
  KEY idx_smartlink_audit_vehicle (vehicle_id, created_at),
  KEY idx_smartlink_audit_action (action, created_at),
  CONSTRAINT fk_smartlink_audit_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_smartlink_audit_pump FOREIGN KEY (pump_id) REFERENCES pumps(id),
  CONSTRAINT fk_smartlink_audit_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

DROP PROCEDURE IF EXISTS smartlink_add_column_if_missing//
CREATE PROCEDURE smartlink_add_column_if_missing(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @smartlink_ddl := CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_definition);
    PREPARE smartlink_stmt FROM @smartlink_ddl;
    EXECUTE smartlink_stmt;
    DEALLOCATE PREPARE smartlink_stmt;
  END IF;
END//

DROP PROCEDURE IF EXISTS smartlink_add_index_if_missing//
CREATE PROCEDURE smartlink_add_index_if_missing(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  ) THEN
    SET @smartlink_ddl := CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` ', p_definition);
    PREPARE smartlink_stmt FROM @smartlink_ddl;
    EXECUTE smartlink_stmt;
    DEALLOCATE PREPARE smartlink_stmt;
  END IF;
END//

DELIMITER ;

CALL smartlink_add_column_if_missing('queue_entries', 'vehicle_id', '`vehicle_id` BIGINT UNSIGNED NULL AFTER `metadata`');
CALL smartlink_add_column_if_missing('queue_entries', 'assigned_pump_id', '`assigned_pump_id` BIGINT UNSIGNED NULL AFTER `vehicle_id`');
CALL smartlink_add_column_if_missing('queue_entries', 'assigned_kiosk_id', '`assigned_kiosk_id` BIGINT UNSIGNED NULL AFTER `assigned_pump_id`');
CALL smartlink_add_column_if_missing('queue_entries', 'pump_assignment_status', '`pump_assignment_status` ENUM(''PENDING'',''ASSIGNED'',''LOCKED'',''REASSIGNED'',''MANUAL_REVIEW_REQUIRED'',''FAILED'') NOT NULL DEFAULT ''PENDING'' AFTER `assigned_kiosk_id`');
CALL smartlink_add_column_if_missing('queue_entries', 'assignment_reason', '`assignment_reason` VARCHAR(500) NULL AFTER `pump_assignment_status`');
CALL smartlink_add_column_if_missing('queue_entries', 'assignment_confidence', '`assignment_confidence` ENUM(''LOW'',''MEDIUM'',''HIGH'',''VERIFIED'') NULL AFTER `assignment_reason`');
CALL smartlink_add_column_if_missing('queue_entries', 'assignment_created_at', '`assignment_created_at` TIMESTAMP(3) NULL AFTER `assignment_confidence`');
CALL smartlink_add_column_if_missing('queue_entries', 'assignment_updated_at', '`assignment_updated_at` TIMESTAMP(3) NULL AFTER `assignment_created_at`');
CALL smartlink_add_column_if_missing('queue_entries', 'assignment_locked_at', '`assignment_locked_at` TIMESTAMP(3) NULL AFTER `assignment_updated_at`');

CALL smartlink_add_index_if_missing('queue_entries', 'idx_queue_vehicle', '(`vehicle_id`)');
CALL smartlink_add_index_if_missing('queue_entries', 'idx_queue_assigned_pump_status', '(`station_id`, `assigned_pump_id`, `status`, `position`)');
CALL smartlink_add_index_if_missing('queue_entries', 'idx_queue_assignment_status', '(`station_id`, `pump_assignment_status`, `joined_at`)');

CALL smartlink_add_column_if_missing('kiosk_devices', 'assigned_pump_id', '`assigned_pump_id` BIGINT UNSIGNED NULL AFTER `station_id`');
CALL smartlink_add_column_if_missing('kiosk_devices', 'kiosk_code', '`kiosk_code` VARCHAR(64) NULL AFTER `public_id`');
CALL smartlink_add_column_if_missing('kiosk_devices', 'allowed_modes_json', '`allowed_modes_json` LONGTEXT NULL AFTER `status`');

CALL smartlink_add_index_if_missing('kiosk_devices', 'idx_kiosk_devices_assigned_pump', '(`station_id`, `assigned_pump_id`, `status`)');
CALL smartlink_add_index_if_missing('kiosk_devices', 'idx_kiosk_devices_code', '(`kiosk_code`)');

DROP PROCEDURE IF EXISTS smartlink_add_column_if_missing;
DROP PROCEDURE IF EXISTS smartlink_add_index_if_missing;
