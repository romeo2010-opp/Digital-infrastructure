CREATE TABLE IF NOT EXISTS exam_lab_papers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  exam_board VARCHAR(80) NOT NULL DEFAULT 'MANEB',
  exam_level VARCHAR(80) NOT NULL DEFAULT 'MSCE',
  subject VARCHAR(120) NOT NULL DEFAULT 'Mathematics',
  paper ENUM('Paper 1', 'Paper 2', 'Other') NOT NULL DEFAULT 'Paper 1',
  exam_year INT NOT NULL,
  status ENUM('active', 'unavailable', 'archived') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  primary_question_version_id BIGINT UNSIGNED NULL,
  primary_mark_scheme_version_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_lab_paper_identity (exam_board, exam_level, subject, paper, exam_year),
  KEY idx_exam_lab_papers_year (exam_board, exam_level, subject, exam_year),
  CONSTRAINT fk_exam_lab_papers_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_exam_lab_papers_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_paper_versions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  paper_id BIGINT UNSIGNED NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  document_type ENUM('Question Paper', 'Mark Scheme', 'Syllabus', 'Examiner Report', 'Other') NOT NULL DEFAULT 'Question Paper',
  source_quality ENUM('Original PDF', 'Scanned PDF', 'Image', 'Manual') NOT NULL DEFAULT 'Original PDF',
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  is_trusted TINYINT(1) NOT NULL DEFAULT 0,
  use_for_training TINYINT(1) NOT NULL DEFAULT 1,
  replaces_version_id BIGINT UNSIGNED NULL,
  extraction_status ENUM('uploaded', 'extracting', 'needs_review', 'extracted', 'failed', 'archived') NOT NULL DEFAULT 'uploaded',
  extraction_quality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  extraction_summary_json JSON NULL,
  notes TEXT NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_lab_version_number (paper_id, document_type, version_number),
  KEY idx_exam_lab_versions_paper (paper_id, document_type, extraction_status),
  KEY idx_exam_lab_versions_primary (paper_id, document_type, is_primary, is_trusted),
  CONSTRAINT fk_exam_lab_versions_paper FOREIGN KEY (paper_id) REFERENCES exam_lab_papers(id),
  CONSTRAINT fk_exam_lab_versions_replaces FOREIGN KEY (replaces_version_id) REFERENCES exam_lab_paper_versions(id),
  CONSTRAINT fk_exam_lab_versions_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

ALTER TABLE exam_lab_papers
  ADD CONSTRAINT fk_exam_lab_papers_primary_question_version FOREIGN KEY (primary_question_version_id) REFERENCES exam_lab_paper_versions(id),
  ADD CONSTRAINT fk_exam_lab_papers_primary_mark_scheme_version FOREIGN KEY (primary_mark_scheme_version_id) REFERENCES exam_lab_paper_versions(id);

CREATE TABLE IF NOT EXISTS exam_lab_paper_pages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  paper_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  page_number INT NOT NULL,
  raw_text MEDIUMTEXT NULL,
  cleaned_text MEDIUMTEXT NULL,
  status ENUM('processed', 'failed', 'non_question_content') NOT NULL DEFAULT 'processed',
  error_reason VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_lab_page (version_id, page_number),
  KEY idx_exam_lab_pages_paper (paper_id, status),
  CONSTRAINT fk_exam_lab_pages_paper FOREIGN KEY (paper_id) REFERENCES exam_lab_papers(id),
  CONSTRAINT fk_exam_lab_pages_version FOREIGN KEY (version_id) REFERENCES exam_lab_paper_versions(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_extraction_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  paper_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  log_level ENUM('info', 'warning', 'error') NOT NULL DEFAULT 'info',
  message VARCHAR(500) NOT NULL,
  details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_exam_lab_extraction_logs_version (version_id, created_at),
  CONSTRAINT fk_exam_lab_logs_paper FOREIGN KEY (paper_id) REFERENCES exam_lab_papers(id),
  CONSTRAINT fk_exam_lab_logs_version FOREIGN KEY (version_id) REFERENCES exam_lab_paper_versions(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_question_candidates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  paper_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  detected_question_number VARCHAR(40) NULL,
  question_text MEDIUMTEXT NOT NULL,
  detected_marks INT NULL,
  source_page_start INT NULL,
  source_page_end INT NULL,
  confidence DECIMAL(5,3) NOT NULL DEFAULT 0,
  status ENUM('pending_review', 'needs_review', 'accepted', 'rejected', 'duplicate', 'instruction_header', 'needs_manual_fix') NOT NULL DEFAULT 'pending_review',
  accepted_question_id BIGINT UNSIGNED NULL,
  raw_json JSON NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_exam_lab_candidates_paper (paper_id, status),
  KEY idx_exam_lab_candidates_version (version_id, confidence),
  CONSTRAINT fk_exam_lab_candidates_paper FOREIGN KEY (paper_id) REFERENCES exam_lab_papers(id),
  CONSTRAINT fk_exam_lab_candidates_version FOREIGN KEY (version_id) REFERENCES exam_lab_paper_versions(id),
  CONSTRAINT fk_exam_lab_candidates_user FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_topics (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  exam_board VARCHAR(80) NOT NULL DEFAULT 'MANEB',
  exam_level VARCHAR(80) NOT NULL DEFAULT 'MSCE',
  subject VARCHAR(120) NOT NULL DEFAULT 'Mathematics',
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  syllabus_weight DECIMAL(5,2) NOT NULL DEFAULT 1,
  order_number INT NOT NULL DEFAULT 0,
  archived_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_lab_topic_scope (exam_board, exam_level, subject, name),
  KEY idx_exam_lab_topics_scope (exam_board, exam_level, subject, archived_at),
  CONSTRAINT fk_exam_lab_topics_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_exam_lab_topics_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_subtopics (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  topic_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  order_number INT NOT NULL DEFAULT 0,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_lab_subtopic (topic_id, name),
  KEY idx_exam_lab_subtopics_topic (topic_id, archived_at),
  CONSTRAINT fk_exam_lab_subtopics_topic FOREIGN KEY (topic_id) REFERENCES exam_lab_topics(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_skills (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  topic_id BIGINT UNSIGNED NOT NULL,
  subtopic_id BIGINT UNSIGNED NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_lab_skill (topic_id, subtopic_id, name),
  KEY idx_exam_lab_skills_topic (topic_id, subtopic_id, archived_at),
  CONSTRAINT fk_exam_lab_skills_topic FOREIGN KEY (topic_id) REFERENCES exam_lab_topics(id),
  CONSTRAINT fk_exam_lab_skills_subtopic FOREIGN KEY (subtopic_id) REFERENCES exam_lab_subtopics(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_questions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  paper_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NULL,
  candidate_id BIGINT UNSIGNED NULL,
  exam_board VARCHAR(80) NOT NULL DEFAULT 'MANEB',
  exam_level VARCHAR(80) NOT NULL DEFAULT 'MSCE',
  subject VARCHAR(120) NOT NULL DEFAULT 'Mathematics',
  paper ENUM('Paper 1', 'Paper 2', 'Other') NOT NULL DEFAULT 'Paper 1',
  exam_year INT NOT NULL,
  question_number VARCHAR(40) NULL,
  question_text MEDIUMTEXT NOT NULL,
  marks INT NOT NULL DEFAULT 0,
  topic_id BIGINT UNSIGNED NULL,
  subtopic_id BIGINT UNSIGNED NULL,
  skill_id BIGINT UNSIGNED NULL,
  difficulty ENUM('easy', 'medium', 'hard', 'unknown') NOT NULL DEFAULT 'unknown',
  question_type VARCHAR(80) NULL,
  command_word VARCHAR(80) NULL,
  has_diagram TINYINT(1) NOT NULL DEFAULT 0,
  has_graph TINYINT(1) NOT NULL DEFAULT 0,
  has_table TINYINT(1) NOT NULL DEFAULT 0,
  extraction_confidence DECIMAL(5,3) NOT NULL DEFAULT 0,
  tagging_confidence DECIMAL(5,3) NOT NULL DEFAULT 0,
  status ENUM('accepted', 'tagged', 'verified', 'needs_review', 'archived') NOT NULL DEFAULT 'accepted',
  verified TINYINT(1) NOT NULL DEFAULT 0,
  use_for_training TINYINT(1) NOT NULL DEFAULT 1,
  source_page INT NULL,
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  verified_by BIGINT UNSIGNED NULL,
  verified_at TIMESTAMP NULL,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_exam_lab_questions_scope (exam_board, exam_level, subject, paper, exam_year),
  KEY idx_exam_lab_questions_topic (topic_id, subtopic_id, verified, status),
  KEY idx_exam_lab_questions_paper (paper_id, status),
  CONSTRAINT fk_exam_lab_questions_paper FOREIGN KEY (paper_id) REFERENCES exam_lab_papers(id),
  CONSTRAINT fk_exam_lab_questions_version FOREIGN KEY (version_id) REFERENCES exam_lab_paper_versions(id),
  CONSTRAINT fk_exam_lab_questions_candidate FOREIGN KEY (candidate_id) REFERENCES exam_lab_question_candidates(id),
  CONSTRAINT fk_exam_lab_questions_topic FOREIGN KEY (topic_id) REFERENCES exam_lab_topics(id),
  CONSTRAINT fk_exam_lab_questions_subtopic FOREIGN KEY (subtopic_id) REFERENCES exam_lab_subtopics(id),
  CONSTRAINT fk_exam_lab_questions_skill FOREIGN KEY (skill_id) REFERENCES exam_lab_skills(id),
  CONSTRAINT fk_exam_lab_questions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_exam_lab_questions_verified_by FOREIGN KEY (verified_by) REFERENCES users(id)
);

ALTER TABLE exam_lab_question_candidates
  ADD CONSTRAINT fk_exam_lab_candidates_question FOREIGN KEY (accepted_question_id) REFERENCES exam_lab_questions(id);

CREATE TABLE IF NOT EXISTS exam_lab_mark_schemes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  paper_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NULL,
  question_id BIGINT UNSIGNED NULL,
  question_number VARCHAR(40) NULL,
  total_marks INT NOT NULL DEFAULT 0,
  mark_breakdown TEXT NULL,
  correct_answer TEXT NULL,
  method_marks TEXT NULL,
  accuracy_marks TEXT NULL,
  common_mistakes TEXT NULL,
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_exam_lab_mark_schemes_paper (paper_id, question_number),
  CONSTRAINT fk_exam_lab_mark_schemes_paper FOREIGN KEY (paper_id) REFERENCES exam_lab_papers(id),
  CONSTRAINT fk_exam_lab_mark_schemes_version FOREIGN KEY (version_id) REFERENCES exam_lab_paper_versions(id),
  CONSTRAINT fk_exam_lab_mark_schemes_question FOREIGN KEY (question_id) REFERENCES exam_lab_questions(id),
  CONSTRAINT fk_exam_lab_mark_schemes_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_question_tagging_history (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT UNSIGNED NOT NULL,
  changed_by BIGINT UNSIGNED NULL,
  previous_json JSON NULL,
  next_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_exam_lab_tagging_history_question (question_id, created_at),
  CONSTRAINT fk_exam_lab_tagging_history_question FOREIGN KEY (question_id) REFERENCES exam_lab_questions(id),
  CONSTRAINT fk_exam_lab_tagging_history_user FOREIGN KEY (changed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_backtests (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  exam_board VARCHAR(80) NOT NULL DEFAULT 'MANEB',
  exam_level VARCHAR(80) NOT NULL DEFAULT 'MSCE',
  subject VARCHAR(120) NOT NULL DEFAULT 'Mathematics',
  paper ENUM('Paper 1', 'Paper 2', 'Other') NOT NULL DEFAULT 'Paper 1',
  training_start_year INT NOT NULL,
  training_end_year INT NOT NULL,
  test_year INT NOT NULL,
  predicted_topic_count INT NOT NULL DEFAULT 10,
  prediction_method ENUM('frequency_only', 'recent_weighted', 'recency_frequency_marks') NOT NULL DEFAULT 'recency_frequency_marks',
  include_subtopics TINYINT(1) NOT NULL DEFAULT 1,
  include_mark_weight TINYINT(1) NOT NULL DEFAULT 1,
  marks_coverage DECIMAL(6,2) NOT NULL DEFAULT 0,
  top5_hit_rate DECIMAL(6,2) NOT NULL DEFAULT 0,
  top10_hit_rate DECIMAL(6,2) NOT NULL DEFAULT 0,
  confidence_level ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'low',
  result_json JSON NULL,
  warnings_json JSON NULL,
  run_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_exam_lab_backtests_scope (exam_board, exam_level, subject, paper, test_year),
  CONSTRAINT fk_exam_lab_backtests_user FOREIGN KEY (run_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_prediction_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  exam_board VARCHAR(80) NOT NULL DEFAULT 'MANEB',
  exam_level VARCHAR(80) NOT NULL DEFAULT 'MSCE',
  subject VARCHAR(120) NOT NULL DEFAULT 'Mathematics',
  paper ENUM('Paper 1', 'Paper 2', 'Other') NOT NULL DEFAULT 'Paper 1',
  target_year INT NOT NULL,
  report_title VARCHAR(255) NOT NULL,
  confidence_level ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'low',
  report_json JSON NULL,
  warnings_json JSON NULL,
  generated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_exam_lab_prediction_reports_scope (exam_board, exam_level, subject, paper, target_year),
  CONSTRAINT fk_exam_lab_prediction_reports_user FOREIGN KEY (generated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_dataset_exports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  export_type ENUM('jsonl_topic_classification', 'csv_analytics', 'clean_question_dataset', 'training_dataset') NOT NULL,
  filters_json JSON NULL,
  file_path VARCHAR(500) NULL,
  row_count INT NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exam_lab_dataset_exports_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_coverage_notes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  exam_board VARCHAR(80) NOT NULL DEFAULT 'MANEB',
  exam_level VARCHAR(80) NOT NULL DEFAULT 'MSCE',
  subject VARCHAR(120) NOT NULL DEFAULT 'Mathematics',
  paper ENUM('Paper 1', 'Paper 2', 'Other') NULL,
  exam_year INT NOT NULL,
  status ENUM('tracking', 'unavailable', 'archived') NOT NULL DEFAULT 'tracking',
  notes TEXT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_lab_coverage_note (exam_board, exam_level, subject, paper, exam_year),
  CONSTRAINT fk_exam_lab_coverage_notes_user FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_lab_activity_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_id BIGINT UNSIGNED NULL,
  details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_exam_lab_activity_logs_entity (entity_type, entity_id, created_at),
  KEY idx_exam_lab_activity_logs_user (user_id, created_at),
  CONSTRAINT fk_exam_lab_activity_logs_user FOREIGN KEY (user_id) REFERENCES users(id)
);
