USE smartlink_schools;

-- Keep AI usage accounting in step with the explicit assessment import feature.
-- The dynamic guard lets this migration remain safe on installations that have
-- not enabled the AI usage tables yet.
SET @has_ai_usage_logs := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_usage_logs'
);
SET @ai_usage_ddl := IF(
  @has_ai_usage_logs > 0,
  "ALTER TABLE ai_usage_logs MODIFY COLUMN feature_name ENUM('syllabus_extraction', 'question_generation', 'explanation_adaptation', 'explanation_tts', 'exam_paper_extraction', 'assessment_pdf_import', 'ai_test') NOT NULL",
  "SELECT 1"
);
PREPARE ai_usage_stmt FROM @ai_usage_ddl;
EXECUTE ai_usage_stmt;
DEALLOCATE PREPARE ai_usage_stmt;

CREATE TABLE IF NOT EXISTS assessment_import_jobs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, public_ref CHAR(36) NOT NULL, school_id BIGINT UNSIGNED NOT NULL, created_by BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NULL, title VARCHAR(180) NOT NULL, subject_id BIGINT UNSIGNED NULL, class_id BIGINT UNSIGNED NULL, term_id BIGINT UNSIGNED NULL,
  assessment_type VARCHAR(40) NOT NULL DEFAULT 'exam', assessment_date DATE NULL, duration_minutes INT NULL,
  student_pdf_file_path VARCHAR(500) NOT NULL, marking_scheme_pdf_file_path VARCHAR(500) NOT NULL,
  status ENUM('uploaded','extracting','parsing','review_required','approved','failed','cancelled') NOT NULL DEFAULT 'uploaded', progress_percentage TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL, parser_version VARCHAR(80) NULL, cover_json JSON NULL, warnings_json JSON NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, completed_at TIMESTAMP NULL,
  UNIQUE KEY uq_assessment_import_ref(public_ref), KEY idx_assessment_import_scope(school_id,status,created_at),
  CONSTRAINT fk_assessment_import_school FOREIGN KEY(school_id) REFERENCES schools(id), CONSTRAINT fk_assessment_import_creator FOREIGN KEY(created_by) REFERENCES users(id),
  CONSTRAINT fk_assessment_import_assessment FOREIGN KEY(assessment_id) REFERENCES assessments(id)
);

CREATE TABLE IF NOT EXISTS assessment_import_pages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, public_ref CHAR(36) NOT NULL, school_id BIGINT UNSIGNED NOT NULL, import_job_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('student_paper','marking_scheme') NOT NULL, page_number INT NOT NULL, text_content LONGTEXT NULL, layout_json JSON NULL,
  preview_image_path VARCHAR(500) NULL, width DECIMAL(10,2) NULL, height DECIMAL(10,2) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_import_page(import_job_id,document_type,page_number), UNIQUE KEY uq_assessment_import_page_ref(public_ref),
  CONSTRAINT fk_assessment_import_page_school FOREIGN KEY(school_id) REFERENCES schools(id), CONSTRAINT fk_assessment_import_page_job FOREIGN KEY(import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_import_assets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, public_ref CHAR(36) NOT NULL, school_id BIGINT UNSIGNED NOT NULL, import_job_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('student_paper','marking_scheme') NOT NULL, page_number INT NULL, asset_type ENUM('image','diagram','formula_image','table_image','logo','unknown') NOT NULL DEFAULT 'unknown',
  file_path VARCHAR(500) NOT NULL, bbox_json JSON NULL, alt_text VARCHAR(255) NULL, linked_question_temp_id VARCHAR(80) NULL, confidence DECIMAL(4,3) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_import_asset_ref(public_ref), KEY idx_assessment_import_asset(import_job_id,document_type,page_number),
  CONSTRAINT fk_assessment_import_asset_school FOREIGN KEY(school_id) REFERENCES schools(id), CONSTRAINT fk_assessment_import_asset_job FOREIGN KEY(import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_import_questions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, public_ref CHAR(36) NOT NULL, school_id BIGINT UNSIGNED NOT NULL, import_job_id BIGINT UNSIGNED NOT NULL,
  temp_question_id VARCHAR(80) NOT NULL, question_number VARCHAR(40) NOT NULL, parent_question_number VARCHAR(40) NULL, section_title VARCHAR(180) NULL,
  question_text LONGTEXT NOT NULL, raw_text LONGTEXT NULL, marks DECIMAL(8,2) NULL, difficulty ENUM('easy','medium','hard') NULL, topic_id BIGINT UNSIGNED NULL, subtopic_id BIGINT UNSIGNED NULL,
  detected_topic_text VARCHAR(180) NULL, page_start INT NULL, page_end INT NULL, bbox_json JSON NULL, formula_json JSON NULL, assets_json JSON NULL,
  confidence DECIMAL(4,3) NOT NULL DEFAULT .500, daily_drill_eligible TINYINT(1) NOT NULL DEFAULT 1,
  review_status ENUM('pending','approved','edited','rejected') NOT NULL DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_import_question_ref(public_ref), UNIQUE KEY uq_assessment_import_temp(import_job_id,temp_question_id),
  CONSTRAINT fk_assessment_import_question_school FOREIGN KEY(school_id) REFERENCES schools(id), CONSTRAINT fk_assessment_import_question_job FOREIGN KEY(import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_import_marking_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, public_ref CHAR(36) NOT NULL, school_id BIGINT UNSIGNED NOT NULL, import_job_id BIGINT UNSIGNED NOT NULL,
  temp_question_id VARCHAR(80) NULL, question_number VARCHAR(40) NOT NULL, answer_text LONGTEXT NOT NULL, marking_points_json JSON NULL, marks DECIMAL(8,2) NULL,
  page_number INT NULL, confidence DECIMAL(4,3) NOT NULL DEFAULT .500, review_status ENUM('pending','approved','edited','rejected') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_import_mark_ref(public_ref), CONSTRAINT fk_assessment_import_mark_school FOREIGN KEY(school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_import_mark_job FOREIGN KEY(import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_import_question_answer_links (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, public_ref CHAR(36) NOT NULL, school_id BIGINT UNSIGNED NOT NULL, import_job_id BIGINT UNSIGNED NOT NULL,
  import_question_id BIGINT UNSIGNED NOT NULL, marking_item_id BIGINT UNSIGNED NOT NULL, match_method ENUM('exact_number','fuzzy_number','semantic','manual') NOT NULL,
  confidence DECIMAL(4,3) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_import_link(import_question_id,marking_item_id), UNIQUE KEY uq_assessment_import_link_ref(public_ref),
  CONSTRAINT fk_assessment_import_link_school FOREIGN KEY(school_id) REFERENCES schools(id), CONSTRAINT fk_assessment_import_link_job FOREIGN KEY(import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_import_link_question FOREIGN KEY(import_question_id) REFERENCES assessment_import_questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_import_link_mark FOREIGN KEY(marking_item_id) REFERENCES assessment_import_marking_items(id) ON DELETE CASCADE
);

ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS source_import_job_id BIGINT UNSIGNED NULL AFTER source_type;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS is_daily_drill_eligible TINYINT(1) NOT NULL DEFAULT 1 AFTER source_import_job_id;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS formula_json JSON NULL AFTER is_daily_drill_eligible;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS assets_json JSON NULL AFTER formula_json;
ALTER TABLE question_bank MODIFY COLUMN source_type ENUM('smartlink_original','teacher_created','school_upload','ai_generated','licensed_partner','past_paper_style','assessment_import') NOT NULL DEFAULT 'teacher_created';
