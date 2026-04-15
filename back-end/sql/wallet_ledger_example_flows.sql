-- wallet_ledger_example_flows.sql
-- Example SQL flows for the SmartLink wallet ledger foundation.
-- These examples are reference-only and should be adapted by the service layer.
-- They intentionally use transaction-scoped variables and explicit balance refresh steps.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

-- ---------------------------------------------------------------------------
-- Shared setup helpers
-- ---------------------------------------------------------------------------

-- Example actor / approver context.
SET @actor_user_id := 1;
SET @approver_user_id := 1;
SET @wallet_currency := 'MWK';

-- Resolve the seeded system accounts once.
SET @payment_clearing_account_id := (
  SELECT id FROM ledger_accounts WHERE account_code = 'PAYMENT_CLEARING_MAIN' LIMIT 1
);
SET @refunds_payable_account_id := (
  SELECT id FROM ledger_accounts WHERE account_code = 'REFUNDS_PAYABLE_MAIN' LIMIT 1
);
SET @platform_revenue_account_id := (
  SELECT id FROM ledger_accounts WHERE account_code = 'PLATFORM_REVENUE_MAIN' LIMIT 1
);
SET @manual_adjustments_account_id := (
  SELECT id FROM ledger_accounts WHERE account_code = 'MANUAL_ADJUSTMENTS_MAIN' LIMIT 1
);
SET @reservation_holds_account_id := (
  SELECT id FROM ledger_accounts WHERE account_code = 'RESERVATION_HOLDS_MAIN' LIMIT 1
);

-- ---------------------------------------------------------------------------
-- 1. Wallet creation
-- ---------------------------------------------------------------------------
-- One wallet per user per currency.
-- The service layer should generate wallet_number deterministically and uniquely.
-- The wallet-linked ledger account code is derived from wallet_number.

SET @wallet_number := 'WLT-MWK-000000000001';
SET @wallet_account_code := CONCAT('WALLET_ACC_', @wallet_number);

START TRANSACTION;

INSERT INTO wallets (
  user_id,
  wallet_number,
  currency_code,
  status,
  is_primary
) VALUES (
  @actor_user_id,
  @wallet_number,
  @wallet_currency,
  'ACTIVE',
  1
);

SET @wallet_id := LAST_INSERT_ID();

INSERT INTO wallet_balances (
  wallet_id,
  ledger_balance,
  available_balance,
  pending_inflow,
  pending_outflow,
  version_no
) VALUES (
  @wallet_id,
  0.00,
  0.00,
  0.00,
  0.00,
  1
);

INSERT INTO ledger_accounts (
  wallet_id,
  account_code,
  account_name,
  account_type,
  normal_balance,
  currency_code,
  status,
  system_account_role
) VALUES (
  @wallet_id,
  @wallet_account_code,
  CONCAT('Wallet liability account ', @wallet_number),
  'LIABILITY',
  'CREDIT',
  @wallet_currency,
  'ACTIVE',
  NULL
);

SET @wallet_account_id := LAST_INSERT_ID();

INSERT INTO wallet_audit_logs (
  wallet_id,
  actor_user_id,
  action_type,
  action_summary,
  metadata_json
) VALUES (
  @wallet_id,
  @actor_user_id,
  'WALLET_CREATED',
  CONCAT('Primary wallet created for user ', @actor_user_id, '.'),
  JSON_OBJECT('walletNumber', @wallet_number, 'currencyCode', @wallet_currency, 'walletAccountCode', @wallet_account_code)
);

COMMIT;

-- ---------------------------------------------------------------------------
-- Shared balance refresh query
-- ---------------------------------------------------------------------------
-- This derives ledger_balance from POSTED entries only.
-- available_balance = ledger_balance - active_holds - pending_outflow + pending_inflow.
-- For wallet-linked accounts, normal_balance is CREDIT.

-- Run this after every successful money movement or hold state change:
UPDATE wallet_balances wb
JOIN (
  SELECT
    la.wallet_id,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN -le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN -le.amount
        ELSE 0
      END
    ), 0.00) AS ledger_balance,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_inflow,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_outflow
  FROM ledger_accounts la
  LEFT JOIN ledger_entries le
    ON le.ledger_account_id = la.id
  LEFT JOIN ledger_transactions lt
    ON lt.id = le.ledger_transaction_id
  WHERE la.wallet_id = @wallet_id
  GROUP BY la.wallet_id
) calc
  ON calc.wallet_id = wb.wallet_id
LEFT JOIN (
  SELECT
    wallet_id,
    COALESCE(SUM(amount), 0.00) AS active_hold_amount
  FROM wallet_reservation_holds
  WHERE wallet_id = @wallet_id
    AND status = 'ACTIVE'
  GROUP BY wallet_id
) holds
  ON holds.wallet_id = wb.wallet_id
SET
  wb.ledger_balance = calc.ledger_balance,
  wb.pending_inflow = calc.pending_inflow,
  wb.pending_outflow = calc.pending_outflow,
  wb.available_balance = calc.ledger_balance - COALESCE(holds.active_hold_amount, 0.00) - calc.pending_outflow + calc.pending_inflow,
  wb.version_no = wb.version_no + 1,
  wb.updated_at = CURRENT_TIMESTAMP(3)
WHERE wb.wallet_id = @wallet_id;

-- ---------------------------------------------------------------------------
-- 2. Posted top-up
-- ---------------------------------------------------------------------------
-- Accounting:
--   DR PAYMENT_CLEARING_MAIN
--   CR user wallet liability account
-- Rationale:
--   SmartLink has received value into its clearing position and now owes that
--   value to the customer wallet.

SET @topup_amount := 25000.00;
SET @topup_reference := 'WLTX-TOPUP-20260311-0001';

START TRANSACTION;

INSERT INTO ledger_transactions (
  wallet_id,
  transaction_reference,
  external_reference,
  transaction_type,
  transaction_status,
  currency_code,
  gross_amount,
  net_amount,
  fee_amount,
  description,
  related_entity_type,
  related_entity_id,
  initiated_by_user_id,
  approved_by_user_id,
  idempotency_key,
  posted_at,
  metadata_json
) VALUES (
  @wallet_id,
  @topup_reference,
  'TOPUP-REQUEST-0001',
  'TOPUP',
  'POSTED',
  @wallet_currency,
  @topup_amount,
  @topup_amount,
  0.00,
  'Wallet top-up posted.',
  'TOPUP_REQUEST',
  'TOPUP-REQUEST-0001',
  @actor_user_id,
  @approver_user_id,
  'wallet:topup:TOPUP-REQUEST-0001',
  CURRENT_TIMESTAMP(3),
  JSON_OBJECT('channel', 'MANUAL_SETTLEMENT', 'fundingSource', 'payment_clearing')
);

SET @topup_transaction_id := LAST_INSERT_ID();

INSERT INTO ledger_entries (
  ledger_transaction_id,
  ledger_account_id,
  entry_side,
  amount,
  currency_code,
  entry_description
) VALUES
  (@topup_transaction_id, @payment_clearing_account_id, 'DEBIT',  @topup_amount, @wallet_currency, 'Incoming top-up settled into SmartLink clearing.'),
  (@topup_transaction_id, @wallet_account_id,         'CREDIT', @topup_amount, @wallet_currency, 'Customer wallet liability increased.');

INSERT INTO wallet_audit_logs (
  wallet_id,
  ledger_transaction_id,
  actor_user_id,
  action_type,
  action_summary,
  metadata_json
) VALUES (
  @wallet_id,
  @topup_transaction_id,
  @actor_user_id,
  'WALLET_TOPUP_POSTED',
  CONCAT('Top-up posted for wallet ', @wallet_number, '.'),
  JSON_OBJECT('amount', @topup_amount, 'transactionReference', @topup_reference)
);

-- Refresh cached balances with the shared query above.
UPDATE wallet_balances wb
JOIN (
  SELECT
    la.wallet_id,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN -le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN -le.amount
        ELSE 0
      END
    ), 0.00) AS ledger_balance,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_inflow,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_outflow
  FROM ledger_accounts la
  LEFT JOIN ledger_entries le ON le.ledger_account_id = la.id
  LEFT JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
  WHERE la.wallet_id = @wallet_id
  GROUP BY la.wallet_id
) calc ON calc.wallet_id = wb.wallet_id
LEFT JOIN (
  SELECT wallet_id, COALESCE(SUM(amount), 0.00) AS active_hold_amount
  FROM wallet_reservation_holds
  WHERE wallet_id = @wallet_id AND status = 'ACTIVE'
  GROUP BY wallet_id
) holds ON holds.wallet_id = wb.wallet_id
SET
  wb.ledger_balance = calc.ledger_balance,
  wb.pending_inflow = calc.pending_inflow,
  wb.pending_outflow = calc.pending_outflow,
  wb.available_balance = calc.ledger_balance - COALESCE(holds.active_hold_amount, 0.00) - calc.pending_outflow + calc.pending_inflow,
  wb.version_no = wb.version_no + 1,
  wb.updated_at = CURRENT_TIMESTAMP(3)
WHERE wb.wallet_id = @wallet_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Posted wallet payment
-- ---------------------------------------------------------------------------
-- Accounting:
--   DR user wallet liability account
--   CR PLATFORM_REVENUE_MAIN
-- Rationale:
--   SmartLink reduces the amount it owes the user and recognizes platform-side
--   value for the posted SmartLink purchase / reservation payment event.

SET @payment_amount := 8000.00;
SET @payment_reference := 'WLTX-PAYMENT-20260311-0001';

START TRANSACTION;

INSERT INTO ledger_transactions (
  wallet_id,
  transaction_reference,
  parent_transaction_id,
  transaction_type,
  transaction_status,
  currency_code,
  gross_amount,
  net_amount,
  fee_amount,
  description,
  related_entity_type,
  related_entity_id,
  initiated_by_user_id,
  approved_by_user_id,
  idempotency_key,
  posted_at,
  metadata_json
) VALUES (
  @wallet_id,
  @payment_reference,
  NULL,
  'PAYMENT',
  'POSTED',
  @wallet_currency,
  @payment_amount,
  @payment_amount,
  0.00,
  'Wallet payment posted for SmartLink fuel or reservation purchase.',
  'USER_RESERVATION',
  'RSV-QUE-20260311093000-AB12CD',
  @actor_user_id,
  @approver_user_id,
  'wallet:payment:RSV-QUE-20260311093000-AB12CD',
  CURRENT_TIMESTAMP(3),
  JSON_OBJECT('source', 'wallet_checkout', 'reservationPublicId', 'RSV-QUE-20260311093000-AB12CD')
);

SET @payment_transaction_id := LAST_INSERT_ID();

INSERT INTO ledger_entries (
  ledger_transaction_id,
  ledger_account_id,
  entry_side,
  amount,
  currency_code,
  entry_description
) VALUES
  (@payment_transaction_id, @wallet_account_id,           'DEBIT',  @payment_amount, @wallet_currency, 'Customer wallet liability reduced by wallet payment.'),
  (@payment_transaction_id, @platform_revenue_account_id, 'CREDIT', @payment_amount, @wallet_currency, 'Platform revenue recognized from posted wallet payment.');

INSERT INTO wallet_audit_logs (
  wallet_id,
  ledger_transaction_id,
  actor_user_id,
  action_type,
  action_summary,
  metadata_json
) VALUES (
  @wallet_id,
  @payment_transaction_id,
  @actor_user_id,
  'WALLET_PAYMENT_POSTED',
  CONCAT('Wallet payment posted for wallet ', @wallet_number, '.'),
  JSON_OBJECT('amount', @payment_amount, 'transactionReference', @payment_reference)
);

-- Refresh cached balances with the shared query above.
UPDATE wallet_balances wb
JOIN (
  SELECT
    la.wallet_id,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN -le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN -le.amount
        ELSE 0
      END
    ), 0.00) AS ledger_balance,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_inflow,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_outflow
  FROM ledger_accounts la
  LEFT JOIN ledger_entries le ON le.ledger_account_id = la.id
  LEFT JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
  WHERE la.wallet_id = @wallet_id
  GROUP BY la.wallet_id
) calc ON calc.wallet_id = wb.wallet_id
LEFT JOIN (
  SELECT wallet_id, COALESCE(SUM(amount), 0.00) AS active_hold_amount
  FROM wallet_reservation_holds
  WHERE wallet_id = @wallet_id AND status = 'ACTIVE'
  GROUP BY wallet_id
) holds ON holds.wallet_id = wb.wallet_id
SET
  wb.ledger_balance = calc.ledger_balance,
  wb.pending_inflow = calc.pending_inflow,
  wb.pending_outflow = calc.pending_outflow,
  wb.available_balance = calc.ledger_balance - COALESCE(holds.active_hold_amount, 0.00) - calc.pending_outflow + calc.pending_inflow,
  wb.version_no = wb.version_no + 1,
  wb.updated_at = CURRENT_TIMESTAMP(3)
WHERE wb.wallet_id = @wallet_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. Posted refund linked to the original payment
-- ---------------------------------------------------------------------------
-- Accounting:
--   DR REFUNDS_PAYABLE_MAIN
--   CR user wallet liability account
-- Rationale:
--   A refund is a new event that restores customer wallet value while reducing
--   the platform refunds payable obligation.

SET @refund_amount := 3000.00;
SET @refund_reference := 'WLTX-REFUND-20260311-0001';

START TRANSACTION;

INSERT INTO ledger_transactions (
  wallet_id,
  transaction_reference,
  parent_transaction_id,
  transaction_type,
  transaction_status,
  currency_code,
  gross_amount,
  net_amount,
  fee_amount,
  description,
  related_entity_type,
  related_entity_id,
  initiated_by_user_id,
  approved_by_user_id,
  idempotency_key,
  posted_at,
  metadata_json
) VALUES (
  @wallet_id,
  @refund_reference,
  @payment_transaction_id,
  'REFUND',
  'POSTED',
  @wallet_currency,
  @refund_amount,
  @refund_amount,
  0.00,
  'Refund posted back into wallet.',
  'REFUND_REQUEST',
  '01REFUNDREQ000000000000001',
  @actor_user_id,
  @approver_user_id,
  'wallet:refund:01REFUNDREQ000000000000001',
  CURRENT_TIMESTAMP(3),
  JSON_OBJECT('reason', 'duplicate_charge', 'originalTransactionReference', @payment_reference)
);

SET @refund_transaction_id := LAST_INSERT_ID();

INSERT INTO ledger_entries (
  ledger_transaction_id,
  ledger_account_id,
  entry_side,
  amount,
  currency_code,
  entry_description
) VALUES
  (@refund_transaction_id, @refunds_payable_account_id, 'DEBIT',  @refund_amount, @wallet_currency, 'Refund payable reduced by approved wallet refund.'),
  (@refund_transaction_id, @wallet_account_id,          'CREDIT', @refund_amount, @wallet_currency, 'Customer wallet liability increased by refund.');

INSERT INTO wallet_audit_logs (
  wallet_id,
  ledger_transaction_id,
  actor_user_id,
  action_type,
  action_summary,
  metadata_json
) VALUES (
  @wallet_id,
  @refund_transaction_id,
  @actor_user_id,
  'WALLET_REFUND_POSTED',
  CONCAT('Refund posted to wallet ', @wallet_number, '.'),
  JSON_OBJECT('amount', @refund_amount, 'parentTransactionReference', @payment_reference)
);

-- Refresh cached balances with the shared query above.
UPDATE wallet_balances wb
JOIN (
  SELECT
    la.wallet_id,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN -le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN -le.amount
        ELSE 0
      END
    ), 0.00) AS ledger_balance,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_inflow,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_outflow
  FROM ledger_accounts la
  LEFT JOIN ledger_entries le ON le.ledger_account_id = la.id
  LEFT JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
  WHERE la.wallet_id = @wallet_id
  GROUP BY la.wallet_id
) calc ON calc.wallet_id = wb.wallet_id
LEFT JOIN (
  SELECT wallet_id, COALESCE(SUM(amount), 0.00) AS active_hold_amount
  FROM wallet_reservation_holds
  WHERE wallet_id = @wallet_id AND status = 'ACTIVE'
  GROUP BY wallet_id
) holds ON holds.wallet_id = wb.wallet_id
SET
  wb.ledger_balance = calc.ledger_balance,
  wb.pending_inflow = calc.pending_inflow,
  wb.pending_outflow = calc.pending_outflow,
  wb.available_balance = calc.ledger_balance - COALESCE(holds.active_hold_amount, 0.00) - calc.pending_outflow + calc.pending_inflow,
  wb.version_no = wb.version_no + 1,
  wb.updated_at = CURRENT_TIMESTAMP(3)
WHERE wb.wallet_id = @wallet_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- 5. Reversal of a mistaken payment
-- ---------------------------------------------------------------------------
-- Accounting:
--   DR PLATFORM_REVENUE_MAIN
--   CR user wallet liability account
-- Rationale:
--   The original posted payment is not mutated. A new reversing event restores
--   the wallet balance and reverses the earlier revenue recognition.

SET @reversal_amount := @payment_amount;
SET @reversal_reference := 'WLTX-REVERSAL-20260311-0001';

START TRANSACTION;

INSERT INTO ledger_transactions (
  wallet_id,
  transaction_reference,
  parent_transaction_id,
  transaction_type,
  transaction_status,
  currency_code,
  gross_amount,
  net_amount,
  fee_amount,
  description,
  related_entity_type,
  related_entity_id,
  initiated_by_user_id,
  approved_by_user_id,
  idempotency_key,
  posted_at,
  metadata_json
) VALUES (
  @wallet_id,
  @reversal_reference,
  @payment_transaction_id,
  'REVERSAL',
  'POSTED',
  @wallet_currency,
  @reversal_amount,
  @reversal_amount,
  0.00,
  'Reversal of mistaken wallet payment.',
  'LEDGER_TRANSACTION',
  @payment_reference,
  @actor_user_id,
  @approver_user_id,
  'wallet:reversal:WLTX-PAYMENT-20260311-0001',
  CURRENT_TIMESTAMP(3),
  JSON_OBJECT('reason', 'operator_error', 'originalTransactionReference', @payment_reference)
);

SET @reversal_transaction_id := LAST_INSERT_ID();

INSERT INTO ledger_entries (
  ledger_transaction_id,
  ledger_account_id,
  entry_side,
  amount,
  currency_code,
  entry_description
) VALUES
  (@reversal_transaction_id, @platform_revenue_account_id, 'DEBIT',  @reversal_amount, @wallet_currency, 'Platform revenue reversed from mistaken wallet payment.'),
  (@reversal_transaction_id, @wallet_account_id,           'CREDIT', @reversal_amount, @wallet_currency, 'Customer wallet liability restored by reversal.');

INSERT INTO wallet_audit_logs (
  wallet_id,
  ledger_transaction_id,
  actor_user_id,
  action_type,
  action_summary,
  metadata_json
) VALUES (
  @wallet_id,
  @reversal_transaction_id,
  @actor_user_id,
  'WALLET_TRANSACTION_REVERSED',
  CONCAT('Wallet payment reversal posted for wallet ', @wallet_number, '.'),
  JSON_OBJECT('amount', @reversal_amount, 'parentTransactionReference', @payment_reference)
);

UPDATE ledger_transactions
SET
  transaction_status = 'REVERSED',
  reversed_at = CURRENT_TIMESTAMP(3),
  updated_at = CURRENT_TIMESTAMP(3)
WHERE id = @payment_transaction_id
  AND transaction_status = 'POSTED';

-- Refresh cached balances with the shared query above.
UPDATE wallet_balances wb
JOIN (
  SELECT
    la.wallet_id,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN -le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'POSTED' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN -le.amount
        ELSE 0
      END
    ), 0.00) AS ledger_balance,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'CREDIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'DEBIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_inflow,
    COALESCE(SUM(
      CASE
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'CREDIT' AND le.entry_side = 'DEBIT' THEN le.amount
        WHEN lt.transaction_status = 'PENDING' AND la.normal_balance = 'DEBIT' AND le.entry_side = 'CREDIT' THEN le.amount
        ELSE 0
      END
    ), 0.00) AS pending_outflow
  FROM ledger_accounts la
  LEFT JOIN ledger_entries le ON le.ledger_account_id = la.id
  LEFT JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
  WHERE la.wallet_id = @wallet_id
  GROUP BY la.wallet_id
) calc ON calc.wallet_id = wb.wallet_id
LEFT JOIN (
  SELECT wallet_id, COALESCE(SUM(amount), 0.00) AS active_hold_amount
  FROM wallet_reservation_holds
  WHERE wallet_id = @wallet_id AND status = 'ACTIVE'
  GROUP BY wallet_id
) holds ON holds.wallet_id = wb.wallet_id
SET
  wb.ledger_balance = calc.ledger_balance,
  wb.pending_inflow = calc.pending_inflow,
  wb.pending_outflow = calc.pending_outflow,
  wb.available_balance = calc.ledger_balance - COALESCE(holds.active_hold_amount, 0.00) - calc.pending_outflow + calc.pending_inflow,
  wb.version_no = wb.version_no + 1,
  wb.updated_at = CURRENT_TIMESTAMP(3)
WHERE wb.wallet_id = @wallet_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. Failed top-up record
-- ---------------------------------------------------------------------------
-- Failed transactions stay visible for auditability and idempotency.
-- No POSTED ledger entries are created because money movement did not complete.

SET @failed_topup_reference := 'WLTX-TOPUP-20260311-FAILED-0001';

START TRANSACTION;

INSERT INTO ledger_transactions (
  wallet_id,
  transaction_reference,
  external_reference,
  transaction_type,
  transaction_status,
  currency_code,
  gross_amount,
  net_amount,
  fee_amount,
  description,
  related_entity_type,
  related_entity_id,
  initiated_by_user_id,
  idempotency_key,
  failed_at,
  metadata_json
) VALUES (
  @wallet_id,
  @failed_topup_reference,
  'TOPUP-REQUEST-FAILED-0001',
  'TOPUP',
  'FAILED',
  @wallet_currency,
  12000.00,
  0.00,
  0.00,
  'Top-up failed before posting.',
  'TOPUP_REQUEST',
  'TOPUP-REQUEST-FAILED-0001',
  @actor_user_id,
  'wallet:topup:TOPUP-REQUEST-FAILED-0001',
  CURRENT_TIMESTAMP(3),
  JSON_OBJECT('gatewayStatus', 'FAILED', 'failureCode', 'TIMEOUT', 'recoveryAccountCode', 'FAILED_PAYMENT_RECOVERY_MAIN')
);

SET @failed_topup_transaction_id := LAST_INSERT_ID();

INSERT INTO wallet_audit_logs (
  wallet_id,
  ledger_transaction_id,
  actor_user_id,
  action_type,
  action_summary,
  metadata_json
) VALUES (
  @wallet_id,
  @failed_topup_transaction_id,
  @actor_user_id,
  'WALLET_TOPUP_FAILED',
  CONCAT('Top-up failed for wallet ', @wallet_number, '.'),
  JSON_OBJECT('transactionReference', @failed_topup_reference, 'failureCode', 'TIMEOUT')
);

COMMIT;

-- ---------------------------------------------------------------------------
-- Optional future hold example
-- ---------------------------------------------------------------------------
-- A reservation hold does not need to mutate wallet_balances directly if the
-- service layer treats ACTIVE wallet_reservation_holds as unavailable funds.
-- Example:
--
-- INSERT INTO wallet_reservation_holds (
--   wallet_id,
--   ledger_transaction_id,
--   reference,
--   hold_type,
--   status,
--   amount,
--   currency_code,
--   related_entity_type,
--   related_entity_id,
--   expires_at
-- ) VALUES (
--   @wallet_id,
--   NULL,
--   'HLD-RSV-20260311-0001',
--   'RESERVATION',
--   'ACTIVE',
--   1500.00,
--   @wallet_currency,
--   'USER_RESERVATION',
--   'RSV-QUE-20260311093000-AB12CD',
--   DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 MINUTE)
-- );
