# Wallet Ledger Foundation

## Model
SmartLink wallet storage is built as a ledger-backed model, not a `users.balance` shortcut.

- `wallets`: user-owned wallet identity per currency.
- `wallet_balances`: cached read model for fast balance reads.
- `ledger_accounts`: wallet-linked and system ledger accounts.
- `ledger_transactions`: immutable business event headers.
- `ledger_entries`: double-entry lines.
- `wallet_reservation_holds`: funds reserved but not yet captured.
- `wallet_audit_logs`: operator and system traceability.

`wallet_balances` is never authoritative. The source of truth remains:

1. `ledger_transactions`
2. `ledger_entries`
3. `wallet_reservation_holds`

## Balance Derivation
Use posted entries only for ledger balance. Holds and pending items affect availability.

Reference formula:

```sql
ledger_balance = posted ledger effect on the wallet-linked ledger account
available_balance = ledger_balance - active_holds - pending_outflow + pending_inflow
```

Wallet-linked ledger accounts use `account_type = LIABILITY` and `normal_balance = CREDIT`, so for those accounts:

```text
ledger_balance = credits - debits
```

For a general-purpose account computation in SQL:

```sql
CASE
  WHEN normal_balance = 'DEBIT' THEN posted_debits - posted_credits
  WHEN normal_balance = 'CREDIT' THEN posted_credits - posted_debits
END
```

## Required Service-Layer Checks
MySQL/MariaDB can store the structure cleanly, but these invariants should be enforced in service code:

- A `POSTED` transaction must create at least two ledger entries.
- Sum of `DEBIT` entries must equal sum of `CREDIT` entries before commit.
- `currency_code` must match across the transaction header, entries, wallet, and participating accounts.
- Posted transactions must be immutable except for lifecycle timestamps such as `reversed_at`.
- Reversals and refunds must be new transactions linked by `parent_transaction_id`.
- `wallet_balances.version_no` should be used for optimistic concurrency when multiple balance updates race.
- No wallet payment should post if `available_balance < requested_amount`.
- Wallet-linked ledger accounts must remain one-to-one with wallets.
- Active holds must be released, captured, expired, or cancelled explicitly; never deleted silently.

## Suggested Service Methods
Recommended service surface for the backend:

- `createWallet(userId, currencyCode)`
- `getWalletByUser(userId, currencyCode = "MWK")`
- `getWalletBalance(walletId)`
- `getWalletStatement(walletId, filters)`
- `postWalletTopup(walletId, amount, reference, actorUserId, options = {})`
- `postWalletPayment(walletId, amount, relatedEntityType, relatedEntityId, actorUserId, options = {})`
- `postWalletRefund(walletId, amount, originalTransactionId, actorUserId, options = {})`
- `reverseWalletTransaction(originalTransactionId, actorUserId, reason)`
- `createReservationHold(walletId, amount, relatedEntityType, relatedEntityId, expiresAt, actorUserId = null)`
- `releaseReservationHold(holdId, actorUserId, reason = null)`
- `captureReservationHold(holdId, actorUserId, options = {})`

## Reference Generation Notes
The repo already uses application-generated business references such as:

- station public IDs
- support case public IDs
- transaction public IDs

Wallet services should follow the same approach:

- `wallet_number`: generated in service code before insert, stable and human-safe
- `transaction_reference`: generated in service code and unique
- `wallet_reservation_holds.reference`: generated in service code and unique

Recommended shape examples:

- `wallet_number`: `WLT-MWK-000000000001`
- `transaction_reference`: `WLTX-TOPUP-20260311-0001`
- `hold.reference`: `HLD-RSV-20260311-0001`

## Why This Model Fits SmartLink
This is a controlled platform wallet, not an open fintech ledger for arbitrary transfers.

- It supports top-ups without binding the schema to a gateway vendor.
- It supports reservation capture and queue commitment fees later.
- It supports refunds and reversals without mutating historical money movement.
- It gives internal finance and audit teams a proper trail for disputes and adjustments.
