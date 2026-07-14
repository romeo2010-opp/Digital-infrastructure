USE smartlink_schools;

/* Publication now creates a question-mode mark sheet transactionally. This
   backfill repairs generated assessments published before that invariant. */
INSERT INTO academic_mark_sheets (
  public_ref,school_id,assessment_id,academic_year_id,term_id,class_id,subject_id,
  entry_mode,evidence_level,status,completion_percentage,idempotency_key,
  version_number,created_by,updated_by
)
SELECT
  UUID(),ga.school_id,ga.assessment_id,a.academic_year_id,a.term_id,a.class_id,a.subject_id,
  'question','question','draft',0,CONCAT('targeted-assessment:',ga.public_ref),
  1,ga.created_by,COALESCE(ga.updated_by,ga.created_by)
FROM generated_assessments ga
JOIN assessments a ON a.school_id=ga.school_id AND a.id=ga.assessment_id
LEFT JOIN academic_mark_sheets ams
  ON ams.school_id=ga.school_id AND ams.assessment_id=ga.assessment_id AND ams.entry_mode='question'
WHERE ga.status='published' AND ga.assessment_id IS NOT NULL AND ams.id IS NULL;
