-- 010_seed_realistic.sql
-- Realistic baseline seed for SmartLink local development.
-- Safe re-runs: uses deterministic public_ids + upsert-style updates.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

-- Fuel types
INSERT INTO fuel_types (id, code, name) VALUES
(1, 'PETROL', 'Petrol'),
(2, 'DIESEL', 'Diesel')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Staff roles
INSERT INTO staff_roles (id, code, name) VALUES
(1, 'MANAGER', 'Manager'),
(2, 'ATTENDANT', 'Attendant'),
(3, 'VIEWER', 'Viewer')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Station (Malawi, Blantyre)
INSERT INTO stations (public_id, name, operator_name, country_code, city, address, timezone, is_active)
VALUES (
  '01J5SMARTLINKBLANTYRE00001',
  'SmartLink Blantyre Central',
  'SmartLink Fuel Ltd',
  'MW',
  'Blantyre',
  'M1 Highway, Limbe, Blantyre',
  'Africa/Blantyre',
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  operator_name = VALUES(operator_name),
  city = VALUES(city),
  address = VALUES(address),
  is_active = VALUES(is_active);

SET @station_id = (
  SELECT id FROM stations WHERE public_id = '01J5SMARTLINKBLANTYRE00001' LIMIT 1
);

-- Users (manager + attendant)
INSERT INTO users (public_id, full_name, phone_e164, email, password_hash, is_active)
VALUES
(
  'SLU-A3K9P2',
  'Station Manager',
  '+265991000111',
  'manager@smartlink.local',
  '$2b$10$A5P0SLf8E8BB7xVAfYjQeuh0U6Vh4wpjQ2hHvbjHjW9.25fksf6F.',
  1
),
(
  'SLU-9F2KD1',
  'Forecourt Attendant',
  '+265991000222',
  'attendant@smartlink.local',
  '$2b$10$A5P0SLf8E8BB7xVAfYjQeuh0U6Vh4wpjQ2hHvbjHjW9.25fksf6F.',
  1
)
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  is_active = VALUES(is_active);

SET @manager_user_id = (
  SELECT id FROM users WHERE public_id = 'SLU-A3K9P2' LIMIT 1
);
SET @attendant_user_id = (
  SELECT id FROM users WHERE public_id = 'SLU-9F2KD1' LIMIT 1
);

-- Station staff links
INSERT INTO station_staff (station_id, user_id, role_id, is_active)
VALUES
(@station_id, @manager_user_id, 1, 1),
(@station_id, @attendant_user_id, 2, 1)
ON DUPLICATE KEY UPDATE
  role_id = VALUES(role_id),
  is_active = VALUES(is_active);

SET @manager_staff_id = (
  SELECT id FROM station_staff WHERE station_id = @station_id AND user_id = @manager_user_id LIMIT 1
);
SET @attendant_staff_id = (
  SELECT id FROM station_staff WHERE station_id = @station_id AND user_id = @attendant_user_id LIMIT 1
);

-- Tanks
INSERT INTO tanks (station_id, public_id, fuel_type_id, name, capacity_litres, is_active)
VALUES
(@station_id, '01J5TANKPETROLBLANTYRE001', 1, 'Petrol Tank A', 30000.00, 1),
(@station_id, '01J5TANKDIESELBLANTYRE001', 2, 'Diesel Tank A', 25000.00, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  capacity_litres = VALUES(capacity_litres),
  is_active = VALUES(is_active);

SET @tank_petrol_id = (
  SELECT id FROM tanks WHERE public_id = '01J5TANKPETROLBLANTYRE001' LIMIT 1
);
SET @tank_diesel_id = (
  SELECT id FROM tanks WHERE public_id = '01J5TANKDIESELBLANTYRE001' LIMIT 1
);

-- Pumps (2 petrol, 1 diesel)
INSERT INTO pumps (station_id, public_id, pump_number, fuel_type_id, tank_id, status, status_reason, is_active)
VALUES
(@station_id, '01J5PUMPPETROLBLANTYRE001', 1, 1, @tank_petrol_id, 'ACTIVE', NULL, 1),
(@station_id, '01J5PUMPPETROLBLANTYRE002', 2, 1, @tank_petrol_id, 'ACTIVE', NULL, 1),
(@station_id, '01J5PUMPDIESELBLANTYRE001', 3, 2, @tank_diesel_id, 'ACTIVE', NULL, 1)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  status_reason = VALUES(status_reason),
  is_active = VALUES(is_active);

SET @pump1_id = (SELECT id FROM pumps WHERE public_id = '01J5PUMPPETROLBLANTYRE001' LIMIT 1);
SET @pump2_id = (SELECT id FROM pumps WHERE public_id = '01J5PUMPPETROLBLANTYRE002' LIMIT 1);
SET @pump3_id = (SELECT id FROM pumps WHERE public_id = '01J5PUMPDIESELBLANTYRE001' LIMIT 1);

-- Pump nozzles (legacy compatibility: at least nozzle #1 per pump)
INSERT INTO pump_nozzles (
  station_id, pump_id, public_id, nozzle_number, side, fuel_type_id, tank_id, status, hardware_channel, is_active
)
VALUES
(@station_id, @pump1_id, '01J5NOZZLEPUMP1BLANTYRE001', 1, 'A', 1, @tank_petrol_id, 'ACTIVE', 'legacy-1-1', 1),
(@station_id, @pump2_id, '01J5NOZZLEPUMP2BLANTYRE001', 1, 'A', 1, @tank_petrol_id, 'ACTIVE', 'legacy-2-1', 1),
(@station_id, @pump3_id, '01J5NOZZLEPUMP3BLANTYRE001', 1, 'A', 2, @tank_diesel_id, 'ACTIVE', 'legacy-3-1', 1)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  tank_id = VALUES(tank_id),
  is_active = VALUES(is_active);

SET @nozzle1_id = (SELECT id FROM pump_nozzles WHERE public_id = '01J5NOZZLEPUMP1BLANTYRE001' LIMIT 1);
SET @nozzle2_id = (SELECT id FROM pump_nozzles WHERE public_id = '01J5NOZZLEPUMP2BLANTYRE001' LIMIT 1);
SET @nozzle3_id = (SELECT id FROM pump_nozzles WHERE public_id = '01J5NOZZLEPUMP3BLANTYRE001' LIMIT 1);

-- Queue settings
INSERT INTO station_queue_settings (
  station_id, is_queue_enabled, grace_minutes, capacity, joins_paused,
  priority_mode, hybrid_queue_n, hybrid_walkin_n, petrol_enabled, diesel_enabled
)
VALUES (@station_id, 1, 10, 100, 0, 'ON', 2, 1, 1, 1)
ON DUPLICATE KEY UPDATE
  is_queue_enabled = VALUES(is_queue_enabled),
  grace_minutes = VALUES(grace_minutes),
  capacity = VALUES(capacity),
  joins_paused = VALUES(joins_paused),
  priority_mode = VALUES(priority_mode),
  hybrid_queue_n = VALUES(hybrid_queue_n),
  hybrid_walkin_n = VALUES(hybrid_walkin_n),
  petrol_enabled = VALUES(petrol_enabled),
  diesel_enabled = VALUES(diesel_enabled);

-- Queue entries (2-5 entries, mix WAITING + 1 CALLED)
DELETE FROM queue_entries
WHERE station_id = @station_id
  AND public_id IN (
    '01J5QUEUEENTRYBLANTYRE00001',
    '01J5QUEUEENTRYBLANTYRE00002',
    '01J5QUEUEENTRYBLANTYRE00003',
    '01J5QUEUEENTRYBLANTYRE00004'
  );

INSERT INTO queue_entries (
  station_id, public_id, user_id, masked_plate, fuel_type_id, position, status,
  joined_at, called_at, grace_expires_at, last_moved_at, metadata
)
VALUES
(
  @station_id,
  '01J5QUEUEENTRYBLANTYRE00001',
  @attendant_user_id,
  'BT****123',
  1,
  1,
  'CALLED',
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 18 MINUTE),
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE),
  DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 MINUTE),
  UTC_TIMESTAMP(3),
  '{"channel":"app"}'
),
(
  @station_id,
  '01J5QUEUEENTRYBLANTYRE00002',
  NULL,
  'BT****517',
  1,
  2,
  'WAITING',
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 12 MINUTE),
  NULL,
  NULL,
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 12 MINUTE),
  '{"channel":"walk_in"}'
),
(
  @station_id,
  '01J5QUEUEENTRYBLANTYRE00003',
  NULL,
  'BM****444',
  2,
  3,
  'WAITING',
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 9 MINUTE),
  NULL,
  NULL,
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 9 MINUTE),
  '{"channel":"app"}'
),
(
  @station_id,
  '01J5QUEUEENTRYBLANTYRE00004',
  NULL,
  'BT****981',
  1,
  4,
  'WAITING',
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 4 MINUTE),
  NULL,
  NULL,
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 4 MINUTE),
  '{"channel":"walk_in"}'
);

SET @queue_called_id = (
  SELECT id FROM queue_entries WHERE public_id = '01J5QUEUEENTRYBLANTYRE00001' LIMIT 1
);

-- Inventory readings (opening + closing per tank)
DELETE FROM inventory_readings
WHERE station_id = @station_id
  AND note IN ('seed-opening', 'seed-closing');

INSERT INTO inventory_readings (
  station_id, tank_id, reading_type, reading_time, litres, recorded_by_staff_id, note
)
VALUES
(@station_id, @tank_petrol_id, 'OPENING', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 18 HOUR), 18250.00, @manager_staff_id, 'seed-opening'),
(@station_id, @tank_petrol_id, 'CLOSING', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR), 16780.00, @manager_staff_id, 'seed-closing'),
(@station_id, @tank_diesel_id, 'OPENING', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 18 HOUR), 13900.00, @manager_staff_id, 'seed-opening'),
(@station_id, @tank_diesel_id, 'CLOSING', DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR), 13140.00, @manager_staff_id, 'seed-closing');

-- One delivery record
DELETE FROM fuel_deliveries
WHERE station_id = @station_id
  AND reference_code = 'DLV-BTY-001';

INSERT INTO fuel_deliveries (
  station_id, tank_id, delivered_time, litres, supplier_name, reference_code, recorded_by_staff_id, note
)
VALUES (
  @station_id,
  @tank_petrol_id,
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 HOUR),
  6000.00,
  'Puma Energy Malawi',
  'DLV-BTY-001',
  @manager_staff_id,
  'Morning replenishment'
);

-- Transactions (30 rows, realistic litres/prices over last 24h)
DELETE FROM transactions
WHERE station_id = @station_id
  AND note = 'seed-tx';

INSERT INTO transactions (
  station_id, public_id, pump_id, nozzle_id, fuel_type_id, occurred_at, litres,
  price_per_litre, total_amount, payment_method, recorded_by_staff_id, queue_entry_id, note
)
SELECT
  @station_id,
  CONCAT('01J5TXBLANTYRE', LPAD(seq.n, 13, '0')),
  CASE
    WHEN MOD(seq.n, 3) = 1 THEN @pump1_id
    WHEN MOD(seq.n, 3) = 2 THEN @pump2_id
    ELSE @pump3_id
  END,
  CASE
    WHEN MOD(seq.n, 3) = 1 THEN @nozzle1_id
    WHEN MOD(seq.n, 3) = 2 THEN @nozzle2_id
    ELSE @nozzle3_id
  END,
  CASE WHEN MOD(seq.n, 5) = 0 THEN 2 ELSE 1 END,
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL (seq.n * 45) MINUTE),
  CAST((12 + MOD(seq.n * 7, 29)) AS DECIMAL(12,3)),
  CASE WHEN MOD(seq.n, 5) = 0 THEN 1945.0000 ELSE 2060.0000 END,
  CAST((12 + MOD(seq.n * 7, 29)) * (CASE WHEN MOD(seq.n, 5) = 0 THEN 1945.0000 ELSE 2060.0000 END) AS DECIMAL(14,2)),
  CASE
    WHEN MOD(seq.n, 10) < 5 THEN 'CASH'
    WHEN MOD(seq.n, 10) < 8 THEN 'MOBILE_MONEY'
    WHEN MOD(seq.n, 10) = 8 THEN 'CARD'
    ELSE 'OTHER'
  END,
  CASE WHEN MOD(seq.n, 2) = 0 THEN @attendant_staff_id ELSE @manager_staff_id END,
  CASE WHEN seq.n = 1 THEN @queue_called_id ELSE NULL END,
  'seed-tx'
FROM (
  SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
  UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10
  UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15
  UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20
  UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25
  UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29 UNION ALL SELECT 30
) AS seq;

-- One low severity incident
INSERT INTO incidents (
  station_id, public_id, severity, category, title, description, status, created_by_staff_id
)
VALUES (
  @station_id,
  '01J5INCIDENTBLANTYRE000001',
  'LOW',
  'VARIANCE',
  'Minor petrol variance observed',
  'Daily close showed slight difference within tolerance.',
  'OPEN',
  @manager_staff_id
)
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  category = VALUES(category),
  title = VALUES(title),
  description = VALUES(description),
  status = VALUES(status),
  created_by_staff_id = VALUES(created_by_staff_id);

-- One report note for today
INSERT INTO report_notes (station_id, note_date, note_text, created_by_staff_id)
VALUES (
  @station_id,
  UTC_DATE(),
  'Smooth shift handover. Queue stable, no pump downtime, one delivery completed.',
  @manager_staff_id
)
ON DUPLICATE KEY UPDATE
  note_text = VALUES(note_text),
  created_by_staff_id = VALUES(created_by_staff_id);

-- Audit log entries (24 entries)
DELETE FROM audit_log
WHERE station_id = @station_id
  AND action_type IN (
    'QUEUE_CALL_NEXT', 'QUEUE_MARK_SERVED', 'QUEUE_SETTINGS_UPDATE',
    'PUMP_STATUS_UPDATE', 'AUTH_LOGIN', 'AUTH_REFRESH', 'AUTH_LOGOUT'
  )
  AND payload LIKE '%seed%';

INSERT INTO audit_log (station_id, actor_staff_id, action_type, payload, created_at)
SELECT
  @station_id,
  CASE WHEN MOD(seq.n, 2) = 0 THEN @manager_staff_id ELSE @attendant_staff_id END,
  CASE
    WHEN MOD(seq.n, 6) = 0 THEN 'PUMP_STATUS_UPDATE'
    WHEN MOD(seq.n, 6) = 1 THEN 'QUEUE_CALL_NEXT'
    WHEN MOD(seq.n, 6) = 2 THEN 'QUEUE_MARK_SERVED'
    WHEN MOD(seq.n, 6) = 3 THEN 'QUEUE_SETTINGS_UPDATE'
    WHEN MOD(seq.n, 6) = 4 THEN 'AUTH_LOGIN'
    ELSE 'AUTH_REFRESH'
  END,
  JSON_OBJECT('seed', true, 'seq', seq.n, 'note', 'realistic-seed'),
  DATE_SUB(UTC_TIMESTAMP(3), INTERVAL (seq.n * 35) MINUTE)
FROM (
  SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
  UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
  UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18
  UNION ALL SELECT 19 UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24
) AS seq;
