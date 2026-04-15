-- 045_transactions_payment_method_smartpay.sql
-- Allow SmartPay-backed forecourt transactions to persist with their actual payment method.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_tx_payment_method := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'payment_method'
);

SET @tx_payment_method_has_smartpay := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'payment_method'
    AND COLUMN_TYPE LIKE '%''SMARTPAY''%'
);

SET @sql := IF(
  @has_tx_payment_method = 1 AND @tx_payment_method_has_smartpay = 0,
  'ALTER TABLE transactions MODIFY COLUMN payment_method ENUM(''CASH'',''MOBILE_MONEY'',''CARD'',''OTHER'',''SMARTPAY'') NOT NULL DEFAULT ''CASH''',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
