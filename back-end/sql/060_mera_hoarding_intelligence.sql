-- 060_mera_hoarding_intelligence.sql
-- Dedicated hoarding intelligence tables and compliance flag extension for MERA.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

ALTER TABLE compliance_flags
  MODIFY flag_type ENUM(
    'COMPLAINT_SURGE',
    'REFUSAL_MISMATCH',
    'REPEATED_INSPECTION_FAILURE',
    'PROLONGED_DRY_STATUS',
    'MANUAL_REVIEW',
    'PRICE_ANOMALY',
    'LICENSE_RISK',
    'POSSIBLE_HOARDING'
  ) NOT NULL;

CREATE TABLE IF NOT EXISTS fuel_delivery_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  delivery_time TIMESTAMP(3) NOT NULL,
  fuel_type VARCHAR(32) NOT NULL,
  estimated_volume DECIMAL(12,2) NULL,
  source_type VARCHAR(64) NOT NULL,
  reported_by VARCHAR(120) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_fuel_delivery_logs_station_time (station_id, delivery_time),
  KEY idx_fuel_delivery_logs_fuel_time (fuel_type, delivery_time),
  CONSTRAINT fk_fuel_delivery_logs_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS station_availability_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  petrol_available TINYINT(1) NOT NULL DEFAULT 0,
  diesel_available TINYINT(1) NOT NULL DEFAULT 0,
  active_pumps INT UNSIGNED NULL,
  reported_by VARCHAR(120) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_station_availability_reports_station_time (station_id, created_at),
  CONSTRAINT fk_station_availability_reports_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hoarding_risk_scores (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  risk_score INT UNSIGNED NOT NULL DEFAULT 0,
  generated_factors_json JSON NULL,
  escalation_status ENUM('LOW','MODERATE','HIGH','CRITICAL') NOT NULL DEFAULT 'LOW',
  last_calculated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_hoarding_risk_station (station_id),
  KEY idx_hoarding_risk_status_score (escalation_status, risk_score),
  CONSTRAINT fk_hoarding_risk_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
