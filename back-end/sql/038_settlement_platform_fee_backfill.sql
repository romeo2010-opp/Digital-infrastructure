-- 038_settlement_platform_fee_backfill.sql
-- Recalculate settlement platform fees to 0.5% of gross amount.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

UPDATE settlement_batches
SET
  fee_amount = ROUND(gross_amount * 0.005, 2),
  net_amount = ROUND(gross_amount - (gross_amount * 0.005), 2),
  updated_at = CURRENT_TIMESTAMP(3)
WHERE
  ROUND(fee_amount, 2) <> ROUND(gross_amount * 0.005, 2)
  OR ROUND(net_amount, 2) <> ROUND(gross_amount - (gross_amount * 0.005), 2);
