USE smartlink_schools;

/* Academic Operations Loop
   ------------------------
   This migration extends the existing assessment, evidence, intervention and
   task domains. It intentionally does not create replacement syllabus,
   mastery, alert, recommendation or result-total tables. */

CREATE TABLE IF NOT EXISTS assessment_sections (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  instructions TEXT NULL,
  marks_available DECIMAL(8,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_assessment_section_ref (public_ref),
  KEY idx_assessment_section_scope (school_id,assessment_id,sort_order),
  CONSTRAINT fk_assessment_section_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_assessment_section_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_section_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_assessment_section_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

ALTER TABLE assessment_questions
  ADD COLUMN IF NOT EXISTS section_id BIGINT UNSIGNED NULL AFTER assessment_id,
  ADD COLUMN IF NOT EXISTS parent_question_id BIGINT UNSIGNED NULL AFTER section_id,
  ADD COLUMN IF NOT EXISTS learning_objective_id BIGINT UNSIGNED NULL AFTER subtopic_id,
  ADD COLUMN IF NOT EXISTS syllabus_strand VARCHAR(180) NULL AFTER subtopic_text,
  ADD COLUMN IF NOT EXISTS marking_points_json JSON NULL AFTER marking_scheme,
  ADD COLUMN IF NOT EXISTS mapping_status ENUM('unmapped','mapped','review_required') NOT NULL DEFAULT 'unmapped' AFTER marking_points_json,
  ADD KEY IF NOT EXISTS idx_assessment_question_hierarchy (school_id,assessment_id,parent_question_id,sort_order),
  ADD KEY IF NOT EXISTS idx_assessment_question_objective (school_id,learning_objective_id),
  ADD CONSTRAINT fk_assessment_question_section FOREIGN KEY (section_id) REFERENCES assessment_sections(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_assessment_question_parent FOREIGN KEY (parent_question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_assessment_question_objective FOREIGN KEY (learning_objective_id) REFERENCES learning_objectives(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS question_topic_mappings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_question_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  allocation_type ENUM('marks','percentage','primary','secondary') NOT NULL DEFAULT 'marks',
  allocated_marks DECIMAL(8,2) NULL,
  allocated_percentage DECIMAL(5,2) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_question_topic_mapping_ref (public_ref),
  UNIQUE KEY uq_question_topic_mapping (school_id,assessment_question_id,topic_id),
  KEY idx_question_topic_scope (school_id,topic_id,assessment_question_id),
  CONSTRAINT fk_question_topic_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_question_topic_question FOREIGN KEY (assessment_question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_question_topic_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_question_topic_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_question_topic_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS question_objective_mappings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_question_id BIGINT UNSIGNED NOT NULL,
  learning_objective_id BIGINT UNSIGNED NOT NULL,
  mapping_role ENUM('primary','secondary') NOT NULL DEFAULT 'primary',
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_question_objective_mapping_ref (public_ref),
  UNIQUE KEY uq_question_objective_mapping (school_id,assessment_question_id,learning_objective_id),
  KEY idx_question_objective_scope (school_id,learning_objective_id,assessment_question_id),
  CONSTRAINT fk_question_objective_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_question_objective_question FOREIGN KEY (assessment_question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_question_objective_objective FOREIGN KEY (learning_objective_id) REFERENCES learning_objectives(id),
  CONSTRAINT fk_question_objective_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_question_objective_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

/* Existing single-topic assessment questions become explicit mappings. This
   preserves their original precision without inventing multi-topic weights. */
INSERT IGNORE INTO question_topic_mappings
  (public_ref,school_id,assessment_question_id,topic_id,allocation_type,allocated_marks,is_primary,created_by)
SELECT UUID(),aq.school_id,aq.id,aq.topic_id,'marks',aq.marks,1,a.created_by
FROM assessment_questions aq
JOIN assessments a ON a.id=aq.assessment_id AND a.school_id=aq.school_id
WHERE aq.topic_id IS NOT NULL;

INSERT IGNORE INTO question_objective_mappings
  (public_ref,school_id,assessment_question_id,learning_objective_id,mapping_role,created_by)
SELECT UUID(),aq.school_id,aq.id,aq.learning_objective_id,'primary',a.created_by
FROM assessment_questions aq
JOIN assessments a ON a.id=aq.assessment_id AND a.school_id=aq.school_id
WHERE aq.learning_objective_id IS NOT NULL;

UPDATE assessment_questions aq
SET aq.mapping_status=IF(EXISTS(
  SELECT 1 FROM question_topic_mappings qtm
  WHERE qtm.school_id=aq.school_id AND qtm.assessment_question_id=aq.id
),'mapped','unmapped');

CREATE TABLE IF NOT EXISTS question_source_permissions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  question_bank_id BIGINT UNSIGNED NOT NULL,
  permission_status ENUM('school_owned','teacher_authored','public_domain','licensed','internal_use_only','attribution_required','unknown_permission','prohibited_reuse') NOT NULL DEFAULT 'unknown_permission',
  attribution_text VARCHAR(500) NULL,
  licence_reference VARCHAR(255) NULL,
  reuse_allowed TINYINT(1) NOT NULL DEFAULT 0,
  transformation_allowed TINYINT(1) NOT NULL DEFAULT 0,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_question_permission_ref (public_ref),
  UNIQUE KEY uq_question_permission_source (school_id,question_bank_id),
  KEY idx_question_permission_reuse (school_id,permission_status,reuse_allowed,transformation_allowed),
  CONSTRAINT fk_question_permission_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_question_permission_question FOREIGN KEY (question_bank_id) REFERENCES question_bank(id) ON DELETE CASCADE,
  CONSTRAINT fk_question_permission_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
  CONSTRAINT fk_question_permission_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_question_permission_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS question_source_lineage (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  question_bank_id BIGINT UNSIGNED NULL,
  assessment_question_id BIGINT UNSIGNED NULL,
  source_question_bank_id BIGINT UNSIGNED NULL,
  source_assessment_id BIGINT UNSIGNED NULL,
  source_year YEAR NULL,
  source_institution_type VARCHAR(100) NULL,
  transformation_type ENUM('original','verbatim','rephrased','parallel','difficulty_adjusted','context_changed','ai_generated') NOT NULL DEFAULT 'original',
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  prompt_version VARCHAR(80) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_question_lineage_ref (public_ref),
  KEY idx_question_lineage_bank (school_id,question_bank_id),
  KEY idx_question_lineage_assessment (school_id,assessment_question_id),
  CONSTRAINT fk_question_lineage_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_question_lineage_bank FOREIGN KEY (question_bank_id) REFERENCES question_bank(id) ON DELETE CASCADE,
  CONSTRAINT fk_question_lineage_assessment_question FOREIGN KEY (assessment_question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE,
  CONSTRAINT fk_question_lineage_source_question FOREIGN KEY (source_question_bank_id) REFERENCES question_bank(id) ON DELETE SET NULL,
  CONSTRAINT fk_question_lineage_source_assessment FOREIGN KEY (source_assessment_id) REFERENCES assessments(id) ON DELETE SET NULL,
  CONSTRAINT fk_question_lineage_creator FOREIGN KEY (created_by) REFERENCES users(id)
);

/* Conservative defaults: school/teacher-authored material may be reused;
   every other source remains unavailable until a person records permission. */
INSERT IGNORE INTO question_source_permissions
  (public_ref,school_id,question_bank_id,permission_status,reuse_allowed,transformation_allowed,created_by)
SELECT UUID(),q.school_id,q.id,
  CASE WHEN q.source_type='teacher_created' THEN 'teacher_authored' ELSE 'school_owned' END,
  1,1,COALESCE(q.created_by,q.approved_by)
FROM question_bank q
WHERE q.source_type IN ('teacher_created','smartlink_original','ai_generated')
  AND COALESCE(q.created_by,q.approved_by) IS NOT NULL;

CREATE TABLE IF NOT EXISTS academic_mark_sheets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  assessment_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  entry_mode ENUM('question','topic','overall') NOT NULL,
  evidence_level ENUM('question','section','topic','overall') NOT NULL,
  status ENUM('draft','submitted','published','locked','returned') NOT NULL DEFAULT 'draft',
  completion_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  idempotency_key VARCHAR(120) NULL,
  version_number INT NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  published_by BIGINT UNSIGNED NULL,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_academic_mark_sheet_ref (public_ref),
  UNIQUE KEY uq_academic_mark_sheet_assessment (school_id,assessment_id,entry_mode),
  UNIQUE KEY uq_academic_mark_sheet_idempotency (school_id,idempotency_key),
  KEY idx_academic_mark_sheet_scope (school_id,academic_year_id,term_id,class_id,subject_id,status),
  CONSTRAINT fk_academic_mark_sheet_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_academic_mark_sheet_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  CONSTRAINT fk_academic_mark_sheet_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_academic_mark_sheet_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_academic_mark_sheet_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_academic_mark_sheet_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_academic_mark_sheet_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_academic_mark_sheet_updater FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT fk_academic_mark_sheet_publisher FOREIGN KEY (published_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learner_assessment_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  mark_sheet_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  participation_status ENUM('pending','present','absent','incomplete','excused') NOT NULL DEFAULT 'pending',
  overall_marks DECIMAL(8,2) NULL,
  percentage DECIMAL(5,2) NULL,
  mastery_state ENUM('not_assessed','emerging','developing','secure','advanced') NOT NULL DEFAULT 'not_assessed',
  evidence_confidence DECIMAL(5,2) NOT NULL DEFAULT 0,
  is_official TINYINT(1) NOT NULL DEFAULT 0,
  teacher_comment VARCHAR(500) NULL,
  last_saved_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_learner_assessment_entry_ref (public_ref),
  UNIQUE KEY uq_learner_assessment_entry (school_id,mark_sheet_id,student_id),
  KEY idx_learner_assessment_student (school_id,student_id,is_official,updated_at),
  CONSTRAINT fk_learner_assessment_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_learner_assessment_sheet FOREIGN KEY (mark_sheet_id) REFERENCES academic_mark_sheets(id) ON DELETE CASCADE,
  CONSTRAINT fk_learner_assessment_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_learner_assessment_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_learner_assessment_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learner_question_marks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  mark_sheet_id BIGINT UNSIGNED NOT NULL,
  learner_entry_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  assessment_question_id BIGINT UNSIGNED NOT NULL,
  marks_awarded DECIMAL(8,2) NULL,
  marks_available DECIMAL(8,2) NOT NULL,
  response_status ENUM('unmarked','marked','omitted','not_applicable') NOT NULL DEFAULT 'unmarked',
  is_official TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_learner_question_mark_ref (public_ref),
  UNIQUE KEY uq_learner_question_mark (school_id,mark_sheet_id,student_id,assessment_question_id),
  KEY idx_learner_question_evidence (school_id,assessment_question_id,is_official),
  CONSTRAINT fk_learner_question_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_learner_question_sheet FOREIGN KEY (mark_sheet_id) REFERENCES academic_mark_sheets(id) ON DELETE CASCADE,
  CONSTRAINT fk_learner_question_entry FOREIGN KEY (learner_entry_id) REFERENCES learner_assessment_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_learner_question_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_learner_question_question FOREIGN KEY (assessment_question_id) REFERENCES assessment_questions(id),
  CONSTRAINT fk_learner_question_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_learner_question_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learner_topic_results (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  mark_sheet_id BIGINT UNSIGNED NOT NULL,
  learner_entry_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  marks_awarded DECIMAL(8,2) NULL,
  marks_available DECIMAL(8,2) NOT NULL,
  percentage DECIMAL(5,2) NULL,
  mastery_state ENUM('not_assessed','emerging','developing','secure','advanced') NOT NULL DEFAULT 'not_assessed',
  evidence_level ENUM('question','section','topic') NOT NULL,
  confidence_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  is_official TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_learner_topic_result_ref (public_ref),
  UNIQUE KEY uq_learner_topic_result (school_id,mark_sheet_id,student_id,topic_id),
  KEY idx_learner_topic_evidence (school_id,topic_id,student_id,is_official),
  CONSTRAINT fk_learner_topic_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_learner_topic_sheet FOREIGN KEY (mark_sheet_id) REFERENCES academic_mark_sheets(id) ON DELETE CASCADE,
  CONSTRAINT fk_learner_topic_entry FOREIGN KEY (learner_entry_id) REFERENCES learner_assessment_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_learner_topic_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_learner_topic_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_learner_topic_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_learner_topic_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS generated_assessments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  source_finding_ref CHAR(36) NULL,
  intervention_id BIGINT UNSIGNED NULL,
  assessment_id BIGINT UNSIGNED NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NULL,
  purpose ENUM('diagnostic','prerequisite_check','intervention_baseline','intervention_reassessment','mastery_confirmation','catch_up_test','exam_preparation','misconception_check') NOT NULL,
  title VARCHAR(220) NOT NULL,
  duration_minutes INT NOT NULL,
  total_marks DECIMAL(8,2) NOT NULL,
  question_count INT NOT NULL,
  difficulty_distribution_json JSON NOT NULL,
  target_objectives_json JSON NULL,
  prerequisite_topics_json JSON NULL,
  baseline_evidence_json JSON NULL,
  status ENUM('draft','generated','review_required','approved','published','archived') NOT NULL DEFAULT 'draft',
  generation_source ENUM('deterministic','ai_draft','teacher') NOT NULL DEFAULT 'deterministic',
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  prompt_version VARCHAR(80) NULL,
  reviewer_id BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_generated_assessment_ref (public_ref),
  KEY idx_generated_assessment_scope (school_id,class_id,subject_id,topic_id,status,created_at),
  CONSTRAINT fk_generated_assessment_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_generated_assessment_intervention FOREIGN KEY (intervention_id) REFERENCES academic_interventions(id) ON DELETE SET NULL,
  CONSTRAINT fk_generated_assessment_published FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL,
  CONSTRAINT fk_generated_assessment_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_generated_assessment_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_generated_assessment_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_generated_assessment_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_generated_assessment_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_generated_assessment_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id),
  CONSTRAINT fk_generated_assessment_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_generated_assessment_updater FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS generated_assessment_versions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  generated_assessment_id BIGINT UNSIGNED NOT NULL,
  version_number INT NOT NULL,
  paper_json JSON NOT NULL,
  validation_json JSON NOT NULL,
  change_summary VARCHAR(500) NULL,
  approval_status ENUM('draft','review_required','approved','rejected') NOT NULL DEFAULT 'review_required',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_generated_assessment_version_ref (public_ref),
  UNIQUE KEY uq_generated_assessment_version (school_id,generated_assessment_id,version_number),
  CONSTRAINT fk_generated_assessment_version_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_generated_assessment_version_parent FOREIGN KEY (generated_assessment_id) REFERENCES generated_assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_generated_assessment_version_creator FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS generated_assessment_learners (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  generated_assessment_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  selection_reason TEXT NOT NULL,
  evidence_json JSON NOT NULL,
  confidence_score DECIMAL(5,2) NULL,
  confirmed_by BIGINT UNSIGNED NULL,
  confirmed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_generated_assessment_learner_ref (public_ref),
  UNIQUE KEY uq_generated_assessment_learner (school_id,generated_assessment_id,student_id),
  CONSTRAINT fk_generated_assessment_learner_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_generated_assessment_learner_parent FOREIGN KEY (generated_assessment_id) REFERENCES generated_assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_generated_assessment_learner_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_generated_assessment_learner_confirmer FOREIGN KEY (confirmed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS academic_intervention_learners (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  intervention_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  baseline_state_json JSON NULL,
  outcome_state_json JSON NULL,
  status ENUM('proposed','confirmed','active','completed','removed') NOT NULL DEFAULT 'proposed',
  confirmed_by BIGINT UNSIGNED NULL,
  confirmed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_intervention_learner_ref (public_ref),
  UNIQUE KEY uq_intervention_learner (school_id,intervention_id,student_id),
  CONSTRAINT fk_intervention_learner_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_intervention_learner_parent FOREIGN KEY (intervention_id) REFERENCES academic_interventions(id) ON DELETE CASCADE,
  CONSTRAINT fk_intervention_learner_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_intervention_learner_confirmer FOREIGN KEY (confirmed_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS academic_intervention_topics (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  intervention_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  topic_role ENUM('target','prerequisite','secondary') NOT NULL DEFAULT 'target',
  success_criterion_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_intervention_topic_ref (public_ref),
  UNIQUE KEY uq_intervention_topic (school_id,intervention_id,topic_id,topic_role),
  CONSTRAINT fk_intervention_topic_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_intervention_topic_parent FOREIGN KEY (intervention_id) REFERENCES academic_interventions(id) ON DELETE CASCADE,
  CONSTRAINT fk_intervention_topic_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS academic_intervention_reassessments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  intervention_id BIGINT UNSIGNED NOT NULL,
  generated_assessment_id BIGINT UNSIGNED NULL,
  baseline_mark_sheet_id BIGINT UNSIGNED NULL,
  reassessment_mark_sheet_id BIGINT UNSIGNED NULL,
  success_criterion_json JSON NOT NULL,
  outcome ENUM('pending','effective','partially_effective','ineffective','inconclusive') NOT NULL DEFAULT 'pending',
  outcome_summary_json JSON NULL,
  evaluated_at TIMESTAMP NULL,
  evaluated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_intervention_reassessment_ref (public_ref),
  UNIQUE KEY uq_intervention_reassessment_generated (school_id,generated_assessment_id),
  KEY idx_intervention_reassessment_scope (school_id,intervention_id,outcome),
  CONSTRAINT fk_intervention_reassessment_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_intervention_reassessment_parent FOREIGN KEY (intervention_id) REFERENCES academic_interventions(id) ON DELETE CASCADE,
  CONSTRAINT fk_intervention_reassessment_generated FOREIGN KEY (generated_assessment_id) REFERENCES generated_assessments(id) ON DELETE SET NULL,
  CONSTRAINT fk_intervention_reassessment_baseline FOREIGN KEY (baseline_mark_sheet_id) REFERENCES academic_mark_sheets(id) ON DELETE SET NULL,
  CONSTRAINT fk_intervention_reassessment_result FOREIGN KEY (reassessment_mark_sheet_id) REFERENCES academic_mark_sheets(id) ON DELETE SET NULL,
  CONSTRAINT fk_intervention_reassessment_evaluator FOREIGN KEY (evaluated_by) REFERENCES users(id)
);
