-- 003_create_missing_views.sql
-- Recreates required reporting views idempotently.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE OR REPLACE VIEW v_sales_daily AS
SELECT
  station_id,
  DATE(occurred_at) AS sale_date,
  fuel_type_id,
  SUM(litres) AS litres_sold,
  SUM(total_amount) AS revenue,
  COUNT(*) AS tx_count
FROM transactions
GROUP BY station_id, DATE(occurred_at), fuel_type_id;

CREATE OR REPLACE VIEW v_queue_daily AS
SELECT
  station_id,
  DATE(joined_at) AS q_date,
  SUM(status = 'SERVED') AS served_count,
  SUM(status = 'NO_SHOW') AS no_show_count,
  SUM(status = 'CANCELLED') AS cancelled_count,
  COUNT(*) AS total_joined
FROM queue_entries
GROUP BY station_id, DATE(joined_at);
