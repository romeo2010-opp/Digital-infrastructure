USE smartlink_schools;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS stream_section VARCHAR(80) NULL AFTER class_id,
  ADD COLUMN IF NOT EXISTS return_reason VARCHAR(255) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS returned_by BIGINT UNSIGNED NULL AFTER return_reason,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP NULL AFTER returned_by,
  ADD COLUMN IF NOT EXISTS approved_by BIGINT UNSIGNED NULL AFTER returned_at,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL AFTER approved_by;

CREATE INDEX IF NOT EXISTS idx_assessments_teacher_scope
  ON assessments (school_id, teacher_id, academic_year_id, term_id, status);

CREATE TABLE IF NOT EXISTS assessment_questions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  question_number INT NOT NULL,
  question_text TEXT NOT NULL,
  question_type ENUM('multiple_choice', 'true_false', 'short_answer', 'structured', 'essay', 'calculation', 'fill_blank') NOT NULL DEFAULT 'short_answer',
  marks DECIMAL(8,2) NOT NULL,
  topic_id BIGINT UNSIGNED NULL,
  topic_text VARCHAR(160) NULL,
  subtopic_id BIGINT UNSIGNED NULL,
  subtopic_text VARCHAR(160) NULL,
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
  cognitive_skill ENUM('recall', 'understanding', 'application', 'analysis') NULL,
  question_instructions TEXT NULL,
  attachment_url VARCHAR(255) NULL,
  correct_answer TEXT NULL,
  marking_scheme TEXT NULL,
  explanation TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_questions_scope (school_id, assessment_id, sort_order),
  CONSTRAINT fk_assessment_questions_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_questions_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id)
);

CREATE TABLE IF NOT EXISTS assessment_question_options (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  option_label VARCHAR(8) NOT NULL,
  option_text TEXT NOT NULL,
  is_correct TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_assessment_question_options_scope (school_id, question_id, sort_order),
  CONSTRAINT fk_assessment_question_options_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_question_options_question FOREIGN KEY (question_id) REFERENCES assessment_questions(id)
);
