CREATE TABLE IF NOT EXISTS academic_migration_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  migration_key VARCHAR(120) NOT NULL,
  source_system VARCHAR(120) NOT NULL,
  migrated_records INT UNSIGNED NOT NULL DEFAULT 0,
  partially_migrated_records INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_records INT UNSIGNED NOT NULL DEFAULT 0,
  manual_review_records INT UNSIGNED NOT NULL DEFAULT 0,
  detail_json JSON NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_academic_migration_report_ref (public_ref),
  UNIQUE KEY uq_academic_migration_report_scope (school_id, migration_key),
  KEY idx_academic_migration_report_school (school_id, generated_at),
  CONSTRAINT fk_academic_migration_report_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

INSERT INTO academic_migration_reports (
  public_ref,school_id,migration_key,source_system,migrated_records,
  partially_migrated_records,skipped_records,manual_review_records,detail_json
)
SELECT UUID(),s.id,'046-topic-mastery-backfill','student_topic_mastery',0,
  COUNT(amr.id),0,
  SUM(CASE WHEN amr.confidence_score < 35 OR amr.mastery_status IN ('NOT_ASSESSED','INSUFFICIENT_EVIDENCE') THEN 1 ELSE 0 END),
  JSON_OBJECT(
    'policy','Legacy topic mastery is preserved as low-confidence topic evidence only.',
    'precision_inferred',FALSE,
    'objective_mastery_inferred',FALSE,
    'review_guidance','Map question-level evidence to learning objectives before relying on precise mastery.'
  )
FROM schools s
LEFT JOIN academic_mastery_records amr ON amr.school_id=s.id
  AND JSON_UNQUOTE(JSON_EXTRACT(amr.calculation_explanation_json,'$.migration'))='046'
GROUP BY s.id
ON DUPLICATE KEY UPDATE
  partially_migrated_records=VALUES(partially_migrated_records),
  manual_review_records=VALUES(manual_review_records),
  detail_json=VALUES(detail_json),
  generated_at=CURRENT_TIMESTAMP;
