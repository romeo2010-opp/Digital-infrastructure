USE smartlink_schools;

ALTER TABLE assessment_import_jobs
  ADD COLUMN IF NOT EXISTS image_extraction_status ENUM('pending','processing','completed','completed_with_warnings','failed') NOT NULL DEFAULT 'pending' AFTER ai_fallback_used,
  ADD COLUMN IF NOT EXISTS image_extraction_pages_processed INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_extraction_status,
  ADD COLUMN IF NOT EXISTS image_extraction_total_pages INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_extraction_pages_processed,
  ADD COLUMN IF NOT EXISTS image_extraction_images_found INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_extraction_total_pages,
  ADD COLUMN IF NOT EXISTS image_extraction_images_saved INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_extraction_images_found,
  ADD COLUMN IF NOT EXISTS image_extraction_review_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_extraction_images_saved,
  ADD COLUMN IF NOT EXISTS image_extraction_last_error TEXT NULL AFTER image_extraction_review_count,
  ADD COLUMN IF NOT EXISTS image_extraction_started_at TIMESTAMP NULL AFTER image_extraction_last_error,
  ADD COLUMN IF NOT EXISTS image_extraction_completed_at TIMESTAMP NULL AFTER image_extraction_started_at,
  ADD COLUMN IF NOT EXISTS image_extraction_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_extraction_completed_at;

ALTER TABLE assessment_import_assets
  MODIFY COLUMN asset_type ENUM(
    'image','diagram','graph','chart','map','table','table_image','logo','cover_graphic',
    'scientific_illustration','geometric_figure','formula_image','photo','apparatus','other','unknown'
  ) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS suggested_question_number VARCHAR(80) NULL AFTER linked_question_temp_id,
  ADD COLUMN IF NOT EXISTS extraction_method ENUM('embedded','vector_crop','page_crop','cropped_from_scan') NULL AFTER source_asset_key,
  ADD COLUMN IF NOT EXISTS file_name VARCHAR(255) NULL AFTER file_path,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) NULL AFTER file_name,
  ADD COLUMN IF NOT EXISTS width INT UNSIGNED NULL AFTER mime_type,
  ADD COLUMN IF NOT EXISTS height INT UNSIGNED NULL AFTER width,
  ADD COLUMN IF NOT EXISTS aspect_ratio DECIMAL(12,6) NULL AFTER height,
  ADD COLUMN IF NOT EXISTS placement ENUM('before_question_text','after_question_text','inline','cover','unassigned') NOT NULL DEFAULT 'unassigned' AFTER aspect_ratio,
  ADD COLUMN IF NOT EXISTS requires_review TINYINT(1) NOT NULL DEFAULT 1 AFTER placement,
  ADD COLUMN IF NOT EXISTS assignment_status ENUM('unassigned','suggested','confirmed','rejected') NOT NULL DEFAULT 'unassigned' AFTER requires_review,
  ADD COLUMN IF NOT EXISTS checksum CHAR(64) NULL AFTER assignment_status,
  ADD COLUMN IF NOT EXISTS duplicate_of_asset_id BIGINT UNSIGNED NULL AFTER checksum,
  ADD COLUMN IF NOT EXISTS created_by BIGINT UNSIGNED NULL AFTER duplicate_of_asset_id,
  ADD COLUMN IF NOT EXISTS row_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER created_by,
  ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP NULL AFTER row_version,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

CREATE INDEX IF NOT EXISTS idx_assessment_import_asset_checksum
  ON assessment_import_assets(school_id, import_job_id, checksum);
CREATE INDEX IF NOT EXISTS idx_assessment_import_asset_assignment
  ON assessment_import_assets(school_id, import_job_id, assignment_status, removed_at);

CREATE TABLE IF NOT EXISTS assessment_import_asset_audit (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  import_job_id BIGINT UNSIGNED NOT NULL,
  asset_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action ENUM('extraction_started','extraction_completed','extraction_failed','assigned','reassigned','confirmed','removed','retry_started') NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_import_asset_audit_scope (school_id, import_job_id, created_at),
  CONSTRAINT fk_import_asset_audit_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_import_asset_audit_job FOREIGN KEY (import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_import_asset_audit_asset FOREIGN KEY (asset_id) REFERENCES assessment_import_assets(id) ON DELETE SET NULL,
  CONSTRAINT fk_import_asset_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
);
