-- 059_seed_mera_demo.sql
-- Optional demo data for the MERA regulatory platform.
-- Demo password for seeded MERA users: MeraDemo123!

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @mera_demo_password_hash := '$2a$10$o8vzIEd/48qdxdUYh3quC.sdqIClDFtiF7X6PqfjkYU9sJrp69yya';

SET @station_one_id := (SELECT id FROM stations ORDER BY id ASC LIMIT 1);
SET @station_two_id := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 1);
SET @station_three_id := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 2);
SET @public_user_id := (SELECT id FROM users ORDER BY id ASC LIMIT 1);

INSERT INTO mera_users (
  public_id,
  full_name,
  email,
  phone,
  password_hash,
  role_id,
  district,
  account_status
)
VALUES
  ('MERA0000000000000000000001', 'MERA Super Admin', 'superadmin@mera.mw', '+265991000001', @mera_demo_password_hash, 1, 'Lilongwe', 'ACTIVE'),
  ('MERA0000000000000000000002', 'MERA Compliance Officer', 'compliance@mera.mw', '+265991000002', @mera_demo_password_hash, 2, 'Blantyre', 'ACTIVE'),
  ('MERA0000000000000000000003', 'MERA Legal Officer', 'legal@mera.mw', '+265991000003', @mera_demo_password_hash, 3, 'Lilongwe', 'ACTIVE'),
  ('MERA0000000000000000000004', 'MERA Complaints Analyst', 'complaints@mera.mw', '+265991000004', @mera_demo_password_hash, 4, 'Mzuzu', 'ACTIVE'),
  ('MERA0000000000000000000005', 'MERA Market Analyst', 'market@mera.mw', '+265991000005', @mera_demo_password_hash, 5, 'Zomba', 'ACTIVE')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  phone = VALUES(phone),
  password_hash = VALUES(password_hash),
  role_id = VALUES(role_id),
  district = VALUES(district),
  account_status = VALUES(account_status);

SET @mera_super_admin_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000001' LIMIT 1);
SET @mera_compliance_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000002' LIMIT 1);
SET @mera_legal_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000003' LIMIT 1);
SET @mera_analyst_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000004' LIMIT 1);
SET @mera_market_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000005' LIMIT 1);

INSERT INTO fuel_station_licenses (
  station_id,
  license_number,
  issue_date,
  expiry_date,
  license_status,
  compliance_conditions
)
SELECT
  @station_one_id,
  'MERA-LIC-2026-001',
  '2025-01-15',
  '2026-12-31',
  'ACTIVE',
  'Weekly dry-status updates required when inventory drops below regulated reserve thresholds.'
FROM DUAL
WHERE @station_one_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  issue_date = VALUES(issue_date),
  expiry_date = VALUES(expiry_date),
  license_status = VALUES(license_status),
  compliance_conditions = VALUES(compliance_conditions);

INSERT INTO fuel_station_licenses (
  station_id,
  license_number,
  issue_date,
  expiry_date,
  license_status,
  compliance_conditions
)
SELECT
  @station_two_id,
  'MERA-LIC-2026-002',
  '2024-07-01',
  '2026-08-31',
  'PENDING_RENEWAL',
  'Station must complete signage and pump calibration follow-up before renewal clearance.'
FROM DUAL
WHERE @station_two_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  issue_date = VALUES(issue_date),
  expiry_date = VALUES(expiry_date),
  license_status = VALUES(license_status),
  compliance_conditions = VALUES(compliance_conditions);

INSERT INTO fuel_station_licenses (
  station_id,
  license_number,
  issue_date,
  expiry_date,
  license_status,
  compliance_conditions
)
SELECT
  @station_three_id,
  'MERA-LIC-2026-003',
  '2023-03-12',
  '2026-05-20',
  'SUSPENDED',
  'Subject to enforcement review pending queue manipulation and refusal-to-sell investigations.'
FROM DUAL
WHERE @station_three_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  issue_date = VALUES(issue_date),
  expiry_date = VALUES(expiry_date),
  license_status = VALUES(license_status),
  compliance_conditions = VALUES(compliance_conditions);

INSERT INTO public_complaints (
  public_id,
  user_id,
  station_id,
  complaint_type,
  complaint_description,
  media_url,
  geo_lat,
  geo_lng,
  complaint_status,
  assigned_officer_id
)
SELECT
  'MERACMPLT000000000000000001',
  @public_user_id,
  @station_one_id,
  'OVERPRICING',
  'Customer reported pump-side price above the displayed board price during the afternoon peak window.',
  '/uploads/mera/demo-overpricing-station-1.jpg',
  -15.7861000,
  35.0058000,
  'UNDER_INVESTIGATION',
  @mera_analyst_id
FROM DUAL
WHERE @station_one_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  complaint_description = VALUES(complaint_description),
  complaint_status = VALUES(complaint_status),
  assigned_officer_id = VALUES(assigned_officer_id),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO public_complaints (
  public_id,
  user_id,
  station_id,
  complaint_type,
  complaint_description,
  media_url,
  geo_lat,
  geo_lng,
  complaint_status,
  assigned_officer_id
)
SELECT
  'MERACMPLT000000000000000002',
  @public_user_id,
  @station_two_id,
  'REFUSAL_TO_SELL',
  'Station attendants reportedly turned away motorists despite availability being displayed as active.',
  '/uploads/mera/demo-refusal-station-2.jpg',
  -15.8015000,
  35.0201000,
  'ASSIGNED',
  @mera_compliance_id
FROM DUAL
WHERE @station_two_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  complaint_description = VALUES(complaint_description),
  complaint_status = VALUES(complaint_status),
  assigned_officer_id = VALUES(assigned_officer_id),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO public_complaints (
  public_id,
  user_id,
  station_id,
  complaint_type,
  complaint_description,
  media_url,
  geo_lat,
  geo_lng,
  complaint_status,
  assigned_officer_id
)
SELECT
  'MERACMPLT000000000000000003',
  @public_user_id,
  @station_three_id,
  'SUSPICIOUS_QUEUE_MANIPULATION',
  'Queue order was allegedly bypassed repeatedly in favor of selected vehicles.',
  '/uploads/mera/demo-queue-station-3.jpg',
  -15.7820000,
  35.0115000,
  'TRIAGED',
  @mera_analyst_id
FROM DUAL
WHERE @station_three_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  complaint_description = VALUES(complaint_description),
  complaint_status = VALUES(complaint_status),
  assigned_officer_id = VALUES(assigned_officer_id),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO inspections (
  public_id,
  station_id,
  officer_id,
  inspection_type,
  queue_length,
  stock_visible,
  pumps_active,
  displayed_price,
  illegal_vending_detected,
  geotag_lat,
  geotag_lng,
  officer_notes,
  inspection_status
)
SELECT
  'MERAINSP0000000000000000001',
  @station_one_id,
  @mera_compliance_id,
  'ROUTINE',
  18,
  1,
  6,
  2680.00,
  0,
  -15.7861000,
  35.0058000,
  'Routine verification completed. Visible stock and pump activity aligned with station report.',
  'PASSED'
FROM DUAL
WHERE @station_one_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  queue_length = VALUES(queue_length),
  pumps_active = VALUES(pumps_active),
  displayed_price = VALUES(displayed_price),
  officer_notes = VALUES(officer_notes),
  inspection_status = VALUES(inspection_status),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO inspections (
  public_id,
  station_id,
  officer_id,
  inspection_type,
  queue_length,
  stock_visible,
  pumps_active,
  displayed_price,
  illegal_vending_detected,
  geotag_lat,
  geotag_lng,
  officer_notes,
  inspection_status
)
SELECT
  'MERAINSP0000000000000000002',
  @station_two_id,
  @mera_compliance_id,
  'COMPLAINT_RESPONSE',
  34,
  0,
  2,
  2715.00,
  1,
  -15.8015000,
  35.0201000,
  'Follow-up inspection found inconsistent selling behavior and suspected roadside dispensing.',
  'ESCALATED'
FROM DUAL
WHERE @station_two_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  queue_length = VALUES(queue_length),
  stock_visible = VALUES(stock_visible),
  pumps_active = VALUES(pumps_active),
  displayed_price = VALUES(displayed_price),
  illegal_vending_detected = VALUES(illegal_vending_detected),
  officer_notes = VALUES(officer_notes),
  inspection_status = VALUES(inspection_status),
  updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO inspection_evidence (inspection_id, file_url, file_type)
SELECT
  i.id,
  '/uploads/mera/demo-inspection-evidence-2.jpg',
  'PHOTO'
FROM inspections i
WHERE i.public_id = 'MERAINSP0000000000000000002'
  AND NOT EXISTS (
    SELECT 1
    FROM inspection_evidence ie
    WHERE ie.inspection_id = i.id
      AND ie.file_url = '/uploads/mera/demo-inspection-evidence-2.jpg'
  );

INSERT INTO compliance_flags (
  public_id,
  station_id,
  flag_type,
  severity,
  generated_reason,
  source_reference,
  resolved_status
)
SELECT
  'MERAFLAG0000000000000000001',
  @station_two_id,
  'REFUSAL_MISMATCH',
  'CRITICAL',
  'Repeated refusal-to-sell complaints conflict with the station''s reported available status.',
  'public_complaints+station_status_logs:demo',
  'OPEN'
FROM DUAL
WHERE @station_two_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  generated_reason = VALUES(generated_reason),
  source_reference = VALUES(source_reference),
  resolved_status = VALUES(resolved_status);

INSERT INTO compliance_flags (
  public_id,
  station_id,
  flag_type,
  severity,
  generated_reason,
  source_reference,
  resolved_status
)
SELECT
  'MERAFLAG0000000000000000002',
  @station_three_id,
  'MANUAL_REVIEW',
  'HIGH',
  'Analyst requested manual review after sustained queue manipulation reports and license stress signals.',
  'analyst_manual_seed',
  'UNDER_REVIEW'
FROM DUAL
WHERE @station_three_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  generated_reason = VALUES(generated_reason),
  source_reference = VALUES(source_reference),
  resolved_status = VALUES(resolved_status);

SET @flag_two_id := (SELECT id FROM compliance_flags WHERE public_id = 'MERAFLAG0000000000000000002' LIMIT 1);

INSERT INTO enforcement_actions (
  public_id,
  station_id,
  initiated_by,
  related_flag_id,
  action_type,
  action_notes,
  action_status
)
SELECT
  'MERAACTN0000000000000000001',
  @station_three_id,
  @mera_legal_id,
  @flag_two_id,
  'WARNING',
  'Formal warning issued pending corrective action plan and documented queue governance controls.',
  'IN_PROGRESS'
FROM DUAL
WHERE @station_three_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  related_flag_id = VALUES(related_flag_id),
  action_notes = VALUES(action_notes),
  action_status = VALUES(action_status);

INSERT INTO station_status_logs (
  station_id,
  reported_source,
  availability_status,
  diesel_status,
  petrol_status,
  updated_by
)
SELECT @station_one_id, 'SYSTEM', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', @mera_market_id
FROM DUAL
WHERE @station_one_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM station_status_logs
    WHERE station_id = @station_one_id
      AND reported_source = 'SYSTEM'
      AND availability_status = 'AVAILABLE'
  );

INSERT INTO station_status_logs (
  station_id,
  reported_source,
  availability_status,
  diesel_status,
  petrol_status,
  updated_by
)
SELECT @station_two_id, 'MERA_INSPECTION', 'LIMITED', 'LIMITED', 'DRY', @mera_compliance_id
FROM DUAL
WHERE @station_two_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM station_status_logs
    WHERE station_id = @station_two_id
      AND reported_source = 'MERA_INSPECTION'
      AND availability_status = 'LIMITED'
  );

INSERT INTO station_status_logs (
  station_id,
  reported_source,
  availability_status,
  diesel_status,
  petrol_status,
  updated_by
)
SELECT @station_three_id, 'SYSTEM', 'DRY', 'DRY', 'LIMITED', @mera_market_id
FROM DUAL
WHERE @station_three_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM station_status_logs
    WHERE station_id = @station_three_id
      AND reported_source = 'SYSTEM'
      AND availability_status = 'DRY'
  );

INSERT INTO fuel_price_reports (station_id, petrol_price, diesel_price, submitted_by)
SELECT @station_one_id, 2680.00, 2590.00, @mera_market_id
FROM DUAL
WHERE @station_one_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM fuel_price_reports
    WHERE station_id = @station_one_id
      AND petrol_price = 2680.00
      AND diesel_price = 2590.00
  );

INSERT INTO fuel_price_reports (station_id, petrol_price, diesel_price, submitted_by)
SELECT @station_two_id, 2715.00, 2625.00, @mera_market_id
FROM DUAL
WHERE @station_two_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM fuel_price_reports
    WHERE station_id = @station_two_id
      AND petrol_price = 2715.00
      AND diesel_price = 2625.00
  );

INSERT INTO audit_logs_mera (actor_id, actor_role, action_type, action_description)
SELECT
  @mera_super_admin_id,
  'SUPER_ADMIN',
  'MERA_DEMO_BOOTSTRAP',
  'Seeded MERA demo users, station licenses, complaints, inspections, and enforcement records.'
FROM DUAL
WHERE @mera_super_admin_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs_mera
    WHERE actor_id = @mera_super_admin_id
      AND action_type = 'MERA_DEMO_BOOTSTRAP'
  );

INSERT INTO audit_logs_mera (actor_id, actor_role, action_type, action_description)
SELECT
  @mera_compliance_id,
  'COMPLIANCE_OFFICER',
  'MERA_DEMO_INSPECTION_REVIEW',
  'Demo inspection review captured for seeded complaint-response scenario.'
FROM DUAL
WHERE @mera_compliance_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs_mera
    WHERE actor_id = @mera_compliance_id
      AND action_type = 'MERA_DEMO_INSPECTION_REVIEW'
  );
