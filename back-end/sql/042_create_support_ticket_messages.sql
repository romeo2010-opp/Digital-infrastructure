CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  support_ticket_id VARCHAR(191) NOT NULL,
  station_public_id VARCHAR(64) NOT NULL,
  support_case_public_id VARCHAR(64) NULL,
  sender_scope ENUM('STATION','SUPPORT') NOT NULL,
  sender_user_public_id VARCHAR(64) NULL,
  sender_role_code VARCHAR(64) NULL,
  sender_name VARCHAR(160) NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_support_ticket_messages_ticket (support_ticket_id, created_at),
  KEY idx_support_ticket_messages_station (station_public_id, created_at),
  KEY idx_support_ticket_messages_case (support_case_public_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
