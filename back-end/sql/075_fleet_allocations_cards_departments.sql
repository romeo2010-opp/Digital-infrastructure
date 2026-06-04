-- 075_fleet_allocations_cards_departments.sql
-- Fleet V2 departments, allocations, fuel-now sessions, manual fuel cards, and reconciliation.
-- Safe to rerun. Existing data is not dropped or rewritten.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS fleet_departments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(32) NULL,
  manager_user_id BIGINT UNSIGNED NULL,
  status ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_departments_code (fleet_account_id, code),
  KEY idx_fleet_departments_fleet_status (fleet_account_id, status, name),
  KEY idx_fleet_departments_manager (manager_user_id),
  CONSTRAINT fk_fleet_departments_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_departments_manager FOREIGN KEY (manager_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_fuel_card_providers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  type ENUM('myfuel','totalenergies','manual','fleet_wallet','station_credit','other') NOT NULL DEFAULT 'manual',
  supports_api TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_fuel_card_providers_name (name),
  KEY idx_fleet_fuel_card_providers_type_status (type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_fuel_cards (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  linked_vehicle_id BIGINT UNSIGNED NULL,
  linked_driver_user_id BIGINT UNSIGNED NULL,
  card_label VARCHAR(120) NOT NULL,
  masked_card_number VARCHAR(32) NOT NULL,
  status ENUM('active','suspended','archived','blocked') NOT NULL DEFAULT 'active',
  provider_status ENUM('manual_tracking','synced','api_not_connected','blocked') NOT NULL DEFAULT 'manual_tracking',
  monthly_litre_limit DECIMAL(14,3) NULL,
  monthly_money_limit DECIMAL(18,2) NULL,
  daily_litre_limit DECIMAL(14,3) NULL,
  daily_money_limit DECIMAL(18,2) NULL,
  last_transaction_at TIMESTAMP(3) NULL,
  last_reconciled_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_fuel_cards_label (fleet_account_id, card_label),
  KEY idx_fleet_fuel_cards_fleet_status (fleet_account_id, status),
  KEY idx_fleet_fuel_cards_provider (provider_id, provider_status),
  KEY idx_fleet_fuel_cards_department (department_id, status),
  KEY idx_fleet_fuel_cards_vehicle (linked_vehicle_id, status),
  KEY idx_fleet_fuel_cards_driver (linked_driver_user_id, status),
  CONSTRAINT fk_fleet_fuel_cards_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_fuel_cards_provider FOREIGN KEY (provider_id) REFERENCES fleet_fuel_card_providers(id),
  CONSTRAINT fk_fleet_fuel_cards_department FOREIGN KEY (department_id) REFERENCES fleet_departments(id),
  CONSTRAINT fk_fleet_fuel_cards_vehicle FOREIGN KEY (linked_vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT fk_fleet_fuel_cards_driver FOREIGN KEY (linked_driver_user_id) REFERENCES users(id),
  CONSTRAINT chk_fleet_fuel_cards_limits CHECK (
    (monthly_litre_limit IS NULL OR monthly_litre_limit >= 0) AND
    (monthly_money_limit IS NULL OR monthly_money_limit >= 0) AND
    (daily_litre_limit IS NULL OR daily_litre_limit >= 0) AND
    (daily_money_limit IS NULL OR daily_money_limit >= 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_allocations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  driver_user_id BIGINT UNSIGNED NULL,
  fuel_card_id BIGINT UNSIGNED NULL,
  allocation_target_type ENUM('fleet','department','vehicle','driver','card','trip','emergency_reserve') NOT NULL DEFAULT 'fleet',
  allocation_unit ENUM('litres','money','both') NOT NULL DEFAULT 'litres',
  monthly_litre_cap DECIMAL(14,3) NULL,
  monthly_money_cap DECIMAL(18,2) NULL,
  current_litre_balance DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  current_money_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  used_litres_current_period DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  used_money_current_period DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  carry_over_litres DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  carry_over_money DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  rollover_policy ENUM('top_up_to_cap','reset_no_carryover','carryover_with_cap','manual_review') NOT NULL DEFAULT 'top_up_to_cap',
  max_carryover_litres DECIMAL(14,3) NULL,
  max_carryover_money DECIMAL(18,2) NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status ENUM('active','paused','archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_allocations_fleet_status (fleet_account_id, status, allocation_target_type),
  KEY idx_fleet_allocations_department (department_id, status),
  KEY idx_fleet_allocations_vehicle (vehicle_id, status),
  KEY idx_fleet_allocations_driver (driver_user_id, status),
  KEY idx_fleet_allocations_card (fuel_card_id, status),
  KEY idx_fleet_allocations_period (fleet_account_id, period_start, period_end),
  CONSTRAINT fk_fleet_allocations_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_allocations_department FOREIGN KEY (department_id) REFERENCES fleet_departments(id),
  CONSTRAINT fk_fleet_allocations_vehicle FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT fk_fleet_allocations_driver FOREIGN KEY (driver_user_id) REFERENCES users(id),
  CONSTRAINT fk_fleet_allocations_fuel_card FOREIGN KEY (fuel_card_id) REFERENCES fleet_fuel_cards(id),
  CONSTRAINT chk_fleet_allocations_non_negative CHECK (
    (monthly_litre_cap IS NULL OR monthly_litre_cap >= 0) AND
    (monthly_money_cap IS NULL OR monthly_money_cap >= 0) AND
    current_litre_balance >= 0 AND
    current_money_balance >= 0 AND
    used_litres_current_period >= 0 AND
    used_money_current_period >= 0 AND
    carry_over_litres >= 0 AND
    carry_over_money >= 0 AND
    (max_carryover_litres IS NULL OR max_carryover_litres >= 0) AND
    (max_carryover_money IS NULL OR max_carryover_money >= 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_allocation_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  allocation_id BIGINT UNSIGNED NOT NULL,
  transaction_type ENUM('allocation_topup','fuel_usage','adjustment','carryover','reversal') NOT NULL,
  litres DECIMAL(14,3) NULL,
  amount DECIMAL(18,2) NULL,
  reference VARCHAR(96) NULL,
  related_fleet_transaction_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fleet_allocation_tx_account_time (fleet_account_id, created_at),
  KEY idx_fleet_allocation_tx_allocation_time (allocation_id, created_at),
  KEY idx_fleet_allocation_tx_related (related_fleet_transaction_id),
  KEY idx_fleet_allocation_tx_created_by (created_by_user_id),
  CONSTRAINT fk_fleet_allocation_tx_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_allocation_tx_allocation FOREIGN KEY (allocation_id) REFERENCES fleet_allocations(id),
  CONSTRAINT fk_fleet_allocation_tx_related FOREIGN KEY (related_fleet_transaction_id) REFERENCES fleet_transactions(id),
  CONSTRAINT fk_fleet_allocation_tx_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_allocation_rollovers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  allocation_id BIGINT UNSIGNED NOT NULL,
  rollover_policy ENUM('top_up_to_cap','reset_no_carryover','carryover_with_cap','manual_review') NOT NULL,
  previous_litre_balance DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  previous_money_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  top_up_litres DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  top_up_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  new_litre_balance DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  new_money_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status ENUM('preview','executed','cancelled') NOT NULL DEFAULT 'preview',
  executed_by_user_id BIGINT UNSIGNED NULL,
  executed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fleet_allocation_rollovers_account_time (fleet_account_id, created_at),
  KEY idx_fleet_allocation_rollovers_allocation (allocation_id, status, period_start),
  KEY idx_fleet_allocation_rollovers_executed_by (executed_by_user_id),
  CONSTRAINT fk_fleet_allocation_rollovers_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_allocation_rollovers_allocation FOREIGN KEY (allocation_id) REFERENCES fleet_allocations(id),
  CONSTRAINT fk_fleet_allocation_rollovers_executed_by FOREIGN KEY (executed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_fueling_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NULL,
  vehicle_id BIGINT UNSIGNED NOT NULL,
  driver_user_id BIGINT UNSIGNED NOT NULL,
  allocation_id BIGINT UNSIGNED NULL,
  fuel_card_id BIGINT UNSIGNED NULL,
  station_id BIGINT UNSIGNED NULL,
  payment_context_type ENUM('personal','fleet_wallet','fuel_card_manual','fuel_card_integrated','station_credit') NOT NULL DEFAULT 'fleet_wallet',
  authorized_litres DECIMAL(14,3) NULL,
  authorized_amount DECIMAL(18,2) NULL,
  odometer_reading DECIMAL(14,1) NOT NULL,
  fuel_type ENUM('petrol','diesel','mixed','unknown') NOT NULL DEFAULT 'unknown',
  status ENUM('authorized','completed','cancelled','expired') NOT NULL DEFAULT 'authorized',
  validation_json LONGTEXT NULL,
  expires_at TIMESTAMP(3) NULL,
  completed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_fueling_sessions_account_status (fleet_account_id, status, created_at),
  KEY idx_fleet_fueling_sessions_driver_status (driver_user_id, status, created_at),
  KEY idx_fleet_fueling_sessions_vehicle_status (vehicle_id, status, created_at),
  KEY idx_fleet_fueling_sessions_allocation (allocation_id, status),
  KEY idx_fleet_fueling_sessions_card (fuel_card_id, status),
  KEY idx_fleet_fueling_sessions_station (station_id, status),
  CONSTRAINT fk_fleet_fueling_sessions_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_fueling_sessions_department FOREIGN KEY (department_id) REFERENCES fleet_departments(id),
  CONSTRAINT fk_fleet_fueling_sessions_vehicle FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT fk_fleet_fueling_sessions_driver FOREIGN KEY (driver_user_id) REFERENCES users(id),
  CONSTRAINT fk_fleet_fueling_sessions_allocation FOREIGN KEY (allocation_id) REFERENCES fleet_allocations(id),
  CONSTRAINT fk_fleet_fueling_sessions_card FOREIGN KEY (fuel_card_id) REFERENCES fleet_fuel_cards(id),
  CONSTRAINT fk_fleet_fueling_sessions_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_fuel_card_imports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  fuel_card_id BIGINT UNSIGNED NULL,
  file_name VARCHAR(180) NULL,
  status ENUM('pending','processed','failed') NOT NULL DEFAULT 'pending',
  imported_by_user_id BIGINT UNSIGNED NULL,
  rows_total INT UNSIGNED NOT NULL DEFAULT 0,
  rows_matched INT UNSIGNED NOT NULL DEFAULT 0,
  rows_unmatched INT UNSIGNED NOT NULL DEFAULT 0,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_fuel_card_imports_account_status (fleet_account_id, status, created_at),
  KEY idx_fleet_fuel_card_imports_provider (provider_id, status),
  KEY idx_fleet_fuel_card_imports_card (fuel_card_id, status),
  KEY idx_fleet_fuel_card_imports_imported_by (imported_by_user_id),
  CONSTRAINT fk_fleet_fuel_card_imports_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_fuel_card_imports_provider FOREIGN KEY (provider_id) REFERENCES fleet_fuel_card_providers(id),
  CONSTRAINT fk_fleet_fuel_card_imports_card FOREIGN KEY (fuel_card_id) REFERENCES fleet_fuel_cards(id),
  CONSTRAINT fk_fleet_fuel_card_imports_imported_by FOREIGN KEY (imported_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_fuel_card_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  provider_id BIGINT UNSIGNED NOT NULL,
  fuel_card_id BIGINT UNSIGNED NOT NULL,
  external_reference VARCHAR(96) NULL,
  transaction_date TIMESTAMP(3) NOT NULL,
  station_name VARCHAR(160) NULL,
  station_id BIGINT UNSIGNED NULL,
  amount DECIMAL(18,2) NULL,
  litres DECIMAL(14,3) NULL,
  fuel_type ENUM('petrol','diesel','mixed','unknown') NULL,
  odometer_reading DECIMAL(14,1) NULL,
  raw_data_json LONGTEXT NULL,
  match_status ENUM('unmatched','matched','suspicious','duplicate','needs_review') NOT NULL DEFAULT 'unmatched',
  risk_status ENUM('normal','suspicious','blocked') NOT NULL DEFAULT 'normal',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_fuel_card_tx_external (provider_id, external_reference),
  KEY idx_fleet_fuel_card_tx_account_time (fleet_account_id, transaction_date),
  KEY idx_fleet_fuel_card_tx_card_status (fuel_card_id, match_status, transaction_date),
  KEY idx_fleet_fuel_card_tx_provider (provider_id, transaction_date),
  KEY idx_fleet_fuel_card_tx_station (station_id, transaction_date),
  CONSTRAINT fk_fleet_fuel_card_tx_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_fuel_card_tx_provider FOREIGN KEY (provider_id) REFERENCES fleet_fuel_card_providers(id),
  CONSTRAINT fk_fleet_fuel_card_tx_card FOREIGN KEY (fuel_card_id) REFERENCES fleet_fuel_cards(id),
  CONSTRAINT fk_fleet_fuel_card_tx_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_fuel_card_reconciliation_matches (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  card_transaction_id BIGINT UNSIGNED NOT NULL,
  fleet_transaction_id BIGINT UNSIGNED NULL,
  status ENUM('matched','unmatched','suspicious','duplicate','needs_review') NOT NULL DEFAULT 'needs_review',
  notes VARCHAR(500) NULL,
  matched_by_user_id BIGINT UNSIGNED NULL,
  matched_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_fuel_card_recon_card_tx (card_transaction_id),
  KEY idx_fleet_fuel_card_recon_account_status (fleet_account_id, status, created_at),
  KEY idx_fleet_fuel_card_recon_fleet_tx (fleet_transaction_id),
  KEY idx_fleet_fuel_card_recon_matched_by (matched_by_user_id),
  CONSTRAINT fk_fleet_fuel_card_recon_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_fuel_card_recon_card_tx FOREIGN KEY (card_transaction_id) REFERENCES fleet_fuel_card_transactions(id),
  CONSTRAINT fk_fleet_fuel_card_recon_fleet_tx FOREIGN KEY (fleet_transaction_id) REFERENCES fleet_transactions(id),
  CONSTRAINT fk_fleet_fuel_card_recon_matched_by FOREIGN KEY (matched_by_user_id) REFERENCES users(id)
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

CALL smartlink_add_column_if_missing('fleet_members', 'department_id', '`department_id` BIGINT UNSIGNED NULL AFTER `user_id`');
CALL smartlink_add_index_if_missing('fleet_members', 'idx_fleet_members_department', '(`department_id`, `status`)');

CALL smartlink_add_column_if_missing('fleet_vehicles', 'department_id', '`department_id` BIGINT UNSIGNED NULL AFTER `fleet_account_id`');
CALL smartlink_add_column_if_missing('fleet_vehicles', 'expected_km_per_litre', '`expected_km_per_litre` DECIMAL(10,2) NULL AFTER `current_odometer`');
CALL smartlink_add_index_if_missing('fleet_vehicles', 'idx_fleet_vehicles_department_status', '(`fleet_account_id`, `department_id`, `status`)');

CALL smartlink_add_column_if_missing('fleet_fuel_requests', 'department_id', '`department_id` BIGINT UNSIGNED NULL AFTER `vehicle_id`');
CALL smartlink_add_column_if_missing('fleet_fuel_requests', 'allocation_id', '`allocation_id` BIGINT UNSIGNED NULL AFTER `department_id`');
CALL smartlink_add_column_if_missing('fleet_fuel_requests', 'approved_litres', '`approved_litres` DECIMAL(14,3) NULL AFTER `requested_litres`');
CALL smartlink_add_column_if_missing('fleet_fuel_requests', 'approved_amount', '`approved_amount` DECIMAL(18,2) NULL AFTER `requested_amount`');
CALL smartlink_add_index_if_missing('fleet_fuel_requests', 'idx_fleet_fuel_requests_allocation', '(`allocation_id`, `status`, `created_at`)');
CALL smartlink_add_index_if_missing('fleet_fuel_requests', 'idx_fleet_fuel_requests_department', '(`department_id`, `status`, `created_at`)');

ALTER TABLE fleet_transactions MODIFY COLUMN station_id BIGINT UNSIGNED NULL;
CALL smartlink_add_column_if_missing('fleet_transactions', 'department_id', '`department_id` BIGINT UNSIGNED NULL AFTER `fleet_account_id`');
CALL smartlink_add_column_if_missing('fleet_transactions', 'allocation_id', '`allocation_id` BIGINT UNSIGNED NULL AFTER `fuel_request_id`');
CALL smartlink_add_column_if_missing('fleet_transactions', 'fuel_card_id', '`fuel_card_id` BIGINT UNSIGNED NULL AFTER `allocation_id`');
CALL smartlink_add_column_if_missing('fleet_transactions', 'payment_context_type', '`payment_context_type` ENUM(''personal'',''fleet_wallet'',''fuel_card_manual'',''fuel_card_integrated'',''station_credit'') NOT NULL DEFAULT ''fleet_wallet'' AFTER `fuel_card_id`');
CALL smartlink_add_column_if_missing('fleet_transactions', 'km_since_last_fuel', '`km_since_last_fuel` DECIMAL(14,2) NULL AFTER `odometer_reading`');
CALL smartlink_add_column_if_missing('fleet_transactions', 'km_per_litre', '`km_per_litre` DECIMAL(10,3) NULL AFTER `km_since_last_fuel`');
CALL smartlink_add_column_if_missing('fleet_transactions', 'cost_per_km', '`cost_per_km` DECIMAL(18,4) NULL AFTER `km_per_litre`');
CALL smartlink_add_index_if_missing('fleet_transactions', 'idx_fleet_transactions_department_time', '(`department_id`, `created_at`)');
CALL smartlink_add_index_if_missing('fleet_transactions', 'idx_fleet_transactions_allocation_time', '(`allocation_id`, `created_at`)');
CALL smartlink_add_index_if_missing('fleet_transactions', 'idx_fleet_transactions_fuel_card_time', '(`fuel_card_id`, `created_at`)');
CALL smartlink_add_index_if_missing('fleet_transactions', 'idx_fleet_transactions_payment_context', '(`fleet_account_id`, `payment_context_type`, `created_at`)');

CALL smartlink_add_column_if_missing('fleet_maintenance_records', 'maintenance_type', '`maintenance_type` VARCHAR(64) NULL AFTER `record_type`');
CALL smartlink_add_column_if_missing('fleet_maintenance_records', 'last_service_odometer', '`last_service_odometer` DECIMAL(14,1) NULL AFTER `odometer_reading`');
CALL smartlink_add_column_if_missing('fleet_maintenance_records', 'next_service_odometer', '`next_service_odometer` DECIMAL(14,1) NULL AFTER `last_service_odometer`');
CALL smartlink_add_column_if_missing('fleet_maintenance_records', 'last_service_date', '`last_service_date` DATE NULL AFTER `next_service_odometer`');
CALL smartlink_add_column_if_missing('fleet_maintenance_records', 'next_service_date', '`next_service_date` DATE NULL AFTER `last_service_date`');
CALL smartlink_add_column_if_missing('fleet_maintenance_records', 'notes', '`notes` VARCHAR(500) NULL AFTER `completed_at`');
CALL smartlink_add_index_if_missing('fleet_maintenance_records', 'idx_fleet_maintenance_next_service', '(`fleet_account_id`, `next_service_date`, `status`)');

DROP PROCEDURE IF EXISTS smartlink_add_column_if_missing;
DROP PROCEDURE IF EXISTS smartlink_add_index_if_missing;
