-- 067_mera_command_centre.sql
-- MERA regulator command-centre persistence, RBAC aliases, and workflow extensions.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS mera_risk_scores (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  station_id BIGINT UNSIGNED NOT NULL,
  risk_score INT UNSIGNED NOT NULL DEFAULT 0,
  risk_level VARCHAR(32) NOT NULL DEFAULT 'Normal',
  main_reasons_json JSON NULL,
  evidence_json JSON NULL,
  recommended_action VARCHAR(96) NULL,
  generated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mera_risk_scores_station (station_id),
  KEY idx_mera_risk_scores_level_score (risk_level, risk_score),
  CONSTRAINT fk_mera_risk_scores_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_alerts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  source_key VARCHAR(160) NULL UNIQUE,
  type VARCHAR(64) NOT NULL,
  severity ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  station_id BIGINT UNSIGNED NULL,
  title VARCHAR(220) NOT NULL,
  description TEXT NULL,
  evidence_json JSON NULL,
  recommended_action VARCHAR(96) NULL,
  status ENUM('new','acknowledged','converted_to_case','dismissed') NOT NULL DEFAULT 'new',
  acknowledged_by BIGINT UNSIGNED NULL,
  acknowledged_at TIMESTAMP(3) NULL,
  dismissed_by BIGINT UNSIGNED NULL,
  dismissed_reason TEXT NULL,
  dismissed_at TIMESTAMP(3) NULL,
  linked_case_id VARCHAR(96) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_alerts_status_severity (status, severity, created_at),
  KEY idx_mera_alerts_station (station_id, created_at),
  CONSTRAINT fk_mera_alerts_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_mera_alerts_ack_user FOREIGN KEY (acknowledged_by) REFERENCES mera_users(id),
  CONSTRAINT fk_mera_alerts_dismiss_user FOREIGN KEY (dismissed_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_cases (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(96) NOT NULL UNIQUE,
  title VARCHAR(220) NOT NULL,
  type VARCHAR(96) NOT NULL,
  station_id BIGINT UNSIGNED NULL,
  district VARCHAR(80) NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'medium',
  assigned_officer_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  source_alert_id VARCHAR(160) NULL,
  evidence_json JSON NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'New',
  due_date TIMESTAMP(3) NULL,
  final_outcome TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_cases_station_status (station_id, status, created_at),
  KEY idx_mera_cases_district_status (district, status),
  KEY idx_mera_cases_assigned (assigned_officer_id, status),
  CONSTRAINT fk_mera_cases_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_mera_cases_assigned FOREIGN KEY (assigned_officer_id) REFERENCES mera_users(id),
  CONSTRAINT fk_mera_cases_created_by FOREIGN KEY (created_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_case_notes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  case_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NULL,
  note TEXT NOT NULL,
  visibility VARCHAR(32) NOT NULL DEFAULT 'internal',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_case_notes_case_time (case_id, created_at),
  CONSTRAINT fk_mera_case_notes_case FOREIGN KEY (case_id) REFERENCES mera_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_mera_case_notes_author FOREIGN KEY (author_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_case_evidence (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  case_id BIGINT UNSIGNED NOT NULL,
  evidence_type VARCHAR(64) NOT NULL DEFAULT 'document',
  title VARCHAR(220) NOT NULL,
  description TEXT NULL,
  file_url VARCHAR(1000) NULL,
  metadata_json JSON NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_mera_case_evidence_case_time (case_id, created_at),
  CONSTRAINT fk_mera_case_evidence_case FOREIGN KEY (case_id) REFERENCES mera_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_mera_case_evidence_created_by FOREIGN KEY (created_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_case_timeline (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  case_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(96) NOT NULL,
  event_title VARCHAR(220) NOT NULL,
  event_description TEXT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_mera_case_timeline_case_time (case_id, created_at),
  CONSTRAINT fk_mera_case_timeline_case FOREIGN KEY (case_id) REFERENCES mera_cases(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_complaint_clusters (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  station_id BIGINT UNSIGNED NULL,
  district VARCHAR(80) NULL,
  category VARCHAR(96) NULL,
  fuel_type VARCHAR(32) NULL,
  keyword_json JSON NULL,
  complaint_ids_json JSON NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'medium',
  first_seen_at TIMESTAMP(3) NULL,
  last_seen_at TIMESTAMP(3) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  linked_case_id VARCHAR(96) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_complaint_clusters_station (station_id, status),
  CONSTRAINT fk_mera_complaint_clusters_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_official_prices (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  fuel_type VARCHAR(32) NOT NULL,
  price_per_litre DECIMAL(12,2) NOT NULL,
  effective_date DATE NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_official_prices_fuel_date (fuel_type, effective_date),
  CONSTRAINT fk_mera_official_prices_user FOREIGN KEY (created_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_notices (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(220) NOT NULL,
  message TEXT NOT NULL,
  category VARCHAR(96) NOT NULL,
  target_region VARCHAR(80) NULL,
  target_district VARCHAR(80) NULL,
  fuel_type VARCHAR(32) NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'medium',
  status ENUM('draft','pending_approval','approved','scheduled','published','rejected') NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  scheduled_at TIMESTAMP(3) NULL,
  approved_at TIMESTAMP(3) NULL,
  published_at TIMESTAMP(3) NULL,
  selected_channels_json JSON NULL,
  external_post_status_json JSON NULL,
  external_post_id VARCHAR(160) NULL,
  external_error TEXT NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_public_notices_status_category (status, category),
  KEY idx_public_notices_target (target_region, target_district),
  CONSTRAINT fk_public_notices_created_by FOREIGN KEY (created_by) REFERENCES mera_users(id),
  CONSTRAINT fk_public_notices_approved_by FOREIGN KEY (approved_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_notice_approvals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_notice_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_public_notice_approvals_notice (public_notice_id, created_at),
  CONSTRAINT fk_public_notice_approvals_notice FOREIGN KEY (public_notice_id) REFERENCES public_notices(id) ON DELETE CASCADE,
  CONSTRAINT fk_public_notice_approvals_actor FOREIGN KEY (actor_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS external_social_posts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_notice_id BIGINT UNSIGNED NOT NULL,
  channel VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'not_configured',
  external_post_id VARCHAR(160) NULL,
  external_error TEXT NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_external_social_posts_notice (public_notice_id, channel),
  CONSTRAINT fk_external_social_posts_notice FOREIGN KEY (public_notice_id) REFERENCES public_notices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(96) NOT NULL UNIQUE,
  report_type VARCHAR(120) NOT NULL,
  title VARCHAR(220) NOT NULL,
  filters_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  generated_by BIGINT UNSIGNED NULL,
  file_url VARCHAR(1000) NULL,
  download_format VARCHAR(32) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_reports_type_time (report_type, created_at),
  CONSTRAINT fk_mera_reports_generated_by FOREIGN KEY (generated_by) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_saved_views (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id VARCHAR(64) NOT NULL UNIQUE,
  owner_user_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  scope_type VARCHAR(32) NOT NULL DEFAULT 'National',
  config_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_mera_saved_views_owner (owner_user_id),
  CONSTRAINT fk_mera_saved_views_owner FOREIGN KEY (owner_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE public_complaints ADD COLUMN linked_case_id VARCHAR(96) NULL AFTER assigned_officer_id',
    'SELECT 1'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'public_complaints' AND COLUMN_NAME = 'linked_case_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE public_complaints
  MODIFY complaint_type ENUM(
    'HOARDING',
    'ILLEGAL_VENDING',
    'OVERPRICING',
    'REFUSAL_TO_SELL',
    'SUSPICIOUS_QUEUE_MANIPULATION',
    'STATION_SAYS_NO_FUEL',
    'LONG_QUEUE',
    'SUSPECTED_HOARDING',
    'PRICE_ISSUE',
    'ATTENDANT_CORRUPTION',
    'FAVOURITISM',
    'ILLEGAL_SELLING',
    'PAYMENT_DISPUTE',
    'QUEUE_MANIPULATION',
    'UNSAFE_CROWDING',
    'FALSE_AVAILABILITY',
    'OTHER'
  ) NOT NULL;

SET @sql := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN public_id VARCHAR(64) NULL AFTER id', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'public_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE fuel_delivery_logs
SET public_id = CONCAT('FDL-', LPAD(id, 22, '0'))
WHERE public_id IS NULL OR public_id = '';

SET @sql := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD UNIQUE KEY uq_fuel_delivery_logs_public_id (public_id)', 'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND INDEX_NAME = 'uq_fuel_delivery_logs_public_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs MODIFY public_id VARCHAR(64) NOT NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'public_id' AND IS_NULLABLE = 'YES'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN source_depot VARCHAR(120) NULL AFTER station_id', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'source_depot');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN omc VARCHAR(120) NULL AFTER source_depot', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'omc');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN tanker_plate VARCHAR(64) NULL AFTER omc', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'tanker_plate');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN driver_name VARCHAR(120) NULL AFTER tanker_plate', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'driver_name');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN litres_loaded DECIMAL(14,2) NULL AFTER fuel_type', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'litres_loaded');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN expected_arrival TIMESTAMP(3) NULL AFTER litres_loaded', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'expected_arrival');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN actual_arrival TIMESTAMP(3) NULL AFTER expected_arrival', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'actual_arrival');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN offloaded_quantity DECIMAL(14,2) NULL AFTER actual_arrival', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'offloaded_quantity');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN station_confirmation_status VARCHAR(64) NULL AFTER offloaded_quantity', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'station_confirmation_status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN first_sale_after_delivery_at TIMESTAMP(3) NULL AFTER station_confirmation_status', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'first_sale_after_delivery_at');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN sales_velocity_after_delivery DECIMAL(14,2) NULL AFTER first_sale_after_delivery_at', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'sales_velocity_after_delivery');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN discrepancy_litres DECIMAL(14,2) NULL AFTER sales_velocity_after_delivery', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'discrepancy_litres');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE fuel_delivery_logs ADD COLUMN status VARCHAR(64) NOT NULL DEFAULT ''pending_review'' AFTER discrepancy_litres', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fuel_delivery_logs' AND COLUMN_NAME = 'status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN reason TEXT NULL AFTER inspection_type', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'reason');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN priority VARCHAR(32) NOT NULL DEFAULT ''medium'' AFTER reason', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'priority');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN scheduled_at TIMESTAMP(3) NULL AFTER priority', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'scheduled_at');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT ''scheduled'' AFTER scheduled_at', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN checklist_json JSON NULL AFTER status', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'checklist_json');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN findings_json JSON NULL AFTER checklist_json', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'findings_json');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN result TEXT NULL AFTER findings_json', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'result');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN linked_case_id VARCHAR(96) NULL AFTER result', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'linked_case_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE inspections ADD COLUMN completed_at TIMESTAMP(3) NULL AFTER linked_case_id', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inspections' AND COLUMN_NAME = 'completed_at');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE audit_logs_mera ADD COLUMN entity_type VARCHAR(64) NULL AFTER affected_entity', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs_mera' AND COLUMN_NAME = 'entity_type');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE audit_logs_mera ADD COLUMN entity_id VARCHAR(96) NULL AFTER entity_type', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs_mera' AND COLUMN_NAME = 'entity_id');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE audit_logs_mera ADD COLUMN before_json JSON NULL AFTER entity_id', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs_mera' AND COLUMN_NAME = 'before_json');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE audit_logs_mera ADD COLUMN after_json JSON NULL AFTER before_json', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs_mera' AND COLUMN_NAME = 'after_json');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := (SELECT IF(COUNT(*) = 0, 'ALTER TABLE audit_logs_mera ADD COLUMN user_agent VARCHAR(255) NULL AFTER after_json', 'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs_mera' AND COLUMN_NAME = 'user_agent');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO mera_roles (id, code, display_name, description) VALUES
  (10, 'MERA_ADMIN', 'MERA Admin', 'National command-centre administrator with full MERA oversight.'),
  (11, 'MERA_SUPERVISOR', 'MERA Supervisor', 'Supervisor authority for approvals, case escalation, and inspection assignment.'),
  (12, 'MERA_ANALYST', 'MERA Analyst', 'Risk, complaints, analytics, cases, and report intelligence analyst.'),
  (13, 'MERA_INSPECTOR', 'MERA Inspector', 'Assigned field inspection and station verification officer.'),
  (14, 'MERA_PUBLIC_COMMUNICATIONS', 'MERA Public Communications', 'Public notice and approved briefing workflow.'),
  (15, 'MERA_VIEWER', 'MERA Viewer', 'Read-only regulatory command-centre access.')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description);

INSERT INTO mera_permissions (code, description) VALUES
  ('VIEW_COMMAND_CENTRE', 'View MERA command centre'),
  ('VIEW_MAP', 'View MERA live map'),
  ('VIEW_STATION_PROFILE', 'View station investigation profile'),
  ('MANAGE_CASES', 'Manage MERA regulatory cases'),
  ('ASSIGN_INSPECTIONS', 'Assign MERA inspections'),
  ('COMPLETE_INSPECTIONS', 'Complete MERA inspections'),
  ('MANAGE_PRICE_COMPLIANCE', 'Manage MERA price compliance'),
  ('GENERATE_REPORTS', 'Generate MERA reports'),
  ('CREATE_PUBLIC_NOTICE', 'Create public notices'),
  ('APPROVE_PUBLIC_NOTICE', 'Approve public notices'),
  ('PUBLISH_PUBLIC_NOTICE', 'Publish public notices'),
  ('MANAGE_USERS', 'Manage MERA users and roles'),
  ('VIEW_AUDIT_LOGS', 'View MERA audit logs'),
  ('ALERTS_VIEW', 'View MERA intelligence alerts'),
  ('ALERTS_MANAGE', 'Manage MERA intelligence alerts'),
  ('RISK_VIEW', 'View MERA risk engine'),
  ('RISK_RECALCULATE', 'Recalculate MERA risk scores'),
  ('PUBLIC_NOTICES_VIEW', 'View MERA public notices'),
  ('ANALYTICS_VIEW', 'View MERA analytics')
ON DUPLICATE KEY UPDATE
  description = VALUES(description);

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'VIEW_COMMAND_CENTRE','VIEW_MAP','VIEW_STATION_PROFILE','MANAGE_CASES','ASSIGN_INSPECTIONS','COMPLETE_INSPECTIONS',
  'MANAGE_PRICE_COMPLIANCE','GENERATE_REPORTS','CREATE_PUBLIC_NOTICE','APPROVE_PUBLIC_NOTICE','PUBLISH_PUBLIC_NOTICE',
  'MANAGE_USERS','VIEW_AUDIT_LOGS','ALERTS_VIEW','ALERTS_MANAGE','RISK_VIEW','RISK_RECALCULATE','PUBLIC_NOTICES_VIEW','ANALYTICS_VIEW',
  'DASHBOARD_VIEW_NATIONAL','DASHBOARD_VIEW_DISTRICT','HEATMAP_VIEW','REPORTS_VIEW','REPORTS_GENERATE','REPORTS_EXPORT',
  'USERS_VIEW','USERS_CREATE','USERS_UPDATE','ROLES_MANAGE','COMPLAINTS_VIEW','COMPLAINTS_TRIAGE','COMPLAINTS_ASSIGN',
  'COMPLAINTS_ESCALATE','COMPLAINTS_CLOSE','INSPECTIONS_VIEW','INSPECTIONS_ASSIGN','INSPECTIONS_CREATE','INSPECTIONS_REVIEW',
  'EVIDENCE_UPLOAD','FLAGS_VIEW','FLAGS_CREATE','FLAGS_ASSIGN','FLAGS_RESOLVE','FLAGS_ESCALATE','ENFORCEMENT_VIEW',
  'ENFORCEMENT_CREATE_WARNING','ENFORCEMENT_UPDATE_STATUS','DELIVERIES_VIEW','DELIVERIES_CREATE','DELIVERIES_VERIFY',
  'AVAILABILITY_VIEW','AVAILABILITY_AUDIT','STATIONS_VIEW','STATIONS_VIEW_DISTRICT','AUDIT_VIEW'
)
WHERE roles.code IN ('SUPER_ADMIN','MERA_ADMIN');

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'VIEW_COMMAND_CENTRE','VIEW_MAP','VIEW_STATION_PROFILE','MANAGE_CASES','ASSIGN_INSPECTIONS','COMPLETE_INSPECTIONS',
  'APPROVE_PUBLIC_NOTICE','PUBLISH_PUBLIC_NOTICE','VIEW_AUDIT_LOGS','ALERTS_VIEW','ALERTS_MANAGE','RISK_VIEW','RISK_RECALCULATE',
  'ANALYTICS_VIEW','DASHBOARD_VIEW_NATIONAL','HEATMAP_VIEW','REPORTS_VIEW','COMPLAINTS_VIEW','INSPECTIONS_VIEW','FLAGS_VIEW',
  'ENFORCEMENT_VIEW','DELIVERIES_VIEW','STATIONS_VIEW','AUDIT_VIEW'
)
WHERE roles.code IN ('MERA_SUPERVISOR','REGIONAL_COMPLIANCE_SUPERVISOR');

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'VIEW_COMMAND_CENTRE','VIEW_MAP','VIEW_STATION_PROFILE','MANAGE_CASES','MANAGE_PRICE_COMPLIANCE','GENERATE_REPORTS',
  'ALERTS_VIEW','ALERTS_MANAGE','RISK_VIEW','RISK_RECALCULATE','ANALYTICS_VIEW','DASHBOARD_VIEW_NATIONAL','HEATMAP_VIEW',
  'REPORTS_VIEW','REPORTS_GENERATE','COMPLAINTS_VIEW','INSPECTIONS_VIEW','FLAGS_VIEW','DELIVERIES_VIEW','STATIONS_VIEW'
)
WHERE roles.code IN ('MERA_ANALYST','NATIONAL_OPERATIONS_ANALYST','MARKET_SUPPLY_ANALYST');

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'VIEW_MAP','VIEW_STATION_PROFILE','COMPLETE_INSPECTIONS','DASHBOARD_VIEW_DISTRICT','HEATMAP_VIEW','INSPECTIONS_VIEW',
  'INSPECTIONS_CREATE','EVIDENCE_UPLOAD','AVAILABILITY_LOG','STATIONS_VIEW_DISTRICT'
)
WHERE roles.code IN ('MERA_INSPECTOR','FIELD_COMPLIANCE_OFFICER');

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'VIEW_COMMAND_CENTRE','PUBLIC_NOTICES_VIEW','CREATE_PUBLIC_NOTICE','PUBLISH_PUBLIC_NOTICE','DASHBOARD_VIEW_NATIONAL','REPORTS_VIEW'
)
WHERE roles.code = 'MERA_PUBLIC_COMMUNICATIONS';

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'VIEW_COMMAND_CENTRE','VIEW_MAP','VIEW_STATION_PROFILE','PUBLIC_NOTICES_VIEW','ANALYTICS_VIEW','DASHBOARD_VIEW_NATIONAL',
  'HEATMAP_VIEW','REPORTS_VIEW','STATIONS_VIEW'
)
WHERE roles.code IN ('MERA_VIEWER','EXECUTIVE_VIEWER');
