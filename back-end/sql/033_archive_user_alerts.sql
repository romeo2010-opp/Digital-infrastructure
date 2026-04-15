-- 033_archive_user_alerts.sql
-- Compacts older read user alerts into monthly JSON archive rows.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS user_alert_archives (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  archive_month DATE NOT NULL,
  alert_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_archived_at TIMESTAMP(3) NULL,
  last_archived_at TIMESTAMP(3) NULL,
  alerts_json LONGTEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_alert_archives_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT uq_user_alert_archives_user_month UNIQUE (user_id, archive_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @idx_user_alert_archives_user_last_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_alert_archives'
    AND INDEX_NAME = 'idx_user_alert_archives_user_last'
);
SET @sql := IF(
  @idx_user_alert_archives_user_last_exists = 0,
  'CREATE INDEX idx_user_alert_archives_user_last ON user_alert_archives (user_id, last_archived_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
