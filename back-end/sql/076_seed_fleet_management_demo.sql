-- 076_seed_fleet_management_demo.sql
-- Optional development/demo data for Fleet Management V2.
-- Requires 070-075. Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @fleet_account_id := (SELECT id FROM fleet_accounts WHERE public_id = 'FLTMBEYALOGISTICS000000001' LIMIT 1);
SET @fleet_owner_user_id := (SELECT owner_user_id FROM fleet_accounts WHERE id = @fleet_account_id LIMIT 1);
SET @fleet_james_user_id := (SELECT id FROM users WHERE public_id = 'SLUFLEETJAMES000000000001' LIMIT 1);
SET @fleet_grace_user_id := (SELECT id FROM users WHERE public_id = 'SLUFLEETGRACE000000000001' LIMIT 1);
SET @fleet_patrick_user_id := (SELECT id FROM users WHERE public_id = 'SLUFLEETPATRICK000000001' LIMIT 1);
SET @veh_hiace_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'BT 2034' LIMIT 1);
SET @veh_truck_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'BLK 9982' LIMIT 1);
SET @veh_hilux_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'MH 3321' LIMIT 1);
SET @station_a_id := (SELECT id FROM stations ORDER BY id ASC LIMIT 1);
SET @station_b_id := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 1);

INSERT INTO fleet_departments (public_id, fleet_account_id, name, code, manager_user_id, status)
SELECT 'FLTDEPTOPS00000000000001', @fleet_account_id, 'Operations Department', 'OPS', @fleet_owner_user_id, 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTDEPTSALES000000000001', @fleet_account_id, 'Sales Department', 'SALES', @fleet_grace_user_id, 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTDEPTMAINT000000000001', @fleet_account_id, 'Maintenance Department', 'MAINT', @fleet_patrick_user_id, 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTDEPTADMIN000000000001', @fleet_account_id, 'Admin & Support', 'ADMIN', @fleet_owner_user_id, 'active'
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  manager_user_id = VALUES(manager_user_id),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

SET @dept_ops_id := (SELECT id FROM fleet_departments WHERE fleet_account_id = @fleet_account_id AND code = 'OPS' LIMIT 1);
SET @dept_sales_id := (SELECT id FROM fleet_departments WHERE fleet_account_id = @fleet_account_id AND code = 'SALES' LIMIT 1);
SET @dept_maint_id := (SELECT id FROM fleet_departments WHERE fleet_account_id = @fleet_account_id AND code = 'MAINT' LIMIT 1);
SET @dept_admin_id := (SELECT id FROM fleet_departments WHERE fleet_account_id = @fleet_account_id AND code = 'ADMIN' LIMIT 1);

UPDATE fleet_vehicles
SET department_id = CASE
    WHEN plate_number = 'BT 2034' THEN @dept_sales_id
    WHEN plate_number = 'BLK 9982' THEN @dept_ops_id
    WHEN plate_number = 'MH 3321' THEN @dept_maint_id
    ELSE department_id
  END,
  expected_km_per_litre = CASE
    WHEN plate_number = 'BT 2034' THEN 9.50
    WHEN plate_number = 'BLK 9982' THEN 5.80
    WHEN plate_number = 'MH 3321' THEN 8.40
    ELSE expected_km_per_litre
  END
WHERE fleet_account_id = @fleet_account_id;

UPDATE fleet_members
SET department_id = CASE
    WHEN user_id = @fleet_james_user_id THEN @dept_ops_id
    WHEN user_id = @fleet_grace_user_id THEN @dept_sales_id
    WHEN user_id = @fleet_patrick_user_id THEN @dept_maint_id
    ELSE department_id
  END
WHERE fleet_account_id = @fleet_account_id;

INSERT INTO fleet_fuel_card_providers (public_id, name, type, supports_api, status)
VALUES
  ('FLTPROVMYFUEL0000000001', 'MyFuel', 'myfuel', 0, 'active'),
  ('FLTPROVMANUAL0000000001', 'Manual Fuel Card', 'manual', 0, 'active'),
  ('FLTPROVFLEETWALLET00001', 'Fleet Wallet', 'fleet_wallet', 0, 'active')
ON DUPLICATE KEY UPDATE
  type = VALUES(type),
  supports_api = VALUES(supports_api),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

SET @provider_myfuel_id := (SELECT id FROM fleet_fuel_card_providers WHERE name = 'MyFuel' LIMIT 1);
SET @provider_manual_id := (SELECT id FROM fleet_fuel_card_providers WHERE name = 'Manual Fuel Card' LIMIT 1);
SET @provider_wallet_id := (SELECT id FROM fleet_fuel_card_providers WHERE name = 'Fleet Wallet' LIMIT 1);

INSERT INTO fleet_fuel_cards (
  public_id,
  fleet_account_id,
  provider_id,
  department_id,
  linked_vehicle_id,
  linked_driver_user_id,
  card_label,
  masked_card_number,
  status,
  provider_status,
  monthly_litre_limit,
  monthly_money_limit,
  daily_litre_limit,
  daily_money_limit,
  last_transaction_at,
  last_reconciled_at
)
SELECT 'FLTCARDMYFUEL4821000001', @fleet_account_id, @provider_myfuel_id, @dept_ops_id, NULL, NULL, 'Operations MyFuel Shared Card', '****4821', 'active', 'api_not_connected', 500.000, 750000.00, 80.000, 120000.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 HOUR), DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTCARDSALES2034000001', @fleet_account_id, @provider_manual_id, @dept_sales_id, @veh_hiace_id, @fleet_grace_user_id, 'Sales Manual Fuel Card', '****2034', 'active', 'manual_tracking', 300.000, 450000.00, 50.000, 75000.00, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 6 HOUR), DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY)
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTCARDWALLET0000000001', @fleet_account_id, @provider_wallet_id, NULL, NULL, NULL, 'SmartLink Fleet Wallet', 'WALLET', 'active', 'manual_tracking', NULL, NULL, NULL, NULL, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 HOUR), DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  provider_id = VALUES(provider_id),
  department_id = VALUES(department_id),
  linked_vehicle_id = VALUES(linked_vehicle_id),
  linked_driver_user_id = VALUES(linked_driver_user_id),
  masked_card_number = VALUES(masked_card_number),
  status = VALUES(status),
  provider_status = VALUES(provider_status),
  monthly_litre_limit = VALUES(monthly_litre_limit),
  monthly_money_limit = VALUES(monthly_money_limit),
  daily_litre_limit = VALUES(daily_litre_limit),
  daily_money_limit = VALUES(daily_money_limit),
  last_transaction_at = VALUES(last_transaction_at),
  last_reconciled_at = VALUES(last_reconciled_at),
  updated_at = CURRENT_TIMESTAMP(3);

SET @card_myfuel_id := (SELECT id FROM fleet_fuel_cards WHERE fleet_account_id = @fleet_account_id AND public_id = 'FLTCARDMYFUEL4821000001' LIMIT 1);
SET @card_sales_id := (SELECT id FROM fleet_fuel_cards WHERE fleet_account_id = @fleet_account_id AND public_id = 'FLTCARDSALES2034000001' LIMIT 1);
SET @card_wallet_id := (SELECT id FROM fleet_fuel_cards WHERE fleet_account_id = @fleet_account_id AND public_id = 'FLTCARDWALLET0000000001' LIMIT 1);

INSERT INTO fleet_allocations (
  public_id,
  fleet_account_id,
  department_id,
  vehicle_id,
  driver_user_id,
  fuel_card_id,
  allocation_target_type,
  allocation_unit,
  monthly_litre_cap,
  monthly_money_cap,
  current_litre_balance,
  current_money_balance,
  used_litres_current_period,
  used_money_current_period,
  carry_over_litres,
  carry_over_money,
  rollover_policy,
  max_carryover_litres,
  max_carryover_money,
  period_start,
  period_end,
  status
)
SELECT 'FLTALLOCPOOL000000000001', @fleet_account_id, NULL, NULL, NULL, @card_wallet_id, 'fleet', 'both', 2000.000, 3000000.00, 750.000, 1125000.00, 1250.000, 1875000.00, 200.000, 300000.00, 'top_up_to_cap', 2500.000, 3750000.00, DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALLOCOPS0000000000001', @fleet_account_id, @dept_ops_id, NULL, NULL, @card_myfuel_id, 'department', 'both', 500.000, 750000.00, 120.000, 180000.00, 380.000, 570000.00, 40.000, 60000.00, 'top_up_to_cap', 700.000, 1050000.00, DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALLOCSALES0000000001', @fleet_account_id, @dept_sales_id, NULL, NULL, @card_sales_id, 'department', 'both', 300.000, 450000.00, 95.000, 142500.00, 205.000, 307500.00, 15.000, 22500.00, 'top_up_to_cap', 400.000, 600000.00, DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALLOCMAINT0000000001', @fleet_account_id, @dept_maint_id, NULL, NULL, NULL, 'department', 'both', 250.000, 375000.00, 110.000, 165000.00, 140.000, 210000.00, 20.000, 30000.00, 'carryover_with_cap', 350.000, 525000.00, DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALLOCADMIN0000000001', @fleet_account_id, @dept_admin_id, NULL, NULL, NULL, 'department', 'both', 200.000, 300000.00, 150.000, 225000.00, 50.000, 75000.00, 10.000, 15000.00, 'reset_no_carryover', NULL, NULL, DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALLOCEMERG0000000001', @fleet_account_id, NULL, NULL, NULL, NULL, 'emergency_reserve', 'both', 150.000, 225000.00, 145.000, 217500.00, 5.000, 7500.00, 0.000, 0.00, 'manual_review', NULL, NULL, DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALLOCJAMES0000000001', @fleet_account_id, @dept_ops_id, @veh_truck_id, @fleet_james_user_id, @card_myfuel_id, 'driver', 'both', 120.000, 180000.00, 45.000, 67500.00, 75.000, 112500.00, 0.000, 0.00, 'top_up_to_cap', 150.000, 225000.00, DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'active'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALLOCGRACE0000000001', @fleet_account_id, @dept_sales_id, @veh_hiace_id, @fleet_grace_user_id, @card_sales_id, 'driver', 'both', 100.000, 150000.00, 38.000, 57000.00, 62.000, 93000.00, 0.000, 0.00, 'top_up_to_cap', 150.000, 225000.00, DATE_FORMAT(UTC_DATE(), '%Y-%m-01'), LAST_DAY(UTC_DATE()), 'active'
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  department_id = VALUES(department_id),
  vehicle_id = VALUES(vehicle_id),
  driver_user_id = VALUES(driver_user_id),
  fuel_card_id = VALUES(fuel_card_id),
  allocation_target_type = VALUES(allocation_target_type),
  allocation_unit = VALUES(allocation_unit),
  monthly_litre_cap = VALUES(monthly_litre_cap),
  monthly_money_cap = VALUES(monthly_money_cap),
  current_litre_balance = VALUES(current_litre_balance),
  current_money_balance = VALUES(current_money_balance),
  used_litres_current_period = VALUES(used_litres_current_period),
  used_money_current_period = VALUES(used_money_current_period),
  carry_over_litres = VALUES(carry_over_litres),
  carry_over_money = VALUES(carry_over_money),
  rollover_policy = VALUES(rollover_policy),
  max_carryover_litres = VALUES(max_carryover_litres),
  max_carryover_money = VALUES(max_carryover_money),
  period_start = VALUES(period_start),
  period_end = VALUES(period_end),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

SET @alloc_pool_id := (SELECT id FROM fleet_allocations WHERE public_id = 'FLTALLOCPOOL000000000001' LIMIT 1);
SET @alloc_ops_id := (SELECT id FROM fleet_allocations WHERE public_id = 'FLTALLOCOPS0000000000001' LIMIT 1);
SET @alloc_sales_id := (SELECT id FROM fleet_allocations WHERE public_id = 'FLTALLOCSALES0000000001' LIMIT 1);
SET @alloc_maint_id := (SELECT id FROM fleet_allocations WHERE public_id = 'FLTALLOCMAINT0000000001' LIMIT 1);
SET @alloc_james_id := (SELECT id FROM fleet_allocations WHERE public_id = 'FLTALLOCJAMES0000000001' LIMIT 1);
SET @alloc_grace_id := (SELECT id FROM fleet_allocations WHERE public_id = 'FLTALLOCGRACE0000000001' LIMIT 1);

INSERT INTO fleet_transactions (
  public_id,
  fleet_account_id,
  department_id,
  vehicle_id,
  driver_user_id,
  station_id,
  fuel_request_id,
  allocation_id,
  fuel_card_id,
  payment_context_type,
  litres,
  amount,
  price_per_litre,
  fuel_type,
  odometer_reading,
  km_since_last_fuel,
  km_per_litre,
  cost_per_km,
  status,
  risk_status,
  risk_reason,
  wallet_transaction_reference,
  created_at
)
SELECT 'FLTTXREF000000000000001', @fleet_account_id, @dept_ops_id, @veh_truck_id, @fleet_james_user_id, @station_a_id, NULL, @alloc_james_id, @card_myfuel_id, 'fuel_card_manual', 45.000, 67500.00, 1500.0000, 'diesel', 82440.0, 398.0, 8.844, 169.5980, 'completed', 'normal', NULL, NULL, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 HOUR)
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTTXREF000000000000002', @fleet_account_id, @dept_sales_id, @veh_hiace_id, @fleet_grace_user_id, COALESCE(@station_b_id, @station_a_id), NULL, @alloc_grace_id, @card_sales_id, 'fuel_card_manual', 32.500, 48750.00, 1500.0000, 'petrol', 45210.0, 290.0, 8.923, 168.1034, 'completed', 'normal', NULL, NULL, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 4 HOUR)
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTTXREF000000000000003', @fleet_account_id, @dept_ops_id, @veh_truck_id, @fleet_james_user_id, @station_a_id, NULL, @alloc_ops_id, @card_myfuel_id, 'fuel_card_manual', 60.000, 90000.00, 1500.0000, 'diesel', 102330.0, 520.0, 8.667, 173.0769, 'completed', 'normal', NULL, NULL, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTTXREF000000000000004', @fleet_account_id, @dept_maint_id, @veh_hilux_id, @fleet_patrick_user_id, COALESCE(@station_b_id, @station_a_id), NULL, @alloc_maint_id, NULL, 'fleet_wallet', 50.000, 75000.00, 1500.0000, 'diesel', 66770.0, 431.0, 8.620, 174.0139, 'completed', 'normal', NULL, 'FWD-SEED-MAINT-0001', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY)
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTTXREF000000000000005', @fleet_account_id, @dept_sales_id, @veh_hiace_id, @fleet_grace_user_id, @station_a_id, NULL, @alloc_sales_id, @card_sales_id, 'fuel_card_manual', 35.000, 52500.00, 1500.0000, 'petrol', 23115.0, 305.0, 8.714, 172.1311, 'completed', 'normal', NULL, NULL, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 3 DAY)
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  amount = VALUES(amount),
  litres = VALUES(litres),
  price_per_litre = VALUES(price_per_litre),
  department_id = VALUES(department_id),
  allocation_id = VALUES(allocation_id),
  fuel_card_id = VALUES(fuel_card_id),
  payment_context_type = VALUES(payment_context_type),
  odometer_reading = VALUES(odometer_reading),
  km_since_last_fuel = VALUES(km_since_last_fuel),
  km_per_litre = VALUES(km_per_litre),
  cost_per_km = VALUES(cost_per_km),
  status = VALUES(status),
  risk_status = VALUES(risk_status),
  created_at = VALUES(created_at),
  updated_at = CURRENT_TIMESTAMP(3);

SET @tx_one_id := (SELECT id FROM fleet_transactions WHERE public_id = 'FLTTXREF000000000000001' LIMIT 1);
SET @tx_two_id := (SELECT id FROM fleet_transactions WHERE public_id = 'FLTTXREF000000000000002' LIMIT 1);

INSERT INTO fleet_allocation_transactions (
  public_id,
  fleet_account_id,
  allocation_id,
  transaction_type,
  litres,
  amount,
  reference,
  related_fleet_transaction_id,
  created_by_user_id,
  created_at
)
SELECT 'FLTALLOCTX000000000001', @fleet_account_id, @alloc_james_id, 'fuel_usage', 45.000, 67500.00, 'ALLOC-SEED-0001', @tx_one_id, @fleet_james_user_id, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 HOUR)
WHERE @fleet_account_id IS NOT NULL AND @alloc_james_id IS NOT NULL
UNION ALL
SELECT 'FLTALLOCTX000000000002', @fleet_account_id, @alloc_grace_id, 'fuel_usage', 32.500, 48750.00, 'ALLOC-SEED-0002', @tx_two_id, @fleet_grace_user_id, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 4 HOUR)
WHERE @fleet_account_id IS NOT NULL AND @alloc_grace_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  litres = VALUES(litres),
  amount = VALUES(amount),
  related_fleet_transaction_id = VALUES(related_fleet_transaction_id);

INSERT INTO fleet_fueling_sessions (
  public_id,
  fleet_account_id,
  department_id,
  vehicle_id,
  driver_user_id,
  allocation_id,
  fuel_card_id,
  station_id,
  payment_context_type,
  authorized_litres,
  authorized_amount,
  odometer_reading,
  fuel_type,
  status,
  validation_json,
  expires_at,
  completed_at,
  created_at
)
SELECT 'FLTSESSION00000000000001', @fleet_account_id, @dept_ops_id, @veh_truck_id, @fleet_james_user_id, @alloc_james_id, @card_myfuel_id, @station_a_id, 'fuel_card_manual', 40.000, 60000.00, 82510.0, 'diesel', 'authorized', JSON_OBJECT('allowed', true, 'source', 'seed'), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 HOUR), NULL, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 20 MINUTE)
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  authorized_litres = VALUES(authorized_litres),
  authorized_amount = VALUES(authorized_amount),
  validation_json = VALUES(validation_json),
  expires_at = VALUES(expires_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_fuel_card_imports (
  public_id,
  fleet_account_id,
  provider_id,
  fuel_card_id,
  file_name,
  status,
  imported_by_user_id,
  rows_total,
  rows_matched,
  rows_unmatched,
  metadata_json
)
SELECT 'FLTCARDIMP000000000001', @fleet_account_id, @provider_myfuel_id, @card_myfuel_id, 'myfuel-may-demo.csv', 'pending', @fleet_owner_user_id, 3, 1, 2, JSON_OBJECT('note', 'Statement import placeholder; parser integration pending.')
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  rows_total = VALUES(rows_total),
  rows_matched = VALUES(rows_matched),
  rows_unmatched = VALUES(rows_unmatched),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_fuel_card_transactions (
  public_id,
  fleet_account_id,
  provider_id,
  fuel_card_id,
  external_reference,
  transaction_date,
  station_name,
  station_id,
  amount,
  litres,
  fuel_type,
  odometer_reading,
  raw_data_json,
  match_status,
  risk_status
)
SELECT 'FLTCARDTX0000000000001', @fleet_account_id, @provider_myfuel_id, @card_myfuel_id, 'MYFUEL-DEMO-0001', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 HOUR), 'Puma Chichiri', @station_a_id, 67500.00, 45.000, 'diesel', 82440.0, JSON_OBJECT('source', 'manual_seed'), 'matched', 'normal'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTCARDTX0000000000002', @fleet_account_id, @provider_myfuel_id, @card_myfuel_id, 'MYFUEL-DEMO-0002', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 HOUR), 'MyFuel Manual Entry', NULL, 111000.00, 74.000, 'diesel', NULL, JSON_OBJECT('source', 'manual_seed'), 'needs_review', 'suspicious'
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  transaction_date = VALUES(transaction_date),
  amount = VALUES(amount),
  litres = VALUES(litres),
  match_status = VALUES(match_status),
  risk_status = VALUES(risk_status),
  raw_data_json = VALUES(raw_data_json),
  updated_at = CURRENT_TIMESTAMP(3);

SET @card_tx_one_id := (SELECT id FROM fleet_fuel_card_transactions WHERE public_id = 'FLTCARDTX0000000000001' LIMIT 1);
SET @card_tx_two_id := (SELECT id FROM fleet_fuel_card_transactions WHERE public_id = 'FLTCARDTX0000000000002' LIMIT 1);

INSERT INTO fleet_fuel_card_reconciliation_matches (
  public_id,
  fleet_account_id,
  card_transaction_id,
  fleet_transaction_id,
  status,
  notes,
  matched_by_user_id,
  matched_at
)
SELECT 'FLTREC000000000000000001', @fleet_account_id, @card_tx_one_id, @tx_one_id, 'matched', 'Matched by amount, litres, card, and odometer.', @fleet_owner_user_id, DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR)
WHERE @fleet_account_id IS NOT NULL AND @card_tx_one_id IS NOT NULL
UNION ALL
SELECT 'FLTREC000000000000000002', @fleet_account_id, @card_tx_two_id, NULL, 'needs_review', 'Manual MyFuel entry has no SmartLink transaction yet.', NULL, NULL
WHERE @fleet_account_id IS NOT NULL AND @card_tx_two_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  fleet_transaction_id = VALUES(fleet_transaction_id),
  status = VALUES(status),
  notes = VALUES(notes),
  matched_by_user_id = VALUES(matched_by_user_id),
  matched_at = VALUES(matched_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_fuel_requests (
  public_id,
  fleet_account_id,
  requested_by_user_id,
  vehicle_id,
  department_id,
  allocation_id,
  station_id,
  requested_amount,
  requested_litres,
  approved_amount,
  approved_litres,
  odometer_reading,
  reason,
  status,
  expires_at
)
SELECT 'FLTREQEXTRA000000000001', @fleet_account_id, @fleet_james_user_id, @veh_truck_id, @dept_ops_id, @alloc_ops_id, @station_a_id, 60000.00, 40.000, NULL, NULL, 82520.0, 'Field trip to Zomba requires extra diesel beyond remaining allocation.', 'pending', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTREQEXTRA000000000002', @fleet_account_id, @fleet_grace_user_id, @veh_hiace_id, @dept_sales_id, @alloc_sales_id, COALESCE(@station_b_id, @station_a_id), 45000.00, 30.000, NULL, NULL, 45290.0, 'Client visit outside normal route allocation.', 'pending', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  requested_amount = VALUES(requested_amount),
  requested_litres = VALUES(requested_litres),
  odometer_reading = VALUES(odometer_reading),
  reason = VALUES(reason),
  status = VALUES(status),
  expires_at = VALUES(expires_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_alerts (public_id, fleet_account_id, type, severity, title, message, related_entity_type, related_entity_id)
SELECT 'FLTALERTOPSLOW0000000001', @fleet_account_id, 'allocation', 'warning', 'Operations Department', 'Low balance: 20 L remaining', 'fleet_department', 'FLTDEPTOPS00000000000001'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALERTMAINTDUE0000001', @fleet_account_id, 'maintenance', 'warning', 'MG 2045', 'Maintenance due in 5 days', 'fleet_vehicle', 'FLTVEHBLK998200000000001'
WHERE @fleet_account_id IS NOT NULL
UNION ALL
SELECT 'FLTALERTBUDGET900000001', @fleet_account_id, 'budget', 'critical', 'Fuel spend limit', '90% of monthly budget used', 'fleet_budget', 'FLTBUDMBEYA202605000001'
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  title = VALUES(title),
  message = VALUES(message),
  related_entity_type = VALUES(related_entity_type),
  related_entity_id = VALUES(related_entity_id);

INSERT INTO fleet_audit_logs (public_id, fleet_account_id, actor_user_id, action, entity_type, entity_id, metadata_json)
SELECT 'FLTAUDALLOCSEED00000001', @fleet_account_id, @fleet_owner_user_id, 'allocation.seeded', 'fleet_allocation', 'FLTALLOCPOOL000000000001', JSON_OBJECT('source', '076_seed_fleet_management_demo')
WHERE @fleet_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  metadata_json = VALUES(metadata_json);
