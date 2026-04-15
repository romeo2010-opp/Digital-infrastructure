-- 026_seed_internal_demo.sql
-- Dev/demo seed for SmartLink internal dashboard.
-- Demo password for all internal users: SmartLink!2026

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @internal_password_hash := '$2a$10$vZz8mbU5d/a1MeNjLgawcuKLrunqioVn5Nw.eUhHImsgK0tNmqTS6';

INSERT INTO internal_roles (id, code, name, department, rank_order, is_active) VALUES
(1, 'PLATFORM_OWNER', 'Platform Owner', 'Executive', 1, 1),
(2, 'NETWORK_OPERATIONS_MANAGER', 'Network Operations Manager', 'Operations', 2, 1),
(3, 'STATION_ONBOARDING_MANAGER', 'Station Onboarding Manager', 'Onboarding', 3, 1),
(4, 'FIELD_AGENT', 'Field Agent', 'Onboarding', 4, 1),
(5, 'CUSTOMER_SUPPORT_AGENT', 'Customer Support Agent', 'Support', 5, 1),
(6, 'FINANCE_MANAGER', 'Finance Manager', 'Finance', 6, 1),
(7, 'RISK_COMPLIANCE_OFFICER', 'Risk & Compliance Officer', 'Risk', 7, 1),
(8, 'DATA_ANALYST', 'Data Analyst', 'Data & Intelligence', 8, 1),
(9, 'SOFTWARE_DEVELOPER', 'Software Developer', 'Engineering', 9, 1),
(10, 'PLATFORM_INFRASTRUCTURE_ENGINEER', 'Platform / Infrastructure Engineer', 'Engineering', 10, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  department = VALUES(department),
  rank_order = VALUES(rank_order),
  is_active = VALUES(is_active);

INSERT INTO internal_permissions (id, code, module_key, action_key, description) VALUES
(1, 'overview:view', 'overview', 'view', 'View internal overview dashboard'),
(2, 'network:view', 'network', 'view', 'View network operations'),
(3, 'stations:view', 'stations', 'view', 'View stations registry'),
(4, 'stations:activate', 'stations', 'activate', 'Activate or deactivate stations'),
(5, 'stations:configure', 'stations', 'configure', 'Configure station setup'),
(6, 'onboarding:view', 'onboarding', 'view', 'View onboarding workflow'),
(7, 'onboarding:manage', 'onboarding', 'manage', 'Manage onboarding workflow'),
(8, 'field:view', 'field', 'view', 'View field operations'),
(9, 'field:manage', 'field', 'manage', 'Manage field operations'),
(10, 'support:view', 'support', 'view', 'View support cases'),
(11, 'support:resolve', 'support', 'resolve', 'Resolve support cases'),
(12, 'support:refund_limited', 'support', 'refund_limited', 'Issue refunds below threshold'),
(13, 'finance:view', 'finance', 'view', 'View finance operations'),
(14, 'finance:settle', 'finance', 'settle', 'Approve settlements'),
(15, 'finance:refund_approve', 'finance', 'refund_approve', 'Approve refunds above threshold'),
(16, 'risk:view', 'risk', 'view', 'View compliance and risk surfaces'),
(17, 'risk:freeze', 'risk', 'freeze', 'Freeze high-risk accounts or cases'),
(18, 'analytics:view', 'analytics', 'view', 'View analytics and forecasting'),
(19, 'analytics:export', 'analytics', 'export', 'Export analytical datasets'),
(20, 'audit:view', 'audit', 'view', 'View internal audit logs'),
(21, 'staff:view', 'staff', 'view', 'View internal staff directory'),
(22, 'staff:manage', 'staff', 'manage', 'Assign or revoke internal roles'),
(23, 'system_health:view', 'system_health', 'view', 'View system health'),
(24, 'engineering.logs:view', 'engineering', 'logs_view', 'View engineering diagnostic logs'),
(25, 'settings:view', 'settings', 'view', 'View internal settings'),
(26, 'settings:edit', 'settings', 'edit', 'Edit internal settings'),
(27, 'security:override', 'security', 'override', 'Use emergency override controls')
ON DUPLICATE KEY UPDATE
  module_key = VALUES(module_key),
  action_key = VALUES(action_key),
  description = VALUES(description);

DELETE FROM internal_role_permissions;

INSERT INTO internal_role_permissions (role_id, permission_id) VALUES
(1, 1),(1, 2),(1, 3),(1, 4),(1, 5),(1, 6),(1, 7),(1, 8),(1, 9),(1, 10),
(1, 13),(1, 16),(1, 17),(1, 18),(1, 19),(1, 20),(1, 21),(1, 22),(1, 23),(1, 24),
(1, 25),(1, 26),(1, 27);

INSERT INTO internal_role_permissions (role_id, permission_id) VALUES
(2, 1),(2, 2),(2, 3),(2, 10),(2, 16),(2, 18),(2, 23),
(3, 1),(3, 3),(3, 4),(3, 5),(3, 6),(3, 7),(3, 8),(3, 9),
(4, 1),(4, 6),(4, 8),(4, 9),
(5, 1),(5, 3),(5, 10),(5, 11),(5, 12),
(6, 1),(6, 13),(6, 14),(6, 15),(6, 18),
(7, 1),(7, 3),(7, 16),(7, 17),(7, 20),
(8, 1),(8, 18),(8, 19),
(9, 1),(9, 23),(9, 24),
(10, 1),(10, 23),(10, 24)
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), permission_id = VALUES(permission_id);

INSERT INTO users (public_id, full_name, phone_e164, email, password_hash, is_active) VALUES
('SLU-OWN001', 'Tamara Mbewe', '+265990000101', 'owner@smartlink.internal', @internal_password_hash, 1),
('SLU-OPS201', 'Luka Chikoko', '+265990000102', 'ops.manager@smartlink.internal', @internal_password_hash, 1),
('SLU-ONB301', 'Martha Nkhoma', '+265990000103', 'onboarding.manager@smartlink.internal', @internal_password_hash, 1),
('SLU-FLD401', 'Joseph Phiri', '+265990000104', 'field.agent@smartlink.internal', @internal_password_hash, 1),
('SLU-SUP501', 'Mercy Kamanga', '+265990000105', 'support.agent@smartlink.internal', @internal_password_hash, 1),
('SLU-FIN601', 'Daniel Zuze', '+265990000106', 'finance.manager@smartlink.internal', @internal_password_hash, 1),
('SLU-RSK701', 'Aisha Banda', '+265990000107', 'risk.officer@smartlink.internal', @internal_password_hash, 1),
('SLU-DAT801', 'Peter Mvula', '+265990000108', 'analyst@smartlink.internal', @internal_password_hash, 1),
('SLU-DEV901', 'Ruth Chirwa', '+265990000109', 'developer@smartlink.internal', @internal_password_hash, 1),
('SLU-INF001', 'Brian Jiya', '+265990000110', 'platform.engineer@smartlink.internal', @internal_password_hash, 1)
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  phone_e164 = VALUES(phone_e164),
  password_hash = VALUES(password_hash),
  is_active = VALUES(is_active);

DELETE FROM internal_user_roles;

INSERT INTO internal_user_roles (user_id, role_id, is_active)
SELECT u.id, 1, 1 FROM users u WHERE u.email = 'owner@smartlink.internal'
UNION ALL
SELECT u.id, 2, 1 FROM users u WHERE u.email = 'ops.manager@smartlink.internal'
UNION ALL
SELECT u.id, 3, 1 FROM users u WHERE u.email = 'onboarding.manager@smartlink.internal'
UNION ALL
SELECT u.id, 4, 1 FROM users u WHERE u.email = 'field.agent@smartlink.internal'
UNION ALL
SELECT u.id, 5, 1 FROM users u WHERE u.email = 'support.agent@smartlink.internal'
UNION ALL
SELECT u.id, 6, 1 FROM users u WHERE u.email = 'finance.manager@smartlink.internal'
UNION ALL
SELECT u.id, 7, 1 FROM users u WHERE u.email = 'risk.officer@smartlink.internal'
UNION ALL
SELECT u.id, 8, 1 FROM users u WHERE u.email = 'analyst@smartlink.internal'
UNION ALL
SELECT u.id, 9, 1 FROM users u WHERE u.email = 'developer@smartlink.internal'
UNION ALL
SELECT u.id, 10, 1 FROM users u WHERE u.email = 'platform.engineer@smartlink.internal'
ON DUPLICATE KEY UPDATE is_active = VALUES(is_active), updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO internal_settings (setting_key, setting_value)
VALUES
('support_refund_threshold_mwk', '15000'),
('audit_retention_days', '365'),
('settlement_review_window_hours', '24'),
('internal_default_timezone', 'Africa/Blantyre')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3);

SET @station_one := (SELECT id FROM stations ORDER BY id ASC LIMIT 1);
SET @station_two := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 1);
SET @station_three := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 2);
SET @owner_user := (SELECT id FROM users WHERE email = 'owner@smartlink.internal' LIMIT 1);
SET @field_user := (SELECT id FROM users WHERE email = 'field.agent@smartlink.internal' LIMIT 1);
SET @support_user := (SELECT id FROM users WHERE email = 'support.agent@smartlink.internal' LIMIT 1);
SET @finance_user := (SELECT id FROM users WHERE email = 'finance.manager@smartlink.internal' LIMIT 1);
SET @risk_user := (SELECT id FROM users WHERE email = 'risk.officer@smartlink.internal' LIMIT 1);

INSERT INTO station_onboarding_records (
  public_id, station_id, proposed_station_name, operator_name, city, status, assigned_user_id, checklist_json, evidence_json, notes
) VALUES
('01INTONBOARD00000000000001', @station_one, 'SmartLink Blantyre Central', 'Calyx Fuels Ltd', 'Blantyre', 'READY_FOR_ACTIVATION', @field_user,
 JSON_OBJECT('identity_verified', true, 'hardware_verified', true, 'manager_assigned', true, 'subscription_ready', true),
 JSON_ARRAY(JSON_OBJECT('type', 'site_photos', 'status', 'uploaded'), JSON_OBJECT('type', 'hardware_serials', 'status', 'verified')),
 'Activation review pending platform approval.'),
('01INTONBOARD00000000000002', @station_two, 'SmartLink Lilongwe North', 'Mvula Energy', 'Lilongwe', 'REVIEW', @field_user,
 JSON_OBJECT('identity_verified', true, 'hardware_verified', false, 'manager_assigned', true, 'subscription_ready', false),
 JSON_ARRAY(JSON_OBJECT('type', 'site_plan', 'status', 'uploaded')),
 'Pump telemetry gateway still pending field verification.'),
('01INTONBOARD00000000000003', NULL, 'Mzuzu Gateway Fuels', 'Northline Petroleum', 'Mzuzu', 'SUBMITTED', @field_user,
 JSON_OBJECT('identity_verified', false, 'hardware_verified', false, 'manager_assigned', false, 'subscription_ready', false),
 JSON_ARRAY(),
 'New station awaiting onboarding assessment.')
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  assigned_user_id = VALUES(assigned_user_id),
  checklist_json = VALUES(checklist_json),
  evidence_json = VALUES(evidence_json),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO field_visits (
  public_id, station_id, onboarding_record_id, assigned_user_id, visit_type, status, scheduled_for, completed_at, summary, evidence_url, notes
) VALUES
('01INTFIELDVISIT00000000001', @station_one, (SELECT id FROM station_onboarding_records WHERE public_id = '01INTONBOARD00000000000001'), @field_user, 'TRAINING', 'COMPLETED',
 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 20 HOUR),
 'Station attendants completed SmartLink queue and reservations training.', 'https://smartlink.local/evidence/training-blantyre-central', 'All pump attendants passed onboarding checklist.'),
('01INTFIELDVISIT00000000002', @station_two, (SELECT id FROM station_onboarding_records WHERE public_id = '01INTONBOARD00000000000002'), @field_user, 'INSPECTION', 'SCHEDULED',
 DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY), NULL,
 'Verify nozzle telemetry and capture final hardware serial evidence.', NULL, 'Bring spare router for telemetry failover test.')
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  scheduled_for = VALUES(scheduled_for),
  completed_at = VALUES(completed_at),
  summary = VALUES(summary),
  evidence_url = VALUES(evidence_url),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO internal_support_cases (
  public_id, station_id, category, priority, status, assigned_user_id, subject, summary
) VALUES
('01INTSUPPORTCASE0000000001', @station_one, 'QUEUE_DISPUTE', 'HIGH', 'OPEN', @support_user, 'Queue position mismatch',
 'Driver reported queue position dropped after reconnect during high demand period.'),
('01INTSUPPORTCASE0000000002', @station_two, 'PAYMENT_FAILURE', 'CRITICAL', 'ESCALATED', @support_user, 'SmartPay reversal pending',
 'Payment captured but fuel dispense transaction did not finalize. Requires finance review.'),
('01INTSUPPORTCASE0000000003', @station_three, 'STATION_COMPLAINT', 'MEDIUM', 'IN_PROGRESS', @support_user, 'Station activation complaint',
 'Operator reports delayed activation after field verification.')
ON DUPLICATE KEY UPDATE
  priority = VALUES(priority),
  status = VALUES(status),
  assigned_user_id = VALUES(assigned_user_id),
  subject = VALUES(subject),
  summary = VALUES(summary),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO support_tickets (
  id, station_id, user_id, category, severity, title, description, status
) VALUES
('SUP-INT-0001', (SELECT public_id FROM stations WHERE id = @station_one), 'SLU-SUP501', 'QUEUE', 'HIGH',
 'Queue status dispute', 'Driver reports reservation moved unexpectedly after mobile reconnect.', 'OPEN'),
('SUP-INT-0002', (SELECT public_id FROM stations WHERE id = @station_two), 'SLU-FIN601', 'PAYMENT', 'CRITICAL',
 'Dispense reversal mismatch', 'Fuel payment captured but dispense completion did not settle in station records.', 'OPEN'),
('SUP-INT-0003', (SELECT public_id FROM stations WHERE id = @station_three), 'SLU-RSK701', 'TECHNICAL', 'MEDIUM',
 'Telemetry onboarding delay', 'Station hardware verification upload pending after scheduled field visit.', 'OPEN')
ON DUPLICATE KEY UPDATE
  category = VALUES(category),
  severity = VALUES(severity),
  title = VALUES(title),
  description = VALUES(description),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO settlement_batches (
  public_id, station_id, batch_date, gross_amount, fee_amount, net_amount, status, approved_by_user_id, approved_at
) VALUES
('01INTSETTLEMENT0000000001', @station_one, CURRENT_DATE(), 1850000.00, 9250.00, 1840750.00, 'UNDER_REVIEW', NULL, NULL),
('01INTSETTLEMENT0000000002', @station_two, DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), 1420000.00, 7100.00, 1412900.00, 'PENDING', NULL, NULL),
('01INTSETTLEMENT0000000003', @station_three, DATE_SUB(CURRENT_DATE(), INTERVAL 2 DAY), 990000.00, 4950.00, 985050.00, 'APPROVED', @finance_user, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 8 HOUR))
ON DUPLICATE KEY UPDATE
  gross_amount = VALUES(gross_amount),
  fee_amount = VALUES(fee_amount),
  net_amount = VALUES(net_amount),
  status = VALUES(status),
  approved_by_user_id = VALUES(approved_by_user_id),
  approved_at = VALUES(approved_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO compliance_cases (
  public_id, station_id, category, severity, status, assigned_user_id, summary, action_taken
) VALUES
('01INTCOMPLIANCE0000000001', @station_one, 'PUMP_ANOMALY', 'HIGH', 'INVESTIGATING', @risk_user,
 'Pump throughput variance exceeded expected tolerance for diesel lane 2.', 'Telemetry correlation review opened.'),
('01INTCOMPLIANCE0000000002', @station_two, 'SUSPICIOUS_TRANSACTIONS', 'CRITICAL', 'OPEN', @risk_user,
 'Cluster of repeated reversals detected within 15 minutes.', 'Temporary transaction review lock requested.'),
('01INTCOMPLIANCE0000000003', @station_three, 'SUBSCRIPTION_NON_COMPLIANCE', 'MEDIUM', 'RESOLVED', @risk_user,
 'Station remained active after subscription grace window.', 'Billing state reconciled and controls verified.')
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  status = VALUES(status),
  assigned_user_id = VALUES(assigned_user_id),
  summary = VALUES(summary),
  action_taken = VALUES(action_taken),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO internal_audit_log (
  public_id, actor_user_id, actor_role_code, action_type, target_type, target_public_id, summary, severity, metadata
) VALUES
('01INTAUDIT000000000000001', @owner_user, 'PLATFORM_OWNER', 'SECURITY_POLICY_REVIEW', 'SETTING', 'support_refund_threshold_mwk',
 'Internal refund threshold reviewed during weekly risk meeting.', 'MEDIUM', JSON_OBJECT('newThreshold', 15000)),
('01INTAUDIT000000000000002', @finance_user, 'FINANCE_MANAGER', 'SETTLEMENT_BATCH_REVIEW', 'SETTLEMENT_BATCH', '01INTSETTLEMENT0000000001',
 'Settlement batch queued for approval after reconciliation checks.', 'HIGH', JSON_OBJECT('batchDate', CURRENT_DATE())),
('01INTAUDIT000000000000003', @risk_user, 'RISK_COMPLIANCE_OFFICER', 'COMPLIANCE_CASE_OPENED', 'COMPLIANCE_CASE', '01INTCOMPLIANCE0000000002',
 'Critical suspicious transaction pattern escalated for immediate investigation.', 'CRITICAL', JSON_OBJECT('severity', 'CRITICAL'))
ON DUPLICATE KEY UPDATE
  summary = VALUES(summary),
  severity = VALUES(severity),
  metadata = VALUES(metadata),
  created_at = CURRENT_TIMESTAMP(3);
