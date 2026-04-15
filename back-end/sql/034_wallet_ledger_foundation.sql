-- 034_wallet_ledger_foundation.sql
-- SmartLink wallet + internal ledger foundation.
-- This is a controlled platform wallet for SmartLink user flows.
-- Ledger entries are the source of truth. wallet_balances is a cached read model.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS wallets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  wallet_number VARCHAR(48) NOT NULL UNIQUE,
  currency_code CHAR(3) NOT NULL DEFAULT 'MWK',
  status ENUM('ACTIVE','SUSPENDED','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  suspended_at TIMESTAMP(3) NULL,
  closed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wallets_user_currency (user_id, currency_code),
  KEY idx_wallets_user_created (user_id, created_at),
  KEY idx_wallets_status (status, updated_at),
  CONSTRAINT fk_wallets_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_balances (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  wallet_id BIGINT UNSIGNED NOT NULL,
  ledger_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  available_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  pending_inflow DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  pending_outflow DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  version_no BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wallet_balances_wallet (wallet_id),
  CONSTRAINT fk_wallet_balances_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  wallet_id BIGINT UNSIGNED NULL,
  account_code VARCHAR(64) NOT NULL UNIQUE,
  account_name VARCHAR(160) NOT NULL,
  account_type ENUM('ASSET','LIABILITY','REVENUE','EXPENSE','CLEARING','CONTRA') NOT NULL,
  normal_balance ENUM('DEBIT','CREDIT') NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'MWK',
  status ENUM('ACTIVE','INACTIVE','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  system_account_role ENUM(
    'WALLET_LIABILITY',
    'PAYMENT_CLEARING',
    'REFUNDS_PAYABLE',
    'PLATFORM_REVENUE',
    'MANUAL_ADJUSTMENTS',
    'RESERVATION_HOLD',
    'FAILED_PAYMENT_RECOVERY'
  ) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ledger_accounts_wallet (wallet_id),
  UNIQUE KEY uq_ledger_accounts_system_role_currency (system_account_role, currency_code),
  KEY idx_ledger_accounts_wallet_status (wallet_id, status),
  KEY idx_ledger_accounts_system_role (system_account_role),
  KEY idx_ledger_accounts_status (status),
  CONSTRAINT fk_ledger_accounts_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  wallet_id BIGINT UNSIGNED NULL,
  transaction_reference VARCHAR(96) NOT NULL UNIQUE,
  external_reference VARCHAR(128) NULL,
  parent_transaction_id BIGINT UNSIGNED NULL,
  transaction_type ENUM(
    'TOPUP',
    'PAYMENT',
    'REFUND',
    'REVERSAL',
    'ADJUSTMENT',
    'HOLD',
    'RELEASE',
    'RESERVATION_PAYMENT',
    'QUEUE_FEE'
  ) NOT NULL,
  transaction_status ENUM('PENDING','POSTED','FAILED','REVERSED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  currency_code CHAR(3) NOT NULL DEFAULT 'MWK',
  gross_amount DECIMAL(18,2) NOT NULL,
  net_amount DECIMAL(18,2) NOT NULL,
  fee_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  description VARCHAR(255) NULL,
  related_entity_type VARCHAR(64) NULL,
  related_entity_id VARCHAR(96) NULL,
  initiated_by_user_id BIGINT UNSIGNED NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  idempotency_key VARCHAR(128) NULL,
  posted_at TIMESTAMP(3) NULL,
  reversed_at TIMESTAMP(3) NULL,
  failed_at TIMESTAMP(3) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ledger_transactions_idempotency (idempotency_key),
  KEY idx_ledger_transactions_wallet_created (wallet_id, created_at),
  KEY idx_ledger_transactions_parent (parent_transaction_id),
  KEY idx_ledger_transactions_type (transaction_type, created_at),
  KEY idx_ledger_transactions_status (transaction_status, created_at),
  KEY idx_ledger_transactions_related_entity (related_entity_type, related_entity_id),
  KEY idx_ledger_transactions_initiated_by (initiated_by_user_id, created_at),
  KEY idx_ledger_transactions_posted_at (posted_at),
  CONSTRAINT fk_ledger_transactions_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_ledger_transactions_parent FOREIGN KEY (parent_transaction_id) REFERENCES ledger_transactions(id),
  CONSTRAINT fk_ledger_transactions_initiated_by FOREIGN KEY (initiated_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_ledger_transactions_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ledger_transaction_id BIGINT UNSIGNED NOT NULL,
  ledger_account_id BIGINT UNSIGNED NOT NULL,
  entry_side ENUM('DEBIT','CREDIT') NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'MWK',
  entry_description VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_ledger_entries_transaction (ledger_transaction_id),
  KEY idx_ledger_entries_account (ledger_account_id),
  KEY idx_ledger_entries_currency (currency_code),
  KEY idx_ledger_entries_transaction_account (ledger_transaction_id, ledger_account_id),
  CONSTRAINT fk_ledger_entries_transaction FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  CONSTRAINT fk_ledger_entries_account FOREIGN KEY (ledger_account_id) REFERENCES ledger_accounts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_reservation_holds (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  wallet_id BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id BIGINT UNSIGNED NULL,
  reference VARCHAR(96) NOT NULL UNIQUE,
  hold_type ENUM('RESERVATION','QUEUE_FEE','MANUAL_HOLD','QUEUE_PREPAY') NOT NULL,
  status ENUM('ACTIVE','RELEASED','CAPTURED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  amount DECIMAL(18,2) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'MWK',
  related_entity_type VARCHAR(64) NOT NULL,
  related_entity_id VARCHAR(96) NOT NULL,
  expires_at TIMESTAMP(3) NULL,
  released_at TIMESTAMP(3) NULL,
  captured_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_wallet_reservation_holds_wallet_status (wallet_id, status, created_at),
  KEY idx_wallet_reservation_holds_wallet_expires (wallet_id, expires_at),
  KEY idx_wallet_reservation_holds_status_expires (status, expires_at),
  KEY idx_wallet_reservation_holds_related_entity (related_entity_type, related_entity_id),
  CONSTRAINT fk_wallet_reservation_holds_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_reservation_holds_transaction FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  wallet_id BIGINT UNSIGNED NULL,
  ledger_transaction_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action_type VARCHAR(96) NOT NULL,
  action_summary VARCHAR(255) NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_wallet_audit_logs_wallet_time (wallet_id, created_at),
  KEY idx_wallet_audit_logs_transaction_time (ledger_transaction_id, created_at),
  KEY idx_wallet_audit_logs_actor_time (actor_user_id, created_at),
  KEY idx_wallet_audit_logs_action_time (action_type, created_at),
  CONSTRAINT fk_wallet_audit_logs_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_audit_logs_transaction FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  CONSTRAINT fk_wallet_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed-safe internal system ledger accounts for MWK.
-- Wallet-linked accounts are created separately when wallets are provisioned.
INSERT INTO ledger_accounts (
  wallet_id,
  account_code,
  account_name,
  account_type,
  normal_balance,
  currency_code,
  status,
  system_account_role
) VALUES
  (NULL, 'WALLET_LIABILITY_MAIN', 'Customer wallet liability main account', 'LIABILITY', 'CREDIT', 'MWK', 'ACTIVE', 'WALLET_LIABILITY'),
  (NULL, 'PAYMENT_CLEARING_MAIN', 'Incoming payment clearing account', 'CLEARING', 'DEBIT', 'MWK', 'ACTIVE', 'PAYMENT_CLEARING'),
  (NULL, 'REFUNDS_PAYABLE_MAIN', 'Refunds payable control account', 'LIABILITY', 'CREDIT', 'MWK', 'ACTIVE', 'REFUNDS_PAYABLE'),
  (NULL, 'PLATFORM_REVENUE_MAIN', 'Platform wallet revenue account', 'REVENUE', 'CREDIT', 'MWK', 'ACTIVE', 'PLATFORM_REVENUE'),
  (NULL, 'MANUAL_ADJUSTMENTS_MAIN', 'Manual wallet adjustment balancing account', 'EXPENSE', 'DEBIT', 'MWK', 'ACTIVE', 'MANUAL_ADJUSTMENTS'),
  (NULL, 'RESERVATION_HOLDS_MAIN', 'Reservation and queue fee hold control account', 'CLEARING', 'CREDIT', 'MWK', 'ACTIVE', 'RESERVATION_HOLD'),
  (NULL, 'FAILED_PAYMENT_RECOVERY_MAIN', 'Failed payment recovery clearing account', 'CLEARING', 'DEBIT', 'MWK', 'ACTIVE', 'FAILED_PAYMENT_RECOVERY')
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  account_type = VALUES(account_type),
  normal_balance = VALUES(normal_balance),
  currency_code = VALUES(currency_code),
  status = VALUES(status),
  system_account_role = VALUES(system_account_role),
  updated_at = CURRENT_TIMESTAMP(3);

-- Important enforcement note:
-- 1. A POSTED ledger_transaction must have at least two ledger_entries.
-- 2. Total DEBIT entries must equal total CREDIT entries per POSTED transaction.
-- 3. Posted transactions and ledger entries must be treated as immutable in the service layer.
-- 4. wallet_balances must only be updated from ledger + hold state, never used as source-of-truth.
