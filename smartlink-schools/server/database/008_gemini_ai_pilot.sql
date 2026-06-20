CREATE TABLE IF NOT EXISTS syllabus_document_chunks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  upload_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  grade_id BIGINT UNSIGNED NULL,
  topic_id BIGINT UNSIGNED NULL,
  chunk_text MEDIUMTEXT NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  source_filename VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_syllabus_chunks_upload (school_id, upload_id, chunk_index),
  KEY idx_syllabus_chunks_scope (school_id, subject_id, grade_id, topic_id),
  CONSTRAINT fk_syllabus_chunks_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_syllabus_chunks_upload FOREIGN KEY (upload_id) REFERENCES syllabus_uploads(id),
  CONSTRAINT fk_syllabus_chunks_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_syllabus_chunks_grade FOREIGN KEY (grade_id) REFERENCES grade_levels(id),
  CONSTRAINT fk_syllabus_chunks_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  feature_name ENUM('syllabus_extraction', 'question_generation', 'explanation_adaptation', 'explanation_tts', 'ai_test') NOT NULL,
  model VARCHAR(120) NOT NULL,
  input_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  estimated_cost_usd DECIMAL(12,8) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_usage_school_date (school_id, created_at),
  KEY idx_ai_usage_feature (school_id, feature_name, created_at),
  CONSTRAINT fk_ai_usage_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_ai_usage_user FOREIGN KEY (user_id) REFERENCES users(id)
);

SET @has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'school_ai_settings' AND COLUMN_NAME = 'ai_monthly_budget_usd'
);
SET @ddl := IF(@has_column = 0, 'ALTER TABLE school_ai_settings ADD COLUMN ai_monthly_budget_usd DECIMAL(10,4) NULL AFTER ai_enabled', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'school_ai_settings' AND COLUMN_NAME = 'ai_daily_request_limit'
);
SET @ddl := IF(@has_column = 0, 'ALTER TABLE school_ai_settings ADD COLUMN ai_daily_request_limit INT UNSIGNED NULL AFTER ai_monthly_budget_usd', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'question_bank' AND COLUMN_NAME = 'common_mistake'
);
SET @ddl := IF(@has_column = 0, 'ALTER TABLE question_bank ADD COLUMN common_mistake TEXT NULL AFTER explanation', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_column := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'question_bank' AND COLUMN_NAME = 'confidence'
);
SET @ddl := IF(@has_column = 0, 'ALTER TABLE question_bank ADD COLUMN confidence DECIMAL(4,3) NULL AFTER marks', 'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
