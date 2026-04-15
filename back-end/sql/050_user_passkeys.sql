CREATE TABLE IF NOT EXISTS user_passkeys (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  credential_id VARCHAR(512) NOT NULL UNIQUE,
  public_key_pem TEXT NOT NULL,
  sign_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  label VARCHAR(120) NULL,
  transports_json LONGTEXT NULL,
  last_used_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_passkeys_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @idx_user_passkeys_user_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'user_passkeys'
    AND index_name = 'idx_user_passkeys_user'
);
SET @create_idx_user_passkeys_user_sql := IF(
  @idx_user_passkeys_user_exists = 0,
  'CREATE INDEX idx_user_passkeys_user ON user_passkeys (user_id)',
  'SELECT 1'
);
PREPARE stmt FROM @create_idx_user_passkeys_user_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS user_passkey_challenges (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NULL,
  purpose ENUM('REGISTER','AUTHENTICATE') NOT NULL,
  challenge VARCHAR(255) NOT NULL,
  origin VARCHAR(255) NOT NULL,
  rp_id VARCHAR(190) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_passkey_challenges_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @idx_user_passkey_challenges_lookup_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'user_passkey_challenges'
    AND index_name = 'idx_user_passkey_challenges_lookup'
);
SET @create_idx_user_passkey_challenges_lookup_sql := IF(
  @idx_user_passkey_challenges_lookup_exists = 0,
  'CREATE INDEX idx_user_passkey_challenges_lookup ON user_passkey_challenges (public_id, purpose, used_at, expires_at)',
  'SELECT 1'
);
PREPARE stmt FROM @create_idx_user_passkey_challenges_lookup_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
