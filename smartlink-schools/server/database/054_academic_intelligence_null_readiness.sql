-- Academic Intelligence v2: preserve "not enough evidence" as NULL.
-- A readiness calculation can be validly unavailable when required inputs are
-- missing; coercing that state to zero makes a missing observation look like
-- a failing result.
ALTER TABLE exam_readiness_snapshots
  MODIFY COLUMN readiness_score DECIMAL(5,2) NULL;

-- The analytical adapter reads mastery_evidence and keeps source records
-- immutable. It is intentionally a view rather than a second copy of marks.
CREATE OR REPLACE VIEW academic_intelligence_evidence AS
SELECT
  me.public_ref,
  me.school_id,
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
