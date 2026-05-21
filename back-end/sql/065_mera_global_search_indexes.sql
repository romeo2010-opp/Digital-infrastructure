-- 065_mera_global_search_indexes.sql
-- Practical lookup indexes for MERA global search and detail click-through pages.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'stations' AND index_name = 'idx_stations_name'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_stations_name ON stations (name)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'stations' AND index_name = 'idx_stations_city'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_stations_city ON stations (city)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'stations' AND index_name = 'idx_stations_operator'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_stations_operator ON stations (operator_name)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'idx_users_full_name'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_users_full_name ON users (full_name)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'station_staff' AND index_name = 'idx_station_staff_user_active_role'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_station_staff_user_active_role ON station_staff (user_id, is_active, role_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'station_staff' AND index_name = 'idx_station_staff_station_active_role'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_station_staff_station_active_role ON station_staff (station_id, is_active, role_id)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'fuel_station_licenses' AND index_name = 'idx_station_licenses_status_expiry'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_station_licenses_status_expiry ON fuel_station_licenses (license_status, expiry_date)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'public_complaints' AND index_name = 'idx_public_complaints_status_time'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_public_complaints_status_time ON public_complaints (complaint_status, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'compliance_flags' AND index_name = 'idx_compliance_flags_status_time'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_compliance_flags_status_time ON compliance_flags (resolved_status, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'enforcement_actions' AND index_name = 'idx_enforcement_status_time'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_enforcement_status_time ON enforcement_actions (action_status, issued_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'regulator_tasks' AND index_name = 'idx_regulator_tasks_status_district_time'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_regulator_tasks_status_district_time ON regulator_tasks (status, district, created_at)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'mera_users' AND index_name = 'idx_mera_users_full_name'
);
SET @sql := IF(@idx_exists = 0, 'CREATE INDEX idx_mera_users_full_name ON mera_users (full_name)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
