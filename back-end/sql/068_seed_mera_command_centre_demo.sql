-- 068_seed_mera_command_centre_demo.sql
-- Demo/dev data for MERA national fuel command-centre workflows.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

INSERT INTO stations (
  public_id,
  name,
  operator_name,
  country_code,
  city,
  address,
  latitude,
  longitude,
  fuel_level,
  availability_status,
  timezone,
  is_active
) VALUES
  ('SL-MW-BLNT-9101', 'Petroda Kameza', 'Petroda Malawi', 'MW', 'Blantyre', 'Kameza roundabout, Blantyre', -15.7669000, 34.9536000, 'LOW', 'AVAILABLE', 'Africa/Blantyre', 1),
  ('SL-MW-LIMB-9102', 'Puma Limbe', 'Puma Energy Malawi', 'MW', 'Limbe', 'Limbe market road', -15.8108000, 35.0531000, 'LOW', 'AVAILABLE', 'Africa/Blantyre', 1),
  ('SL-MW-LLWE-9103', 'TotalEnergies Area 25', 'TotalEnergies Malawi', 'MW', 'Lilongwe', 'Area 25, Lilongwe', -13.9144000, 33.7395000, 'MEDIUM', 'AVAILABLE', 'Africa/Blantyre', 1),
  ('SL-MW-BLNT-9104', 'Mt Meru Nyambadwe', 'Mt Meru Malawi', 'MW', 'Blantyre', 'Nyambadwe, Blantyre', -15.8063000, 35.0028000, 'MEDIUM', 'AVAILABLE', 'Africa/Blantyre', 1),
  ('SL-MW-MZZU-9105', 'Engen Mzuzu', 'Engen Malawi', 'MW', 'Mzuzu', 'Mzuzu CBD', -11.4590000, 34.0207000, 'HIGH', 'AVAILABLE', 'Africa/Blantyre', 1),
  ('SL-MW-ZMBA-9106', 'Energem Zomba', 'Energem Malawi', 'MW', 'Zomba', 'Zomba city centre', -15.3865000, 35.3188000, 'MEDIUM', 'AVAILABLE', 'Africa/Blantyre', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  operator_name = VALUES(operator_name),
  city = VALUES(city),
  address = VALUES(address),
  latitude = VALUES(latitude),
  longitude = VALUES(longitude),
  fuel_level = VALUES(fuel_level),
  availability_status = VALUES(availability_status),
  is_active = VALUES(is_active);

SET @admin_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000001' LIMIT 1);
SET @supervisor_id := COALESCE((SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000003' LIMIT 1), @admin_id);
SET @inspector_id := COALESCE((SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000004' LIMIT 1), @supervisor_id);
SET @analyst_id := COALESCE((SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000008' LIMIT 1), @supervisor_id);
SET @comms_id := COALESCE((SELECT id FROM mera_users WHERE role_id IN (SELECT id FROM mera_roles WHERE code IN ('MERA_PUBLIC_COMMUNICATIONS','PUBLIC_COMPLAINTS_ANALYST')) ORDER BY id LIMIT 1), @supervisor_id);

SET @petroda_id := (SELECT id FROM stations WHERE public_id = 'SL-MW-BLNT-9101' LIMIT 1);
SET @puma_id := (SELECT id FROM stations WHERE public_id = 'SL-MW-LIMB-9102' LIMIT 1);
SET @area25_id := (SELECT id FROM stations WHERE public_id = 'SL-MW-LLWE-9103' LIMIT 1);
SET @nyambadwe_id := (SELECT id FROM stations WHERE public_id = 'SL-MW-BLNT-9104' LIMIT 1);
SET @engen_id := (SELECT id FROM stations WHERE public_id = 'SL-MW-MZZU-9105' LIMIT 1);
SET @zomba_id := (SELECT id FROM stations WHERE public_id = 'SL-MW-ZMBA-9106' LIMIT 1);

INSERT INTO mera_official_prices (public_id, fuel_type, price_per_litre, effective_date, status, created_by) VALUES
  ('MERA-PRICE-PETROL-DEMO-001', 'PETROL', 2714.00, CURRENT_DATE(), 'active', @analyst_id),
  ('MERA-PRICE-DIESEL-DEMO-001', 'DIESEL', 2734.00, CURRENT_DATE(), 'active', @analyst_id),
  ('MERA-PRICE-PARAFFIN-DEMO-001', 'PARAFFIN', 1910.00, CURRENT_DATE(), 'active', @analyst_id)
ON DUPLICATE KEY UPDATE
  price_per_litre = VALUES(price_per_litre),
  effective_date = VALUES(effective_date),
  status = VALUES(status);

INSERT INTO station_current_status (
  station_id,
  availability_status,
  petrol_status,
  diesel_status,
  tank_count,
  delivery_verified,
  petrol_delivery_verified,
  diesel_delivery_verified,
  delivered_litres_since_baseline,
  petrol_delivered_litres_since_baseline,
  diesel_delivered_litres_since_baseline,
  latest_delivery_time,
  updated_at,
  last_logged_at
)
SELECT @petroda_id, 'DRY', 'DRY', 'LIMITED', 4, 1, 1, 1, 32000, 16000, 16000, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 10 HOUR), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE @petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE availability_status = VALUES(availability_status), petrol_status = VALUES(petrol_status), diesel_status = VALUES(diesel_status), latest_delivery_time = VALUES(latest_delivery_time), updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO station_current_status (
  station_id,
  availability_status,
  petrol_status,
  diesel_status,
  tank_count,
  delivery_verified,
  petrol_delivery_verified,
  diesel_delivery_verified,
  delivered_litres_since_baseline,
  petrol_delivered_litres_since_baseline,
  diesel_delivered_litres_since_baseline,
  latest_delivery_time,
  updated_at,
  last_logged_at
)
SELECT @puma_id, 'LIMITED', 'AVAILABLE', 'DRY', 4, 1, 1, 1, 24000, 12000, 12000, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 18 HOUR), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE @puma_id IS NOT NULL
ON DUPLICATE KEY UPDATE availability_status = VALUES(availability_status), petrol_status = VALUES(petrol_status), diesel_status = VALUES(diesel_status), latest_delivery_time = VALUES(latest_delivery_time), updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO station_current_status (
  station_id,
  availability_status,
  petrol_status,
  diesel_status,
  tank_count,
  delivery_verified,
  petrol_delivery_verified,
  diesel_delivery_verified,
  delivered_litres_since_baseline,
  petrol_delivered_litres_since_baseline,
  diesel_delivered_litres_since_baseline,
  latest_delivery_time,
  updated_at,
  last_logged_at
)
SELECT @area25_id, 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 4, 1, 1, 1, 18000, 9000, 9000, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE @area25_id IS NOT NULL
ON DUPLICATE KEY UPDATE availability_status = VALUES(availability_status), petrol_status = VALUES(petrol_status), diesel_status = VALUES(diesel_status), latest_delivery_time = VALUES(latest_delivery_time), updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO fuel_delivery_logs (
  public_id,
  station_id,
  source_depot,
  omc,
  tanker_plate,
  driver_name,
  fuel_type,
  litres_loaded,
  expected_arrival,
  actual_arrival,
  offloaded_quantity,
  station_confirmation_status,
  first_sale_after_delivery_at,
  sales_velocity_after_delivery,
  discrepancy_litres,
  status,
  delivery_time,
  estimated_volume,
  source_type,
  reported_by
)
SELECT 'MERA-FDL-DEMO-PETRODA-001', @petroda_id, 'Blantyre Depot', 'Petroda Malawi', 'BT 4582', 'Demo driver', 'PETROL', 16000, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 12 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 10 HOUR), 15800, 'confirmed', NULL, 120, 200, 'under_review', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 10 HOUR), 16000, 'TANKER_MANIFEST', 'DEMO_SEED'
WHERE @petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE status = VALUES(status), first_sale_after_delivery_at = VALUES(first_sale_after_delivery_at), discrepancy_litres = VALUES(discrepancy_litres);

INSERT INTO fuel_delivery_logs (
  public_id,
  station_id,
  source_depot,
  omc,
  tanker_plate,
  driver_name,
  fuel_type,
  litres_loaded,
  expected_arrival,
  actual_arrival,
  offloaded_quantity,
  station_confirmation_status,
  first_sale_after_delivery_at,
  sales_velocity_after_delivery,
  discrepancy_litres,
  status,
  delivery_time,
  estimated_volume,
  source_type,
  reported_by
)
SELECT 'MERA-FDL-DEMO-PUMA-001', @puma_id, 'Nacala Corridor Depot', 'Puma Energy Malawi', 'BT 7912', 'Demo driver', 'DIESEL', 12000, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 22 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 18 HOUR), 11880, 'confirmed', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 9 HOUR), 780, 120, 'verified', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 18 HOUR), 12000, 'TANKER_MANIFEST', 'DEMO_SEED'
WHERE @puma_id IS NOT NULL
ON DUPLICATE KEY UPDATE status = VALUES(status), first_sale_after_delivery_at = VALUES(first_sale_after_delivery_at);

INSERT INTO fuel_delivery_logs (
  public_id,
  station_id,
  source_depot,
  omc,
  tanker_plate,
  driver_name,
  fuel_type,
  litres_loaded,
  expected_arrival,
  actual_arrival,
  offloaded_quantity,
  station_confirmation_status,
  first_sale_after_delivery_at,
  sales_velocity_after_delivery,
  discrepancy_litres,
  status,
  delivery_time,
  estimated_volume,
  source_type,
  reported_by
)
SELECT 'MERA-FDL-DEMO-AREA25-001', @area25_id, 'Lilongwe Depot', 'TotalEnergies Malawi', 'LL 2401', 'Demo driver', 'PETROL', 9000, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 HOUR), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 29 HOUR), 9000, 'confirmed', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 28 HOUR), 1120, 0, 'verified', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 29 HOUR), 9000, 'TANKER_MANIFEST', 'DEMO_SEED'
WHERE @area25_id IS NOT NULL
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT INTO fuel_price_reports (station_id, petrol_price, diesel_price, submitted_by, created_at)
SELECT @petroda_id, 2790.00, 2734.00, @analyst_id, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 6 HOUR)
WHERE @petroda_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM fuel_price_reports
    WHERE station_id = @petroda_id
      AND petrol_price = 2790.00
      AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
  );

INSERT INTO fuel_price_reports (station_id, petrol_price, diesel_price, submitted_by, created_at)
SELECT @puma_id, 2714.00, 2810.00, @analyst_id, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 HOUR)
WHERE @puma_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM fuel_price_reports
    WHERE station_id = @puma_id
      AND diesel_price = 2810.00
      AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
  );

INSERT INTO public_complaints (
  public_id,
  station_id,
  complaint_type,
  complaint_description,
  complaint_status,
  assigned_officer_id,
  created_at,
  updated_at
)
SELECT 'MCMP-PETRODA-001', @petroda_id, 'HOARDING', 'DEMO: Customers report Petroda Kameza received fuel but attendants say petrol is reserved for selected vehicles.', 'UNDER_INVESTIGATION', @analyst_id, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 4 HOUR), CURRENT_TIMESTAMP(3)
WHERE @petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE complaint_status = VALUES(complaint_status), complaint_description = VALUES(complaint_description);

INSERT INTO public_complaints (
  public_id,
  station_id,
  complaint_type,
  complaint_description,
  complaint_status,
  assigned_officer_id,
  created_at,
  updated_at
)
SELECT 'MCMP-PETRODA-002', @petroda_id, 'SUSPICIOUS_QUEUE_MANIPULATION', 'DEMO: Queue at Kameza is being bypassed by private vehicles and jerrycans.', 'ASSIGNED', @analyst_id, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 3 HOUR), CURRENT_TIMESTAMP(3)
WHERE @petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE complaint_status = VALUES(complaint_status);

INSERT INTO public_complaints (
  public_id,
  station_id,
  complaint_type,
  complaint_description,
  complaint_status,
  assigned_officer_id,
  created_at,
  updated_at
)
SELECT 'MCMP-PUMA-001', @puma_id, 'OVERPRICING', 'DEMO: Diesel reported above official pump price at Puma Limbe.', 'TRIAGED', @analyst_id, DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 2 HOUR), CURRENT_TIMESTAMP(3)
WHERE @puma_id IS NOT NULL
ON DUPLICATE KEY UPDATE complaint_status = VALUES(complaint_status);

INSERT INTO mera_alerts (
  public_id,
  source_key,
  type,
  severity,
  station_id,
  title,
  description,
  evidence_json,
  recommended_action,
  status,
  created_at
)
SELECT
  'MERA-ALERT-DEMO-PETRODA-001',
  'demo:petroda:possible-hoarding',
  'POSSIBLE_HOARDING',
  'critical',
  @petroda_id,
  'Possible hoarding at Petroda Kameza',
  'DEMO: Delivery confirmed but public availability remains dry and complaints continue.',
  JSON_ARRAY(JSON_OBJECT('type','delivery_to_sale','detail','16,000L delivered, no first-sale timestamp recorded'), JSON_OBJECT('type','complaints','count',2)),
  'Open Compliance Case',
  'new',
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 90 MINUTE)
WHERE @petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE status = VALUES(status), evidence_json = VALUES(evidence_json);

INSERT INTO mera_alerts (
  public_id,
  source_key,
  type,
  severity,
  station_id,
  title,
  description,
  evidence_json,
  recommended_action,
  status,
  created_at
)
SELECT
  'MERA-ALERT-DEMO-PUMA-001',
  'demo:puma:price-mismatch',
  'PRICE_MISMATCH',
  'high',
  @puma_id,
  'Diesel price mismatch at Puma Limbe',
  'DEMO: Reported diesel price is above the official MERA price.',
  JSON_ARRAY(JSON_OBJECT('type','price_mismatch','reported',2810,'official',2734)),
  'Assign Inspection',
  'new',
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 80 MINUTE)
WHERE @puma_id IS NOT NULL
ON DUPLICATE KEY UPDATE status = VALUES(status), evidence_json = VALUES(evidence_json);

INSERT INTO mera_cases (
  public_id,
  title,
  type,
  station_id,
  district,
  severity,
  assigned_officer_id,
  created_by,
  source_alert_id,
  evidence_json,
  status,
  due_date,
  final_outcome
)
SELECT
  'CASE-DEMO-PETRODA-HOARDING',
  'DEMO: Petroda Kameza delivery-to-sale hoarding review',
  'SUSPECTED HOARDING',
  @petroda_id,
  'Blantyre',
  'critical',
  @inspector_id,
  @supervisor_id,
  'MERA-ALERT-DEMO-PETRODA-001',
  JSON_ARRAY(JSON_OBJECT('type','alert','id','MERA-ALERT-DEMO-PETRODA-001')),
  'Under Review',
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY),
  NULL
WHERE @petroda_id IS NOT NULL AND @supervisor_id IS NOT NULL
ON DUPLICATE KEY UPDATE status = VALUES(status), assigned_officer_id = VALUES(assigned_officer_id), due_date = VALUES(due_date);

SET @case_petroda_id := (SELECT id FROM mera_cases WHERE public_id = 'CASE-DEMO-PETRODA-HOARDING' LIMIT 1);

INSERT INTO mera_case_timeline (public_id, case_id, event_type, event_title, event_description, metadata_json)
SELECT 'MERA-TL-DEMO-PETRODA-001', @case_petroda_id, 'delivery_arrived', 'Delivery arrived', 'DEMO: 16,000L petrol delivery confirmed at Petroda Kameza.', JSON_OBJECT('deliveryId','MERA-FDL-DEMO-PETRODA-001')
WHERE @case_petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE event_description = VALUES(event_description);

INSERT INTO mera_case_timeline (public_id, case_id, event_type, event_title, event_description, metadata_json)
SELECT 'MERA-TL-DEMO-PETRODA-002', @case_petroda_id, 'complaint_received', 'Complaint cluster received', 'DEMO: Public complaints report queue bypass and withheld fuel.', JSON_OBJECT('complaints', JSON_ARRAY('MCMP-PETRODA-001','MCMP-PETRODA-002'))
WHERE @case_petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE event_description = VALUES(event_description);

INSERT INTO mera_case_notes (public_id, case_id, author_user_id, note, visibility)
SELECT 'MERA-NOTE-DEMO-PETRODA-001', @case_petroda_id, @supervisor_id, 'DEMO: Prioritise physical stock verification and delivery-to-sale reconciliation.', 'internal'
WHERE @case_petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE note = VALUES(note);

INSERT INTO mera_case_evidence (public_id, case_id, evidence_type, title, description, metadata_json, created_by)
SELECT 'MERA-EVID-DEMO-PETRODA-001', @case_petroda_id, 'delivery_record', 'Delivery and availability conflict', 'DEMO: Delivery received while station remained publicly unavailable.', JSON_OBJECT('deliveryId','MERA-FDL-DEMO-PETRODA-001'), @analyst_id
WHERE @case_petroda_id IS NOT NULL
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO inspections (
  public_id,
  station_id,
  officer_id,
  inspection_type,
  reason,
  priority,
  scheduled_at,
  status,
  inspection_status,
  checklist_json,
  linked_case_id,
  queue_length,
  stock_visible,
  pumps_active,
  illegal_vending_detected,
  officer_notes
)
SELECT
  'MINSP-PETRODA-001',
  @petroda_id,
  @inspector_id,
  'SPOT_CHECK',
  'DEMO: Critical hoarding risk from delivery-to-sale delay and complaint cluster.',
  'critical',
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 6 HOUR),
  'scheduled',
  'OPEN',
  JSON_ARRAY('verify physical stock','verify recent delivery records','verify pump meter readings','verify official pump price','check queue process','interview station manager','review CCTV if available','verify complaints','verify manual override explanation'),
  'CASE-DEMO-PETRODA-HOARDING',
  86,
  1,
  2,
  0,
  'DEMO: Inspection created by command-centre seed.'
WHERE @petroda_id IS NOT NULL AND @inspector_id IS NOT NULL
ON DUPLICATE KEY UPDATE priority = VALUES(priority), status = VALUES(status), linked_case_id = VALUES(linked_case_id);

INSERT INTO regulator_tasks (
  task_number,
  title,
  description,
  type,
  category,
  priority,
  status,
  district,
  station_id,
  station_name,
  linked_entity_type,
  linked_entity_id,
  evidence_summary,
  assigned_to_user_id,
  assigned_by_user_id,
  due_at
)
SELECT
  'TASK-2026-MERA-CC-001',
  'Review critical possible hoarding alert',
  'DEMO: Review risk evidence for Petroda Kameza and decide whether to convert to enforcement review.',
  'HOARDING_INVESTIGATION',
  'Suspicious station alert',
  'CRITICAL',
  'ASSIGNED',
  'Blantyre',
  @petroda_id,
  'Petroda Kameza',
  'MERA_ALERT',
  'MERA-ALERT-DEMO-PETRODA-001',
  'Delivery-to-sale delay, complaint cluster, and dry public status.',
  @analyst_id,
  @supervisor_id,
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 6 HOUR)
WHERE @petroda_id IS NOT NULL AND @analyst_id IS NOT NULL AND @supervisor_id IS NOT NULL
ON DUPLICATE KEY UPDATE priority = VALUES(priority), status = VALUES(status), due_at = VALUES(due_at);

INSERT INTO regulator_tasks (
  task_number,
  title,
  description,
  type,
  category,
  priority,
  status,
  district,
  station_id,
  station_name,
  linked_entity_type,
  linked_entity_id,
  evidence_summary,
  assigned_to_user_id,
  assigned_by_user_id,
  due_at
)
SELECT
  'TASK-2026-MERA-CC-002',
  'Verify diesel price mismatch',
  'DEMO: Compare Puma Limbe diesel pump price against official MERA price and attach evidence.',
  'PRICE_VIOLATION_REVIEW',
  'Price-compliance review',
  'HIGH',
  'ASSIGNED',
  'Limbe',
  @puma_id,
  'Puma Limbe',
  'PRICE_RECORD',
  'MERA-ALERT-DEMO-PUMA-001',
  'Reported diesel MK 2,810 against official MK 2,734.',
  @inspector_id,
  @supervisor_id,
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
WHERE @puma_id IS NOT NULL AND @inspector_id IS NOT NULL AND @supervisor_id IS NOT NULL
ON DUPLICATE KEY UPDATE priority = VALUES(priority), status = VALUES(status), due_at = VALUES(due_at);

INSERT INTO public_notices (
  public_id,
  title,
  message,
  category,
  target_region,
  target_district,
  fuel_type,
  severity,
  status,
  selected_channels_json,
  created_by,
  approved_by,
  scheduled_at
)
SELECT
  'MERA-NOTICE-DEMO-001',
  'DEMO: Blantyre fuel availability advisory',
  'MERA is monitoring fuel availability in Blantyre and urges motorists to avoid panic buying while verified deliveries are reconciled.',
  'district advisory',
  'Southern Region',
  'Blantyre',
  'PETROL',
  'medium',
  'pending_approval',
  JSON_ARRAY('FACEBOOK_PAGE','X_TWITTER'),
  @comms_id,
  NULL,
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 HOUR)
WHERE @comms_id IS NOT NULL
ON DUPLICATE KEY UPDATE status = VALUES(status), message = VALUES(message);

INSERT INTO mera_reports (
  public_id,
  report_type,
  title,
  filters_json,
  status,
  generated_by
)
SELECT
  'RPT-DEMO-HOARDING-001',
  'Hoarding Suspicion Report',
  'DEMO: Blantyre suspected hoarding evidence summary',
  JSON_OBJECT('district','Blantyre','severity','critical','demo',true),
  'ready',
  @analyst_id
WHERE @analyst_id IS NOT NULL
ON DUPLICATE KEY UPDATE status = VALUES(status), filters_json = VALUES(filters_json);
