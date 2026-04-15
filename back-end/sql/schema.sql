SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE DATABASE IF NOT EXISTS smartlink
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE smartlink;

CREATE TABLE IF NOT EXISTS fuel_types (
  id TINYINT UNSIGNED PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  name VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO fuel_types (id, code, name) VALUES
(1, 'PETROL', 'Petrol'),
(2, 'DIESEL', 'Diesel')
ON DUPLICATE KEY UPDATE name = VALUES(name);

CREATE TABLE IF NOT EXISTS staff_roles (
  id TINYINT UNSIGNED PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  name VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO staff_roles (id, code, name) VALUES
(1, 'MANAGER', 'Manager'),
(2, 'ATTENDANT', 'Attendant'),
(3, 'VIEWER', 'Viewer')
ON DUPLICATE KEY UPDATE name = VALUES(name);

CREATE TABLE IF NOT EXISTS stations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  operator_name VARCHAR(120) NULL,
  country_code CHAR(2) NULL,
  city VARCHAR(80) NULL,
  address VARCHAR(255) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Blantyre',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_stations_active ON stations (is_active);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  full_name VARCHAR(120) NULL,
  phone_e164 VARCHAR(20) NULL UNIQUE,
  email VARCHAR(160) NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_passkeys (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  credential_id VARCHAR(512) NOT NULL UNIQUE,
  public_key_pem TEXT NOT NULL,
  sign_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  label VARCHAR(120) NULL,
  transports_json LONGTEXT NULL,
  last_used_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_passkeys_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_user_passkeys_user ON user_passkeys (user_id);

CREATE TABLE IF NOT EXISTS user_passkey_challenges (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  purpose ENUM('REGISTER','AUTHENTICATE') NOT NULL,
  challenge VARCHAR(255) NOT NULL,
  origin VARCHAR(255) NOT NULL,
  rp_id VARCHAR(190) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_passkey_challenges_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_user_passkey_challenges_lookup
  ON user_passkey_challenges (public_id, purpose, used_at, expires_at);

CREATE TABLE IF NOT EXISTS station_staff (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id TINYINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_station_staff (station_id, user_id),
  CONSTRAINT fk_staff_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_staff_role FOREIGN KEY (role_id) REFERENCES staff_roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_station_staff_station_role ON station_staff (station_id, role_id);

CREATE TABLE IF NOT EXISTS tanks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  public_id CHAR(26) NOT NULL UNIQUE,
  fuel_type_id TINYINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  capacity_litres DECIMAL(12,2) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tanks_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_tanks_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_tanks_station_fuel ON tanks (station_id, fuel_type_id);

CREATE TABLE IF NOT EXISTS pumps (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  pump_number INT UNSIGNED NOT NULL,
  fuel_type_id TINYINT UNSIGNED NULL,
  tank_id BIGINT UNSIGNED NULL,
  status ENUM('ACTIVE','PAUSED','OFFLINE') NOT NULL DEFAULT 'ACTIVE',
  status_reason VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_station_pump_number (station_id, pump_number),
  CONSTRAINT fk_pumps_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_pumps_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
  CONSTRAINT fk_pumps_tank FOREIGN KEY (tank_id) REFERENCES tanks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_pumps_station_status ON pumps (station_id, status);

CREATE TABLE IF NOT EXISTS pump_nozzles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  pump_id BIGINT UNSIGNED NOT NULL,
  public_id VARCHAR(96) NOT NULL UNIQUE,
  nozzle_number VARCHAR(64) NOT NULL,
  side VARCHAR(8) NULL,
  fuel_type_id TINYINT UNSIGNED NOT NULL,
  tank_id BIGINT UNSIGNED NULL,
  status ENUM('ACTIVE','PAUSED','OFFLINE','DISPENSING') NOT NULL DEFAULT 'ACTIVE',
  hardware_channel VARCHAR(64) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pump_nozzle_number (station_id, pump_id, nozzle_number),
  CONSTRAINT fk_pump_nozzles_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_pump_nozzles_pump FOREIGN KEY (pump_id) REFERENCES pumps(id),
  CONSTRAINT fk_pump_nozzles_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
  CONSTRAINT fk_pump_nozzles_tank FOREIGN KEY (tank_id) REFERENCES tanks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_pump_nozzles_station_pump_status ON pump_nozzles (station_id, pump_id, status);
CREATE INDEX idx_pump_nozzles_station_fuel ON pump_nozzles (station_id, fuel_type_id);
CREATE INDEX idx_pump_nozzles_tank ON pump_nozzles (tank_id);

CREATE TABLE IF NOT EXISTS station_queue_settings (
  station_id BIGINT UNSIGNED PRIMARY KEY,
  is_queue_enabled TINYINT(1) NOT NULL DEFAULT 1,
  grace_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  capacity INT UNSIGNED NOT NULL DEFAULT 100,
  joins_paused TINYINT(1) NOT NULL DEFAULT 0,
  priority_mode ENUM('OFF','ON','HYBRID') NOT NULL DEFAULT 'ON',
  hybrid_queue_n SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  hybrid_walkin_n SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  petrol_enabled TINYINT(1) NOT NULL DEFAULT 1,
  diesel_enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_queue_settings_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS queue_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  masked_plate VARCHAR(32) NULL,
  fuel_type_id TINYINT UNSIGNED NOT NULL,
  position INT UNSIGNED NOT NULL,
  status ENUM('WAITING','CALLED','LATE','NO_SHOW','SERVED','CANCELLED') NOT NULL DEFAULT 'WAITING',
  joined_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  called_at TIMESTAMP(3) NULL,
  grace_expires_at TIMESTAMP(3) NULL,
  served_at TIMESTAMP(3) NULL,
  cancelled_at TIMESTAMP(3) NULL,
  last_moved_at TIMESTAMP(3) NULL,
  metadata LONGTEXT NULL,
  CONSTRAINT fk_queue_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_queue_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_queue_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_queue_station_status_pos ON queue_entries (station_id, status, position);
CREATE INDEX idx_queue_station_joined ON queue_entries (station_id, joined_at);

CREATE TABLE IF NOT EXISTS inventory_readings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  tank_id BIGINT UNSIGNED NOT NULL,
  reading_type ENUM('OPENING','CLOSING') NOT NULL,
  reading_time TIMESTAMP(3) NOT NULL,
  litres DECIMAL(12,2) NOT NULL,
  recorded_by_staff_id BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_inv_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_inv_tank FOREIGN KEY (tank_id) REFERENCES tanks(id),
  CONSTRAINT fk_inv_staff FOREIGN KEY (recorded_by_staff_id) REFERENCES station_staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_inv_station_tank_time ON inventory_readings (station_id, tank_id, reading_time);

CREATE TABLE IF NOT EXISTS fuel_deliveries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  tank_id BIGINT UNSIGNED NOT NULL,
  delivered_time TIMESTAMP(3) NOT NULL,
  litres DECIMAL(12,2) NOT NULL,
  supplier_name VARCHAR(120) NULL,
  reference_code VARCHAR(64) NULL,
  recorded_by_staff_id BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_del_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_del_tank FOREIGN KEY (tank_id) REFERENCES tanks(id),
  CONSTRAINT fk_del_staff FOREIGN KEY (recorded_by_staff_id) REFERENCES station_staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_del_station_tank_time ON fuel_deliveries (station_id, tank_id, delivered_time);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  pump_id BIGINT UNSIGNED NULL,
  nozzle_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  reservation_public_id VARCHAR(64) NULL,
  fuel_type_id TINYINT UNSIGNED NOT NULL,
  occurred_at TIMESTAMP(3) NOT NULL,
  litres DECIMAL(12,3) NOT NULL,
  price_per_litre DECIMAL(12,4) NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  payment_method ENUM('CASH','MOBILE_MONEY','CARD','OTHER','SMARTPAY') NOT NULL DEFAULT 'CASH',
  recorded_by_staff_id BIGINT UNSIGNED NULL,
  queue_entry_id BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  status ENUM('RECORDED','UNDER_REVIEW','FROZEN','CANCELLED','REVERSED') NOT NULL DEFAULT 'RECORDED',
  settlement_impact_status ENUM('UNCHANGED','ADJUSTED','REVERSED') NOT NULL DEFAULT 'UNCHANGED',
  workflow_reason_code VARCHAR(64) NULL,
  workflow_note TEXT NULL,
  status_updated_at TIMESTAMP(3) NULL,
  status_updated_by_role_code VARCHAR(64) NULL,
  cancelled_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tx_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_tx_pump FOREIGN KEY (pump_id) REFERENCES pumps(id),
  CONSTRAINT fk_tx_nozzle FOREIGN KEY (nozzle_id) REFERENCES pump_nozzles(id),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_tx_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
  CONSTRAINT fk_tx_staff FOREIGN KEY (recorded_by_staff_id) REFERENCES station_staff(id),
  CONSTRAINT fk_tx_queue FOREIGN KEY (queue_entry_id) REFERENCES queue_entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_tx_station_time ON transactions (station_id, occurred_at);
CREATE INDEX idx_tx_station_fuel_time ON transactions (station_id, fuel_type_id, occurred_at);
CREATE INDEX idx_tx_station_nozzle_time ON transactions (station_id, nozzle_id, occurred_at);
CREATE INDEX idx_tx_user_time ON transactions (user_id, occurred_at);
CREATE INDEX idx_tx_reservation_public_id ON transactions (reservation_public_id);

CREATE TABLE IF NOT EXISTS pump_dispense_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  pump_id BIGINT UNSIGNED NOT NULL,
  nozzle_id BIGINT UNSIGNED NULL,
  started_at TIMESTAMP(3) NOT NULL,
  ended_at TIMESTAMP(3) NULL,
  litres DECIMAL(12,3) NULL,
  raw_payload LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pde_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_pde_pump FOREIGN KEY (pump_id) REFERENCES pumps(id),
  CONSTRAINT fk_pde_nozzle FOREIGN KEY (nozzle_id) REFERENCES pump_nozzles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_pde_station_pump_time ON pump_dispense_events (station_id, pump_id, started_at);
CREATE INDEX idx_pde_station_nozzle_time ON pump_dispense_events (station_id, nozzle_id, started_at);

CREATE TABLE IF NOT EXISTS incidents (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  public_id CHAR(26) NOT NULL UNIQUE,
  severity ENUM('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'LOW',
  category ENUM('VARIANCE','PUMP','QUEUE','PAYMENT','OTHER') NOT NULL DEFAULT 'OTHER',
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  status ENUM('OPEN','RESOLVED','DISMISSED') NOT NULL DEFAULT 'OPEN',
  created_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_inc_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_inc_staff FOREIGN KEY (created_by_staff_id) REFERENCES station_staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_inc_station_status_time ON incidents (station_id, status, created_at);

CREATE TABLE IF NOT EXISTS report_notes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  note_date DATE NOT NULL,
  note_text TEXT NOT NULL,
  created_by_staff_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_notes_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_notes_staff FOREIGN KEY (created_by_staff_id) REFERENCES station_staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE UNIQUE INDEX uq_notes_station_date ON report_notes (station_id, note_date);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  actor_staff_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(64) NOT NULL,
  payload LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_audit_staff FOREIGN KEY (actor_staff_id) REFERENCES station_staff(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_audit_station_time ON audit_log (station_id, created_at);
CREATE INDEX idx_audit_station_action ON audit_log (station_id, action_type);

CREATE OR REPLACE VIEW v_sales_daily AS
SELECT
  station_id,
  DATE(occurred_at) AS sale_date,
  fuel_type_id,
  SUM(litres) AS litres_sold,
  SUM(total_amount) AS revenue,
  COUNT(*) AS tx_count
FROM transactions
GROUP BY station_id, DATE(occurred_at), fuel_type_id;

CREATE OR REPLACE VIEW v_queue_daily AS
SELECT
  station_id,
  DATE(joined_at) AS q_date,
  SUM(status = 'SERVED') AS served_count,
  SUM(status = 'NO_SHOW') AS no_show_count,
  SUM(status = 'CANCELLED') AS cancelled_count,
  COUNT(*) AS total_joined
FROM queue_entries
GROUP BY station_id, DATE(joined_at);

ALTER TABLE transactions
  ADD COLUMN payment_reference VARCHAR(128) NULL AFTER reservation_public_id,
  ADD COLUMN base_price_per_litre DECIMAL(14,4) NULL AFTER price_per_litre,
  ADD COLUMN requested_litres DECIMAL(12,3) NULL AFTER total_amount,
  ADD COLUMN subtotal DECIMAL(14,2) NULL AFTER requested_litres,
  ADD COLUMN total_direct_discount DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER subtotal,
  ADD COLUMN station_discount_total DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER total_direct_discount,
  ADD COLUMN smartlink_discount_total DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER station_discount_total,
  ADD COLUMN cashback_total DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER smartlink_discount_total,
  ADD COLUMN final_amount_paid DECIMAL(14,2) NULL AFTER cashback_total,
  ADD COLUMN effective_price_per_litre DECIMAL(14,4) NULL AFTER final_amount_paid,
  ADD COLUMN promo_labels_applied LONGTEXT NULL AFTER effective_price_per_litre,
  ADD COLUMN pricing_snapshot_json LONGTEXT NULL AFTER promo_labels_applied,
  ADD COLUMN receipt_verification_ref VARCHAR(96) NULL AFTER pricing_snapshot_json,
  ADD COLUMN cashback_status ENUM('NONE','EARNED','CREDITED','PENDING_LOYALTY','FAILED') NOT NULL DEFAULT 'NONE' AFTER receipt_verification_ref,
  ADD COLUMN cashback_destination ENUM('WALLET','LOYALTY','NONE') NOT NULL DEFAULT 'NONE' AFTER cashback_status,
  ADD COLUMN cashback_credited_at TIMESTAMP(3) NULL AFTER cashback_destination;

CREATE INDEX idx_tx_payment_reference ON transactions (payment_reference);
CREATE INDEX idx_tx_receipt_verification_ref ON transactions (receipt_verification_ref);

CREATE TABLE IF NOT EXISTS promotion_campaigns (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  campaign_label VARCHAR(120) NOT NULL,
  promotion_kind ENUM('DISCOUNT','FLASH_PRICE','CASHBACK') NOT NULL DEFAULT 'DISCOUNT',
  fuel_type_id TINYINT UNSIGNED NULL,
  funding_source ENUM('STATION','SMARTLINK','SHARED') NOT NULL DEFAULT 'STATION',
  station_share_pct DECIMAL(7,4) NOT NULL DEFAULT 100.0000,
  smartlink_share_pct DECIMAL(7,4) NOT NULL DEFAULT 0.0000,
  discount_mode ENUM('PERCENTAGE_PER_LITRE','FIXED_PER_LITRE','FIXED_BASKET','FLASH_PRICE_PER_LITRE') NULL,
  discount_value DECIMAL(14,4) NULL,
  cashback_mode ENUM('PERCENTAGE','FIXED_AMOUNT') NULL,
  cashback_value DECIMAL(14,4) NULL,
  cashback_destination ENUM('WALLET','LOYALTY','NONE') NOT NULL DEFAULT 'WALLET',
  flash_price_per_litre DECIMAL(14,4) NULL,
  starts_at TIMESTAMP(3) NOT NULL,
  ends_at TIMESTAMP(3) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('DRAFT','ACTIVE','INACTIVE','EXPIRED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  max_redemptions INT UNSIGNED NULL,
  max_litres DECIMAL(14,3) NULL,
  redeemed_count INT UNSIGNED NOT NULL DEFAULT 0,
  redeemed_litres DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  eligibility_rules_json LONGTEXT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_promotion_campaigns_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_promotion_campaigns_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
  CONSTRAINT fk_promotion_campaigns_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_promotion_campaigns_station_time ON promotion_campaigns (station_id, starts_at, ends_at);
CREATE INDEX idx_promotion_campaigns_station_status ON promotion_campaigns (station_id, status, is_active);
CREATE INDEX idx_promotion_campaigns_station_fuel ON promotion_campaigns (station_id, fuel_type_id, status);

CREATE TABLE IF NOT EXISTS promotion_redemptions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  transaction_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  litres_covered DECIMAL(14,3) NOT NULL DEFAULT 0.000,
  direct_discount_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cashback_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  station_funded_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  smartlink_funded_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  cashback_status ENUM('NONE','EARNED','CREDITED','PENDING_LOYALTY','FAILED') NOT NULL DEFAULT 'NONE',
  cashback_destination ENUM('WALLET','LOYALTY','NONE') NOT NULL DEFAULT 'NONE',
  cashback_credited_at TIMESTAMP(3) NULL,
  snapshot_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_promotion_redemptions_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  CONSTRAINT fk_promotion_redemptions_campaign FOREIGN KEY (campaign_id) REFERENCES promotion_campaigns(id),
  CONSTRAINT fk_promotion_redemptions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_promotion_redemptions_transaction ON promotion_redemptions (transaction_id, created_at);
CREATE INDEX idx_promotion_redemptions_campaign ON promotion_redemptions (campaign_id, created_at);
CREATE INDEX idx_promotion_redemptions_user ON promotion_redemptions (user_id, created_at);
