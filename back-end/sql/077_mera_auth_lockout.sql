SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS mera_auth_risk_signals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  scope_type ENUM('IDENTIFIER','MERA_USER','IP','SUBNET') NOT NULL,
  scope_value VARCHAR(190) NOT NULL,
  failure_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_failure_at TIMESTAMP(3) NULL,
  last_failure_at TIMESTAMP(3) NULL,
  locked_until TIMESTAMP(3) NULL,
  flagged_at TIMESTAMP(3) NULL,
  flag_reason VARCHAR(160) NULL,
  last_failure_reason VARCHAR(160) NULL,
  last_user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(64) NULL,
  subnet VARCHAR(80) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mera_auth_risk_scope (scope_type, scope_value),
  KEY idx_mera_auth_risk_locked (locked_until),
  KEY idx_mera_auth_risk_flagged (flagged_at),
  KEY idx_mera_auth_risk_ip_time (ip_address, last_failure_at),
  KEY idx_mera_auth_risk_subnet_time (subnet, last_failure_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
