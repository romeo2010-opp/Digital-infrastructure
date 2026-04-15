-- 028_seed_internal_dashboard_expansion.sql
-- Supplemental internal seed data for alerts, refunds, system health, and subscriptions.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

INSERT INTO internal_permissions (id, code, module_key, action_key, description) VALUES
(28, 'support:escalate', 'support', 'escalate', 'Escalate support cases'),
(29, 'finance:settlement_reject', 'finance', 'settlement_reject', 'Reject or hold settlement batches'),
(30, 'risk:unfreeze', 'risk', 'unfreeze', 'Unfreeze high-risk accounts or cases'),
(31, 'audit:export', 'audit', 'export', 'Export internal audit logs'),
(32, 'staff:create', 'staff', 'create', 'Create internal users'),
(33, 'staff:suspend', 'staff', 'suspend', 'Suspend or reactivate internal users'),
(34, 'staff:reset_access', 'staff', 'reset_access', 'Reset internal user access'),
(35, 'permissions:view_matrix', 'permissions', 'view_matrix', 'View internal permission matrix'),
(36, 'security:force_sign_out', 'security', 'force_sign_out', 'Force sign out an internal user'),
(37, 'security:lock_account', 'security', 'lock_account', 'Lock an internal user account'),
(38, 'security:event_detail', 'security', 'event_detail', 'View internal security event details'),
(39, 'risk:override_approve', 'risk', 'override_approve', 'Approve high-risk overrides'),
(40, 'network:incident_manage', 'network', 'incident_manage', 'Manage operational incidents and alerts'),
(41, 'network:station_action', 'network', 'station_action', 'Run station-level operational actions'),
(42, 'network:export', 'network', 'export', 'Export network operations reports')
ON DUPLICATE KEY UPDATE
  module_key = VALUES(module_key),
  action_key = VALUES(action_key),
  description = VALUES(description);

INSERT INTO internal_role_permissions (role_id, permission_id) VALUES
(1, 28),(1, 29),(1, 30),(1, 31),(1, 32),(1, 33),(1, 34),(1, 35),(1, 36),(1, 37),(1, 38),(1, 39),(1, 40),(1, 41),(1, 42),
(2, 40),(2, 41),(2, 42),
(5, 28),
(6, 29),
(7, 30)
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), permission_id = VALUES(permission_id);

INSERT INTO internal_settings (setting_key, setting_value)
VALUES
('allow_quick_tunnel_host', '0'),
('escalation_policy_window_minutes', '30'),
('internal_access_policy', 'STRICT'),
('emergency_override_enabled', '0')
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  updated_at = CURRENT_TIMESTAMP(3);

SET @station_one := (SELECT id FROM stations ORDER BY id ASC LIMIT 1);
SET @station_two := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 1);
SET @station_three := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 2);
SET @support_user := (SELECT id FROM users WHERE email = 'support.agent@smartlink.internal' LIMIT 1);
SET @finance_user := (SELECT id FROM users WHERE email = 'finance.manager@smartlink.internal' LIMIT 1);
SET @risk_user := (SELECT id FROM users WHERE email = 'risk.officer@smartlink.internal' LIMIT 1);
SET @owner_user := (SELECT id FROM users WHERE email = 'owner@smartlink.internal' LIMIT 1);
SET @support_case_payment := (SELECT id FROM internal_support_cases WHERE public_id = '01INTSUPPORTCASE0000000002' LIMIT 1);

INSERT INTO refund_requests (
  public_id, station_id, user_id, support_case_id, transaction_public_id, amount_mwk, priority, status,
  requested_by_user_id, reviewed_by_user_id, reason, resolution_notes, reviewed_at
) VALUES
('01INTREFUND000000000000001', @station_two, @support_user, @support_case_payment, 'TXN-PAY-20260307111037390-Q2W5N9', 12000.00, 'HIGH', 'PENDING_SUPPORT_REVIEW', @support_user, NULL,
 'Customer charged but dispense confirmation failed.', NULL, NULL),
('01INTREFUND000000000000002', @station_one, @support_user, NULL, 'TXN-PAY-20260307131811810-K4M9P2', 42000.00, 'CRITICAL', 'PENDING_FINANCE_APPROVAL', @support_user, NULL,
 'High-value refund escalated after settlement mismatch.', 'Support verified driver evidence and station logs.', NULL),
('01INTREFUND000000000000003', @station_three, @support_user, NULL, 'TXN-PAY-20260306124544770-B7R3N1', 9000.00, 'MEDIUM', 'APPROVED', @support_user, @finance_user,
 'Duplicate debit on queue-linked fuel order.', 'Refund approved during daily finance reconciliation.', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 3 HOUR))
ON DUPLICATE KEY UPDATE
  amount_mwk = VALUES(amount_mwk),
  priority = VALUES(priority),
  status = VALUES(status),
  reviewed_by_user_id = VALUES(reviewed_by_user_id),
  resolution_notes = VALUES(resolution_notes),
  reviewed_at = VALUES(reviewed_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO dashboard_alerts (
  public_id, category, severity, status, station_id, entity_type, entity_public_id, owner_role_code, title, summary, metadata, created_at
) VALUES
('01INTALERT000000000000001', 'OPERATIONS', 'CRITICAL', 'OPEN', @station_two, 'STATION', (SELECT public_id FROM stations WHERE id = @station_two), 'NETWORK_OPERATIONS_MANAGER',
 'Station Offline Beyond SLA', 'Lilongwe station has remained offline for 47 minutes and requires network operations intervention.', JSON_OBJECT('minutesOffline', 47), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 47 MINUTE)),
('01INTALERT000000000000002', 'FINANCE', 'HIGH', 'OPEN', @station_one, 'SETTLEMENT_BATCH', '01INTSETTLEMENT0000000001', 'FINANCE_MANAGER',
 'Settlement Batch Awaiting Approval', 'One settlement batch has exceeded the normal review window and is awaiting finance approval.', JSON_OBJECT('hoursWaiting', 29), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 HOUR)),
('01INTALERT000000000000003', 'RISK', 'CRITICAL', 'OPEN', @station_two, 'COMPLIANCE_CASE', '01INTCOMPLIANCE0000000002', 'RISK_COMPLIANCE_OFFICER',
 'Suspicious Transaction Cluster', 'Repeated reversals detected within 15 minutes at Lilongwe North require immediate review.', JSON_OBJECT('reversalCount', 6), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 32 MINUTE)),
('01INTALERT000000000000004', 'SUPPORT', 'HIGH', 'OPEN', @station_one, 'SUPPORT_CASE', '01INTSUPPORTCASE0000000001', 'CUSTOMER_SUPPORT_AGENT',
 'Queue Complaint Backlog', 'High-priority queue dispute remains unresolved and has exceeded support SLA.', JSON_OBJECT('minutesOpen', 96), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 96 MINUTE)),
('01INTALERT000000000000005', 'ONBOARDING', 'MEDIUM', 'OPEN', NULL, 'ONBOARDING_RECORD', '01INTONBOARD00000000000002', 'STATION_ONBOARDING_MANAGER',
 'Onboarding Delay', 'Telemetry verification remains pending for a station awaiting activation review.', JSON_OBJECT('blockedChecklistItem', 'hardware_verified'), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 18 HOUR)),
('01INTALERT000000000000006', 'SYSTEM', 'HIGH', 'OPEN', NULL, 'SERVICE', 'sync-ingest', 'PLATFORM_INFRASTRUCTURE_ENGINEER',
 'Sync Ingest Lag', 'Background ingest latency has exceeded the normal threshold.', JSON_OBJECT('lagMinutes', 18), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 18 MINUTE))
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  status = VALUES(status),
  title = VALUES(title),
  summary = VALUES(summary),
  metadata = VALUES(metadata),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO system_health_events (
  public_id, service_key, environment_key, severity, status, summary, detail, source_key, created_at, resolved_at
) VALUES
('01INTHEALTH00000000000001', 'api', 'production', 'INFO', 'OPEN', 'Internal API responding normally', 'Latency remains within expected threshold for internal reads.', 'api-gateway', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE), NULL),
('01INTHEALTH00000000000002', 'sync-ingest', 'production', 'WARNING', 'OPEN', 'Sync ingest lag elevated', 'Queue ingest worker is behind expected processing target by 18 minutes.', 'sync-worker', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 18 MINUTE), NULL),
('01INTHEALTH00000000000003', 'wallet-reconciliation', 'production', 'HIGH', 'ACKNOWLEDGED', 'Wallet reconciliation delayed', 'Finance reconciliation job completed late and requires follow-up review.', 'finance-jobs', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 2 HOUR), NULL),
('01INTHEALTH00000000000004', 'push-notifications', 'production', 'INFO', 'RESOLVED', 'Push notification provider recovered', 'Transient provider timeout cleared after retry policy engaged.', 'push-gateway', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 8 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 HOUR))
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  status = VALUES(status),
  summary = VALUES(summary),
  detail = VALUES(detail),
  source_key = VALUES(source_key),
  resolved_at = VALUES(resolved_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO station_subscription_statuses (
  station_id, plan_code, plan_name, status, monthly_fee_mwk, renewal_date, last_payment_at, grace_expires_at
) VALUES
(@station_one, 'ENTERPRISE', 'Enterprise Network', 'ACTIVE', 350000.00, DATE_ADD(CURRENT_DATE(), INTERVAL 18 DAY), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 12 DAY), NULL),
(@station_two, 'GROWTH', 'Growth Operations', 'OVERDUE', 220000.00, DATE_SUB(CURRENT_DATE(), INTERVAL 4 DAY), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 35 DAY), DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 3 DAY)),
(@station_three, 'ESSENTIAL', 'Essential Station', 'GRACE', 145000.00, DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 31 DAY), DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 6 DAY))
ON DUPLICATE KEY UPDATE
  plan_code = VALUES(plan_code),
  plan_name = VALUES(plan_name),
  status = VALUES(status),
  monthly_fee_mwk = VALUES(monthly_fee_mwk),
  renewal_date = VALUES(renewal_date),
  last_payment_at = VALUES(last_payment_at),
  grace_expires_at = VALUES(grace_expires_at),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO internal_audit_log (
  public_id, actor_user_id, actor_role_code, action_type, target_type, target_public_id, summary, severity, metadata
) VALUES
('01INTAUDIT000000000000010', @support_user, 'CUSTOMER_SUPPORT_AGENT', 'SUPPORT_CASE_ESCALATE', 'SUPPORT_CASE', '01INTSUPPORTCASE0000000002',
 'Payment failure case escalated for finance review.', 'HIGH', JSON_OBJECT('priority', 'CRITICAL')),
('01INTAUDIT000000000000011', @finance_user, 'FINANCE_MANAGER', 'REFUND_REVIEW', 'REFUND_REQUEST', '01INTREFUND000000000000003',
 'Refund approved after reviewing station and transaction evidence.', 'HIGH', JSON_OBJECT('status', 'APPROVED')),
('01INTAUDIT000000000000012', @owner_user, 'PLATFORM_OWNER', 'COMMERCIAL_POLICY_REVIEW', 'SUBSCRIPTION', (SELECT public_id FROM stations WHERE id = @station_two),
 'Commercial review completed for overdue station subscription account.', 'MEDIUM', JSON_OBJECT('status', 'OVERDUE'))
ON DUPLICATE KEY UPDATE
  summary = VALUES(summary),
  severity = VALUES(severity),
  metadata = VALUES(metadata),
  created_at = CURRENT_TIMESTAMP(3);
