SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

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
