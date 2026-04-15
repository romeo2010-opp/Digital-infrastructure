-- 027_internal_dashboard_expansion.sql
-- Additional internal command-center tables for refund review, dashboard alerts,
-- system health events, and commercial subscription visibility.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS refund_requests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  support_case_id BIGINT UNSIGNED NULL,
  transaction_public_id VARCHAR(64) NULL,
  amount_mwk DECIMAL(14,2) NOT NULL,
  priority ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('PENDING_SUPPORT_REVIEW','PENDING_FINANCE_APPROVAL','APPROVED','REJECTED','PAID') NOT NULL DEFAULT 'PENDING_SUPPORT_REVIEW',
  requested_by_user_id BIGINT UNSIGNED NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  reason VARCHAR(255) NOT NULL,
  resolution_notes TEXT NULL,
  reviewed_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_refund_requests_status_priority (status, priority, created_at),
  KEY idx_refund_requests_station (station_id, created_at),
  CONSTRAINT fk_refund_requests_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_refund_requests_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_refund_requests_support_case FOREIGN KEY (support_case_id) REFERENCES internal_support_cases(id),
  CONSTRAINT fk_refund_requests_requested_by FOREIGN KEY (requested_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_refund_requests_reviewed_by FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dashboard_alerts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  category VARCHAR(64) NOT NULL,
  severity ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status ENUM('OPEN','ACKNOWLEDGED','RESOLVED') NOT NULL DEFAULT 'OPEN',
  station_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  entity_type VARCHAR(64) NULL,
  entity_public_id VARCHAR(96) NULL,
  owner_role_code VARCHAR(64) NULL,
  title VARCHAR(160) NOT NULL,
  summary VARCHAR(255) NOT NULL,
  metadata LONGTEXT NULL,
  acknowledged_at TIMESTAMP(3) NULL,
  resolved_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_dashboard_alerts_status_severity (status, severity, created_at),
  KEY idx_dashboard_alerts_station (station_id, created_at),
  CONSTRAINT fk_dashboard_alerts_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_dashboard_alerts_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_health_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  service_key VARCHAR(96) NOT NULL,
  environment_key VARCHAR(48) NOT NULL DEFAULT 'production',
  severity ENUM('INFO','WARNING','HIGH','CRITICAL') NOT NULL DEFAULT 'INFO',
  status ENUM('OPEN','ACKNOWLEDGED','RESOLVED') NOT NULL DEFAULT 'OPEN',
  summary VARCHAR(255) NOT NULL,
  detail TEXT NULL,
  source_key VARCHAR(96) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  resolved_at TIMESTAMP(3) NULL,
  KEY idx_system_health_events_status (status, severity, created_at),
  KEY idx_system_health_events_service (service_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_subscription_statuses (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  plan_code VARCHAR(64) NOT NULL,
  plan_name VARCHAR(120) NOT NULL,
  status ENUM('ACTIVE','OVERDUE','GRACE','PAUSED','TRIAL') NOT NULL DEFAULT 'ACTIVE',
  monthly_fee_mwk DECIMAL(14,2) NOT NULL DEFAULT 0,
  renewal_date DATE NULL,
  last_payment_at TIMESTAMP(3) NULL,
  grace_expires_at TIMESTAMP(3) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_station_subscription_statuses_station (station_id),
  KEY idx_station_subscription_statuses_status (status, renewal_date),
  CONSTRAINT fk_station_subscription_statuses_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
