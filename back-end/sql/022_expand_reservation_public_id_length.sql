-- 022_expand_reservation_public_id_length.sql
-- Expands reservation public ids for RSV-TYPE-TIMESTAMP-RANDOM values.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

ALTER TABLE user_reservations
  MODIFY COLUMN public_id VARCHAR(64) NOT NULL;
