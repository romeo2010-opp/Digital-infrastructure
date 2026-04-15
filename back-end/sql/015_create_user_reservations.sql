-- 015_create_user_reservations.sql
-- Dedicated user reservations table (separate from queue entries)
-- Includes idempotent table creation + indexes + backfill from queue_entries.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS user_reservations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  fuel_type_id TINYINT UNSIGNED NOT NULL,
  source_queue_entry_id BIGINT UNSIGNED NULL,
  reservation_date DATE NULL,
  slot_start DATETIME(3) NULL,
  slot_end DATETIME(3) NULL,
  requested_litres DECIMAL(12,2) NULL,
  identifier VARCHAR(64) NULL,
  status ENUM('PENDING','CONFIRMED','FULFILLED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  notes VARCHAR(255) NULL,
  metadata LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  confirmed_at TIMESTAMP(3) NULL,
  fulfilled_at TIMESTAMP(3) NULL,
  cancelled_at TIMESTAMP(3) NULL,
  CONSTRAINT fk_user_reservations_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_reservations_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_user_reservations_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
  CONSTRAINT fk_user_reservations_queue_entry FOREIGN KEY (source_queue_entry_id) REFERENCES queue_entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @idx_user_created_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND INDEX_NAME = 'idx_user_reservations_user_created'
);
SET @sql := IF(
  @idx_user_created_exists = 0,
  'CREATE INDEX idx_user_reservations_user_created ON user_reservations (user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_user_status_created_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND INDEX_NAME = 'idx_user_reservations_user_status_created'
);
SET @sql := IF(
  @idx_user_status_created_exists = 0,
  'CREATE INDEX idx_user_reservations_user_status_created ON user_reservations (user_id, status, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_station_slot_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND INDEX_NAME = 'idx_user_reservations_station_slot'
);
SET @sql := IF(
  @idx_station_slot_exists = 0,
  'CREATE INDEX idx_user_reservations_station_slot ON user_reservations (station_id, reservation_date, slot_start)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @uq_source_queue_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND INDEX_NAME = 'uq_user_reservations_source_queue'
);
SET @sql := IF(
  @uq_source_queue_exists = 0,
  'CREATE UNIQUE INDEX uq_user_reservations_source_queue ON user_reservations (source_queue_entry_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill existing queue entries as reservations once.
-- Status mapping:
-- WAITING/LATE -> PENDING
-- CALLED -> CONFIRMED
-- SERVED -> FULFILLED
-- CANCELLED -> CANCELLED
-- NO_SHOW -> EXPIRED
INSERT INTO user_reservations (
  public_id,
  user_id,
  station_id,
  fuel_type_id,
  source_queue_entry_id,
  requested_litres,
  identifier,
  status,
  created_at,
  confirmed_at,
  fulfilled_at,
  cancelled_at,
  metadata
)
SELECT
  qe.public_id,
  qe.user_id,
  qe.station_id,
  qe.fuel_type_id,
  qe.id,
  CASE
    WHEN JSON_VALID(qe.metadata)
      AND COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.requestedLiters')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.requested_liters')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.requestedLitres')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.requested_litres')), '')
      ) REGEXP '^[0-9]+(\\.[0-9]+)?$'
    THEN CAST(
      COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.requestedLiters')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.requested_liters')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.requestedLitres')), ''),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.requested_litres')), '')
      )
      AS DECIMAL(12,2)
    )
    ELSE NULL
  END AS requested_litres,
  qe.masked_plate,
  CASE
    WHEN qe.status = 'CALLED' THEN 'CONFIRMED'
    WHEN qe.status = 'SERVED' THEN 'FULFILLED'
    WHEN qe.status = 'CANCELLED' THEN 'CANCELLED'
    WHEN qe.status = 'NO_SHOW' THEN 'EXPIRED'
    ELSE 'PENDING'
  END AS status,
  qe.joined_at,
  qe.called_at,
  qe.served_at,
  qe.cancelled_at,
  qe.metadata
FROM queue_entries qe
LEFT JOIN user_reservations ur
  ON ur.source_queue_entry_id = qe.id
WHERE qe.user_id IS NOT NULL
  AND ur.id IS NULL;
