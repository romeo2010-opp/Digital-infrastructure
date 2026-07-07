CREATE TABLE IF NOT EXISTS user_portal_preferences (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  school_id BIGINT UNSIGNED NULL,
  preferences_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_portal_preferences_user (user_id),
  KEY idx_user_portal_preferences_school (school_id, updated_at),
  CONSTRAINT fk_user_portal_preferences_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_portal_preferences_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS user_portal_assets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  school_id BIGINT UNSIGNED NULL,
  asset_type ENUM('personalization_background') NOT NULL DEFAULT 'personalization_background',
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  file_size INT UNSIGNED NOT NULL DEFAULT 0,
  asset_data MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_portal_assets_user_type (user_id, asset_type),
  KEY idx_user_portal_assets_school (school_id, asset_type, updated_at),
  CONSTRAINT fk_user_portal_assets_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_portal_assets_school FOREIGN KEY (school_id) REFERENCES schools(id)
);
