-- 018_create_user_alerts.sql
-- Persistent in-app alerts for user notifications (real-time + history).
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS user_alerts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NULL,
  reservation_public_id VARCHAR(64) NULL,
  category ENUM('RESERVATION','QUEUE','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
  title VARCHAR(160) NOT NULL,
  body VARCHAR(600) NOT NULL,
  status ENUM('UNREAD','READ') NOT NULL DEFAULT 'UNREAD',
  metadata LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at TIMESTAMP(3) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_alerts_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_alerts_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @idx_user_alerts_user_status_created_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_alerts'
    AND INDEX_NAME = 'idx_user_alerts_user_status_created'
);
SET @sql := IF(
  @idx_user_alerts_user_status_created_exists = 0,
  'CREATE INDEX idx_user_alerts_user_status_created ON user_alerts (user_id, status, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_user_alerts_station_created_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_alerts'
    AND INDEX_NAME = 'idx_user_alerts_station_created'
);
SET @sql := IF(
  @idx_user_alerts_station_created_exists = 0,
  'CREATE INDEX idx_user_alerts_station_created ON user_alerts (station_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_user_alerts_reservation_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_alerts'
    AND INDEX_NAME = 'idx_user_alerts_reservation'
);
SET @sql := IF(
  @idx_user_alerts_reservation_exists = 0,
  'CREATE INDEX idx_user_alerts_reservation ON user_alerts (reservation_public_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
