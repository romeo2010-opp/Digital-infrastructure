-- 024_expand_user_alerts_reservation_public_id_length.sql
-- Expands user_alerts.reservation_public_id for RSV-TYPE-TIMESTAMP-RANDOM values.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

ALTER TABLE user_alerts
  MODIFY COLUMN reservation_public_id VARCHAR(64) NULL;
