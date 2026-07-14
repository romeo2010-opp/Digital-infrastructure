USE smartlink_schools;

CREATE TABLE IF NOT EXISTS system_error_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  error_id CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  http_method VARCHAR(10) NULL,
  request_path VARCHAR(500) NULL,
  http_status SMALLINT UNSIGNED NOT NULL DEFAULT 500,
  error_code VARCHAR(80) NULL,
  constraint_name VARCHAR(160) NULL,
  error_message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_system_error_id (error_id),
  KEY idx_system_error_school_created (school_id, created_at),
  KEY idx_system_error_code_created (error_code, created_at),
  CONSTRAINT fk_system_error_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL,
  CONSTRAINT fk_system_error_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE assessment_import_jobs
  ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(40) NULL AFTER parser_version,
  ADD COLUMN IF NOT EXISTS ai_model VARCHAR(120) NULL AFTER ai_provider,
  ADD COLUMN IF NOT EXISTS ai_prompt_version VARCHAR(80) NULL AFTER ai_model,
  ADD COLUMN IF NOT EXISTS ai_quality_score DECIMAL(5,2) NULL AFTER ai_prompt_version,
  ADD COLUMN IF NOT EXISTS ai_fallback_used TINYINT(1) NOT NULL DEFAULT 0 AFTER ai_quality_score;

CREATE INDEX IF NOT EXISTS idx_assessment_import_ai_provider
  ON assessment_import_jobs(school_id, ai_provider, created_at);
