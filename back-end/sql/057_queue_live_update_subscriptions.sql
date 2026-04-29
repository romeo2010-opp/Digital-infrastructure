-- 057_queue_live_update_subscriptions.sql
-- Stores live queue voice update subscriptions for SmartLink assistant users.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS queue_live_update_subscriptions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  queue_entry_id BIGINT UNSIGNED NOT NULL UNIQUE,
  phone_number VARCHAR(32) NOT NULL,
  language_code VARCHAR(16) NOT NULL DEFAULT 'en',
  provider_code VARCHAR(32) NOT NULL DEFAULT 'mock',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notify_on_position_change TINYINT(1) NOT NULL DEFAULT 1,
  call_when_position_reached INT UNSIGNED NOT NULL DEFAULT 4,
  play_music_between_updates TINYINT(1) NOT NULL DEFAULT 1,
  last_known_position INT UNSIGNED NULL,
  last_known_status VARCHAR(32) NULL,
  last_called_at TIMESTAMP(3) NULL,
  last_provider_reference VARCHAR(128) NULL,
  metadata LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_queue_live_updates_user_active (user_id, is_active, updated_at),
  KEY idx_queue_live_updates_station_active (station_id, is_active, updated_at),
  KEY idx_queue_live_updates_phone_active (phone_number, is_active),
  CONSTRAINT fk_queue_live_updates_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_queue_live_updates_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_queue_live_updates_queue_entry FOREIGN KEY (queue_entry_id) REFERENCES queue_entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
