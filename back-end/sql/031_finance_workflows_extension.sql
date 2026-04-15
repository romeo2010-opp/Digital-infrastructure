-- 031_finance_workflows_extension.sql
-- Finance workflow support for reconciliation and wallet adjustment requests.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS finance_reconciliation_runs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  status ENUM('IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
  notes TEXT NULL,
  started_by_user_id BIGINT UNSIGNED NULL,
  completed_by_user_id BIGINT UNSIGNED NULL,
  started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at TIMESTAMP(3) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_finance_reconciliation_runs_status_started (status, started_at),
  CONSTRAINT fk_finance_reconciliation_runs_started_by FOREIGN KEY (started_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_finance_reconciliation_runs_completed_by FOREIGN KEY (completed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_reconciliation_exceptions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  run_id BIGINT UNSIGNED NOT NULL,
  exception_type VARCHAR(64) NOT NULL,
  severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN',
  summary VARCHAR(255) NOT NULL,
  detail TEXT NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_finance_reconciliation_exceptions_run_status (run_id, status),
  CONSTRAINT fk_finance_reconciliation_exceptions_run FOREIGN KEY (run_id) REFERENCES finance_reconciliation_runs(id),
  CONSTRAINT fk_finance_reconciliation_exceptions_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_adjustment_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NULL,
  amount_mwk DECIMAL(14,2) NOT NULL,
  direction ENUM('CREDIT','DEBIT') NOT NULL,
  status ENUM('PENDING','APPROVED') NOT NULL DEFAULT 'PENDING',
  reason VARCHAR(255) NOT NULL,
  note TEXT NULL,
  requested_by_user_id BIGINT UNSIGNED NULL,
  approved_by_user_id BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_wallet_adjustment_requests_status_created (status, created_at),
  KEY idx_wallet_adjustment_requests_station (station_id, created_at),
  CONSTRAINT fk_wallet_adjustment_requests_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_wallet_adjustment_requests_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_wallet_adjustment_requests_approved_by FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
