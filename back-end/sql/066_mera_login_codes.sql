SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS mera_login_challenges (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  mera_user_id BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  resend_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(64) NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  resend_available_at TIMESTAMP(3) NOT NULL,
  consumed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_login_challenges_user_expiry (mera_user_id, expires_at),
  KEY idx_mera_login_challenges_expiry (expires_at),
  CONSTRAINT fk_mera_login_challenges_user FOREIGN KEY (mera_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_trusted_devices (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  mera_user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(64) NULL,
  last_used_at TIMESTAMP(3) NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  revoked_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_trusted_devices_user_expiry (mera_user_id, expires_at),
  CONSTRAINT fk_mera_trusted_devices_user FOREIGN KEY (mera_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
