-- 025_internal_company_dashboard.sql
-- Internal SmartLink company-side management schema.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS internal_roles (
  id TINYINT UNSIGNED PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  department VARCHAR(120) NOT NULL,
  rank_order SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_permissions (
  id SMALLINT UNSIGNED PRIMARY KEY,
  code VARCHAR(96) NOT NULL UNIQUE,
  module_key VARCHAR(64) NOT NULL,
  action_key VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_role_permissions (
  role_id TINYINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_internal_role_permissions_role FOREIGN KEY (role_id) REFERENCES internal_roles(id),
  CONSTRAINT fk_internal_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES internal_permissions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_user_roles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id TINYINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  assigned_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_internal_user_role (user_id, role_id),
  KEY idx_internal_user_roles_role_active (role_id, is_active),
  CONSTRAINT fk_internal_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_internal_user_roles_role FOREIGN KEY (role_id) REFERENCES internal_roles(id),
  CONSTRAINT fk_internal_user_roles_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_auth_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  session_token_hash CHAR(64) NOT NULL UNIQUE,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(64) NULL,
  last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at TIMESTAMP(3) NOT NULL,
  revoked_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_internal_auth_sessions_user_expiry (user_id, expires_at),
  CONSTRAINT fk_internal_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_audit_log (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_role_code VARCHAR(64) NULL,
  action_type VARCHAR(96) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_public_id VARCHAR(96) NULL,
  summary VARCHAR(255) NOT NULL,
  severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  metadata LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_internal_audit_log_created (created_at),
  KEY idx_internal_audit_log_target (target_type, target_public_id),
  CONSTRAINT fk_internal_audit_log_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_onboarding_records (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NULL,
  proposed_station_name VARCHAR(120) NOT NULL,
  operator_name VARCHAR(120) NULL,
  city VARCHAR(80) NULL,
  status ENUM('SUBMITTED','REVIEW','READY_FOR_ACTIVATION','ACTIVATED','REJECTED') NOT NULL DEFAULT 'SUBMITTED',
  assigned_user_id BIGINT UNSIGNED NULL,
  checklist_json LONGTEXT NULL,
  evidence_json LONGTEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_station_onboarding_status (status, updated_at),
  CONSTRAINT fk_station_onboarding_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_station_onboarding_assigned_user FOREIGN KEY (assigned_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS field_visits (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NULL,
  onboarding_record_id BIGINT UNSIGNED NULL,
  assigned_user_id BIGINT UNSIGNED NULL,
  visit_type ENUM('INSTALLATION','INSPECTION','TRAINING','FOLLOW_UP') NOT NULL DEFAULT 'INSPECTION',
  status ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','BLOCKED') NOT NULL DEFAULT 'SCHEDULED',
  scheduled_for TIMESTAMP(3) NULL,
  completed_at TIMESTAMP(3) NULL,
  summary VARCHAR(255) NULL,
  evidence_url VARCHAR(1000) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_field_visits_status_schedule (status, scheduled_for),
  CONSTRAINT fk_field_visits_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_field_visits_onboarding FOREIGN KEY (onboarding_record_id) REFERENCES station_onboarding_records(id),
  CONSTRAINT fk_field_visits_assigned_user FOREIGN KEY (assigned_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_support_cases (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  source_ticket_id VARCHAR(191) NULL,
  station_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  category VARCHAR(64) NOT NULL,
  priority ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('OPEN','IN_PROGRESS','ESCALATED','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  assigned_user_id BIGINT UNSIGNED NULL,
  subject VARCHAR(160) NOT NULL,
  summary TEXT NOT NULL,
  resolution_notes TEXT NULL,
  resolved_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_internal_support_cases_status_priority (status, priority),
  CONSTRAINT fk_internal_support_cases_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_internal_support_cases_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_internal_support_cases_assigned_user FOREIGN KEY (assigned_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_batches (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NOT NULL,
  batch_date DATE NOT NULL,
  gross_amount DECIMAL(14,2) NOT NULL,
  fee_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(14,2) NOT NULL,
  status ENUM('PENDING','UNDER_REVIEW','APPROVED','PAID','HELD') NOT NULL DEFAULT 'PENDING',
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_settlement_batches_status_date (status, batch_date),
  CONSTRAINT fk_settlement_batches_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_settlement_batches_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compliance_cases (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  category VARCHAR(64) NOT NULL,
  severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('OPEN','INVESTIGATING','FROZEN','FRAUD_CONFIRMED','RESOLVED') NOT NULL DEFAULT 'OPEN',
  assigned_user_id BIGINT UNSIGNED NULL,
  summary VARCHAR(255) NOT NULL,
  action_taken TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_compliance_cases_status_severity (status, severity),
  CONSTRAINT fk_compliance_cases_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_compliance_cases_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_compliance_cases_assigned_user FOREIGN KEY (assigned_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_settings (
  setting_key VARCHAR(96) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by_user_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_internal_settings_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
