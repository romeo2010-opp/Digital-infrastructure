CREATE TABLE IF NOT EXISTS kiosk_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  location_label VARCHAR(120) NULL,
  device_fingerprint VARCHAR(255) NOT NULL,
  status ENUM('ACTIVE','DISABLED','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  last_seen_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_kiosk_devices_public_id (public_id),
  UNIQUE KEY uq_kiosk_devices_fingerprint (device_fingerprint),
  KEY idx_kiosk_devices_station_status (station_id, status),
  CONSTRAINT fk_kiosk_devices_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kiosk_registration_challenges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL,
  display_code VARCHAR(12) NOT NULL,
  challenge_hash CHAR(64) NOT NULL,
  device_fingerprint_hash CHAR(64) NOT NULL,
  status ENUM('PENDING','APPROVED','DENIED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMP(3) NOT NULL,
  registered_kiosk_id BIGINT UNSIGNED NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP(3) NULL,
  denied_at TIMESTAMP(3) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_kiosk_registration_challenges_public_id (public_id),
  KEY idx_kiosk_registration_challenges_hash (challenge_hash),
  KEY idx_kiosk_registration_challenges_fingerprint_status (device_fingerprint_hash, status, expires_at),
  KEY idx_kiosk_registration_challenges_status (status, expires_at),
  KEY idx_kiosk_registration_challenges_registered_kiosk (registered_kiosk_id),
  KEY idx_kiosk_registration_challenges_approved_by (approved_by_user_id),
  CONSTRAINT fk_kiosk_registration_challenges_kiosk FOREIGN KEY (registered_kiosk_id) REFERENCES kiosk_devices(id),
  CONSTRAINT fk_kiosk_registration_challenges_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kiosk_login_challenges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL,
  kiosk_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  display_code VARCHAR(12) NOT NULL,
  challenge_hash CHAR(64) NOT NULL,
  status ENUM('PENDING','APPROVED','DENIED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMP(3) NOT NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP(3) NULL,
  denied_at TIMESTAMP(3) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_kiosk_login_challenges_public_id (public_id),
  KEY idx_kiosk_login_challenges_hash (challenge_hash),
  KEY idx_kiosk_login_challenges_kiosk_status (kiosk_id, status, expires_at),
  KEY idx_kiosk_login_challenges_station_status (station_id, status, expires_at),
  KEY idx_kiosk_login_challenges_approved_by (approved_by_user_id),
  CONSTRAINT fk_kiosk_login_challenges_kiosk FOREIGN KEY (kiosk_id) REFERENCES kiosk_devices(id),
  CONSTRAINT fk_kiosk_login_challenges_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_kiosk_login_challenges_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO internal_permissions (id, code, module_key, action_key, description) VALUES
(901, 'kiosk:register', 'kiosk', 'register', 'Register SmartLink station kiosk devices')
ON DUPLICATE KEY UPDATE
  module_key = VALUES(module_key),
  action_key = VALUES(action_key),
  description = VALUES(description);

INSERT INTO internal_role_permissions (role_id, permission_id)
SELECT ir.id, ip.id
FROM internal_roles ir
INNER JOIN internal_permissions ip ON ip.code = 'kiosk:register'
WHERE ir.code IN ('PLATFORM_OWNER', 'PLATFORM_INFRASTRUCTURE_ENGINEER')
ON DUPLICATE KEY UPDATE
  role_id = VALUES(role_id),
  permission_id = VALUES(permission_id);

CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL,
  kiosk_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  approved_by_user_id BIGINT UNSIGNED NOT NULL,
  role_scope ENUM('ATTENDANT','MANAGER') NOT NULL,
  permissions_json LONGTEXT NOT NULL,
  status ENUM('ACTIVE','EXPIRED','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at TIMESTAMP(3) NOT NULL,
  last_heartbeat_at TIMESTAMP(3) NULL,
  revoked_at TIMESTAMP(3) NULL,
  revoked_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_kiosk_sessions_public_id (public_id),
  KEY idx_kiosk_sessions_station_status (station_id, status, expires_at),
  KEY idx_kiosk_sessions_kiosk_status (kiosk_id, status, expires_at),
  KEY idx_kiosk_sessions_approved_by (approved_by_user_id),
  KEY idx_kiosk_sessions_revoked_by (revoked_by_user_id),
  CONSTRAINT fk_kiosk_sessions_kiosk FOREIGN KEY (kiosk_id) REFERENCES kiosk_devices(id),
  CONSTRAINT fk_kiosk_sessions_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_kiosk_sessions_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_kiosk_sessions_revoked_by FOREIGN KEY (revoked_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staff_trusted_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  device_name VARCHAR(120) NULL,
  device_fingerprint VARCHAR(255) NOT NULL,
  phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  last_used_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_trusted_devices_user_fingerprint (user_id, device_fingerprint),
  KEY idx_staff_trusted_devices_user_status (user_id, status),
  CONSTRAINT fk_staff_trusted_devices_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(96) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(96) NULL,
  metadata_json LONGTEXT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_security_audit_actor_time (actor_id, created_at),
  KEY idx_security_audit_entity (entity_type, entity_id),
  KEY idx_security_audit_action_time (action, created_at),
  CONSTRAINT fk_security_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
