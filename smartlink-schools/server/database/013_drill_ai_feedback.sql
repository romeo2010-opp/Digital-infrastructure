ALTER TABLE drill_session_questions
  ADD COLUMN IF NOT EXISTS ai_feedback TEXT NULL AFTER mistake_type;
