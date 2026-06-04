-- 070_fleet_accounts.sql
-- Fleet accounts, memberships, vehicles, wallet, policy, requests, transactions, alerts, and audit logs.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS fleet_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  business_type VARCHAR(80) NOT NULL,
  registration_number VARCHAR(80) NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  primary_contact_name VARCHAR(120) NOT NULL,
  primary_contact_phone VARCHAR(32) NOT NULL,
  billing_email VARCHAR(160) NULL,
  status ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_accounts_owner (owner_user_id, status),
  KEY idx_fleet_accounts_status (status, updated_at),
  CONSTRAINT fk_fleet_accounts_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_members (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner','admin','finance','dispatcher','driver','auditor') NOT NULL,
  status ENUM('pending','active','suspended','removed') NOT NULL DEFAULT 'pending',
  invited_by_user_id BIGINT UNSIGNED NULL,
  invited_at TIMESTAMP(3) NULL,
  accepted_at TIMESTAMP(3) NULL,
  last_accessed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_members_fleet_user (fleet_account_id, user_id),
  KEY idx_fleet_members_user_status (user_id, status),
  KEY idx_fleet_members_fleet_role_status (fleet_account_id, role, status),
  KEY idx_fleet_members_invited_by (invited_by_user_id),
  CONSTRAINT fk_fleet_members_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_members_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_fleet_members_invited_by FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_invitations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  invitee_name VARCHAR(120) NULL,
  invitee_email VARCHAR(160) NULL,
  invitee_phone VARCHAR(32) NULL,
  role ENUM('owner','admin','finance','dispatcher','driver','auditor') NOT NULL,
  status ENUM('pending','accepted','expired','cancelled') NOT NULL DEFAULT 'pending',
  invited_by_user_id BIGINT UNSIGNED NOT NULL,
  accepted_by_user_id BIGINT UNSIGNED NULL,
  metadata_json LONGTEXT NULL,
  expires_at TIMESTAMP(3) NULL,
  accepted_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_invitations_fleet_status (fleet_account_id, status, created_at),
  KEY idx_fleet_invitations_identity (invitee_email, invitee_phone, status),
  KEY idx_fleet_invitations_invited_by (invited_by_user_id),
  KEY idx_fleet_invitations_accepted_by (accepted_by_user_id),
  CONSTRAINT fk_fleet_invitations_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_invitations_invited_by FOREIGN KEY (invited_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_fleet_invitations_accepted_by FOREIGN KEY (accepted_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_access_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  fleet_name VARCHAR(160) NULL,
  contact_name VARCHAR(120) NULL,
  contact_phone VARCHAR(32) NULL,
  contact_email VARCHAR(160) NULL,
  message VARCHAR(500) NULL,
  status ENUM('pending','reviewed','closed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_access_requests_user_status (user_id, status, created_at),
  KEY idx_fleet_access_requests_status (status, created_at),
  CONSTRAINT fk_fleet_access_requests_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  plate_number VARCHAR(32) NOT NULL,
  vehicle_name VARCHAR(120) NULL,
  vehicle_type VARCHAR(80) NULL,
  fuel_type ENUM('petrol','diesel','mixed','unknown') NOT NULL DEFAULT 'unknown',
  tank_capacity_litres DECIMAL(12,2) NULL,
  current_odometer DECIMAL(14,1) NULL,
  status ENUM('active','maintenance','suspended','archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_vehicles_plate (fleet_account_id, plate_number),
  KEY idx_fleet_vehicles_fleet_status (fleet_account_id, status),
  CONSTRAINT fk_fleet_vehicles_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_vehicle_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('active','suspended','removed') NOT NULL DEFAULT 'active',
  assigned_by_user_id BIGINT UNSIGNED NULL,
  assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_vehicle_assignments_vehicle_status (vehicle_id, status),
  KEY idx_fleet_vehicle_assignments_user_status (user_id, status),
  KEY idx_fleet_vehicle_assignments_fleet_status (fleet_account_id, status),
  KEY idx_fleet_vehicle_assignments_assigned_by (assigned_by_user_id),
  CONSTRAINT fk_fleet_vehicle_assignments_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_vehicle_assignments_vehicle FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT fk_fleet_vehicle_assignments_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_fleet_vehicle_assignments_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_wallets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  reserved_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'MWK',
  status ENUM('active','suspended','closed') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_wallets_account (fleet_account_id),
  KEY idx_fleet_wallets_status (status),
  CONSTRAINT fk_fleet_wallets_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT chk_fleet_wallets_non_negative CHECK (balance >= 0 AND reserved_balance >= 0 AND reserved_balance <= balance)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_wallet_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_wallet_id BIGINT UNSIGNED NOT NULL,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  type ENUM('topup','debit','refund','adjustment','reservation_hold','hold_release') NOT NULL,
  status ENUM('pending','posted','failed','reversed','cancelled') NOT NULL DEFAULT 'posted',
  amount DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'MWK',
  reference VARCHAR(96) NOT NULL,
  description VARCHAR(255) NULL,
  related_entity_type VARCHAR(64) NULL,
  related_entity_id VARCHAR(96) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fleet_wallet_transactions_reference (reference),
  KEY idx_fleet_wallet_transactions_wallet_time (fleet_wallet_id, created_at),
  KEY idx_fleet_wallet_transactions_account_time (fleet_account_id, created_at),
  KEY idx_fleet_wallet_transactions_type_status (type, status, created_at),
  KEY idx_fleet_wallet_transactions_created_by (created_by_user_id),
  CONSTRAINT fk_fleet_wallet_transactions_wallet FOREIGN KEY (fleet_wallet_id) REFERENCES fleet_wallets(id),
  CONSTRAINT fk_fleet_wallet_transactions_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_wallet_transactions_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_policies (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(140) NOT NULL,
  applies_to_type ENUM('fleet','vehicle','driver') NOT NULL DEFAULT 'fleet',
  applies_to_id BIGINT UNSIGNED NULL,
  daily_amount_limit DECIMAL(18,2) NULL,
  weekly_amount_limit DECIMAL(18,2) NULL,
  monthly_amount_limit DECIMAL(18,2) NULL,
  daily_litre_limit DECIMAL(14,3) NULL,
  monthly_litre_limit DECIMAL(14,3) NULL,
  allowed_fuel_type ENUM('petrol','diesel','mixed','unknown') NULL,
  allowed_station_ids_json LONGTEXT NULL,
  requires_approval_above_amount DECIMAL(18,2) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_policies_fleet_active (fleet_account_id, active),
  KEY idx_fleet_policies_target (fleet_account_id, applies_to_type, applies_to_id, active),
  CONSTRAINT fk_fleet_policies_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_fuel_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  requested_by_user_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NULL,
  requested_amount DECIMAL(18,2) NULL,
  requested_litres DECIMAL(14,3) NULL,
  odometer_reading DECIMAL(14,1) NULL,
  reason VARCHAR(255) NULL,
  status ENUM('pending','approved','rejected','expired','cancelled','completed') NOT NULL DEFAULT 'pending',
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP(3) NULL,
  rejected_reason VARCHAR(255) NULL,
  hold_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  hold_reference VARCHAR(96) NULL,
  expires_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_fuel_requests_fleet_status (fleet_account_id, status, created_at),
  KEY idx_fleet_fuel_requests_driver_status (requested_by_user_id, status, created_at),
  KEY idx_fleet_fuel_requests_vehicle_status (vehicle_id, status, created_at),
  KEY idx_fleet_fuel_requests_station (station_id),
  KEY idx_fleet_fuel_requests_approved_by (approved_by_user_id),
  CONSTRAINT fk_fleet_fuel_requests_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_fuel_requests_driver FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_fleet_fuel_requests_vehicle FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT fk_fleet_fuel_requests_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_fleet_fuel_requests_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_fleet_fuel_requests_value CHECK (requested_amount IS NOT NULL OR requested_litres IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  vehicle_id BIGINT UNSIGNED NOT NULL,
  driver_user_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  pump_id BIGINT UNSIGNED NULL,
  nozzle_id BIGINT UNSIGNED NULL,
  fuel_request_id BIGINT UNSIGNED NULL,
  litres DECIMAL(14,3) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  price_per_litre DECIMAL(14,4) NOT NULL,
  fuel_type ENUM('petrol','diesel','mixed','unknown') NOT NULL,
  odometer_reading DECIMAL(14,1) NULL,
  status ENUM('pending','completed','reversed','flagged') NOT NULL DEFAULT 'completed',
  risk_status ENUM('normal','suspicious','blocked') NOT NULL DEFAULT 'normal',
  risk_reason VARCHAR(255) NULL,
  wallet_transaction_reference VARCHAR(96) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fleet_transactions_fleet_time (fleet_account_id, created_at),
  KEY idx_fleet_transactions_vehicle_time (vehicle_id, created_at),
  KEY idx_fleet_transactions_driver_time (driver_user_id, created_at),
  KEY idx_fleet_transactions_station_time (station_id, created_at),
  KEY idx_fleet_transactions_status (fleet_account_id, status, risk_status),
  KEY idx_fleet_transactions_pump (pump_id),
  KEY idx_fleet_transactions_nozzle (nozzle_id),
  KEY idx_fleet_transactions_request (fuel_request_id),
  CONSTRAINT fk_fleet_transactions_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_transactions_vehicle FOREIGN KEY (vehicle_id) REFERENCES fleet_vehicles(id),
  CONSTRAINT fk_fleet_transactions_driver FOREIGN KEY (driver_user_id) REFERENCES users(id),
  CONSTRAINT fk_fleet_transactions_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_fleet_transactions_pump FOREIGN KEY (pump_id) REFERENCES pumps(id),
  CONSTRAINT fk_fleet_transactions_nozzle FOREIGN KEY (nozzle_id) REFERENCES pump_nozzles(id),
  CONSTRAINT fk_fleet_transactions_request FOREIGN KEY (fuel_request_id) REFERENCES fleet_fuel_requests(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_alerts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(64) NOT NULL,
  severity ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
  title VARCHAR(160) NOT NULL,
  message VARCHAR(500) NOT NULL,
  related_entity_type VARCHAR(64) NULL,
  related_entity_id VARCHAR(96) NULL,
  read_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fleet_alerts_fleet_time (fleet_account_id, created_at),
  KEY idx_fleet_alerts_unread (fleet_account_id, read_at, severity),
  CONSTRAINT fk_fleet_alerts_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fleet_audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fleet_account_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(96) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(96) NULL,
  metadata_json LONGTEXT NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fleet_audit_logs_fleet_time (fleet_account_id, created_at),
  KEY idx_fleet_audit_logs_actor_time (actor_user_id, created_at),
  KEY idx_fleet_audit_logs_entity (fleet_account_id, entity_type, entity_id),
  CONSTRAINT fk_fleet_audit_logs_account FOREIGN KEY (fleet_account_id) REFERENCES fleet_accounts(id),
  CONSTRAINT fk_fleet_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
