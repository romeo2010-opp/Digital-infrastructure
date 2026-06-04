-- 072_fleet_financial_ops.sql
-- Fleet financial and operational dashboard support tables.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS fleet_budgets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  budget_month DATE NOT NULL,
  fuel_budget DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  maintenance_budget DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  other_budget DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  revenue_target DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  status ENUM('active','locked','archived') NOT NULL DEFAULT 'active',
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_budgets_month (fleet_account_id, budget_month),
  KEY idx_fleet_budgets_fleet_status (fleet_account_id, status, budget_month),
  KEY idx_fleet_budgets_created_by (created_by_user_id),
  CONSTRAINT fk_fleet_budgets_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_budgets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_fleet_budgets_non_negative CHECK (
    fuel_budget >= 0 AND maintenance_budget >= 0 AND other_budget >= 0 AND revenue_target >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_invoices (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  invoice_number VARCHAR(64) NOT NULL,
  billing_period_start DATE NULL,
  billing_period_end DATE NULL,
  status ENUM('draft','pending','paid','overdue','cancelled') NOT NULL DEFAULT 'pending',
  subtotal DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  paid_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  due_at TIMESTAMP(3) NULL,
  paid_at TIMESTAMP(3) NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_invoices_number (fleet_account_id, invoice_number),
  KEY idx_fleet_invoices_status_due (fleet_account_id, status, due_at),
  CONSTRAINT fk_fleet_invoices_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT chk_fleet_invoices_non_negative CHECK (
    subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_maintenance_records (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NOT NULL,
  record_type ENUM('service','repair','inspection','tyres','other') NOT NULL DEFAULT 'service',
  status ENUM('due','scheduled','completed','overdue','cancelled') NOT NULL DEFAULT 'due',
  title VARCHAR(140) NOT NULL,
  cost_estimate DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  cost_actual DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  odometer_reading DECIMAL(14,1) NULL,
  due_at TIMESTAMP(3) NULL,
  completed_at TIMESTAMP(3) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_maintenance_fleet_status (fleet_account_id, status, due_at),
  KEY idx_fleet_maintenance_vehicle_status (vehicle_id, status, due_at),
  KEY idx_fleet_maintenance_created_by (created_by_user_id),
  CONSTRAINT fk_fleet_maintenance_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_maintenance_vehicle FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT fk_fleet_maintenance_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_fleet_maintenance_non_negative CHECK (cost_estimate >= 0 AND cost_actual >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_route_activity (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NULL,
  driver_user_id BIGINT UNSIGNED NULL,
  route_name VARCHAR(140) NOT NULL,
  route_status ENUM('planned','active','completed','cancelled') NOT NULL DEFAULT 'planned',
  distance_km DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  fuel_cost DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  other_cost DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  revenue_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  started_at TIMESTAMP(3) NULL,
  completed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_route_activity_fleet_status (fleet_account_id, route_status, started_at),
  KEY idx_fleet_route_activity_vehicle_time (vehicle_id, started_at),
  KEY idx_fleet_route_activity_driver_time (driver_user_id, started_at),
  CONSTRAINT fk_fleet_route_activity_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_route_activity_vehicle FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT fk_fleet_route_activity_driver FOREIGN KEY (driver_user_id) REFERENCES users(id),
  CONSTRAINT chk_fleet_route_activity_non_negative CHECK (
    distance_km >= 0 AND fuel_cost >= 0 AND other_cost >= 0 AND revenue_amount >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_vehicle_live_states (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NOT NULL,
  fuel_percent DECIMAL(5,2) NULL,
  operational_status ENUM('active','idle','in_service','offline') NOT NULL DEFAULT 'offline',
  location_label VARCHAR(160) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  speed_kph DECIMAL(8,2) NULL,
  last_seen_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_vehicle_live_state_vehicle (fleet_account_id, vehicle_id),
  KEY idx_fleet_vehicle_live_states_status (fleet_account_id, operational_status, last_seen_at),
  CONSTRAINT fk_fleet_vehicle_live_states_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_vehicle_live_states_vehicle FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT chk_fleet_vehicle_live_states_fuel CHECK (fuel_percent IS NULL OR (fuel_percent >= 0 AND fuel_percent <= 100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @fleet_account_id := (SELECT id FROM fleet_accounts WHERE public_id = 'FLTMBEYALOGISTICS000000001' LIMIT 1);
SET @fleet_owner_user_id := (SELECT owner_user_id FROM fleet_accounts WHERE id = @fleet_account_id LIMIT 1);
SET @fleet_james_user_id := (SELECT id FROM users WHERE public_id = 'SLUFLEETJAMES000000000001' LIMIT 1);
SET @fleet_grace_user_id := (SELECT id FROM users WHERE public_id = 'SLUFLEETGRACE000000000001' LIMIT 1);
SET @fleet_patrick_user_id := (SELECT id FROM users WHERE public_id = 'SLUFLEETPATRICK000000001' LIMIT 1);
SET @veh_hiace_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'BT 2034' LIMIT 1);
SET @veh_truck_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'BLK 9982' LIMIT 1);
SET @veh_hilux_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'MH 3321' LIMIT 1);

INSERT INTO fleet_budgets (
  public_id,
  fleet_account_id,
  budget_month,
  fuel_budget,
  maintenance_budget,
  other_budget,
  revenue_target,
  status,
  created_by_user_id
)
SELECT
  'FLTBUDMBEYA202605000001',
  @fleet_account_id,
  DATE_FORMAT(UTC_DATE(), '%Y-%m-01'),
  4200000.00,
  850000.00,
  350000.00,
  12800000.00,
  'active',
  @fleet_owner_user_id
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  fuel_budget = VALUES(fuel_budget),
  maintenance_budget = VALUES(maintenance_budget),
  other_budget = VALUES(other_budget),
  revenue_target = VALUES(revenue_target),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_invoices (
  public_id,
  fleet_account_id,
  invoice_number,
  billing_period_start,
  billing_period_end,
  status,
  subtotal,
  tax_amount,
  total_amount,
  paid_amount,
  due_at,
  paid_at,
  notes
)
SELECT 'FLTINVMBEYA202605000001', @fleet_account_id, 'MBEYA-2026-05-001', DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'pending', 980000.00, 0.00, 980000.00, 0.00, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY), NULL, 'Monthly fuel coordination statement'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTINVMBEYA202604000001', @fleet_account_id, 'MBEYA-2026-04-001', DATE_SUB(DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), INTERVAL 1 MONTH), DATE_SUB(DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), INTERVAL 1 DAY), 'paid', 1120000.00, 0.00, 1120000.00, 1120000.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 18 DAY), DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 21 DAY), 'Paid April fleet statement'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTINVMBEYA202603000001', @fleet_account_id, 'MBEYA-2026-03-001', DATE_SUB(DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), INTERVAL 2 MONTH), DATE_SUB(DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), INTERVAL 1 MONTH), 'overdue', 640000.00, 0.00, 640000.00, 320000.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 35 DAY), NULL, 'Partial settlement pending'
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  subtotal = VALUES(subtotal),
  tax_amount = VALUES(tax_amount),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  due_at = VALUES(due_at),
  paid_at = VALUES(paid_at),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_maintenance_records (
  public_id,
  fleet_account_id,
  vehicle_id,
  record_type,
  status,
  title,
  cost_estimate,
  cost_actual,
  odometer_reading,
  due_at,
  completed_at,
  created_by_user_id
)
SELECT 'FLTMNTBT20340000000001', @fleet_account_id, @veh_hiace_id, 'service', 'scheduled', '5,000 km service and oil change', 180000.00, 0.00, 48600.0, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 DAY), NULL, @fleet_owner_user_id
WHERE @fleet_account_id IS NOT NULL AND @veh_hiace_id IS NOT NULL
UNION ALL
SELECT 'FLTMNTBLK998200000001', @fleet_account_id, @veh_truck_id, 'inspection', 'overdue', 'Brake and suspension inspection', 240000.00, 0.00, 128900.0, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY), NULL, @fleet_owner_user_id
WHERE @fleet_account_id IS NOT NULL AND @veh_truck_id IS NOT NULL
UNION ALL
SELECT 'FLTMNTMH33210000000001', @fleet_account_id, @veh_hilux_id, 'repair', 'completed', 'Fuel filter replacement', 95000.00, 87500.00, 73580.0, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 DAY), DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY), @fleet_owner_user_id
WHERE @fleet_account_id IS NOT NULL AND @veh_hilux_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  cost_estimate = VALUES(cost_estimate),
  cost_actual = VALUES(cost_actual),
  odometer_reading = VALUES(odometer_reading),
  due_at = VALUES(due_at),
  completed_at = VALUES(completed_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_route_activity (
  public_id,
  fleet_account_id,
  vehicle_id,
  driver_user_id,
  route_name,
  route_status,
  distance_km,
  fuel_cost,
  other_cost,
  revenue_amount,
  started_at,
  completed_at
)
SELECT 'FLTRTEBT20340000000001', @fleet_account_id, @veh_hiace_id, @fleet_james_user_id, 'Limbe - Chileka shuttle', 'completed', 186.40, 118500.00, 22000.00, 435000.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 6 DAY), DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 6 DAY) + INTERVAL 8 HOUR
WHERE @fleet_account_id IS NOT NULL AND @veh_hiace_id IS NOT NULL
UNION ALL
SELECT 'FLTRTEBLK998200000001', @fleet_account_id, @veh_truck_id, @fleet_grace_user_id, 'Blantyre - Lilongwe freight', 'active', 312.00, 244000.00, 46000.00, 980000.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 18 HOUR), NULL
WHERE @fleet_account_id IS NOT NULL AND @veh_truck_id IS NOT NULL
UNION ALL
SELECT 'FLTRTEMH33210000000001', @fleet_account_id, @veh_hilux_id, @fleet_patrick_user_id, 'MERA inspection support', 'completed', 142.20, 93000.00, 16000.00, 280000.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 DAY), DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 DAY) + INTERVAL 5 HOUR
WHERE @fleet_account_id IS NOT NULL AND @veh_hilux_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  route_status = VALUES(route_status),
  distance_km = VALUES(distance_km),
  fuel_cost = VALUES(fuel_cost),
  other_cost = VALUES(other_cost),
  revenue_amount = VALUES(revenue_amount),
  started_at = VALUES(started_at),
  completed_at = VALUES(completed_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_vehicle_live_states (
  public_id,
  fleet_account_id,
  vehicle_id,
  fuel_percent,
  operational_status,
  location_label,
  latitude,
  longitude,
  speed_kph,
  last_seen_at
)
SELECT 'FLTLIVBT20340000000001', @fleet_account_id, @veh_hiace_id, 62.00, 'active', 'Limbe Depot', -15.8069000, 35.0520000, 38.50, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 4 MINUTE)
WHERE @fleet_account_id IS NOT NULL AND @veh_hiace_id IS NOT NULL
UNION ALL
SELECT 'FLTLIVBLK998200000001', @fleet_account_id, @veh_truck_id, 38.00, 'active', 'M1 near Dedza', -14.3829000, 34.3332000, 64.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 9 MINUTE)
WHERE @fleet_account_id IS NOT NULL AND @veh_truck_id IS NOT NULL
UNION ALL
SELECT 'FLTLIVMH33210000000001', @fleet_account_id, @veh_hilux_id, 74.00, 'in_service', 'Mandala Service Yard', -15.7894000, 35.0061000, 0.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 23 MINUTE)
WHERE @fleet_account_id IS NOT NULL AND @veh_hilux_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  fuel_percent = VALUES(fuel_percent),
  operational_status = VALUES(operational_status),
  location_label = VALUES(location_label),
  latitude = VALUES(latitude),
  longitude = VALUES(longitude),
  speed_kph = VALUES(speed_kph),
  last_seen_at = VALUES(last_seen_at),
  updated_at = CURRENT_TIMESTAMP(3);
