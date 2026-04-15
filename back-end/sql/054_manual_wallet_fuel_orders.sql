CREATE TABLE IF NOT EXISTS fuel_orders (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  display_code VARCHAR(20) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  access_mode ENUM('reservation','queue','manual') NOT NULL DEFAULT 'manual',
  fuel_type_id TINYINT UNSIGNED NOT NULL,
  requested_amount_mwk DECIMAL(14,2) NULL,
  requested_litres DECIMAL(12,3) NULL,
  status ENUM(
    'created',
    'awaiting_station',
    'at_station',
    'near_pump',
    'attached_to_session',
    'dispensing',
    'completed',
    'expired',
    'cancelled',
    'failed'
  ) NOT NULL DEFAULT 'created',
  source ENUM('mobile_app','kiosk','attendant','telemetry') NOT NULL DEFAULT 'mobile_app',
  expires_at TIMESTAMP(3) NULL,
  attached_at TIMESTAMP(3) NULL,
  dispensed_at TIMESTAMP(3) NULL,
  completed_at TIMESTAMP(3) NULL,
  cancelled_at TIMESTAMP(3) NULL,
  failed_at TIMESTAMP(3) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_fuel_orders_user_status_time (user_id, status, created_at),
  KEY idx_fuel_orders_station_status_time (station_id, status, created_at),
  KEY idx_fuel_orders_station_expiry (station_id, expires_at),
  KEY idx_fuel_orders_access_mode (access_mode, status, created_at),
  CONSTRAINT fk_fuel_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_fuel_orders_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_fuel_orders_fuel_type FOREIGN KEY (fuel_type_id) REFERENCES fuel_types(id),
  CONSTRAINT chk_fuel_orders_request_value CHECK (
    requested_amount_mwk IS NOT NULL OR requested_litres IS NOT NULL
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_intents (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  fuel_order_id BIGINT UNSIGNED NOT NULL,
  payment_method ENUM('wallet','cash','pos') NOT NULL DEFAULT 'wallet',
  hold_amount_mwk DECIMAL(14,2) NULL,
  captured_amount_mwk DECIMAL(14,2) NULL,
  payment_status ENUM('pending','held','captured','released','failed','cancelled') NOT NULL DEFAULT 'pending',
  hold_reference VARCHAR(64) NULL,
  payment_reference VARCHAR(128) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_payment_intents_fuel_order (fuel_order_id),
  KEY idx_payment_intents_status_time (payment_status, created_at),
  KEY idx_payment_intents_reference (payment_reference),
  CONSTRAINT fk_payment_intents_fuel_order FOREIGN KEY (fuel_order_id) REFERENCES fuel_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presence_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  station_id BIGINT UNSIGNED NOT NULL,
  fuel_order_id BIGINT UNSIGNED NULL,
  beacon_id VARCHAR(64) NULL,
  proximity_level ENUM('station','lane','pump') NOT NULL,
  seen_at TIMESTAMP(3) NOT NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_presence_events_station_time (station_id, seen_at),
  KEY idx_presence_events_user_station_time (user_id, station_id, seen_at),
  KEY idx_presence_events_fuel_order_time (fuel_order_id, seen_at),
  CONSTRAINT fk_presence_events_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_presence_events_station FOREIGN KEY (station_id) REFERENCES stations(id),
  CONSTRAINT fk_presence_events_fuel_order FOREIGN KEY (fuel_order_id) REFERENCES fuel_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @has_pump_sessions_fuel_order_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pump_sessions'
    AND COLUMN_NAME = 'fuel_order_id'
);
SET @pump_sessions_fuel_order_id_sql := IF(
  @has_pump_sessions_fuel_order_id = 0,
  'ALTER TABLE pump_sessions ADD COLUMN fuel_order_id BIGINT UNSIGNED NULL AFTER transaction_id',
  'SELECT 1'
);
PREPARE pump_sessions_fuel_order_id_stmt FROM @pump_sessions_fuel_order_id_sql;
EXECUTE pump_sessions_fuel_order_id_stmt;
DEALLOCATE PREPARE pump_sessions_fuel_order_id_stmt;

SET @has_pump_sessions_fuel_order_key := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pump_sessions'
    AND INDEX_NAME = 'uq_pump_sessions_fuel_order'
);
SET @pump_sessions_fuel_order_key_sql := IF(
  @has_pump_sessions_fuel_order_key = 0,
  'ALTER TABLE pump_sessions ADD UNIQUE KEY uq_pump_sessions_fuel_order (fuel_order_id)',
  'SELECT 1'
);
PREPARE pump_sessions_fuel_order_key_stmt FROM @pump_sessions_fuel_order_key_sql;
EXECUTE pump_sessions_fuel_order_key_stmt;
DEALLOCATE PREPARE pump_sessions_fuel_order_key_stmt;

SET @has_pump_sessions_fuel_order_fk := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pump_sessions'
    AND CONSTRAINT_NAME = 'fk_pump_sessions_fuel_order'
);
SET @pump_sessions_fuel_order_fk_sql := IF(
  @has_pump_sessions_fuel_order_fk = 0,
  'ALTER TABLE pump_sessions ADD CONSTRAINT fk_pump_sessions_fuel_order FOREIGN KEY (fuel_order_id) REFERENCES fuel_orders(id)',
  'SELECT 1'
);
PREPARE pump_sessions_fuel_order_fk_stmt FROM @pump_sessions_fuel_order_fk_sql;
EXECUTE pump_sessions_fuel_order_fk_stmt;
DEALLOCATE PREPARE pump_sessions_fuel_order_fk_stmt;

SET @has_transactions_fuel_order_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND COLUMN_NAME = 'fuel_order_id'
);
SET @transactions_fuel_order_id_sql := IF(
  @has_transactions_fuel_order_id = 0,
  'ALTER TABLE transactions ADD COLUMN fuel_order_id BIGINT UNSIGNED NULL AFTER queue_entry_id',
  'SELECT 1'
);
PREPARE transactions_fuel_order_id_stmt FROM @transactions_fuel_order_id_sql;
EXECUTE transactions_fuel_order_id_stmt;
DEALLOCATE PREPARE transactions_fuel_order_id_stmt;

SET @has_transactions_fuel_order_key := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND INDEX_NAME = 'idx_transactions_fuel_order_id'
);
SET @transactions_fuel_order_key_sql := IF(
  @has_transactions_fuel_order_key = 0,
  'ALTER TABLE transactions ADD KEY idx_transactions_fuel_order_id (fuel_order_id)',
  'SELECT 1'
);
PREPARE transactions_fuel_order_key_stmt FROM @transactions_fuel_order_key_sql;
EXECUTE transactions_fuel_order_key_stmt;
DEALLOCATE PREPARE transactions_fuel_order_key_stmt;

SET @has_transactions_fuel_order_fk := (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transactions'
    AND CONSTRAINT_NAME = 'fk_transactions_fuel_order'
);
SET @transactions_fuel_order_fk_sql := IF(
  @has_transactions_fuel_order_fk = 0,
  'ALTER TABLE transactions ADD CONSTRAINT fk_transactions_fuel_order FOREIGN KEY (fuel_order_id) REFERENCES fuel_orders(id)',
  'SELECT 1'
);
PREPARE transactions_fuel_order_fk_stmt FROM @transactions_fuel_order_fk_sql;
EXECUTE transactions_fuel_order_fk_stmt;
DEALLOCATE PREPARE transactions_fuel_order_fk_stmt;
