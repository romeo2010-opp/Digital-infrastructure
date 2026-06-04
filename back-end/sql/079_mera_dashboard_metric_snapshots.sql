CREATE TABLE IF NOT EXISTS mera_dashboard_metric_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope_key VARCHAR(96) NOT NULL DEFAULT '__NATIONAL__',
  metric_key VARCHAR(96) NOT NULL,
  metric_value DECIMAL(18,4) NOT NULL DEFAULT 0,
  captured_date DATE NOT NULL,
  captured_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mera_dashboard_metric_scope_day (scope_key, metric_key, captured_date),
  KEY idx_mera_dashboard_metric_lookup (scope_key, metric_key, captured_date)
);
