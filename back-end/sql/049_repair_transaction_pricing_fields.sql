-- 049_repair_transaction_pricing_fields.sql
-- Repair historically incorrect transaction litres/pricing fields using stronger proof sources.
--
-- Why this exists:
-- 1. Some queue-shadow / SmartPay transactions were persisted with preview litres (often 40L)
--    instead of the actual dispensed litres.
-- 2. When that happened, dependent fields like subtotal and price_per_litre were also skewed.
--
-- Repair order:
-- 1. Pump session dispensed litres linked to the transaction.
-- 2. Posted wallet ledger amount divided by base pump price for queue-backed SmartPay rows.
-- 3. Historical queue-shadow reservation fallback using requested_litres when no stronger proof exists.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @has_transactions := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
);

SET @has_pump_sessions := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pump_sessions'
);

SET @has_ledger_transactions := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ledger_transactions'
);

SET @sql := IF(
  @has_transactions = 1 AND @has_pump_sessions = 1,
  'UPDATE transactions tx
   INNER JOIN (
     SELECT
       ps.transaction_id,
       MAX(ps.dispensed_litres) AS dispensed_litres
     FROM pump_sessions ps
     WHERE ps.transaction_id IS NOT NULL
       AND ps.dispensed_litres IS NOT NULL
       AND ps.dispensed_litres > 0
     GROUP BY ps.transaction_id
   ) proof ON proof.transaction_id = tx.id
   SET
     tx.litres = ROUND(proof.dispensed_litres, 3),
     tx.subtotal = CASE
       WHEN COALESCE(tx.base_price_per_litre, tx.price_per_litre) > 0
         THEN ROUND(COALESCE(tx.base_price_per_litre, tx.price_per_litre) * proof.dispensed_litres, 2)
       ELSE tx.subtotal
     END,
     tx.price_per_litre = CASE
       WHEN proof.dispensed_litres > 0 AND COALESCE(tx.final_amount_paid, tx.total_amount) > 0
         THEN ROUND(COALESCE(tx.final_amount_paid, tx.total_amount) / proof.dispensed_litres, 4)
       ELSE tx.price_per_litre
     END,
     tx.effective_price_per_litre = CASE
       WHEN proof.dispensed_litres > 0 AND COALESCE(tx.final_amount_paid, tx.total_amount) > 0
         THEN ROUND(GREATEST(0, COALESCE(tx.final_amount_paid, tx.total_amount) - COALESCE(tx.cashback_total, 0)) / proof.dispensed_litres, 4)
       ELSE tx.effective_price_per_litre
     END,
     tx.pricing_snapshot_json = CASE
       WHEN tx.pricing_snapshot_json IS NOT NULL AND JSON_VALID(tx.pricing_snapshot_json)
         THEN JSON_SET(
           tx.pricing_snapshot_json,
           ''$.basePricePerLitre'', COALESCE(tx.base_price_per_litre, tx.price_per_litre),
           ''$.litres'', ROUND(proof.dispensed_litres, 3),
           ''$.subtotal'', CASE
             WHEN COALESCE(tx.base_price_per_litre, tx.price_per_litre) > 0
               THEN ROUND(COALESCE(tx.base_price_per_litre, tx.price_per_litre) * proof.dispensed_litres, 2)
             ELSE JSON_EXTRACT(tx.pricing_snapshot_json, ''$.subtotal'')
           END,
           ''$.directPricePerLitre'', CASE
             WHEN proof.dispensed_litres > 0 AND COALESCE(tx.final_amount_paid, tx.total_amount) > 0
               THEN ROUND(COALESCE(tx.final_amount_paid, tx.total_amount) / proof.dispensed_litres, 4)
             ELSE JSON_EXTRACT(tx.pricing_snapshot_json, ''$.directPricePerLitre'')
           END,
           ''$.finalPayable'', COALESCE(tx.final_amount_paid, tx.total_amount),
           ''$.effectiveNetCost'', GREATEST(0, COALESCE(tx.final_amount_paid, tx.total_amount) - COALESCE(tx.cashback_total, 0)),
           ''$.effectivePricePerLitre'', CASE
             WHEN proof.dispensed_litres > 0 AND COALESCE(tx.final_amount_paid, tx.total_amount) > 0
               THEN ROUND(GREATEST(0, COALESCE(tx.final_amount_paid, tx.total_amount) - COALESCE(tx.cashback_total, 0)) / proof.dispensed_litres, 4)
             ELSE JSON_EXTRACT(tx.pricing_snapshot_json, ''$.effectivePricePerLitre'')
           END
         )
       ELSE tx.pricing_snapshot_json
     END
   WHERE ABS(COALESCE(tx.litres, 0) - proof.dispensed_litres) > 0.009',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_transactions = 1 AND @has_ledger_transactions = 1 AND @has_pump_sessions = 1,
  'UPDATE transactions tx
   INNER JOIN (
     SELECT
       lt.transaction_reference,
       COALESCE(lt.net_amount, lt.gross_amount) AS settled_amount
     FROM ledger_transactions lt
     INNER JOIN (
       SELECT
         transaction_reference,
         MAX(id) AS latest_id
       FROM ledger_transactions
       WHERE transaction_status = ''POSTED''
         AND transaction_type IN (''PAYMENT'', ''RESERVATION_PAYMENT'', ''QUEUE_FEE'')
         AND transaction_reference IS NOT NULL
         AND TRIM(transaction_reference) <> ''''
       GROUP BY transaction_reference
     ) latest ON latest.latest_id = lt.id
   ) wallet ON wallet.transaction_reference = tx.payment_reference
   LEFT JOIN (
     SELECT DISTINCT ps.transaction_id
     FROM pump_sessions ps
     WHERE ps.transaction_id IS NOT NULL
       AND ps.dispensed_litres IS NOT NULL
       AND ps.dispensed_litres > 0
   ) proof ON proof.transaction_id = tx.id
   SET
     tx.litres = ROUND(wallet.settled_amount / tx.base_price_per_litre, 3),
     tx.total_amount = ROUND(wallet.settled_amount, 2),
     tx.final_amount_paid = ROUND(wallet.settled_amount, 2),
     tx.subtotal = ROUND(tx.base_price_per_litre * (wallet.settled_amount / tx.base_price_per_litre), 2),
     tx.price_per_litre = ROUND(wallet.settled_amount / (wallet.settled_amount / tx.base_price_per_litre), 4),
     tx.effective_price_per_litre = ROUND(GREATEST(0, wallet.settled_amount - COALESCE(tx.cashback_total, 0)) / (wallet.settled_amount / tx.base_price_per_litre), 4),
     tx.payment_method = CASE
       WHEN tx.payment_method IN (''OTHER'', ''CASH'') THEN ''SMARTPAY''
       ELSE tx.payment_method
     END,
     tx.pricing_snapshot_json = CASE
       WHEN tx.pricing_snapshot_json IS NOT NULL AND JSON_VALID(tx.pricing_snapshot_json)
         THEN JSON_SET(
           tx.pricing_snapshot_json,
           ''$.basePricePerLitre'', tx.base_price_per_litre,
           ''$.litres'', ROUND(wallet.settled_amount / tx.base_price_per_litre, 3),
           ''$.subtotal'', ROUND(tx.base_price_per_litre * (wallet.settled_amount / tx.base_price_per_litre), 2),
           ''$.directPricePerLitre'', ROUND(wallet.settled_amount / (wallet.settled_amount / tx.base_price_per_litre), 4),
           ''$.finalPayable'', ROUND(wallet.settled_amount, 2),
           ''$.effectiveNetCost'', GREATEST(0, ROUND(wallet.settled_amount, 2) - COALESCE(tx.cashback_total, 0)),
           ''$.effectivePricePerLitre'', ROUND(GREATEST(0, wallet.settled_amount - COALESCE(tx.cashback_total, 0)) / (wallet.settled_amount / tx.base_price_per_litre), 4)
         )
       ELSE tx.pricing_snapshot_json
     END
   WHERE proof.transaction_id IS NULL
     AND wallet.settled_amount IS NOT NULL
     AND wallet.settled_amount > 0
     AND tx.base_price_per_litre IS NOT NULL
     AND tx.base_price_per_litre > 0
     AND COALESCE(tx.total_direct_discount, 0) = 0
     AND COALESCE(tx.cashback_total, 0) = 0
     AND ABS(COALESCE(tx.litres, 0) - ROUND(wallet.settled_amount / tx.base_price_per_litre, 3)) > 0.009',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_transactions = 1 AND @has_ledger_transactions = 1 AND @has_pump_sessions = 1,
  'UPDATE transactions tx
   LEFT JOIN (
     SELECT DISTINCT ps.transaction_id
     FROM pump_sessions ps
     WHERE ps.transaction_id IS NOT NULL
       AND ps.dispensed_litres IS NOT NULL
       AND ps.dispensed_litres > 0
   ) proof ON proof.transaction_id = tx.id
   LEFT JOIN (
     SELECT DISTINCT lt.transaction_reference
     FROM ledger_transactions lt
     WHERE lt.transaction_status = ''POSTED''
       AND lt.transaction_type IN (''PAYMENT'', ''RESERVATION_PAYMENT'', ''QUEUE_FEE'')
       AND lt.transaction_reference IS NOT NULL
       AND TRIM(lt.transaction_reference) <> ''''
   ) wallet ON wallet.transaction_reference = tx.payment_reference
   SET
     tx.litres = ROUND(tx.requested_litres, 3),
     tx.total_amount = ROUND(tx.base_price_per_litre * tx.requested_litres, 2),
     tx.final_amount_paid = ROUND(tx.base_price_per_litre * tx.requested_litres, 2),
     tx.subtotal = ROUND(tx.base_price_per_litre * tx.requested_litres, 2),
     tx.price_per_litre = ROUND(tx.base_price_per_litre, 4),
     tx.effective_price_per_litre = ROUND(tx.base_price_per_litre, 4),
     tx.payment_method = CASE
       WHEN tx.payment_reference IS NOT NULL AND TRIM(tx.payment_reference) <> '''' AND tx.payment_method = ''OTHER'' THEN ''SMARTPAY''
       ELSE tx.payment_method
     END,
     tx.pricing_snapshot_json = CASE
       WHEN tx.pricing_snapshot_json IS NOT NULL AND JSON_VALID(tx.pricing_snapshot_json)
         THEN JSON_SET(
           tx.pricing_snapshot_json,
           ''$.basePricePerLitre'', tx.base_price_per_litre,
           ''$.litres'', ROUND(tx.requested_litres, 3),
           ''$.subtotal'', ROUND(tx.base_price_per_litre * tx.requested_litres, 2),
           ''$.directPricePerLitre'', ROUND(tx.base_price_per_litre, 4),
           ''$.finalPayable'', ROUND(tx.base_price_per_litre * tx.requested_litres, 2),
           ''$.effectiveNetCost'', ROUND(tx.base_price_per_litre * tx.requested_litres, 2),
           ''$.effectivePricePerLitre'', ROUND(tx.base_price_per_litre, 4)
         )
       ELSE tx.pricing_snapshot_json
     END
   WHERE proof.transaction_id IS NULL
     AND wallet.transaction_reference IS NULL
     AND tx.reservation_public_id LIKE ''RSV-QUE-%''
     AND tx.requested_litres IS NOT NULL
     AND tx.requested_litres > 0
     AND tx.base_price_per_litre IS NOT NULL
     AND tx.base_price_per_litre > 0
     AND COALESCE(tx.total_direct_discount, 0) = 0
     AND COALESCE(tx.cashback_total, 0) = 0
     AND ABS(COALESCE(tx.litres, 0) - tx.requested_litres) > 0.009',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
