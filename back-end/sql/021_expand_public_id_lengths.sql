SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

ALTER TABLE stations
  MODIFY COLUMN public_id VARCHAR(64) NOT NULL;

ALTER TABLE pumps
  MODIFY COLUMN public_id VARCHAR(64) NOT NULL;

ALTER TABLE pump_nozzles
  MODIFY COLUMN public_id VARCHAR(96) NOT NULL;

ALTER TABLE transactions
  MODIFY COLUMN public_id VARCHAR(64) NOT NULL;

