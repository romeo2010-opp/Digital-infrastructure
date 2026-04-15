-- 055_queue_prepay_wallet_hold_type.sql
-- Extend wallet hold types to support queue prepay holds.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_wallet_hold_type := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_reservation_holds'
    AND COLUMN_NAME = 'hold_type'
);

SET @wallet_hold_has_queue_prepay := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_reservation_holds'
    AND COLUMN_NAME = 'hold_type'
    AND COLUMN_TYPE LIKE "%'QUEUE_PREPAY'%"
);

SET @wallet_hold_queue_prepay_sql := IF(
  @has_wallet_hold_type = 1 AND @wallet_hold_has_queue_prepay = 0,
  "ALTER TABLE wallet_reservation_holds MODIFY COLUMN hold_type ENUM('RESERVATION','QUEUE_FEE','MANUAL_HOLD','QUEUE_PREPAY') NOT NULL",
  'SELECT 1'
);

PREPARE wallet_hold_queue_prepay_stmt FROM @wallet_hold_queue_prepay_sql;
EXECUTE wallet_hold_queue_prepay_stmt;
DEALLOCATE PREPARE wallet_hold_queue_prepay_stmt;
