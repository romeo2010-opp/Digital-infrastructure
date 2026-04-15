-- 014_station_discovery_profile.sql
-- Adds station discovery metadata needed by user mobile map/list screens.
-- Idempotent and safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

-- latitude
SET @has_latitude := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'latitude'
);
SET @sql := IF(
  @has_latitude = 0,
  'ALTER TABLE stations ADD COLUMN latitude DECIMAL(10,7) NULL AFTER address',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- longitude
SET @has_longitude := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'longitude'
);
SET @sql := IF(
  @has_longitude = 0,
  'ALTER TABLE stations ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- phone_e164
SET @has_phone_e164 := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'phone_e164'
);
SET @sql := IF(
  @has_phone_e164 = 0,
  'ALTER TABLE stations ADD COLUMN phone_e164 VARCHAR(20) NULL AFTER timezone',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- opening_time
SET @has_opening_time := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'opening_time'
);
SET @sql := IF(
  @has_opening_time = 0,
  'ALTER TABLE stations ADD COLUMN opening_time TIME NULL AFTER phone_e164',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- closing_time
SET @has_closing_time := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'closing_time'
);
SET @sql := IF(
  @has_closing_time = 0,
  'ALTER TABLE stations ADD COLUMN closing_time TIME NULL AFTER opening_time',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- open_24h
SET @has_open_24h := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'open_24h'
);
SET @sql := IF(
  @has_open_24h = 0,
  'ALTER TABLE stations ADD COLUMN open_24h TINYINT(1) NOT NULL DEFAULT 0 AFTER closing_time',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- rating
SET @has_rating := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'rating'
);
SET @sql := IF(
  @has_rating = 0,
  'ALTER TABLE stations ADD COLUMN rating DECIMAL(2,1) NULL AFTER open_24h',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- reviews_count
SET @has_reviews_count := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'reviews_count'
);
SET @sql := IF(
  @has_reviews_count = 0,
  'ALTER TABLE stations ADD COLUMN reviews_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER rating',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- fuel_level
SET @has_fuel_level := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'fuel_level'
);
SET @sql := IF(
  @has_fuel_level = 0,
  'ALTER TABLE stations ADD COLUMN fuel_level ENUM(''HIGH'',''MEDIUM'',''LOW'') NOT NULL DEFAULT ''MEDIUM'' AFTER reviews_count',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- availability_status
SET @has_availability_status := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'availability_status'
);
SET @sql := IF(
  @has_availability_status = 0,
  'ALTER TABLE stations ADD COLUMN availability_status ENUM(''AVAILABLE'',''IN_USE'') NOT NULL DEFAULT ''AVAILABLE'' AFTER fuel_level',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- hero_image_url
SET @has_hero_image_url := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'hero_image_url'
);
SET @sql := IF(
  @has_hero_image_url = 0,
  'ALTER TABLE stations ADD COLUMN hero_image_url VARCHAR(512) NULL AFTER availability_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- facilities_json
SET @has_facilities_json := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'facilities_json'
);
SET @sql := IF(
  @has_facilities_json = 0,
  'ALTER TABLE stations ADD COLUMN facilities_json LONGTEXT NULL AFTER hero_image_url',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- prices_json
SET @has_prices_json := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND COLUMN_NAME = 'prices_json'
);
SET @sql := IF(
  @has_prices_json = 0,
  'ALTER TABLE stations ADD COLUMN prices_json LONGTEXT NULL AFTER facilities_json',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Discovery indexes
SET @idx_geo_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND INDEX_NAME = 'idx_stations_geo'
);
SET @sql := IF(
  @idx_geo_exists = 0,
  'CREATE INDEX idx_stations_geo ON stations (latitude, longitude)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_discovery_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stations'
    AND INDEX_NAME = 'idx_stations_discovery'
);
SET @sql := IF(
  @idx_discovery_exists = 0,
  'CREATE INDEX idx_stations_discovery ON stations (is_active, city, availability_status, fuel_level)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Existing seeded stations: attach discovery profile values.
UPDATE stations
SET
  latitude = -13.9589000,
  longitude = 33.7838000,
  phone_e164 = '+265999111120',
  opening_time = '00:00:00',
  closing_time = '23:59:00',
  open_24h = 1,
  rating = 4.3,
  reviews_count = 118,
  fuel_level = 'MEDIUM',
  availability_status = 'AVAILABLE',
  hero_image_url = 'https://images.pexels.com/photos/97079/pexels-photo-97079.jpeg?auto=compress&cs=tinysrgb&w=1200',
  facilities_json = '["Car","Car Repair","Restaurant"]',
  prices_json = '[{"label":"Petrol","value":"MK 2,680/L"},{"label":"Diesel","value":"MK 2,590/L"},{"label":"Premium","value":"MK 2,760/L"},{"label":"Petrol 2","value":"MK 2,700/L"},{"label":"Diesel 2","value":"MK 2,610/L"},{"label":"Premium 2","value":"MK 2,780/L"}]'
WHERE public_id = '01STATIONABC1234567890123';

UPDATE stations
SET
  latitude = -15.7861000,
  longitude = 35.0058000,
  phone_e164 = '+265999311901',
  opening_time = '05:00:00',
  closing_time = '23:00:00',
  open_24h = 0,
  rating = 4.6,
  reviews_count = 149,
  fuel_level = 'HIGH',
  availability_status = 'AVAILABLE',
  hero_image_url = 'https://images.pexels.com/photos/3694341/pexels-photo-3694341.jpeg?auto=compress&cs=tinysrgb&w=1200',
  facilities_json = '["Car","Car Repair","Restaurant"]',
  prices_json = '[{"label":"Petrol","value":"MK 2,670/L"},{"label":"Diesel","value":"MK 2,580/L"},{"label":"Premium","value":"MK 2,745/L"},{"label":"Petrol 2","value":"MK 2,695/L"},{"label":"Diesel 2","value":"MK 2,605/L"},{"label":"Premium 2","value":"MK 2,770/L"}]'
WHERE public_id = '01J5SMARTLINKBLANTYRE00001';

-- Additional Blantyre stations for user map/list.
INSERT INTO stations (
  public_id,
  name,
  operator_name,
  country_code,
  city,
  address,
  latitude,
  longitude,
  timezone,
  phone_e164,
  opening_time,
  closing_time,
  open_24h,
  rating,
  reviews_count,
  fuel_level,
  availability_status,
  hero_image_url,
  facilities_json,
  prices_json,
  is_active
)
VALUES
(
  '01J6SLBTY00000000000000001',
  'BP Ginnery Corner',
  'BP',
  'MW',
  'Blantyre',
  'Masauko Chipembere Hwy, Blantyre',
  -15.7858000,
  35.0036000,
  'Africa/Blantyre',
  '+265999020881',
  '00:00:00',
  '23:59:00',
  1,
  4.6,
  126,
  'MEDIUM',
  'IN_USE',
  'https://images.pexels.com/photos/3328356/pexels-photo-3328356.jpeg?auto=compress&cs=tinysrgb&w=1200',
  '["Car","Car Repair"]',
  '[{"label":"Petrol","value":"MK 2,680/L"},{"label":"Diesel","value":"MK 2,590/L"},{"label":"Premium","value":"MK 2,760/L"},{"label":"Petrol 2","value":"MK 2,700/L"},{"label":"Diesel 2","value":"MK 2,610/L"},{"label":"Premium 2","value":"MK 2,780/L"}]',
  1
),
(
  '01J6SLBTY00000000000000002',
  'TotalEnergies Chichiri',
  'TotalEnergies',
  'MW',
  'Blantyre',
  'M1, Chichiri, Blantyre',
  -15.7953000,
  35.0214000,
  'Africa/Blantyre',
  '+265888450120',
  '05:00:00',
  '22:00:00',
  0,
  4.5,
  98,
  'MEDIUM',
  'AVAILABLE',
  'https://images.pexels.com/photos/185411/pexels-photo-185411.jpeg?auto=compress&cs=tinysrgb&w=1200',
  '["Car","Restaurant"]',
  '[{"label":"Petrol","value":"MK 2,670/L"},{"label":"Diesel","value":"MK 2,580/L"},{"label":"Premium","value":"MK 2,745/L"},{"label":"Petrol 2","value":"MK 2,695/L"},{"label":"Diesel 2","value":"MK 2,605/L"},{"label":"Premium 2","value":"MK 2,770/L"}]',
  1
),
(
  '01J6SLBTY00000000000000003',
  'Engen Naperi',
  'Engen',
  'MW',
  'Blantyre',
  'Naperi, Blantyre',
  -15.7794000,
  35.0028000,
  'Africa/Blantyre',
  '+265999441331',
  '00:00:00',
  '23:59:00',
  1,
  4.7,
  141,
  'HIGH',
  'AVAILABLE',
  'https://images.pexels.com/photos/92970/pexels-photo-92970.jpeg?auto=compress&cs=tinysrgb&w=1200',
  '["Car","Car Repair"]',
  '[{"label":"Petrol","value":"MK 2,660/L"},{"label":"Diesel","value":"MK 2,575/L"},{"label":"Premium","value":"MK 2,740/L"},{"label":"Petrol 2","value":"MK 2,685/L"},{"label":"Diesel 2","value":"MK 2,595/L"},{"label":"Premium 2","value":"MK 2,760/L"}]',
  1
),
(
  '01J6SLBTY00000000000000004',
  'Puma Limbe Market',
  'PUMA',
  'MW',
  'Blantyre',
  'Limbe, Blantyre',
  -15.8171000,
  35.0482000,
  'Africa/Blantyre',
  '+265888771420',
  '00:00:00',
  '23:59:00',
  1,
  4.4,
  77,
  'LOW',
  'AVAILABLE',
  'https://images.pexels.com/photos/2231758/pexels-photo-2231758.jpeg?auto=compress&cs=tinysrgb&w=1200',
  '["Car","Restaurant"]',
  '[{"label":"Petrol","value":"MK 2,700/L"},{"label":"Diesel","value":"MK 2,620/L"},{"label":"Premium","value":"MK 2,790/L"},{"label":"Petrol 2","value":"MK 2,725/L"},{"label":"Diesel 2","value":"MK 2,640/L"},{"label":"Premium 2","value":"MK 2,810/L"}]',
  1
),
(
  '01J6SLBTY00000000000000005',
  'Chitawira Service Station',
  'SmartLink Partner',
  'MW',
  'Blantyre',
  'Chitawira, Blantyre',
  -15.8079000,
  35.0039000,
  'Africa/Blantyre',
  '+265999559230',
  '06:00:00',
  '23:00:00',
  0,
  4.3,
  64,
  'LOW',
  'IN_USE',
  'https://images.pexels.com/photos/1402787/pexels-photo-1402787.jpeg?auto=compress&cs=tinysrgb&w=1200',
  '["Car","Restaurant"]',
  '[{"label":"Petrol","value":"MK 2,700/L"},{"label":"Diesel","value":"MK 2,620/L"},{"label":"Premium","value":"MK 2,790/L"},{"label":"Petrol 2","value":"MK 2,725/L"},{"label":"Diesel 2","value":"MK 2,640/L"},{"label":"Premium 2","value":"MK 2,810/L"}]',
  1
),
(
  '01J6SLBTY00000000000000006',
  'Kameza Fuel Stop',
  'SmartLink Partner',
  'MW',
  'Blantyre',
  'Kameza Roundabout, Blantyre',
  -15.8328000,
  35.0241000,
  'Africa/Blantyre',
  '+265999771420',
  '05:00:00',
  '22:30:00',
  0,
  4.2,
  52,
  'MEDIUM',
  'AVAILABLE',
  'https://images.pexels.com/photos/239711/pexels-photo-239711.jpeg?auto=compress&cs=tinysrgb&w=1200',
  '["Car","Restaurant"]',
  '[{"label":"Petrol","value":"MK 2,690/L"},{"label":"Diesel","value":"MK 2,600/L"},{"label":"Premium","value":"MK 2,770/L"},{"label":"Petrol 2","value":"MK 2,710/L"},{"label":"Diesel 2","value":"MK 2,620/L"},{"label":"Premium 2","value":"MK 2,790/L"}]',
  1
),
(
  '01J6SLBTY00000000000000007',
  'Chileka Road Depot',
  'SmartLink Partner',
  'MW',
  'Blantyre',
  'Chileka Rd, Blantyre',
  -15.8072000,
  34.9736000,
  'Africa/Blantyre',
  '+265999663230',
  '00:00:00',
  '23:59:00',
  1,
  4.1,
  46,
  'LOW',
  'AVAILABLE',
  'https://images.pexels.com/photos/97075/pexels-photo-97075.jpeg?auto=compress&cs=tinysrgb&w=1200',
  '["Car","Car Repair"]',
  '[{"label":"Petrol","value":"MK 2,700/L"},{"label":"Diesel","value":"MK 2,620/L"},{"label":"Premium","value":"MK 2,800/L"},{"label":"Petrol 2","value":"MK 2,720/L"},{"label":"Diesel 2","value":"MK 2,640/L"},{"label":"Premium 2","value":"MK 2,820/L"}]',
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  operator_name = VALUES(operator_name),
  country_code = VALUES(country_code),
  city = VALUES(city),
  address = VALUES(address),
  latitude = VALUES(latitude),
  longitude = VALUES(longitude),
  timezone = VALUES(timezone),
  phone_e164 = VALUES(phone_e164),
  opening_time = VALUES(opening_time),
  closing_time = VALUES(closing_time),
  open_24h = VALUES(open_24h),
  rating = VALUES(rating),
  reviews_count = VALUES(reviews_count),
  fuel_level = VALUES(fuel_level),
  availability_status = VALUES(availability_status),
  hero_image_url = VALUES(hero_image_url),
  facilities_json = VALUES(facilities_json),
  prices_json = VALUES(prices_json),
  is_active = VALUES(is_active);

-- Ensure queue settings rows exist for discoverable stations.
INSERT INTO station_queue_settings (
  station_id,
  is_queue_enabled,
  grace_minutes,
  capacity,
  joins_paused,
  priority_mode,
  hybrid_queue_n,
  hybrid_walkin_n,
  petrol_enabled,
  diesel_enabled
)
SELECT
  s.id,
  1,
  10,
  120,
  0,
  'ON',
  2,
  1,
  1,
  1
FROM stations s
WHERE s.public_id IN (
  '01STATIONABC1234567890123',
  '01J5SMARTLINKBLANTYRE00001',
  '01J6SLBTY00000000000000001',
  '01J6SLBTY00000000000000002',
  '01J6SLBTY00000000000000003',
  '01J6SLBTY00000000000000004',
  '01J6SLBTY00000000000000005',
  '01J6SLBTY00000000000000006',
  '01J6SLBTY00000000000000007'
)
ON DUPLICATE KEY UPDATE
  is_queue_enabled = VALUES(is_queue_enabled),
  grace_minutes = VALUES(grace_minutes),
  capacity = VALUES(capacity),
  petrol_enabled = VALUES(petrol_enabled),
  diesel_enabled = VALUES(diesel_enabled);

SELECT 'Station discovery profile migration applied.' AS info_message;
