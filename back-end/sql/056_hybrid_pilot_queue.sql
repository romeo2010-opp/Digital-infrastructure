CREATE TABLE IF NOT EXISTS station_hybrid_queue_settings (
  station_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  pilot_pump_public_id VARCHAR(64) NULL,
  queue_state VARCHAR(32) NOT NULL DEFAULT 'OPEN_TO_WALKINS',
  current_assignment_public_id VARCHAR(96) NULL,
  hold_started_at TIMESTAMP(3) NULL DEFAULT NULL,
  hold_expires_at TIMESTAMP(3) NULL DEFAULT NULL,
  digital_hold_timeout_seconds INT UNSIGNED NOT NULL DEFAULT 120,
  kiosk_walkin_redirect_message VARCHAR(255) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_station_hybrid_queue_station
    FOREIGN KEY (station_id) REFERENCES stations(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hybrid_lane_commitments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(26) NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  pump_public_id VARCHAR(64) NOT NULL,
  order_type VARCHAR(16) NOT NULL,
  order_public_id VARCHAR(64) NOT NULL,
  committed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  cleared_at TIMESTAMP(3) NULL DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'COMMITTED',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_hybrid_lane_commitments_public_id (public_id),
  KEY idx_hybrid_lane_station_pump_status (station_id, pump_public_id, status, committed_at),
  KEY idx_hybrid_lane_station_order_status (station_id, order_type, order_public_id, status),
  CONSTRAINT fk_hybrid_lane_station
    FOREIGN KEY (station_id) REFERENCES stations(id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);
