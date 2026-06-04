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

CREATE TABLE IF NOT EXISTS mera_roles (
  id TINYINT UNSIGNED PRIMARY KEY,
  role_name VARCHAR(64) NOT NULL UNIQUE,
  role_description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mera_roles (id, role_name, role_description) VALUES
  (1, 'SUPER_ADMIN', 'Full system administration and regulatory oversight'),
  (2, 'COMPLIANCE_OFFICER', 'Field compliance monitoring and inspections'),
  (3, 'LEGAL_ENFORCEMENT', 'Legal enforcement actions and sanctions'),
  (4, 'PUBLIC_COMPLAINT_ANALYST', 'Complaint intake, triage, and escalation'),
  (5, 'MARKET_ANALYST', 'Market surveillance, shortages, and reporting')
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  role_description = VALUES(role_description);

CREATE TABLE IF NOT EXISTS mera_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  phone VARCHAR(24) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_id TINYINT UNSIGNED NOT NULL,
  district VARCHAR(80) NULL,
  account_status ENUM('ACTIVE','INVITED','SUSPENDED','DISABLED') NOT NULL DEFAULT 'INVITED',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_users_role_status (role_id, account_status),
  KEY idx_mera_users_district (district),
  CONSTRAINT fk_mera_users_role FOREIGN KEY (role_id) REFERENCES mera_roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_user_preferences (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  mera_user_id BIGINT UNSIGNED NOT NULL,
  appearance VARCHAR(16) NOT NULL DEFAULT 'system',
  density VARCHAR(16) NOT NULL DEFAULT 'comfortable',
  landing_page VARCHAR(32) NOT NULL DEFAULT 'dashboard',
  compact_tables TINYINT(1) NOT NULL DEFAULT 0,
  shortage_alerts TINYINT(1) NOT NULL DEFAULT 1,
  complaints_alerts TINYINT(1) NOT NULL DEFAULT 1,
  daily_digest TINYINT(1) NOT NULL DEFAULT 1,
  browser_notifications TINYINT(1) NOT NULL DEFAULT 0,
  session_timeout_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  require_step_up TINYINT(1) NOT NULL DEFAULT 1,
  trusted_device TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mera_user_preferences_user (mera_user_id),
  CONSTRAINT fk_mera_user_preferences_user FOREIGN KEY (mera_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_auth_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  mera_user_id BIGINT UNSIGNED NOT NULL,
  session_token_hash CHAR(64) NOT NULL UNIQUE,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(64) NULL,
  last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at TIMESTAMP(3) NOT NULL,
  revoked_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_mera_auth_sessions_user_expiry (mera_user_id, expires_at),
  CONSTRAINT fk_mera_auth_sessions_user FOREIGN KEY (mera_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fuel_station_licenses (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  license_number VARCHAR(96) NOT NULL UNIQUE,
  issue_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  license_status ENUM('ACTIVE','EXPIRED','SUSPENDED','REVOKED','PENDING_RENEWAL') NOT NULL DEFAULT 'ACTIVE',
  compliance_conditions TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_station_licenses_station_status (station_id, license_status, expiry_date),
  KEY idx_station_licenses_expiry (expiry_date),
  CONSTRAINT fk_station_licenses_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_complaints (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  complaint_type ENUM('HOARDING','ILLEGAL_VENDING','OVERPRICING','REFUSAL_TO_SELL','SUSPICIOUS_QUEUE_MANIPULATION','OTHER') NOT NULL,
  complaint_description TEXT NOT NULL,
  media_url VARCHAR(1000) NULL,
  geo_lat DECIMAL(10,7) NULL,
  geo_lng DECIMAL(10,7) NULL,
  complaint_status ENUM('NEW','TRIAGED','ASSIGNED','UNDER_INVESTIGATION','RESOLVED','DISMISSED') NOT NULL DEFAULT 'NEW',
  assigned_officer_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_public_complaints_station_status (station_id, complaint_status, created_at),
  KEY idx_public_complaints_assigned (assigned_officer_id, complaint_status),
  KEY idx_public_complaints_type_time (complaint_type, created_at),
  CONSTRAINT fk_public_complaints_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_public_complaints_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_public_complaints_officer FOREIGN KEY (assigned_officer_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspections (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NOT NULL,
  officer_id BIGINT UNSIGNED NOT NULL,
  inspection_type ENUM('ROUTINE','FOLLOW_UP','SPOT_CHECK','SHORTAGE_RESPONSE','COMPLAINT_RESPONSE') NOT NULL DEFAULT 'ROUTINE',
  queue_length INT UNSIGNED NULL,
  stock_visible TINYINT(1) NOT NULL DEFAULT 1,
  pumps_active INT UNSIGNED NULL,
  displayed_price DECIMAL(12,2) NULL,
  illegal_vending_detected TINYINT(1) NOT NULL DEFAULT 0,
  geotag_lat DECIMAL(10,7) NULL,
  geotag_lng DECIMAL(10,7) NULL,
  officer_notes TEXT NULL,
  inspection_status ENUM('OPEN','PASSED','FAILED','ESCALATED','CLOSED') NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_inspections_station_status (station_id, inspection_status, created_at),
  KEY idx_inspections_officer_time (officer_id, created_at),
  KEY idx_inspections_type_time (inspection_type, created_at),
  CONSTRAINT fk_inspections_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_inspections_officer FOREIGN KEY (officer_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inspection_evidence (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  inspection_id BIGINT UNSIGNED NOT NULL,
  file_url VARCHAR(1000) NOT NULL,
  file_type ENUM('PHOTO','VIDEO','DOCUMENT','OTHER') NOT NULL DEFAULT 'PHOTO',
  uploaded_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_inspection_evidence_inspection (inspection_id, uploaded_at),
  CONSTRAINT fk_inspection_evidence_inspection FOREIGN KEY (inspection_id) REFERENCES inspections(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compliance_flags (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NOT NULL,
  flag_type ENUM('COMPLAINT_SURGE','REFUSAL_MISMATCH','REPEATED_INSPECTION_FAILURE','PROLONGED_DRY_STATUS','MANUAL_REVIEW','PRICE_ANOMALY','LICENSE_RISK') NOT NULL,
  severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  generated_reason TEXT NOT NULL,
  source_reference VARCHAR(255) NULL,
  resolved_status ENUM('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED') NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at TIMESTAMP(3) NULL,
  resolved_by BIGINT UNSIGNED NULL,
  KEY idx_compliance_flags_station_status (station_id, resolved_status, created_at),
  KEY idx_compliance_flags_type_severity (flag_type, severity, created_at),
  CONSTRAINT fk_compliance_flags_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_compliance_flags_resolved_by FOREIGN KEY (resolved_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enforcement_actions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NOT NULL,
  initiated_by BIGINT UNSIGNED NOT NULL,
  related_flag_id BIGINT UNSIGNED NULL,
  action_type ENUM('WARNING','FINE','SUSPENSION','CLOSURE_NOTICE','FOLLOW_UP_DIRECTIVE') NOT NULL,
  action_notes TEXT NULL,
  action_status ENUM('OPEN','IN_PROGRESS','COMPLIED','ESCALATED','CLOSED') NOT NULL DEFAULT 'OPEN',
  issued_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at TIMESTAMP(3) NULL,
  KEY idx_enforcement_station_status (station_id, action_status, issued_at),
  KEY idx_enforcement_flag (related_flag_id),
  CONSTRAINT fk_enforcement_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_enforcement_actor FOREIGN KEY (initiated_by) REFERENCES mera_users(id),
  CONSTRAINT fk_enforcement_flag FOREIGN KEY (related_flag_id) REFERENCES compliance_flags(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_status_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  reported_source ENUM('STATION','USER','MERA_INSPECTION','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
  availability_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  diesel_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  petrol_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_station_status_logs_station_time (station_id, created_at),
  KEY idx_station_status_logs_source_time (reported_source, created_at),
  CONSTRAINT fk_station_status_logs_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_station_status_logs_user FOREIGN KEY (updated_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_current_status (
  station_id BIGINT UNSIGNED PRIMARY KEY,
  availability_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  diesel_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  petrol_status ENUM('AVAILABLE','LIMITED','DRY','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  petrol_live_litres DECIMAL(14,3) NULL,
  diesel_live_litres DECIMAL(14,3) NULL,
  total_live_litres DECIMAL(14,3) NULL,
  total_capacity_litres DECIMAL(14,3) NULL,
  known_fuel_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tank_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  delivery_verified TINYINT(1) NOT NULL DEFAULT 0,
  petrol_delivery_verified TINYINT(1) NOT NULL DEFAULT 0,
  diesel_delivery_verified TINYINT(1) NOT NULL DEFAULT 0,
  delivered_litres_since_baseline DECIMAL(14,3) NOT NULL DEFAULT 0,
  petrol_delivered_litres_since_baseline DECIMAL(14,3) NULL,
  diesel_delivered_litres_since_baseline DECIMAL(14,3) NULL,
  latest_delivery_time TIMESTAMP(3) NULL,
  reported_source ENUM('STATION','USER','MERA_INSPECTION','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
  last_derived_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_logged_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_station_current_status_availability (availability_status, updated_at),
  KEY idx_station_current_status_last_logged (last_logged_at),
  CONSTRAINT fk_station_current_status_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_status_rollups (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  bucket_start TIMESTAMP(3) NOT NULL,
  bucket_minutes SMALLINT UNSIGNED NOT NULL,
  district_key VARCHAR(96) NOT NULL DEFAULT '__NATIONAL__',
  district_label VARCHAR(96) NULL,
  available_count INT UNSIGNED NOT NULL DEFAULT 0,
  limited_count INT UNSIGNED NOT NULL DEFAULT 0,
  dry_count INT UNSIGNED NOT NULL DEFAULT 0,
  unknown_count INT UNSIGNED NOT NULL DEFAULT 0,
  total_stations INT UNSIGNED NOT NULL DEFAULT 0,
  stations_with_fuel INT UNSIGNED NOT NULL DEFAULT 0,
  delivery_verified_stations_with_fuel INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_station_status_rollups_bucket_scope (bucket_minutes, bucket_start, district_key),
  KEY idx_station_status_rollups_scope_time (district_key, bucket_minutes, bucket_start),
  KEY idx_station_status_rollups_bucket_time (bucket_minutes, bucket_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fuel_price_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  petrol_price DECIMAL(12,2) NULL,
  diesel_price DECIMAL(12,2) NULL,
  submitted_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fuel_price_reports_station_time (station_id, created_at),
  CONSTRAINT fk_fuel_price_reports_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_fuel_price_reports_user FOREIGN KEY (submitted_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs_mera (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  actor_role VARCHAR(64) NULL,
  action_type VARCHAR(96) NOT NULL,
  action_description TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_audit_logs_mera_actor_time (actor_id, created_at),
  KEY idx_audit_logs_mera_action_time (action_type, created_at),
  CONSTRAINT fk_audit_logs_mera_actor FOREIGN KEY (actor_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_tasks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_number VARCHAR(32) NULL UNIQUE,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  type ENUM('CASE_REVIEW','COMPLAINT_REVIEW','STATION_INSPECTION','HOARDING_INVESTIGATION','PRICE_VIOLATION_REVIEW','QUEUE_DISORDER_REVIEW','TELEMETRY_MISMATCH_REVIEW','FIELD_VISIT','MANUAL_TASK') NOT NULL,
  category VARCHAR(96) NULL,
  priority ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('ASSIGNED','ACKNOWLEDGED','IN_PROGRESS','NEEDS_MORE_INFO','ESCALATED','COMPLETED','REJECTED','CANCELLED') NOT NULL DEFAULT 'ASSIGNED',
  district VARCHAR(80) NULL,
  station_id BIGINT UNSIGNED NULL,
  station_name VARCHAR(160) NULL,
  linked_entity_type VARCHAR(64) NULL,
  linked_entity_id VARCHAR(96) NULL,
  evidence_summary TEXT NULL,
  assigned_to_user_id BIGINT UNSIGNED NOT NULL,
  assigned_by_user_id BIGINT UNSIGNED NOT NULL,
  due_at TIMESTAMP(3) NULL,
  acknowledged_at TIMESTAMP(3) NULL,
  started_at TIMESTAMP(3) NULL,
  completed_at TIMESTAMP(3) NULL,
  cancelled_at TIMESTAMP(3) NULL,
  escalated_at TIMESTAMP(3) NULL,
  completion_notes TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at TIMESTAMP(3) NULL,
  KEY idx_regulator_tasks_assigned_to (assigned_to_user_id),
  KEY idx_regulator_tasks_assigned_by (assigned_by_user_id),
  KEY idx_regulator_tasks_status (status),
  KEY idx_regulator_tasks_priority (priority),
  KEY idx_regulator_tasks_due_at (due_at),
  KEY idx_regulator_tasks_linked_entity (linked_entity_type, linked_entity_id),
  KEY idx_regulator_tasks_station (station_id),
  KEY idx_regulator_tasks_district (district),
  KEY idx_regulator_tasks_created_at (created_at),
  CONSTRAINT fk_regulator_tasks_assigned_to FOREIGN KEY (assigned_to_user_id) REFERENCES mera_users(id),
  CONSTRAINT fk_regulator_tasks_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES mera_users(id),
  CONSTRAINT fk_regulator_tasks_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_task_notes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  visibility ENUM('INTERNAL','SUPERVISOR_ONLY') NOT NULL DEFAULT 'INTERNAL',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_regulator_task_notes_task_time (task_id, created_at),
  KEY idx_regulator_task_notes_author (author_user_id),
  CONSTRAINT fk_regulator_task_notes_task FOREIGN KEY (task_id) REFERENCES regulator_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_regulator_task_notes_author FOREIGN KEY (author_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_task_activity_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(96) NOT NULL,
  old_value VARCHAR(255) NULL,
  new_value VARCHAR(255) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_regulator_task_activity_task_time (task_id, created_at),
  KEY idx_regulator_task_activity_actor (actor_user_id),
  KEY idx_regulator_task_activity_action_time (action, created_at),
  CONSTRAINT fk_regulator_task_activity_task FOREIGN KEY (task_id) REFERENCES regulator_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_regulator_task_activity_actor FOREIGN KEY (actor_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_task_evidence (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  evidence_type VARCHAR(64) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  file_url VARCHAR(1000) NULL,
  linked_existing_evidence_id VARCHAR(96) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_regulator_task_evidence_task_time (task_id, created_at),
  KEY idx_regulator_task_evidence_uploader (uploaded_by_user_id),
  CONSTRAINT fk_regulator_task_evidence_task FOREIGN KEY (task_id) REFERENCES regulator_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_regulator_task_evidence_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_task_watchers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_regulator_task_watchers_task_user (task_id, user_id),
  KEY idx_regulator_task_watchers_user (user_id),
  CONSTRAINT fk_regulator_task_watchers_task FOREIGN KEY (task_id) REFERENCES regulator_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_regulator_task_watchers_user FOREIGN KEY (user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_notifications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('TASK_ASSIGNED','TASK_REASSIGNED','TASK_DUE_SOON','TASK_OVERDUE','TASK_STATUS_CHANGED','TASK_ESCALATED','TASK_COMPLETED') NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  linked_entity_type VARCHAR(64) NULL,
  linked_entity_id VARCHAR(96) NULL,
  read_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_mera_notifications_user_read_time (user_id, read_at, created_at),
  KEY idx_mera_notifications_type_time (type, created_at),
  KEY idx_mera_notifications_linked_entity (linked_entity_type, linked_entity_id),
  CONSTRAINT fk_mera_notifications_user FOREIGN KEY (user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
