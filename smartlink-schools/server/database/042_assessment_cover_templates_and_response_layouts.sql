USE smartlink_schools;

ALTER TABLE assessment_import_questions
  ADD COLUMN IF NOT EXISTS response_layout_json JSON NULL AFTER assets_json;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS source_import_job_id BIGINT UNSIGNED NULL AFTER exam_session_id,
  ADD COLUMN IF NOT EXISTS cover_template_id BIGINT UNSIGNED NULL AFTER source_import_job_id;

CREATE TABLE IF NOT EXISTS assessment_cover_templates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NULL,
  template_name VARCHAR(180) NOT NULL,
  template_description VARCHAR(500) NULL,
  source_type ENUM('built_in','school_created','imported_pdf','duplicated') NOT NULL,
  source_import_job_id BIGINT UNSIGNED NULL,
  source_assessment_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NULL,
  class_id BIGINT UNSIGNED NULL,
  assessment_type VARCHAR(40) NULL,
  template_category ENUM('exam','test','quiz','homework','worksheet','daily_drill','general') NOT NULL DEFAULT 'general',
  layout_json JSON NOT NULL,
  style_json JSON NULL,
  preview_image_path VARCHAR(500) NULL,
  thumbnail_image_path VARCHAR(500) NULL,
  extracted_from_page_number INT NULL,
  confidence DECIMAL(4,3) NULL,
  signature_hash CHAR(64) NULL,
  signature_json JSON NULL,
  appearance_count INT UNSIGNED NOT NULL DEFAULT 1,
  usage_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_global TINYINT(1) NOT NULL DEFAULT 0,
  review_status ENUM('pending','approved','rejected','archived') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_cover_template_ref(public_ref),
  KEY idx_assessment_cover_template_library(school_id,review_status,is_active,template_category),
  KEY idx_assessment_cover_template_signature(school_id,signature_hash),
  CONSTRAINT fk_cover_template_school FOREIGN KEY(school_id) REFERENCES schools(id),
  CONSTRAINT fk_cover_template_import FOREIGN KEY(source_import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE SET NULL,
  CONSTRAINT fk_cover_template_assessment FOREIGN KEY(source_assessment_id) REFERENCES assessments(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assessment_template_assets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NULL,
  template_id BIGINT UNSIGNED NOT NULL,
  asset_type ENUM('logo','image','background','signature','seal','decorative','unknown') NOT NULL DEFAULT 'unknown',
  file_path VARCHAR(500) NOT NULL,
  original_file_path VARCHAR(500) NULL,
  bbox_json JSON NULL,
  style_json JSON NULL,
  alt_text VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_template_asset_ref(public_ref),
  KEY idx_assessment_template_asset(template_id,asset_type),
  CONSTRAINT fk_template_asset_school FOREIGN KEY(school_id) REFERENCES schools(id),
  CONSTRAINT fk_template_asset_template FOREIGN KEY(template_id) REFERENCES assessment_cover_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_template_usage (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  template_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NULL,
  import_job_id BIGINT UNSIGNED NULL,
  used_by BIGINT UNSIGNED NOT NULL,
  used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  context_json JSON NULL,
  KEY idx_assessment_template_usage(school_id,template_id,used_at),
  CONSTRAINT fk_template_usage_school FOREIGN KEY(school_id) REFERENCES schools(id),
  CONSTRAINT fk_template_usage_template FOREIGN KEY(template_id) REFERENCES assessment_cover_templates(id),
  CONSTRAINT fk_template_usage_assessment FOREIGN KEY(assessment_id) REFERENCES assessments(id) ON DELETE SET NULL,
  CONSTRAINT fk_template_usage_import FOREIGN KEY(import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE SET NULL,
  CONSTRAINT fk_template_usage_user FOREIGN KEY(used_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assessment_template_matches (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  import_job_id BIGINT UNSIGNED NOT NULL,
  extracted_template_id BIGINT UNSIGNED NULL,
  matched_template_id BIGINT UNSIGNED NULL,
  match_score DECIMAL(4,3) NOT NULL,
  match_reasons_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_assessment_template_match(school_id,import_job_id,match_score),
  CONSTRAINT fk_template_match_school FOREIGN KEY(school_id) REFERENCES schools(id),
  CONSTRAINT fk_template_match_import FOREIGN KEY(import_job_id) REFERENCES assessment_import_jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_template_match_extracted FOREIGN KEY(extracted_template_id) REFERENCES assessment_cover_templates(id) ON DELETE SET NULL,
  CONSTRAINT fk_template_match_existing FOREIGN KEY(matched_template_id) REFERENCES assessment_cover_templates(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS assessment_template_settings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  auto_suggest_templates TINYINT(1) NOT NULL DEFAULT 1,
  auto_apply_default_template TINYINT(1) NOT NULL DEFAULT 0,
  default_exam_template_id BIGINT UNSIGNED NULL,
  default_test_template_id BIGINT UNSIGNED NULL,
  default_quiz_template_id BIGINT UNSIGNED NULL,
  default_worksheet_template_id BIGINT UNSIGNED NULL,
  default_daily_drill_template_id BIGINT UNSIGNED NULL,
  allow_teachers_to_create_templates TINYINT(1) NOT NULL DEFAULT 1,
  require_template_approval TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_template_settings_school(school_id),
  CONSTRAINT fk_template_settings_school FOREIGN KEY(school_id) REFERENCES schools(id)
);

INSERT INTO assessment_cover_templates (
  public_ref,school_id,template_name,template_description,source_type,template_category,
  layout_json,style_json,confidence,is_global,review_status,approved_at
)
SELECT UUID(),NULL,seed.template_name,seed.template_description,'built_in',seed.template_category,
  seed.layout_json,seed.style_json,1,1,'approved',CURRENT_TIMESTAMP
FROM (
  SELECT 'Classic Exam Cover' template_name,'Formal SmartLink exam cover with candidate details and instructions.' template_description,'exam' template_category,
    JSON_OBJECT('version',1,'paper_size','A4','cover_style','structured_template','sections',JSON_ARRAY('header','title','metadata','candidate_details','instructions','footer'),'candidate_fields',JSON_ARRAY('student_name','student_id'),'metadata_fields',JSON_ARRAY('subject_name','class_name','duration','total_marks','assessment_date')) layout_json,
    JSON_OBJECT('theme','classic','accent','#111827','font_family','serif') style_json
  UNION ALL SELECT 'Modern Clean Cover','Clean SmartLink cover with a branded header and metadata grid.','general',
    JSON_OBJECT('version',1,'paper_size','A4','cover_style','structured_template','sections',JSON_ARRAY('brand','title','metadata','candidate_details','instructions'),'candidate_fields',JSON_ARRAY('student_name','class_name'),'metadata_fields',JSON_ARRAY('subject_name','term_name','duration','total_marks')),
    JSON_OBJECT('theme','modern','accent','#6d28d9','font_family','sans-serif')
  UNION ALL SELECT 'International Exam Simple Cover','Minimal generic international-style assessment cover.','exam',
    JSON_OBJECT('version',1,'paper_size','A4','cover_style','structured_template','sections',JSON_ARRAY('title','paper_details','candidate_details','instructions','information','footer'),'candidate_fields',JSON_ARRAY('student_name','student_id'),'metadata_fields',JSON_ARRAY('subject_name','assessment_date','duration','total_marks')),
    JSON_OBJECT('theme','international_simple','accent','#111827','font_family','sans-serif')
  UNION ALL SELECT 'Primary Worksheet Cover','Friendly structured cover for primary worksheets.','worksheet',
    JSON_OBJECT('version',1,'paper_size','A4','cover_style','structured_template','sections',JSON_ARRAY('brand','title','student_details','worksheet_details','instructions'),'candidate_fields',JSON_ARRAY('student_name','class_name','assessment_date'),'metadata_fields',JSON_ARRAY('subject_name','teacher_name')),
    JSON_OBJECT('theme','primary','accent','#0f766e','font_family','sans-serif')
  UNION ALL SELECT 'Daily Drill Cover','Compact SmartLink practice-sheet cover.','daily_drill',
    JSON_OBJECT('version',1,'paper_size','A4','cover_style','structured_template','sections',JSON_ARRAY('brand','title','drill_details','student_details'),'candidate_fields',JSON_ARRAY('student_name','assessment_date'),'metadata_fields',JSON_ARRAY('subject_name','topic_name','subtopic_name','duration')),
    JSON_OBJECT('theme','daily_drill','accent','#2563eb','font_family','sans-serif')
) seed
WHERE NOT EXISTS (
  SELECT 1 FROM assessment_cover_templates existing
  WHERE existing.school_id IS NULL AND existing.source_type='built_in' AND existing.template_name=seed.template_name
);

