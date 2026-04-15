-- 016_user_reservations_user_nullable.sql
-- Makes user_reservations.user_id nullable for manager-created reservations.
-- Safe to run multiple times.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @user_id_is_not_nullable := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
    AND COLUMN_NAME = 'user_id'
    AND IS_NULLABLE = 'NO'
);

SET @sql := IF(
  @user_id_is_not_nullable > 0,
  'ALTER TABLE user_reservations MODIFY COLUMN user_id BIGINT UNSIGNED NULL',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
