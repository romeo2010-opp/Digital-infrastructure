USE smartlink_schools;

/* Auditable AI interpretation metadata. Raw prompts and learner records are
   intentionally not stored; only scoped references and the validated output
   are retained. */
CREATE TABLE IF NOT EXISTS academic_ai_narration_runs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NULL,
  scope_json JSON NOT NULL,
  finding_refs_json JSON NOT NULL,
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  prompt_version VARCHAR(80) NOT NULL,
  output_schema_version VARCHAR(40) NOT NULL DEFAULT '1.0',
  source ENUM('ai_explained','deterministic') NOT NULL,
  validation_status ENUM('valid','fallback','rejected') NOT NULL,
  output_json JSON NULL,
  validation_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_academic_ai_narration_ref (public_ref),
  KEY idx_academic_ai_narration_scope (school_id, created_at),
  CONSTRAINT fk_academic_ai_narration_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_academic_ai_narration_user FOREIGN KEY (requested_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS academic_intelligence_snapshots (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  scope_type ENUM('student','class','subject','topic','school') NOT NULL,
  scope_ref CHAR(36) NULL,
  metric_key VARCHAR(100) NOT NULL,
  metric_value DECIMAL(8,2) NULL,
  confidence_score DECIMAL(5,2) NULL,
  evidence_state VARCHAR(40) NOT NULL DEFAULT 'insufficient',
  reason VARCHAR(255) NULL,
  evidence_summary_json JSON NULL,
  formula_version VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_academic_intelligence_snapshot_ref (public_ref),
  KEY idx_academic_intelligence_snapshot_scope (school_id, scope_type, scope_ref, metric_key, created_at),
  CONSTRAINT fk_academic_intelligence_snapshot_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_academic_intelligence_snapshot_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_academic_intelligence_snapshot_term FOREIGN KEY (term_id) REFERENCES terms(id)
);

