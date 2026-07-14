-- Complete the canonical evidence scope so term/year filters do not depend on
-- JSON metadata or an assessment-table join.
ALTER TABLE mastery_evidence
  ADD COLUMN IF NOT EXISTS academic_year_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS term_id BIGINT UNSIGNED NULL,
  ADD KEY IF NOT EXISTS idx_mastery_evidence_session_scope (school_id, academic_year_id, term_id, class_id, subject_id, evidence_at);
