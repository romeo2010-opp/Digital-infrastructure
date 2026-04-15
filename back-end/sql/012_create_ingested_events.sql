CREATE TABLE IF NOT EXISTS ingested_events (
  id VARCHAR(191) NOT NULL,
  event_id VARCHAR(191) NOT NULL,
  station_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  actor_user_id VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingested_events_event_id (event_id),
  KEY idx_ingested_events_station_received (station_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
