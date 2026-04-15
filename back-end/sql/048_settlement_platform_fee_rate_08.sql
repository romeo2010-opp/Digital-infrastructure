-- 048_settlement_platform_fee_rate_08.sql
-- Recalculate settlement platform fees to 0.8% of gross amount.

UPDATE settlement_batches
SET
  fee_amount = ROUND(gross_amount * 0.008, 2),
  net_amount = ROUND(gross_amount - (gross_amount * 0.008), 2),
  updated_at = CURRENT_TIMESTAMP
WHERE
  ROUND(fee_amount, 2) <> ROUND(gross_amount * 0.008, 2)
  OR ROUND(net_amount, 2) <> ROUND(gross_amount - (gross_amount * 0.008), 2);
