ALTER TABLE student_topic_mastery
  ADD COLUMN IF NOT EXISTS latest_performance DECIMAL(5,2) NULL,
  ADD COLUMN IF NOT EXISTS confidence_label ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS trend ENUM('improving', 'steady', 'declining') NOT NULL DEFAULT 'steady',
  ADD COLUMN IF NOT EXISTS consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intervention_needed TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intervention_reason VARCHAR(255) NULL;

ALTER TABLE student_topic_mastery
  ADD INDEX IF NOT EXISTS idx_student_mastery_intervention (school_id, intervention_needed, mastery_label, next_review_at);
