-- 058_mera_regulatory_platform.sql
-- MERA regulatory intelligence platform schema.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

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
