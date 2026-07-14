-- Keep findings and interventions term-scoped. Nullable preserves legacy rows
-- until their next evidence-driven recalculation assigns a term.
ALTER TABLE academic_alerts
  ADD COLUMN IF NOT EXISTS term_id BIGINT UNSIGNED NULL,
  ADD KEY IF NOT EXISTS idx_academic_alert_term_scope (school_id, term_id, status, severity);

ALTER TABLE academic_recommendations
  ADD COLUMN IF NOT EXISTS term_id BIGINT UNSIGNED NULL,
  ADD KEY IF NOT EXISTS idx_academic_recommendation_term_scope (school_id, term_id, status, priority);

ALTER TABLE academic_interventions
  ADD COLUMN IF NOT EXISTS term_id BIGINT UNSIGNED NULL,
  ADD KEY IF NOT EXISTS idx_academic_intervention_term_scope (school_id, term_id, status, review_date);
