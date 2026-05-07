SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

ALTER TABLE mera_roles
  CHANGE COLUMN role_name code VARCHAR(64) NOT NULL,
  CHANGE COLUMN role_description description VARCHAR(255) NOT NULL,
  ADD COLUMN display_name VARCHAR(120) NULL AFTER code;

ALTER TABLE mera_users
  CHANGE COLUMN district district_scope VARCHAR(80) NULL,
  ADD COLUMN region_scope VARCHAR(80) NULL AFTER district_scope,
  ADD COLUMN last_login_at TIMESTAMP(3) NULL AFTER account_status;

CREATE TABLE IF NOT EXISTS mera_permissions (
  id SMALLINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(96) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mera_role_permissions (
  role_id TINYINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_mera_role_permissions_role FOREIGN KEY (role_id) REFERENCES mera_roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_mera_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES mera_permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE audit_logs_mera
  ADD COLUMN actor_name VARCHAR(120) NULL AFTER actor_id,
  ADD COLUMN permission_code VARCHAR(96) NULL AFTER actor_role,
  ADD COLUMN affected_entity VARCHAR(255) NULL AFTER action_description,
  ADD COLUMN ip_address VARCHAR(64) NULL AFTER affected_entity,
  ADD COLUMN device_info VARCHAR(255) NULL AFTER ip_address;

INSERT INTO mera_roles (id, code, display_name, description) VALUES
  (1, 'SUPER_ADMIN', 'Super Admin / Director', 'Highest system authority.'),
  (2, 'NATIONAL_OPERATIONS_ANALYST', 'National Operations Analyst', 'National petroleum intelligence monitoring.'),
  (3, 'REGIONAL_COMPLIANCE_SUPERVISOR', 'Regional Compliance Supervisor', 'District and regional compliance command.'),
  (4, 'FIELD_COMPLIANCE_OFFICER', 'Field Compliance Officer', 'On-ground inspection and evidence collection.'),
  (5, 'PUBLIC_COMPLAINTS_ANALYST', 'Public Complaints Analyst', 'Complaint triage and public report verification.'),
  (6, 'LEGAL_ENFORCEMENT_OFFICER', 'Legal & Enforcement Officer', 'Formal regulatory action management.'),
  (7, 'LICENSING_OFFICER', 'Licensing Officer', 'Station license and compliance-condition management.'),
  (8, 'MARKET_SUPPLY_ANALYST', 'Market / Fuel Supply Analyst', 'Fuel availability, delivery, price, and hoarding risk analysis.'),
  (9, 'EXECUTIVE_VIEWER', 'Executive Viewer', 'Senior read-only oversight.')
ON DUPLICATE KEY UPDATE
  code = VALUES(code),
  display_name = VALUES(display_name),
  description = VALUES(description);

INSERT INTO mera_permissions (code, description) VALUES
  ('DASHBOARD_VIEW_NATIONAL', 'View the national MERA dashboard'),
  ('DASHBOARD_VIEW_DISTRICT', 'View district scoped dashboard data'),
  ('HEATMAP_VIEW', 'View the national heat intelligence map'),
  ('HEATMAP_EXPORT', 'Export heatmap data and packages'),
  ('REPORTS_VIEW', 'View generated intelligence reports'),
  ('REPORTS_EXPORT', 'Export approved reports'),
  ('REPORTS_GENERATE', 'Generate intelligence reports'),
  ('USERS_VIEW', 'View MERA user administration'),
  ('USERS_CREATE', 'Create MERA users'),
  ('USERS_UPDATE', 'Update MERA user profiles or assignments'),
  ('USERS_DISABLE', 'Disable or suspend MERA user accounts'),
  ('ROLES_MANAGE', 'Manage MERA roles and permissions'),
  ('COMPLAINTS_VIEW', 'View complaint records'),
  ('COMPLAINTS_TRIAGE', 'Triage and review complaints'),
  ('COMPLAINTS_ASSIGN', 'Assign complaints to officers'),
  ('COMPLAINTS_ESCALATE', 'Escalate complaint cases'),
  ('COMPLAINTS_CLOSE', 'Close or reject complaint cases'),
  ('INSPECTIONS_VIEW', 'View inspection records'),
  ('INSPECTIONS_ASSIGN', 'Assign inspections to officers'),
  ('INSPECTIONS_CREATE', 'Create inspection reports'),
  ('INSPECTIONS_REVIEW', 'Review submitted inspections'),
  ('EVIDENCE_UPLOAD', 'Upload inspection evidence'),
  ('FLAGS_VIEW', 'View compliance flags'),
  ('FLAGS_CREATE', 'Create compliance flags'),
  ('FLAGS_ASSIGN', 'Assign compliance flags'),
  ('FLAGS_RESOLVE', 'Resolve compliance flags'),
  ('FLAGS_ESCALATE', 'Escalate compliance flags'),
  ('ENFORCEMENT_VIEW', 'View enforcement actions'),
  ('ENFORCEMENT_CREATE_WARNING', 'Create warning enforcement actions'),
  ('ENFORCEMENT_CREATE_FINE', 'Create fine enforcement actions'),
  ('ENFORCEMENT_CREATE_SUSPENSION', 'Create suspension enforcement actions'),
  ('ENFORCEMENT_UPDATE_STATUS', 'Update enforcement status or deadlines'),
  ('ENFORCEMENT_APPROVE', 'Approve enforcement actions'),
  ('LICENSES_VIEW', 'View licensing records'),
  ('LICENSES_CREATE', 'Create station licenses'),
  ('LICENSES_UPDATE', 'Update station licenses'),
  ('LICENSES_EXPIRE_REVIEW', 'Review license expiry alerts'),
  ('DELIVERIES_VIEW', 'View fuel delivery logs'),
  ('DELIVERIES_CREATE', 'Create fuel delivery logs'),
  ('DELIVERIES_VERIFY', 'Verify fuel deliveries'),
  ('AVAILABILITY_VIEW', 'View availability audit records'),
  ('AVAILABILITY_AUDIT', 'Audit availability declarations'),
  ('AVAILABILITY_LOG', 'Log availability observations'),
  ('STATIONS_VIEW', 'View station regulatory profiles'),
  ('STATIONS_VIEW_DISTRICT', 'View district scoped station profiles'),
  ('STATIONS_UPDATE_REGULATORY_PROFILE', 'Update station regulatory profiles'),
  ('AUDIT_VIEW', 'View audit trail')
ON DUPLICATE KEY UPDATE
  description = VALUES(description);

DELETE FROM mera_role_permissions;

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_NATIONAL','DASHBOARD_VIEW_DISTRICT','HEATMAP_VIEW','HEATMAP_EXPORT','REPORTS_VIEW','REPORTS_EXPORT',
  'REPORTS_GENERATE','USERS_VIEW','USERS_CREATE','USERS_UPDATE','USERS_DISABLE','ROLES_MANAGE','COMPLAINTS_VIEW',
  'COMPLAINTS_TRIAGE','COMPLAINTS_ASSIGN','COMPLAINTS_ESCALATE','COMPLAINTS_CLOSE','INSPECTIONS_VIEW',
  'INSPECTIONS_ASSIGN','INSPECTIONS_CREATE','INSPECTIONS_REVIEW','EVIDENCE_UPLOAD','FLAGS_VIEW','FLAGS_CREATE',
  'FLAGS_ASSIGN','FLAGS_RESOLVE','FLAGS_ESCALATE','ENFORCEMENT_VIEW','ENFORCEMENT_CREATE_WARNING',
  'ENFORCEMENT_CREATE_FINE','ENFORCEMENT_CREATE_SUSPENSION','ENFORCEMENT_UPDATE_STATUS','ENFORCEMENT_APPROVE',
  'LICENSES_VIEW','LICENSES_CREATE','LICENSES_UPDATE','LICENSES_EXPIRE_REVIEW','DELIVERIES_VIEW','DELIVERIES_CREATE',
  'DELIVERIES_VERIFY','AVAILABILITY_VIEW','AVAILABILITY_AUDIT','AVAILABILITY_LOG','STATIONS_VIEW',
  'STATIONS_VIEW_DISTRICT','STATIONS_UPDATE_REGULATORY_PROFILE','AUDIT_VIEW'
)
WHERE roles.code = 'SUPER_ADMIN';

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_NATIONAL','HEATMAP_VIEW','HEATMAP_EXPORT','REPORTS_VIEW','REPORTS_EXPORT',
  'STATIONS_VIEW','COMPLAINTS_VIEW','FLAGS_VIEW','INSPECTIONS_VIEW','ENFORCEMENT_VIEW'
)
WHERE roles.code = 'NATIONAL_OPERATIONS_ANALYST';

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_DISTRICT','HEATMAP_VIEW','COMPLAINTS_VIEW','COMPLAINTS_ASSIGN','COMPLAINTS_ESCALATE',
  'INSPECTIONS_VIEW','INSPECTIONS_ASSIGN','INSPECTIONS_REVIEW','FLAGS_VIEW','FLAGS_ESCALATE','STATIONS_VIEW_DISTRICT'
)
WHERE roles.code = 'REGIONAL_COMPLIANCE_SUPERVISOR';

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_DISTRICT','INSPECTIONS_VIEW','INSPECTIONS_CREATE','EVIDENCE_UPLOAD','AVAILABILITY_LOG','STATIONS_VIEW_DISTRICT'
)
WHERE roles.code = 'FIELD_COMPLIANCE_OFFICER';

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_DISTRICT','COMPLAINTS_VIEW','COMPLAINTS_TRIAGE','COMPLAINTS_ASSIGN','COMPLAINTS_ESCALATE','STATIONS_VIEW_DISTRICT'
)
WHERE roles.code = 'PUBLIC_COMPLAINTS_ANALYST';

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_NATIONAL','FLAGS_VIEW','FLAGS_RESOLVE','ENFORCEMENT_VIEW','ENFORCEMENT_CREATE_WARNING','ENFORCEMENT_CREATE_FINE',
  'ENFORCEMENT_CREATE_SUSPENSION','ENFORCEMENT_UPDATE_STATUS','STATIONS_VIEW','REPORTS_VIEW'
)
WHERE roles.code = 'LEGAL_ENFORCEMENT_OFFICER';

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_NATIONAL','LICENSES_VIEW','LICENSES_CREATE','LICENSES_UPDATE','LICENSES_EXPIRE_REVIEW','STATIONS_VIEW'
)
WHERE roles.code = 'LICENSING_OFFICER';

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_NATIONAL','HEATMAP_VIEW','DELIVERIES_VIEW','DELIVERIES_CREATE','DELIVERIES_VERIFY','AVAILABILITY_VIEW',
  'AVAILABILITY_AUDIT','REPORTS_VIEW','REPORTS_GENERATE','FLAGS_VIEW'
)
WHERE roles.code = 'MARKET_SUPPLY_ANALYST';

INSERT INTO mera_role_permissions (role_id, permission_id)
SELECT roles.id, perms.id
FROM mera_roles roles
INNER JOIN mera_permissions perms ON perms.code IN (
  'DASHBOARD_VIEW_NATIONAL','HEATMAP_VIEW','REPORTS_VIEW','REPORTS_EXPORT','STATIONS_VIEW'
)
WHERE roles.code = 'EXECUTIVE_VIEWER';
