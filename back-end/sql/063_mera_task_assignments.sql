-- 063_mera_task_assignments.sql
-- MERA regulator task assignment workflow, audit activity, evidence, and in-app notifications.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS regulator_tasks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_number VARCHAR(32) NULL UNIQUE,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  type ENUM(
    'CASE_REVIEW',
    'COMPLAINT_REVIEW',
    'STATION_INSPECTION',
    'HOARDING_INVESTIGATION',
    'PRICE_VIOLATION_REVIEW',
    'QUEUE_DISORDER_REVIEW',
    'TELEMETRY_MISMATCH_REVIEW',
    'FIELD_VISIT',
    'MANUAL_TASK'
  ) NOT NULL,
  category VARCHAR(96) NULL,
  priority ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  status ENUM(
    'ASSIGNED',
    'ACKNOWLEDGED',
    'IN_PROGRESS',
    'NEEDS_MORE_INFO',
    'ESCALATED',
    'COMPLETED',
    'REJECTED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'ASSIGNED',
  district VARCHAR(80) NULL,
  station_id BIGINT UNSIGNED NULL,
  station_name VARCHAR(160) NULL,
  linked_entity_type VARCHAR(64) NULL,
  linked_entity_id VARCHAR(96) NULL,
  evidence_summary TEXT NULL,
  assigned_to_user_id BIGINT UNSIGNED NOT NULL,
  assigned_by_user_id BIGINT UNSIGNED NOT NULL,
  due_at TIMESTAMP(3) NULL,
  acknowledged_at TIMESTAMP(3) NULL,
  started_at TIMESTAMP(3) NULL,
  completed_at TIMESTAMP(3) NULL,
  cancelled_at TIMESTAMP(3) NULL,
  escalated_at TIMESTAMP(3) NULL,
  completion_notes TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at TIMESTAMP(3) NULL,
  KEY idx_regulator_tasks_assigned_to (assigned_to_user_id),
  KEY idx_regulator_tasks_assigned_by (assigned_by_user_id),
  KEY idx_regulator_tasks_status (status),
  KEY idx_regulator_tasks_priority (priority),
  KEY idx_regulator_tasks_due_at (due_at),
  KEY idx_regulator_tasks_linked_entity (linked_entity_type, linked_entity_id),
  KEY idx_regulator_tasks_station (station_id),
  KEY idx_regulator_tasks_district (district),
  KEY idx_regulator_tasks_created_at (created_at),
  CONSTRAINT fk_regulator_tasks_assigned_to FOREIGN KEY (assigned_to_user_id) REFERENCES mera_users(id),
  CONSTRAINT fk_regulator_tasks_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES mera_users(id),
  CONSTRAINT fk_regulator_tasks_station FOREIGN KEY (station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_task_notes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  visibility ENUM('INTERNAL','SUPERVISOR_ONLY') NOT NULL DEFAULT 'INTERNAL',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_regulator_task_notes_task_time (task_id, created_at),
  KEY idx_regulator_task_notes_author (author_user_id),
  CONSTRAINT fk_regulator_task_notes_task FOREIGN KEY (task_id) REFERENCES regulator_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_regulator_task_notes_author FOREIGN KEY (author_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_task_activity_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(96) NOT NULL,
  old_value VARCHAR(255) NULL,
  new_value VARCHAR(255) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_regulator_task_activity_task_time (task_id, created_at),
  KEY idx_regulator_task_activity_actor (actor_user_id),
  KEY idx_regulator_task_activity_action_time (action, created_at),
  CONSTRAINT fk_regulator_task_activity_task FOREIGN KEY (task_id) REFERENCES regulator_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_regulator_task_activity_actor FOREIGN KEY (actor_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_task_evidence (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  evidence_type VARCHAR(64) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  file_url VARCHAR(1000) NULL,
  linked_existing_evidence_id VARCHAR(96) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_regulator_task_evidence_task_time (task_id, created_at),
  KEY idx_regulator_task_evidence_uploader (uploaded_by_user_id),
  CONSTRAINT fk_regulator_task_evidence_task FOREIGN KEY (task_id) REFERENCES regulator_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_regulator_task_evidence_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regulator_task_watchers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_regulator_task_watchers_task_user (task_id, user_id),
  KEY idx_regulator_task_watchers_user (user_id),
  CONSTRAINT fk_regulator_task_watchers_task FOREIGN KEY (task_id) REFERENCES regulator_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_regulator_task_watchers_user FOREIGN KEY (user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_notifications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM(
    'TASK_ASSIGNED',
    'TASK_REASSIGNED',
    'TASK_DUE_SOON',
    'TASK_OVERDUE',
    'TASK_STATUS_CHANGED',
    'TASK_ESCALATED',
    'TASK_COMPLETED'
  ) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  linked_entity_type VARCHAR(64) NULL,
  linked_entity_id VARCHAR(96) NULL,
  read_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_mera_notifications_user_read_time (user_id, read_at, created_at),
  KEY idx_mera_notifications_type_time (type, created_at),
  KEY idx_mera_notifications_linked_entity (linked_entity_type, linked_entity_id),
  CONSTRAINT fk_mera_notifications_user FOREIGN KEY (user_id) REFERENCES mera_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO mera_permissions (code, description) VALUES
  ('TASKS_VIEW_ASSIGNED', 'View MERA tasks assigned to the current officer'),
  ('TASKS_VIEW_ALL', 'View all MERA regulator tasks'),
  ('TASKS_VIEW_EXECUTIVE', 'View executive MERA task summaries'),
  ('TASKS_CREATE', 'Create MERA regulator tasks'),
  ('TASKS_ASSIGN', 'Assign or reassign MERA regulator tasks'),
  ('TASKS_MANAGE', 'Manage priority, due dates, cancellation, and reopening for MERA tasks'),
  ('TASKS_WORK', 'Acknowledge, start, note, escalate, and complete assigned MERA tasks'),
  ('TASKS_ADD_EVIDENCE', 'Attach evidence to MERA regulator tasks'),
  ('TASKS_STATS_VIEW', 'View MERA task operations statistics')
ON DUPLICATE KEY UPDATE
  description = VALUES(description);

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'TASKS_VIEW_ASSIGNED',
  'TASKS_VIEW_ALL',
  'TASKS_CREATE',
  'TASKS_ASSIGN',
  'TASKS_MANAGE',
  'TASKS_WORK',
  'TASKS_ADD_EVIDENCE',
  'TASKS_STATS_VIEW'
)
WHERE roles.code IN ('SUPER_ADMIN', 'REGIONAL_COMPLIANCE_SUPERVISOR');

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'TASKS_VIEW_ASSIGNED',
  'TASKS_WORK',
  'TASKS_ADD_EVIDENCE'
)
WHERE roles.code IN (
  'FIELD_COMPLIANCE_OFFICER',
  'PUBLIC_COMPLAINTS_ANALYST',
  'LEGAL_ENFORCEMENT_OFFICER',
  'LICENSING_OFFICER',
  'MARKET_SUPPLY_ANALYST',
  'NATIONAL_OPERATIONS_ANALYST'
);

INSERT IGNORE INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'TASKS_VIEW_EXECUTIVE',
  'TASKS_STATS_VIEW'
)
WHERE roles.code = 'EXECUTIVE_VIEWER';
