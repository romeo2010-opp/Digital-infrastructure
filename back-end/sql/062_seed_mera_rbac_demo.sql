SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @mera_demo_password_hash := '$2a$10$o8vzIEd/48qdxdUYh3quC.sdqIClDFtiF7X6PqfjkYU9sJrp69yya';

INSERT INTO mera_users (
  public_id,
  full_name,
  email,
  phone,
  password_hash,
  role_id,
  district_scope,
  region_scope,
  account_status
)
SELECT
  seed.public_id,
  seed.full_name,
  seed.email,
  seed.phone,
  @mera_demo_password_hash,
  roles.id,
  seed.district_scope,
  seed.region_scope,
  'ACTIVE'
FROM (
  SELECT 'MERA0000000000000000000001' AS public_id, 'MERA Super Admin' AS full_name, 'superadmin@mera.mw' AS email, '+265991000001' AS phone, 'SUPER_ADMIN' AS role_code, NULL AS district_scope, 'National' AS region_scope
  UNION ALL SELECT 'MERA0000000000000000000002', 'MERA National Analyst', 'national.ops@mera.mw', '+265991000002', 'NATIONAL_OPERATIONS_ANALYST', NULL, 'National'
  UNION ALL SELECT 'MERA0000000000000000000003', 'MERA Regional Supervisor', 'regional.supervisor@mera.mw', '+265991000003', 'REGIONAL_COMPLIANCE_SUPERVISOR', 'Blantyre', 'South'
  UNION ALL SELECT 'MERA0000000000000000000004', 'MERA Field Officer', 'field.officer@mera.mw', '+265991000004', 'FIELD_COMPLIANCE_OFFICER', 'Blantyre', 'South'
  UNION ALL SELECT 'MERA0000000000000000000005', 'MERA Complaints Analyst', 'complaints@mera.mw', '+265991000005', 'PUBLIC_COMPLAINTS_ANALYST', 'Lilongwe', 'Centre'
  UNION ALL SELECT 'MERA0000000000000000000006', 'MERA Legal Officer', 'legal@mera.mw', '+265991000006', 'LEGAL_ENFORCEMENT_OFFICER', NULL, 'National'
  UNION ALL SELECT 'MERA0000000000000000000007', 'MERA Licensing Officer', 'licensing@mera.mw', '+265991000007', 'LICENSING_OFFICER', NULL, 'National'
  UNION ALL SELECT 'MERA0000000000000000000008', 'MERA Market Analyst', 'market@mera.mw', '+265991000008', 'MARKET_SUPPLY_ANALYST', NULL, 'National'
  UNION ALL SELECT 'MERA0000000000000000000009', 'MERA Executive Viewer', 'executive@mera.mw', '+265991000009', 'EXECUTIVE_VIEWER', NULL, 'National'
) seed
INNER JOIN mera_roles roles ON roles.code = seed.role_code
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  phone = VALUES(phone),
  password_hash = VALUES(password_hash),
  role_id = VALUES(role_id),
  district_scope = VALUES(district_scope),
  region_scope = VALUES(region_scope),
  account_status = VALUES(account_status);
