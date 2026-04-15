-- 029_station_onboarding_manager_permissions.sql
-- Align Station Onboarding Manager permissions with onboarding setup and activation ownership.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

DELETE irp
FROM internal_role_permissions irp
INNER JOIN internal_roles ir ON ir.id = irp.role_id
INNER JOIN internal_permissions ip ON ip.id = irp.permission_id
WHERE ir.code = 'STATION_ONBOARDING_MANAGER'
  AND ip.code IN (
    'overview:view',
    'stations:view',
    'stations:activate',
    'stations:configure',
    'onboarding:view',
    'onboarding:manage',
    'field:view',
    'field:manage',
    'staff:view'
  );

INSERT INTO internal_role_permissions (role_id, permission_id)
SELECT ir.id, ip.id
FROM internal_roles ir
INNER JOIN internal_permissions ip
  ON ip.code IN (
    'overview:view',
    'stations:view',
    'stations:activate',
    'stations:configure',
    'onboarding:view',
    'onboarding:manage',
    'field:view',
    'field:manage'
  )
WHERE ir.code = 'STATION_ONBOARDING_MANAGER'
ON DUPLICATE KEY UPDATE role_id = VALUES(role_id), permission_id = VALUES(permission_id);
