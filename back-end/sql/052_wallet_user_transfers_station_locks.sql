-- 052_wallet_user_transfers_station_locks.sql
-- Closed-loop SmartLink wallet user transfers with optional station-locked credit.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

ALTER TABLE ledger_accounts
  MODIFY COLUMN system_account_role ENUM(
    'WALLET_LIABILITY',
    'PAYMENT_CLEARING',
    'REFUNDS_PAYABLE',
    'PLATFORM_REVENUE',
    'MANUAL_ADJUSTMENTS',
    'RESERVATION_HOLD',
    'FAILED_PAYMENT_RECOVERY',
    'USER_TRANSFER_CLEARING'
  ) NULL;

ALTER TABLE ledger_transactions
  MODIFY COLUMN transaction_type ENUM(
    'TOPUP',
    'PAYMENT',
    'REFUND',
    'REVERSAL',
    'ADJUSTMENT',
    'HOLD',
    'RELEASE',
    'RESERVATION_PAYMENT',
    'QUEUE_FEE',
    'TRANSFER'
  ) NOT NULL;

SET @has_wallet_locked_balance := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_balances'
    AND COLUMN_NAME = 'locked_balance'
);
SET @wallet_locked_balance_sql := IF(
  @has_wallet_locked_balance = 0,
  'ALTER TABLE wallet_balances ADD COLUMN locked_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER available_balance',
  'SELECT 1'
);
PREPARE wallet_locked_balance_stmt FROM @wallet_locked_balance_sql;
EXECUTE wallet_locked_balance_stmt;
DEALLOCATE PREPARE wallet_locked_balance_stmt;

CREATE TABLE IF NOT EXISTS wallet_user_transfers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  receiver_user_id BIGINT UNSIGNED NOT NULL,
  sender_wallet_id BIGINT UNSIGNED NOT NULL,
  receiver_wallet_id BIGINT UNSIGNED NOT NULL,
  sender_ledger_transaction_id BIGINT UNSIGNED NULL,
  receiver_ledger_transaction_id BIGINT UNSIGNED NULL,
  amount_mwk DECIMAL(18,2) NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'MWK',
  transfer_mode ENUM('NORMAL','STATION_LOCKED') NOT NULL DEFAULT 'NORMAL',
  locked_station_id BIGINT UNSIGNED NULL,
  status ENUM('PENDING','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  initiated_via ENUM('USER_ID','QR') NOT NULL DEFAULT 'USER_ID',
  qr_reference VARCHAR(128) NULL,
  note VARCHAR(255) NULL,
  idempotency_key VARCHAR(128) NULL,
  metadata_json LONGTEXT NULL,
  completed_at TIMESTAMP(3) NULL,
  failed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wallet_user_transfers_sender_idempotency (sender_user_id, idempotency_key),
  KEY idx_wallet_user_transfers_sender_time (sender_user_id, created_at),
  KEY idx_wallet_user_transfers_receiver_time (receiver_user_id, created_at),
  KEY idx_wallet_user_transfers_mode_status (transfer_mode, status, created_at),
  KEY idx_wallet_user_transfers_station (locked_station_id, created_at),
  KEY idx_wallet_user_transfers_sender_wallet (sender_wallet_id, created_at),
  KEY idx_wallet_user_transfers_receiver_wallet (receiver_wallet_id, created_at),
  CONSTRAINT fk_wallet_user_transfers_sender_user FOREIGN KEY (sender_user_id) REFERENCES users(id),
  CONSTRAINT fk_wallet_user_transfers_receiver_user FOREIGN KEY (receiver_user_id) REFERENCES users(id),
  CONSTRAINT fk_wallet_user_transfers_sender_wallet FOREIGN KEY (sender_wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_user_transfers_receiver_wallet FOREIGN KEY (receiver_wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_user_transfers_sender_ledger_tx FOREIGN KEY (sender_ledger_transaction_id) REFERENCES ledger_transactions(id),
  CONSTRAINT fk_wallet_user_transfers_receiver_ledger_tx FOREIGN KEY (receiver_ledger_transaction_id) REFERENCES ledger_transactions(id),
  CONSTRAINT fk_wallet_user_transfers_locked_station FOREIGN KEY (locked_station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_station_locks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  wallet_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  source_transfer_id BIGINT UNSIGNED NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'MWK',
  original_amount_mwk DECIMAL(18,2) NOT NULL,
  amount_mwk_remaining DECIMAL(18,2) NOT NULL,
  status ENUM('ACTIVE','DEPLETED','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  metadata_json LONGTEXT NULL,
  depleted_at TIMESTAMP(3) NULL,
  expired_at TIMESTAMP(3) NULL,
  cancelled_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_wallet_station_locks_wallet_station_status (wallet_id, station_id, status, created_at),
  KEY idx_wallet_station_locks_user_status (user_id, status, created_at),
  KEY idx_wallet_station_locks_source_transfer (source_transfer_id),
  CONSTRAINT fk_wallet_station_locks_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_wallet_station_locks_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_wallet_station_locks_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_wallet_station_locks_transfer FOREIGN KEY (source_transfer_id) REFERENCES wallet_user_transfers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  (NULL, 'USER_TRANSFER_CLEARING_MAIN', 'User wallet transfer clearing account', 'CLEARING', 'DEBIT', 'MWK', 'ACTIVE', 'USER_TRANSFER_CLEARING')
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  account_type = VALUES(account_type),
  normal_balance = VALUES(normal_balance),
  currency_code = VALUES(currency_code),
  status = VALUES(status),
  system_account_role = VALUES(system_account_role),
  updated_at = CURRENT_TIMESTAMP(3);
