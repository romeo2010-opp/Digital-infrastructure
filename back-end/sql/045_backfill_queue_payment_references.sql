-- 045_backfill_queue_payment_references.sql
-- Backfill missing transactions.payment_reference values for historical
-- queue-prepay transactions, including queue entries that later settled
-- through synced reservations.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

UPDATE transactions tx
INNER JOIN queue_entries qe
  ON qe.id = tx.queue_entry_id
SET
  tx.payment_reference = COALESCE(
    NULLIF(
      TRIM(
        CASE
          WHEN JSON_VALID(qe.metadata)
            THEN JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.serviceRequest.walletTransactionReference'))
          ELSE NULL
        END
      ),
      ''
    ),
    (
      SELECT lt.transaction_reference
      FROM ledger_transactions lt
      WHERE lt.related_entity_type = 'QUEUE'
        AND lt.related_entity_id = qe.public_id
        AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
        AND lt.transaction_status = 'POSTED'
      ORDER BY COALESCE(lt.posted_at, lt.created_at) DESC, lt.id DESC
      LIMIT 1
    )
  )
WHERE (tx.payment_reference IS NULL OR TRIM(tx.payment_reference) = '')
  AND tx.queue_entry_id IS NOT NULL
  AND COALESCE(
    NULLIF(
      TRIM(
        CASE
          WHEN JSON_VALID(qe.metadata)
            THEN JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.serviceRequest.walletTransactionReference'))
          ELSE NULL
        END
      ),
      ''
    ),
    (
      SELECT lt.transaction_reference
      FROM ledger_transactions lt
      WHERE lt.related_entity_type = 'QUEUE'
        AND lt.related_entity_id = qe.public_id
        AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
        AND lt.transaction_status = 'POSTED'
      ORDER BY COALESCE(lt.posted_at, lt.created_at) DESC, lt.id DESC
      LIMIT 1
    )
  ) IS NOT NULL;

SET @has_user_reservations := (
  SELECT COUNT(*)
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_reservations'
);

SET @sql := IF(
  @has_user_reservations = 1,
  "
  UPDATE transactions tx
  INNER JOIN user_reservations ur
    ON ur.public_id = tx.reservation_public_id
  INNER JOIN queue_entries qe
    ON qe.id = ur.source_queue_entry_id
  SET
    tx.payment_reference = COALESCE(
      NULLIF(
        TRIM(
          CASE
            WHEN JSON_VALID(ur.metadata)
              THEN JSON_UNQUOTE(JSON_EXTRACT(ur.metadata, '$.serviceRequest.walletTransactionReference'))
            ELSE NULL
          END
        ),
        ''
      ),
      NULLIF(
        TRIM(
          CASE
            WHEN JSON_VALID(qe.metadata)
              THEN JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.serviceRequest.walletTransactionReference'))
            ELSE NULL
          END
        ),
        ''
      ),
      (
        SELECT lt.transaction_reference
        FROM ledger_transactions lt
        WHERE lt.related_entity_type = 'QUEUE'
          AND lt.related_entity_id = qe.public_id
          AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
          AND lt.transaction_status = 'POSTED'
        ORDER BY COALESCE(lt.posted_at, lt.created_at) DESC, lt.id DESC
        LIMIT 1
      )
    )
  WHERE (tx.payment_reference IS NULL OR TRIM(tx.payment_reference) = '')
    AND tx.reservation_public_id IS NOT NULL
    AND ur.source_queue_entry_id IS NOT NULL
    AND COALESCE(
      NULLIF(
        TRIM(
          CASE
            WHEN JSON_VALID(ur.metadata)
              THEN JSON_UNQUOTE(JSON_EXTRACT(ur.metadata, '$.serviceRequest.walletTransactionReference'))
            ELSE NULL
          END
        ),
        ''
      ),
      NULLIF(
        TRIM(
          CASE
            WHEN JSON_VALID(qe.metadata)
              THEN JSON_UNQUOTE(JSON_EXTRACT(qe.metadata, '$.serviceRequest.walletTransactionReference'))
            ELSE NULL
          END
        ),
        ''
      ),
      (
        SELECT lt.transaction_reference
        FROM ledger_transactions lt
        WHERE lt.related_entity_type = 'QUEUE'
          AND lt.related_entity_id = qe.public_id
          AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE')
          AND lt.transaction_status = 'POSTED'
        ORDER BY COALESCE(lt.posted_at, lt.created_at) DESC, lt.id DESC
        LIMIT 1
      )
    ) IS NOT NULL
  ",
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
