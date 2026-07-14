USE smartlink_schools;

ALTER TABLE academic_mastery_records
  ADD COLUMN IF NOT EXISTS scope_key VARCHAR(120) NOT NULL DEFAULT '' AFTER mastery_level;

UPDATE academic_mastery_records
SET scope_key = CONCAT(mastery_level, ':', COALESCE(topic_id,0), ':', COALESCE(subtopic_id,0), ':', COALESCE(learning_objective_id,0))
WHERE scope_key = '';

ALTER TABLE academic_mastery_records
  ADD UNIQUE KEY IF NOT EXISTS uq_academic_mastery_scope_key (school_id, student_id, subject_id, scope_key);

ALTER TABLE question_attempts
  ADD UNIQUE KEY IF NOT EXISTS uq_question_attempt_drill (school_id, drill_session_id, student_id, question_id);

