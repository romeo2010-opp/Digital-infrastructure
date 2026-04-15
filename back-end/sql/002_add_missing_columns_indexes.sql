-- 002_add_missing_columns_indexes.sql
-- Pump -> PumpNozzle migration-safe patch (MariaDB/MySQL compatible).

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

-- 1) Make pumps.fuel_type_id nullable (dispenser group, not product endpoint).
SET @col_nullable := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pumps'
    AND COLUMN_NAME = 'fuel_type_id'
    AND IS_NULLABLE = 'NO'
);
SET @sql := IF(@col_nullable > 0, 'ALTER TABLE pumps MODIFY fuel_type_id TINYINT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Create pump_nozzles table when missing.
CREATE TABLE IF NOT EXISTS pump_nozzles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  pump_id BIGINT UNSIGNED NOT NULL,
  public_id CHAR(26) NOT NULL UNIQUE,
  nozzle_number VARCHAR(64) NOT NULL,
  side VARCHAR(8) NULL,
  fuel_type_id TINYINT UNSIGNED NOT NULL,
  tank_id BIGINT UNSIGNED NULL,
  status ENUM('ACTIVE','PAUSED','OFFLINE','DISPENSING') NOT NULL DEFAULT 'ACTIVE',
  hardware_channel VARCHAR(64) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pump_nozzle_number (station_id, pump_id, nozzle_number),
  CONSTRAINT fk_pump_nozzles_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_pump_nozzles_pump FOREIGN KEY (pump_id) REFERENCES pumps(id),
  CONSTRAINT fk_pump_nozzles_fuel FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
  CONSTRAINT fk_pump_nozzles_tank FOREIGN KEY (tank_id) REFERENCES tanks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_pump_nozzles_station_pump_status ON pump_nozzles (station_id, pump_id, status);
CREATE INDEX IF NOT EXISTS idx_pump_nozzles_station_fuel ON pump_nozzles (station_id, fuel_type_id);
CREATE INDEX IF NOT EXISTS idx_pump_nozzles_tank ON pump_nozzles (tank_id);

-- 2b) Ensure pump_nozzles.nozzle_number supports string labels.
SET @nozzle_number_is_varchar := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pump_nozzles'
    AND COLUMN_NAME = 'nozzle_number'
    AND DATA_TYPE = 'varchar'
);
SET @sql := IF(@nozzle_number_is_varchar = 0, 'ALTER TABLE pump_nozzles MODIFY nozzle_number VARCHAR(64) NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) Add transactions.nozzle_id when missing + index + FK.
SET @tx_nozzle_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'nozzle_id'
);
SET @sql := IF(@tx_nozzle_exists = 0, 'ALTER TABLE transactions ADD COLUMN nozzle_id BIGINT UNSIGNED NULL AFTER pump_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @tx_nozzle_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND INDEX_NAME = 'idx_tx_station_nozzle_time'
);
SET @sql := IF(@tx_nozzle_idx_exists = 0, 'CREATE INDEX idx_tx_station_nozzle_time ON transactions (station_id, nozzle_id, occurred_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @tx_nozzle_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND CONSTRAINT_NAME = 'fk_tx_nozzle'
);
SET @sql := IF(@tx_nozzle_fk_exists = 0, 'ALTER TABLE transactions ADD CONSTRAINT fk_tx_nozzle FOREIGN KEY (nozzle_id) REFERENCES pump_nozzles(id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) Add pump_dispense_events.nozzle_id when missing + index + FK.
SET @pde_nozzle_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pump_dispense_events'
    AND COLUMN_NAME = 'nozzle_id'
);
SET @sql := IF(@pde_nozzle_exists = 0, 'ALTER TABLE pump_dispense_events ADD COLUMN nozzle_id BIGINT UNSIGNED NULL AFTER pump_id', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @pde_nozzle_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pump_dispense_events'
    AND INDEX_NAME = 'idx_pde_station_nozzle_time'
);
SET @sql := IF(@pde_nozzle_idx_exists = 0, 'CREATE INDEX idx_pde_station_nozzle_time ON pump_dispense_events (station_id, nozzle_id, started_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @pde_nozzle_fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pump_dispense_events'
    AND CONSTRAINT_NAME = 'fk_pde_nozzle'
);
SET @sql := IF(@pde_nozzle_fk_exists = 0, 'ALTER TABLE pump_dispense_events ADD CONSTRAINT fk_pde_nozzle FOREIGN KEY (nozzle_id) REFERENCES pump_nozzles(id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5) Legacy backfill: each existing pump becomes nozzle #1 if no nozzles exist.
INSERT INTO pump_nozzles (
  station_id,
  pump_id,
  public_id,
  nozzle_number,
  side,
  fuel_type_id,
  tank_id,
  status,
  hardware_channel,
  is_active
)
SELECT
  p.station_id,
  p.id,
  UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 26)) AS public_id,
  '1' AS nozzle_number,
  'A' AS side,
  COALESCE(p.fuel_type_id, t.fuel_type_id) AS fuel_type_id,
  p.tank_id,
  CASE
    WHEN p.status IN ('ACTIVE', 'PAUSED', 'OFFLINE') THEN p.status
    ELSE 'ACTIVE'
  END AS status,
  CONCAT('legacy-', p.id, '-1') AS hardware_channel,
  p.is_active
FROM pumps p
LEFT JOIN tanks t ON t.id = p.tank_id
LEFT JOIN pump_nozzles pn ON pn.pump_id = p.id
WHERE pn.id IS NULL
  AND COALESCE(p.fuel_type_id, t.fuel_type_id) IS NOT NULL;

-- 6) Backfill transactions.nozzle_id from pump->nozzle#1 mapping.
UPDATE transactions tx
INNER JOIN pump_nozzles pn
  ON pn.station_id = tx.station_id
 AND pn.pump_id = tx.pump_id
 AND pn.nozzle_number = '1'
SET tx.nozzle_id = pn.id
WHERE tx.pump_id IS NOT NULL
  AND tx.nozzle_id IS NULL;

-- 7) Backfill pump_dispense_events.nozzle_id from pump->nozzle#1 mapping.
UPDATE pump_dispense_events pde
INNER JOIN pump_nozzles pn
  ON pn.station_id = pde.station_id
 AND pn.pump_id = pde.pump_id
 AND pn.nozzle_number = '1'
SET pde.nozzle_id = pn.id
WHERE pde.nozzle_id IS NULL;

SELECT 'Pump/nozzle migration patch applied.' AS info_message;
