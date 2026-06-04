-- 074_seed_vehicle_profiles_demo.sql
-- Optional development/demo data for Vehicle Profiles and Smart Pump Assignment.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @fleet_james_user_id := (SELECT id FROM users WHERE email = 'james.banda@smartlink.local' LIMIT 1);
SET @fleet_grace_user_id := (SELECT id FROM users WHERE email = 'grace.phiri@smartlink.local' LIMIT 1);
SET @fleet_patrick_user_id := (SELECT id FROM users WHERE email = 'patrick.mbewe@smartlink.local' LIMIT 1);

INSERT INTO vehicles (
  public_id,
  user_id,
  nickname,
  vehicle_type,
  usage_type,
  make,
  model,
  year,
  number_plate,
  fuel_type,
  tank_capacity_litres,
  is_full_tank,
  tank_side,
  tank_side_source,
  tank_side_confidence,
  visual_mockup_key,
  is_default,
  verification_status
)
SELECT 'SLVEHMAZDACX50000000001', @fleet_james_user_id, 'CX-5', 'SUV', 'PRIVATE', 'Mazda', 'CX-5', 2021, 'BT 2034', 'PETROL', 56.00, 0, 'PASSENGER_SIDE', 'USER_CONFIRMED', 'LOW', 'mazda_cx5_suv', 1, 'UNVERIFIED'
WHERE @fleet_james_user_id IS NOT NULL
UNION ALL
SELECT 'SLVEHCOROLLA0000000001', @fleet_grace_user_id, 'Corolla', 'SEDAN', 'PRIVATE', 'Toyota', 'Corolla', 2018, 'BLK 9982', 'PETROL', 50.00, 0, 'DRIVER_SIDE', 'USER_CONFIRMED', 'LOW', 'toyota_corolla_sedan', 1, 'UNVERIFIED'
WHERE @fleet_grace_user_id IS NOT NULL
UNION ALL
SELECT 'SLVEHHILUX000000000001', @fleet_patrick_user_id, 'Hilux', 'PICKUP', 'FLEET', 'Toyota', 'Hilux', 2020, 'MH 3321', 'DIESEL', 80.00, 0, 'PASSENGER_SIDE', 'USER_CONFIRMED', 'LOW', 'toyota_hilux_pickup', 1, 'UNVERIFIED'
WHERE @fleet_patrick_user_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  nickname = VALUES(nickname),
  vehicle_type = VALUES(vehicle_type),
  usage_type = VALUES(usage_type),
  make = VALUES(make),
  model = VALUES(model),
  year = VALUES(year),
  number_plate = VALUES(number_plate),
  fuel_type = VALUES(fuel_type),
  tank_capacity_litres = VALUES(tank_capacity_litres),
  tank_side = VALUES(tank_side),
  tank_side_source = VALUES(tank_side_source),
  tank_side_confidence = VALUES(tank_side_confidence),
  visual_mockup_key = VALUES(visual_mockup_key),
  is_default = VALUES(is_default),
  archived_at = NULL,
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO pump_configurations (
  station_id,
  pump_id,
  display_name,
  fuel_types_supported_json,
  lane_side_supported,
  supported_vehicle_types_json,
  max_vehicle_size,
  is_smartlink_enabled,
  is_active,
  accepts_walkins_when_idle,
  max_standby_walkins,
  clear_lane_buffer_minutes,
  current_mode
)
SELECT
  p.station_id,
  p.id,
  CONCAT('SmartLink Pump ', p.pump_number),
  CASE
    WHEN ft.code IS NOT NULL THEN JSON_ARRAY(UPPER(ft.code))
    ELSE JSON_ARRAY('PETROL', 'DIESEL')
  END,
  CASE
    WHEN MOD(p.pump_number, 3) = 1 THEN 'DRIVER_SIDE'
    WHEN MOD(p.pump_number, 3) = 2 THEN 'PASSENGER_SIDE'
    ELSE 'BOTH_SIDES'
  END,
  JSON_ARRAY('SEDAN','HATCHBACK','SUV','PICKUP','MINIBUS','TRUCK','MOTORCYCLE'),
  CASE
    WHEN MOD(p.pump_number, 4) = 0 THEN 'EXTRA_LARGE'
    WHEN MOD(p.pump_number, 3) = 0 THEN 'LARGE'
    ELSE 'MEDIUM'
  END,
  1,
  p.is_active,
  1,
  1,
  7,
  'OPEN_WALKIN'
FROM pumps p
LEFT JOIN fuel_types ft ON ft.id = p.fuel_type_id
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  fuel_types_supported_json = VALUES(fuel_types_supported_json),
  supported_vehicle_types_json = VALUES(supported_vehicle_types_json),
  is_smartlink_enabled = VALUES(is_smartlink_enabled),
  is_active = VALUES(is_active),
  updated_at = CURRENT_TIMESTAMP(3);
