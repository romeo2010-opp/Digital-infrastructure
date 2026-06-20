USE smartlink_schools;

CREATE TABLE IF NOT EXISTS assessment_blocks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  parent_block_id BIGINT UNSIGNED NULL,
  block_type ENUM(
    'cover_field',
    'heading',
    'paragraph',
    'instructions',
    'section',
    'question',
    'sub_question',
    'mcq_options',
    'answer_space',
    'image',
    'shape',
    'table',
    'equation',
    'page_break',
    'text_box',
    'marking_scheme',
    'teacher_note'
  ) NOT NULL,
  content_json JSON NOT NULL,
  style_json JSON NULL,
  metadata_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_printable TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_blocks_scope (school_id, assessment_id, sort_order),
  KEY idx_assessment_blocks_parent (school_id, parent_block_id),
  CONSTRAINT fk_assessment_blocks_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_blocks_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  CONSTRAINT fk_assessment_blocks_parent FOREIGN KEY (parent_block_id) REFERENCES assessment_blocks(id)
);

CREATE TABLE IF NOT EXISTS assessment_media (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(180) NOT NULL,
  file_type VARCHAR(80) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  storage_path VARCHAR(255) NOT NULL,
  alt_text VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_media_scope (school_id, assessment_id, created_at),
  CONSTRAINT fk_assessment_media_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_media_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  CONSTRAINT fk_assessment_media_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
