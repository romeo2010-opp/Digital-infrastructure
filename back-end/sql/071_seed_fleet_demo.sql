-- 071_seed_fleet_demo.sql
-- Optional development/demo data for Fleet Accounts.
-- Demo password for seeded fleet users: SmartLink!2026

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @fleet_password_hash := '$2a$10$vZz8mbU5d/a1MeNjLgawcuKLrunqioVn5Nw.eUhHImsgK0tNmqTS6';

INSERT INTO users (public_id, full_name, phone_e164, email, password_hash, is_active)
VALUES
  ('SLUFLEETOWNER000000000001', 'Mbeya Logistics Manager', '+265990200001', 'fleet.manager@smartlink.local', @fleet_password_hash, 1),
  ('SLUFLEETJAMES000000000001', 'James Banda', '+265990200002', 'james.banda@smartlink.local', @fleet_password_hash, 1),
  ('SLUFLEETGRACE000000000001', 'Grace Phiri', '+265990200003', 'grace.phiri@smartlink.local', @fleet_password_hash, 1),
  ('SLUFLEETPATRICK000000001', 'Patrick Mbewe', '+265990200004', 'patrick.mbewe@smartlink.local', @fleet_password_hash, 1),
  ('SLUFLEETFINANCE000000001', 'Mbeya Logistics Finance', '+265990200005', 'fleet.finance@smartlink.local', @fleet_password_hash, 1)
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  phone_e164 = VALUES(phone_e164),
  password_hash = VALUES(password_hash),
  is_active = VALUES(is_active);

SET @fleet_owner_user_id := (SELECT id FROM users WHERE email = 'fleet.manager@smartlink.local' LIMIT 1);
SET @fleet_james_user_id := (SELECT id FROM users WHERE email = 'james.banda@smartlink.local' LIMIT 1);
SET @fleet_grace_user_id := (SELECT id FROM users WHERE email = 'grace.phiri@smartlink.local' LIMIT 1);
SET @fleet_patrick_user_id := (SELECT id FROM users WHERE email = 'patrick.mbewe@smartlink.local' LIMIT 1);
SET @fleet_finance_user_id := (SELECT id FROM users WHERE email = 'fleet.finance@smartlink.local' LIMIT 1);

INSERT INTO fleet_accounts (
  public_id,
  name,
  business_type,
  registration_number,
  owner_user_id,
  primary_contact_name,
  primary_contact_phone,
  billing_email,
  status
)
VALUES (
  'FLTMBEYALOGISTICS000000001',
  'Mbeya Logistics',
  'logistics',
  'MBEYA-LOG-2026',
  @fleet_owner_user_id,
  'Mbeya Logistics Manager',
  '+265990200001',
  'fleet.billing@smartlink.local',
  'active'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  business_type = VALUES(business_type),
  registration_number = VALUES(registration_number),
  owner_user_id = VALUES(owner_user_id),
  primary_contact_name = VALUES(primary_contact_name),
  primary_contact_phone = VALUES(primary_contact_phone),
  billing_email = VALUES(billing_email),
  status = VALUES(status);

SET @fleet_account_id := (SELECT id FROM fleet_accounts WHERE public_id = 'FLTMBEYALOGISTICS000000001' LIMIT 1);

INSERT INTO fleet_members (
  public_id,
  fleet_account_id,
  user_id,
  role,
  status,
  invited_by_user_id,
  invited_at,
  accepted_at
)
VALUES
  ('FLTMEMOWNER00000000000001', @fleet_account_id, @fleet_owner_user_id, 'owner', 'active', @fleet_owner_user_id, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('FLTMEMFINANCE000000000001', @fleet_account_id, @fleet_finance_user_id, 'finance', 'active', @fleet_owner_user_id, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('FLTMEMJAMES00000000000001', @fleet_account_id, @fleet_james_user_id, 'driver', 'active', @fleet_owner_user_id, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('FLTMEMGRACE00000000000001', @fleet_account_id, @fleet_grace_user_id, 'driver', 'active', @fleet_owner_user_id, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('FLTMEMPATRICK000000000001', @fleet_account_id, @fleet_patrick_user_id, 'driver', 'active', @fleet_owner_user_id, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  role = VALUES(role),
  status = VALUES(status),
  invited_by_user_id = VALUES(invited_by_user_id),
  accepted_at = VALUES(accepted_at);

INSERT INTO fleet_wallets (
  public_id,
  fleet_account_id,
  balance,
  reserved_balance,
  currency,
  status
)
VALUES (
  'FLTWALLETMBEYA0000000001',
  @fleet_account_id,
  3500000.00,
  0.00,
  'MWK',
  'active'
)
ON DUPLICATE KEY UPDATE
  balance = VALUES(balance),
  reserved_balance = VALUES(reserved_balance),
  currency = VALUES(currency),
  status = VALUES(status);

SET @fleet_wallet_id := (SELECT id FROM fleet_wallets WHERE fleet_account_id = @fleet_account_id LIMIT 1);

INSERT INTO fleet_wallet_transactions (
  public_id,
  fleet_wallet_id,
  fleet_account_id,
  type,
  status,
  amount,
  currency,
  reference,
  description,
  created_by_user_id
)
VALUES (
  'FLTWALTXSEED000000000001',
  @fleet_wallet_id,
  @fleet_account_id,
  'topup',
  'posted',
  3500000.00,
  'MWK',
  'FLT-SEED-TOPUP-MBEYA',
  'Development seed opening balance for Mbeya Logistics.',
  @fleet_owner_user_id
)
ON DUPLICATE KEY UPDATE
  amount = VALUES(amount),
  status = VALUES(status),
  description = VALUES(description);

INSERT INTO fleet_vehicles (
  public_id,
  fleet_account_id,
  plate_number,
  vehicle_name,
  vehicle_type,
  fuel_type,
  tank_capacity_litres,
  current_odometer,
  status
)
VALUES
  ('FLTVEHBT2034000000000001', @fleet_account_id, 'BT 2034', 'Toyota Hiace', 'minibus', 'petrol', 70.00, 48210.0, 'active'),
  ('FLTVEHBLK998200000000001', @fleet_account_id, 'BLK 9982', 'Isuzu Truck', 'truck', 'diesel', 180.00, 128410.0, 'active'),
  ('FLTVEHMH3321000000000001', @fleet_account_id, 'MH 3321', 'Toyota Hilux', 'pickup', 'diesel', 80.00, 73550.0, 'active')
ON DUPLICATE KEY UPDATE
  vehicle_name = VALUES(vehicle_name),
  vehicle_type = VALUES(vehicle_type),
  fuel_type = VALUES(fuel_type),
  tank_capacity_litres = VALUES(tank_capacity_litres),
  current_odometer = VALUES(current_odometer),
  status = VALUES(status);

SET @veh_hiace_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'BT 2034' LIMIT 1);
SET @veh_truck_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'BLK 9982' LIMIT 1);
SET @veh_hilux_id := (SELECT id FROM fleet_vehicles WHERE fleet_account_id = @fleet_account_id AND plate_number = 'MH 3321' LIMIT 1);

INSERT INTO fleet_vehicle_assignments (
  public_id,
  fleet_account_id,
  vehicle_id,
  user_id,
  status,
  assigned_by_user_id,
  assigned_at
)
VALUES
  ('FLTASGNJAMES000000000001', @fleet_account_id, @veh_hiace_id, @fleet_james_user_id, 'active', @fleet_owner_user_id, CURRENT_TIMESTAMP(3)),
  ('FLTASGNGRACE000000000001', @fleet_account_id, @veh_truck_id, @fleet_grace_user_id, 'active', @fleet_owner_user_id, CURRENT_TIMESTAMP(3)),
  ('FLTASGNPATRICK0000000001', @fleet_account_id, @veh_hilux_id, @fleet_patrick_user_id, 'active', @fleet_owner_user_id, CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  assigned_by_user_id = VALUES(assigned_by_user_id),
  removed_at = NULL,
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fleet_policies (
  public_id,
  fleet_account_id,
  name,
  applies_to_type,
  applies_to_id,
  daily_amount_limit,
  monthly_amount_limit,
  daily_litre_limit,
  monthly_litre_limit,
  allowed_fuel_type,
  requires_approval_above_amount,
  active
)
VALUES
  ('FLTPOLFLEET000000000001', @fleet_account_id, 'Fleet daily driver control', 'fleet', NULL, 80000.00, NULL, NULL, NULL, NULL, 50000.00, 1),
  ('FLTPOLMONTH000000000001', @fleet_account_id, 'Monthly vehicle ceiling', 'fleet', NULL, NULL, 1200000.00, NULL, NULL, NULL, NULL, 1)
ON DUPLICATE KEY UPDATE
  daily_amount_limit = VALUES(daily_amount_limit),
  monthly_amount_limit = VALUES(monthly_amount_limit),
  requires_approval_above_amount = VALUES(requires_approval_above_amount),
  active = VALUES(active);

INSERT INTO fleet_alerts (
  public_id,
  fleet_account_id,
  type,
  severity,
  title,
  message
)
VALUES (
  'FLTALERTSEED000000000001',
  @fleet_account_id,
  'policy',
  'info',
  'Fleet controls enabled',
  'Mbeya Logistics has seeded wallet, vehicle, driver, and policy controls for development testing.'
)
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  title = VALUES(title),
  message = VALUES(message);

INSERT INTO fleet_audit_logs (
  public_id,
  fleet_account_id,
  actor_user_id,
  action,
  entity_type,
  entity_id,
  metadata_json
)
VALUES (
  'FLTAUDITSEED00000000001',
  @fleet_account_id,
  @fleet_owner_user_id,
  'fleet.seeded',
  'fleet_account',
  'FLTMBEYALOGISTICS000000001',
  JSON_OBJECT('source', '071_seed_fleet_demo.sql')
)
ON DUPLICATE KEY UPDATE
  metadata_json = VALUES(metadata_json);
