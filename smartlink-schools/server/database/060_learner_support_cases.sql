USE smartlink_schools;

/* Persistent learner support and term-safe mastery.
   Existing academic alerts/interventions remain source records. Support cases
   provide the durable identity, timeline, delivery and escalation lifecycle. */

ALTER TABLE academic_mastery_records
  ADD COLUMN IF NOT EXISTS academic_year_id BIGINT UNSIGNED NULL AFTER school_id,
  ADD COLUMN IF NOT EXISTS term_id BIGINT UNSIGNED NULL AFTER academic_year_id,
  ADD COLUMN IF NOT EXISTS session_scope_key VARCHAR(200) NOT NULL DEFAULT '' AFTER scope_key,
  ADD KEY IF NOT EXISTS idx_academic_mastery_session (school_id,academic_year_id,term_id,student_id,subject_id,mastery_level),
  ADD CONSTRAINT fk_academic_mastery_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  ADD CONSTRAINT fk_academic_mastery_term FOREIGN KEY (term_id) REFERENCES terms(id);

UPDATE academic_mastery_records
SET session_scope_key=CONCAT(COALESCE(academic_year_id,0),':',COALESCE(term_id,0),':',scope_key)
WHERE session_scope_key='';

DROP INDEX IF EXISTS uq_academic_mastery_scope_key ON academic_mastery_records;
ALTER TABLE academic_mastery_records
  ADD UNIQUE KEY IF NOT EXISTS uq_academic_mastery_session_scope
    (school_id,student_id,subject_id,session_scope_key);

ALTER TABLE mastery_evidence
  ADD COLUMN IF NOT EXISTS assessment_id BIGINT UNSIGNED NULL AFTER source_entity_id,
  ADD COLUMN IF NOT EXISTS question_id BIGINT UNSIGNED NULL AFTER assessment_id,
  ADD COLUMN IF NOT EXISTS evidence_precision ENUM('question','section','topic','overall','limited') NOT NULL DEFAULT 'limited' AFTER evidence_granularity,
  ADD COLUMN IF NOT EXISTS publication_state ENUM('draft','submitted','published','locked','invalidated') NOT NULL DEFAULT 'published' AFTER evidence_precision,
  ADD COLUMN IF NOT EXISTS evidence_status ENUM('valid','absent','incomplete','excused','invalidated') NOT NULL DEFAULT 'valid' AFTER publication_state,
  ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER evidence_at,
  ADD KEY IF NOT EXISTS idx_mastery_evidence_publication (school_id,publication_state,evidence_status,academic_year_id,term_id),
  ADD KEY IF NOT EXISTS idx_mastery_evidence_assessment (school_id,assessment_id,student_id),
  ADD CONSTRAINT fk_mastery_evidence_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  ADD CONSTRAINT fk_mastery_evidence_assessment_question FOREIGN KEY (question_id) REFERENCES assessment_questions(id);

UPDATE mastery_evidence
SET assessment_id=COALESCE(assessment_id,CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.assessment_id')) AS UNSIGNED)),
    question_id=COALESCE(question_id,CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.question_id')) AS UNSIGNED)),
    evidence_precision=CASE
      WHEN evidence_granularity='objective' AND JSON_EXTRACT(metadata_json,'$.question_id') IS NOT NULL THEN 'question'
      WHEN evidence_granularity IN ('objective','subtopic','topic') THEN 'topic'
      WHEN evidence_granularity='subject_total' THEN 'overall'
      ELSE 'limited'
    END;

/* Remove evidence created by the former submit-time ingestion bug. Approved
   and locked result batches remain authoritative. */
DELETE me FROM mastery_evidence me
JOIN result_batches rb ON rb.school_id=me.school_id AND rb.id=me.source_entity_id
WHERE me.source_entity_type='result_batch' AND rb.status NOT IN ('approved','locked');

CREATE TABLE IF NOT EXISTS learner_support_cases (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  current_term_id BIGINT UNSIGNED NULL,
  class_id BIGINT UNSIGNED NULL,
  learner_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NULL,
  primary_topic_id BIGINT UNSIGNED NULL,
  primary_objective_id BIGINT UNSIGNED NULL,
  scope_type ENUM('learner','group','class','cross_subject') NOT NULL DEFAULT 'learner',
  case_type ENUM('topic_mastery','prerequisite_gap','multi_topic','multi_subject_decline','assessment_format','attendance_participation','evidence_quality','delivery_issue') NOT NULL,
  severity ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  status ENUM('detected','teacher_follow_up','intervention_active','reassessment_pending','strategy_review','academic_team_review','guardian_review','continued_support','resolved','closed_inconclusive','transferred') NOT NULL DEFAULT 'detected',
  first_detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_reviewed_at TIMESTAMP NULL,
  next_review_at TIMESTAMP NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  owner_role VARCHAR(60) NULL,
  intervention_cycle_count INT NOT NULL DEFAULT 0,
  unsuccessful_cycle_count INT NOT NULL DEFAULT 0,
  successful_cycle_count INT NOT NULL DEFAULT 0,
  comparable_failure_count INT NOT NULL DEFAULT 0,
  evidence_confidence DECIMAL(5,2) NOT NULL DEFAULT 0,
  current_summary TEXT NOT NULL,
  escalation_level TINYINT UNSIGNED NOT NULL DEFAULT 0,
  identity_key VARCHAR(255) NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  UNIQUE KEY uq_support_case_ref (public_ref),
  UNIQUE KEY uq_support_case_identity (school_id,identity_key),
  KEY idx_support_case_queue (school_id,status,escalation_level,next_review_at),
  KEY idx_support_case_learner (school_id,learner_id,status,updated_at),
  KEY idx_support_case_scope (school_id,current_term_id,class_id,subject_id,primary_topic_id,status),
  CONSTRAINT fk_support_case_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_case_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_support_case_term FOREIGN KEY (current_term_id) REFERENCES terms(id),
  CONSTRAINT fk_support_case_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_support_case_learner FOREIGN KEY (learner_id) REFERENCES students(id),
  CONSTRAINT fk_support_case_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_support_case_topic FOREIGN KEY (primary_topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_support_case_objective FOREIGN KEY (primary_objective_id) REFERENCES learning_objectives(id),
  CONSTRAINT fk_support_case_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_support_case_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_support_case_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learner_support_case_members (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  learner_id BIGINT UNSIGNED NOT NULL,
  membership_status ENUM('proposed','active','resolved','removed','transferred') NOT NULL DEFAULT 'active',
  baseline_summary_json JSON NULL,
  outcome_summary_json JSON NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_case_member_ref (public_ref),
  UNIQUE KEY uq_support_case_member (school_id,case_id,learner_id),
  KEY idx_support_case_member_learner (school_id,learner_id,membership_status),
  CONSTRAINT fk_support_member_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_member_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_member_learner FOREIGN KEY (learner_id) REFERENCES students(id),
  CONSTRAINT fk_support_member_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_support_member_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learner_support_case_topics (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  objective_id BIGINT UNSIGNED NULL,
  topic_role ENUM('primary','secondary','prerequisite','resolved_component') NOT NULL DEFAULT 'primary',
  current_mastery DECIMAL(5,2) NULL,
  previous_mastery DECIMAL(5,2) NULL,
  status ENUM('active','monitoring','resolved','removed') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_case_topic_ref (public_ref),
  UNIQUE KEY uq_support_case_topic (school_id,case_id,topic_id,objective_id,topic_role),
  KEY idx_support_case_topic_scope (school_id,subject_id,topic_id,status),
  CONSTRAINT fk_support_topic_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_topic_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_topic_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_support_topic_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_support_topic_objective FOREIGN KEY (objective_id) REFERENCES learning_objectives(id),
  CONSTRAINT fk_support_topic_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_support_topic_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learner_support_case_evidence (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  learner_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NULL,
  topic_id BIGINT UNSIGNED NULL,
  objective_id BIGINT UNSIGNED NULL,
  assessment_id BIGINT UNSIGNED NULL,
  question_id BIGINT UNSIGNED NULL,
  mastery_evidence_id BIGINT UNSIGNED NULL,
  finding_ref CHAR(36) NULL,
  evidence_role ENUM('detection','comparison','baseline','reassessment','delivery','attendance','format_pattern','resolution') NOT NULL,
  evidence_precision ENUM('question','section','topic','overall','limited') NOT NULL,
  score_percentage DECIMAL(5,2) NULL,
  marks_awarded DECIMAL(8,2) NULL,
  marks_available DECIMAL(8,2) NULL,
  confidence_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  comparable TINYINT(1) NOT NULL DEFAULT 0,
  comparability_json JSON NULL,
  evidence_status ENUM('valid','absent','incomplete','excused','invalidated','inconclusive') NOT NULL DEFAULT 'valid',
  observed_at TIMESTAMP NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_case_evidence_ref (public_ref),
  UNIQUE KEY uq_support_case_evidence_source (school_id,case_id,mastery_evidence_id,evidence_role),
  KEY idx_support_case_evidence_timeline (school_id,case_id,observed_at),
  KEY idx_support_case_evidence_compare (school_id,learner_id,subject_id,topic_id,comparable,observed_at),
  CONSTRAINT fk_support_evidence_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_evidence_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_evidence_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_support_evidence_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_support_evidence_learner FOREIGN KEY (learner_id) REFERENCES students(id),
  CONSTRAINT fk_support_evidence_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_support_evidence_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_support_evidence_objective FOREIGN KEY (objective_id) REFERENCES learning_objectives(id),
  CONSTRAINT fk_support_evidence_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  CONSTRAINT fk_support_evidence_question FOREIGN KEY (question_id) REFERENCES assessment_questions(id),
  CONSTRAINT fk_support_evidence_mastery FOREIGN KEY (mastery_evidence_id) REFERENCES mastery_evidence(id),
  CONSTRAINT fk_support_evidence_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_support_evidence_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learner_support_case_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  evidence_json JSON NULL,
  status VARCHAR(60) NOT NULL,
  responsible_user_id BIGINT UNSIGNED NULL,
  linked_entity_type VARCHAR(80) NULL,
  linked_entity_ref VARCHAR(120) NULL,
  idempotency_key VARCHAR(180) NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_case_event_ref (public_ref),
  UNIQUE KEY uq_support_case_event_idempotency (school_id,idempotency_key),
  KEY idx_support_case_event_timeline (school_id,case_id,occurred_at,id),
  CONSTRAINT fk_support_event_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_event_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_event_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_support_event_responsible FOREIGN KEY (responsible_user_id) REFERENCES users(id),
  CONSTRAINT fk_support_event_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_support_event_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS intervention_strategy_types (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  strategy_code VARCHAR(80) NOT NULL,
  label VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  supported_formats_json JSON NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_intervention_strategy_ref (public_ref),
  UNIQUE KEY uq_intervention_strategy_code (school_id,strategy_code),
  CONSTRAINT fk_intervention_strategy_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_intervention_strategy_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_intervention_strategy_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT IGNORE INTO intervention_strategy_types
  (public_ref,school_id,strategy_code,label,description)
SELECT UUID(),s.id,v.code,v.label,v.description
FROM schools s
JOIN (
  SELECT 'direct_reteaching' code,'Direct reteaching' label,'Explicitly reteach the target concept.' description UNION ALL
  SELECT 'prerequisite_reteaching','Prerequisite reteaching','Rebuild prerequisite knowledge before the target concept.' UNION ALL
  SELECT 'guided_practice','Guided practice','Teacher-supported worked practice with feedback.' UNION ALL
  SELECT 'peer_supported_practice','Peer-supported practice','Structured peer explanation and practice.' UNION ALL
  SELECT 'small_group_instruction','Small-group instruction','Targeted teaching for a learner group.' UNION ALL
  SELECT 'visual_concrete_materials','Visual or concrete materials','Use models, diagrams or manipulatives.' UNION ALL
  SELECT 'oral_diagnostic','Oral diagnostic','Check understanding through an oral response.' UNION ALL
  SELECT 'written_diagnostic','Written diagnostic','Check understanding through written responses.' UNION ALL
  SELECT 'practical_task','Practical task','Use an applied or practical demonstration.' UNION ALL
  SELECT 'timed_practice','Timed practice','Build fluency under a defined time limit.' UNION ALL
  SELECT 'untimed_practice','Untimed practice','Prioritise reasoning without time pressure.' UNION ALL
  SELECT 'worked_examples','Worked-example approach','Model complete solutions before independent work.' UNION ALL
  SELECT 'spaced_retrieval','Spaced retrieval','Revisit knowledge at planned intervals.' UNION ALL
  SELECT 'homework_reinforcement','Homework reinforcement','Provide reviewed practice outside sessions.'
) v;

CREATE TABLE IF NOT EXISTS intervention_cycles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  legacy_intervention_id BIGINT UNSIGNED NULL,
  cycle_number INT NOT NULL,
  strategy_type_id BIGINT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NULL,
  planned_session_count INT NOT NULL DEFAULT 0,
  success_criterion_json JSON NOT NULL,
  delivery_threshold DECIMAL(5,2) NOT NULL DEFAULT 80,
  attendance_threshold DECIMAL(5,2) NOT NULL DEFAULT 70,
  start_date DATE NOT NULL,
  review_date DATE NULL,
  status ENUM('planned','active','awaiting_reassessment','completed','incomplete_delivery','insufficient_participation','inconclusive','cancelled') NOT NULL DEFAULT 'planned',
  outcome ENUM('pending','effective','partially_effective','ineffective','inconclusive','not_classified') NOT NULL DEFAULT 'pending',
  diagnostic_json JSON NULL,
  version_number INT NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_intervention_cycle_ref (public_ref),
  UNIQUE KEY uq_intervention_cycle_number (school_id,case_id,cycle_number),
  KEY idx_intervention_cycle_queue (school_id,status,review_date,owner_user_id),
  CONSTRAINT fk_intervention_cycle_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_intervention_cycle_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_intervention_cycle_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_intervention_cycle_legacy FOREIGN KEY (legacy_intervention_id) REFERENCES academic_interventions(id),
  CONSTRAINT fk_intervention_cycle_strategy FOREIGN KEY (strategy_type_id) REFERENCES intervention_strategy_types(id),
  CONSTRAINT fk_intervention_cycle_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_intervention_cycle_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_intervention_cycle_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS intervention_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  cycle_id BIGINT UNSIGNED NOT NULL,
  session_number INT NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP NULL,
  status ENUM('planned','completed','cancelled','missed','rescheduled') NOT NULL DEFAULT 'planned',
  teacher_attended TINYINT(1) NULL,
  target_taught TINYINT(1) NULL,
  prerequisite_addressed TINYINT(1) NULL,
  resources_json JSON NULL,
  activities_json JSON NULL,
  teacher_notes TEXT NULL,
  practice_assigned TEXT NULL,
  review_status ENUM('pending','reviewed','follow_up_required') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_intervention_session_ref (public_ref),
  UNIQUE KEY uq_intervention_session_number (school_id,cycle_id,session_number),
  KEY idx_intervention_session_due (school_id,status,scheduled_at),
  CONSTRAINT fk_intervention_session_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_intervention_session_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_intervention_session_cycle FOREIGN KEY (cycle_id) REFERENCES intervention_cycles(id) ON DELETE CASCADE,
  CONSTRAINT fk_intervention_session_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_intervention_session_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS intervention_session_attendance (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  learner_id BIGINT UNSIGNED NOT NULL,
  attendance_status ENUM('present','absent','late','excused','not_recorded') NOT NULL DEFAULT 'not_recorded',
  note VARCHAR(500) NULL,
  status ENUM('active','corrected') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_intervention_attendance_ref (public_ref),
  UNIQUE KEY uq_intervention_attendance (school_id,session_id,learner_id),
  CONSTRAINT fk_intervention_attendance_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_intervention_attendance_session FOREIGN KEY (session_id) REFERENCES intervention_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_intervention_attendance_learner FOREIGN KEY (learner_id) REFERENCES students(id),
  CONSTRAINT fk_intervention_attendance_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_intervention_attendance_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS academic_review_meetings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  meeting_type ENUM('strategy_review','academic_team_review','headteacher_review','external_referral_consideration') NOT NULL,
  attendee_user_ids_json JSON NOT NULL,
  evidence_summary_json JSON NOT NULL,
  decisions_json JSON NULL,
  status ENUM('requested','scheduled','completed','cancelled') NOT NULL DEFAULT 'requested',
  approved_by BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_academic_review_ref (public_ref),
  KEY idx_academic_review_queue (school_id,status,scheduled_at),
  CONSTRAINT fk_academic_review_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_academic_review_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_academic_review_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_academic_review_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_academic_review_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_academic_review_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS guardian_review_records (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  guardian_id BIGINT UNSIGNED NULL,
  safe_summary TEXT NOT NULL,
  proposed_next_steps_json JSON NOT NULL,
  approval_status ENUM('draft','pending_approval','approved','rejected','shared') NOT NULL DEFAULT 'draft',
  meeting_at TIMESTAMP NULL,
  approved_by BIGINT UNSIGNED NULL,
  shared_by BIGINT UNSIGNED NULL,
  status ENUM('active','superseded','cancelled') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_guardian_review_ref (public_ref),
  KEY idx_guardian_review_approval (school_id,approval_status,meeting_at),
  CONSTRAINT fk_guardian_review_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_guardian_review_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_guardian_review_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_guardian_review_guardian FOREIGN KEY (guardian_id) REFERENCES student_guardians(id),
  CONSTRAINT fk_guardian_review_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_guardian_review_sharer FOREIGN KEY (shared_by) REFERENCES users(id),
  CONSTRAINT fk_guardian_review_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_guardian_review_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS escalation_policies (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  policy_name VARCHAR(180) NOT NULL,
  policy_json JSON NOT NULL,
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'active',
  version_number INT NOT NULL DEFAULT 1,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_escalation_policy_ref (public_ref),
  UNIQUE KEY uq_escalation_policy_version (school_id,policy_name,version_number),
  KEY idx_escalation_policy_active (school_id,status,effective_from,effective_to),
  CONSTRAINT fk_escalation_policy_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_escalation_policy_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_escalation_policy_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT INTO escalation_policies (public_ref,school_id,policy_name,policy_json,effective_from)
SELECT UUID(),s.id,'Default learner support policy',JSON_OBJECT(
  'firstWeakEvidenceAction','teacher_follow_up',
  'comparableFailureCountForIntervention',2,
  'unsuccessfulCyclesForStrategyReview',1,
  'unsuccessfulCyclesForAcademicReview',2,
  'minimumConfidenceForEscalation',65,
  'minimumSupportDeliveryRate',80,
  'minimumSupportAttendanceRate',70,
  'reviewWithinSchoolDays',5,
  'masteryThreshold',70,
  'minimumMappedMarks',5,
  'maximumComparableEvidenceDays',120,
  'reassessmentRequired',true,
  'wholeClassAffectedRate',60,
  'subgroupAffectedRate',20,
  'resolutionComparableEvidenceCount',2,
  'sustainedResolutionDays',14
),CURDATE()
FROM schools s
WHERE NOT EXISTS (SELECT 1 FROM escalation_policies ep WHERE ep.school_id=s.id AND ep.status='active');

CREATE TABLE IF NOT EXISTS escalation_decisions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  cycle_id BIGINT UNSIGNED NULL,
  policy_id BIGINT UNSIGNED NOT NULL,
  from_level TINYINT UNSIGNED NOT NULL,
  to_level TINYINT UNSIGNED NOT NULL,
  decision_type ENUM('continue','escalate','deescalate','resolve','inconclusive','operational_follow_up') NOT NULL,
  trigger_json JSON NOT NULL,
  diagnostic_json JSON NULL,
  human_approval_required TINYINT(1) NOT NULL DEFAULT 0,
  approval_status ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required',
  approved_by BIGINT UNSIGNED NULL,
  status ENUM('active','superseded','cancelled') NOT NULL DEFAULT 'active',
  idempotency_key VARCHAR(180) NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_escalation_decision_ref (public_ref),
  UNIQUE KEY uq_escalation_decision_idempotency (school_id,idempotency_key),
  KEY idx_escalation_decision_case (school_id,case_id,created_at),
  CONSTRAINT fk_escalation_decision_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_escalation_decision_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_escalation_decision_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_escalation_decision_cycle FOREIGN KEY (cycle_id) REFERENCES intervention_cycles(id),
  CONSTRAINT fk_escalation_decision_policy FOREIGN KEY (policy_id) REFERENCES escalation_policies(id),
  CONSTRAINT fk_escalation_decision_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_escalation_decision_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_escalation_decision_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS support_case_notifications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  title VARCHAR(220) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  deduplication_key VARCHAR(220) NOT NULL,
  status ENUM('pending','sent','read','dismissed','cancelled') NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP NULL,
  read_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_notification_ref (public_ref),
  UNIQUE KEY uq_support_notification_dedupe (school_id,deduplication_key),
  KEY idx_support_notification_inbox (school_id,recipient_user_id,status,created_at),
  CONSTRAINT fk_support_notification_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_notification_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_support_notification_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_notification_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  CONSTRAINT fk_support_notification_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_support_notification_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS support_case_term_transfers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  from_term_id BIGINT UNSIGNED NOT NULL,
  to_term_id BIGINT UNSIGNED NOT NULL,
  from_class_id BIGINT UNSIGNED NULL,
  to_class_id BIGINT UNSIGNED NULL,
  from_owner_user_id BIGINT UNSIGNED NULL,
  to_owner_user_id BIGINT UNSIGNED NULL,
  transfer_reason VARCHAR(500) NOT NULL,
  evidence_summary_json JSON NOT NULL,
  approval_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  approved_by BIGINT UNSIGNED NULL,
  status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_transfer_ref (public_ref),
  UNIQUE KEY uq_support_transfer_terms (school_id,case_id,from_term_id,to_term_id),
  KEY idx_support_transfer_pending (school_id,approval_status,to_term_id),
  CONSTRAINT fk_support_transfer_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_transfer_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_transfer_from_term FOREIGN KEY (from_term_id) REFERENCES terms(id),
  CONSTRAINT fk_support_transfer_to_term FOREIGN KEY (to_term_id) REFERENCES terms(id),
  CONSTRAINT fk_support_transfer_from_class FOREIGN KEY (from_class_id) REFERENCES classes(id),
  CONSTRAINT fk_support_transfer_to_class FOREIGN KEY (to_class_id) REFERENCES classes(id),
  CONSTRAINT fk_support_transfer_from_owner FOREIGN KEY (from_owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_support_transfer_to_owner FOREIGN KEY (to_owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_support_transfer_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_support_transfer_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_support_transfer_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

ALTER TABLE academic_intervention_reassessments
  ADD COLUMN IF NOT EXISTS support_case_id BIGINT UNSIGNED NULL AFTER school_id,
  ADD COLUMN IF NOT EXISTS intervention_cycle_id BIGINT UNSIGNED NULL AFTER intervention_id,
  ADD COLUMN IF NOT EXISTS comparability_json JSON NULL AFTER success_criterion_json,
  ADD COLUMN IF NOT EXISTS delivery_diagnostic_json JSON NULL AFTER outcome_summary_json,
  ADD KEY IF NOT EXISTS idx_intervention_reassessment_case (school_id,support_case_id,intervention_cycle_id,outcome),
  ADD CONSTRAINT fk_intervention_reassessment_case FOREIGN KEY (support_case_id) REFERENCES learner_support_cases(id),
  ADD CONSTRAINT fk_intervention_reassessment_cycle FOREIGN KEY (intervention_cycle_id) REFERENCES intervention_cycles(id);
