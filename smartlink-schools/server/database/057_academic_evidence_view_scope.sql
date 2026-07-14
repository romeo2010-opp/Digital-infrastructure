-- Refresh the adapter view after the session-scope columns exist.
CREATE OR REPLACE VIEW academic_intelligence_evidence AS
SELECT
  me.public_ref,
  me.school_id,
  me.academic_year_id,
  me.term_id,
  me.student_id,
  me.class_id,
  me.subject_id,
  me.topic_id,
  me.subtopic_id,
  me.learning_objective_id,
  me.evidence_type AS source_type,
  me.source_entity_type,
  me.source_entity_id,
  me.score_percentage AS value,
  me.marks_awarded,
  me.marks_available AS maximum_value,
  me.evidence_granularity AS mapping_quality,
  me.evidence_at AS observed_at,
  me.created_at AS recorded_at,
  me.metadata_json
FROM mastery_evidence me;
