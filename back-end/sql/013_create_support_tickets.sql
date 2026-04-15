CREATE TABLE IF NOT EXISTS support_tickets (
  id VARCHAR(191) NOT NULL,
  station_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  category VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  screenshot_url VARCHAR(1000) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_support_station_created (station_id, created_at),
  KEY idx_support_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
