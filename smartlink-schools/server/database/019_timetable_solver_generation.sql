USE smartlink_schools;

CREATE TABLE IF NOT EXISTS curriculum_period_requirements (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  timetable_id BIGINT UNSIGNED NULL,
  class_id BIGINT UNSIGNED NULL,
  stream_section VARCHAR(80) NULL,
  student_group_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NULL,
  teacher_id BIGINT UNSIGNED NULL,
  assistant_teacher_id BIGINT UNSIGNED NULL,
  entry_type ENUM(
    'LESSON',
    'SUBJECT_LESSON',
    'PRACTICAL_LESSON',
    'LABORATORY_LESSON',
    'COMPUTER_LESSON',
    'STUDY',
    'CUSTOM'
  ) NOT NULL DEFAULT 'LESSON',
  periods_per_cycle INT UNSIGNED NOT NULL DEFAULT 1,
  block_length INT UNSIGNED NOT NULL DEFAULT 1,
  required_facility_id BIGINT UNSIGNED NULL,
  required_facility_type VARCHAR(80) NULL,
  preferred_facility_ids JSON NULL,
  required_equipment_json JSON NULL,
  allowed_cycle_day_ids JSON NULL,
  preferred_cycle_day_ids JSON NULL,
  avoided_cycle_day_ids JSON NULL,
  allowed_slot_ids JSON NULL,
  preferred_slot_ids JSON NULL,
  avoided_slot_ids JSON NULL,
  required_capacity INT UNSIGNED NULL,
  priority INT NOT NULL DEFAULT 50,
  active TINYINT(1) NOT NULL DEFAULT 1,
  metadata JSON NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_curriculum_requirements_scope (school_id, academic_year_id, term_id, timetable_id, active),
  KEY idx_curriculum_requirements_class_subject (school_id, class_id, subject_id, teacher_id, active),
  CONSTRAINT fk_curriculum_requirements_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_curriculum_requirements_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_curriculum_requirements_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_curriculum_requirements_timetable FOREIGN KEY (timetable_id) REFERENCES timetables(id),
  CONSTRAINT fk_curriculum_requirements_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_curriculum_requirements_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_curriculum_requirements_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_curriculum_requirements_assistant FOREIGN KEY (assistant_teacher_id) REFERENCES users(id),
  CONSTRAINT fk_curriculum_requirements_facility FOREIGN KEY (required_facility_id) REFERENCES school_facilities(id),
  CONSTRAINT fk_curriculum_requirements_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_curriculum_requirements_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

ALTER TABLE timetable_generation_jobs
  MODIFY COLUMN job_status ENUM(
    'QUEUED',
    'PREPARING_INPUT',
    'RUNNING',
    'RUNNING_SOLVER',
    'VALIDATING_RESULT',
    'SAVING_DRAFT',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'QUEUED';

ALTER TABLE timetable_generation_jobs
  MODIFY COLUMN progress_stage ENUM(
    'PREPARING_INPUT',
    'RUNNING_FEASIBILITY_AUDIT',
    'CONSTRUCTING_SOLVER_MODEL',
    'RUNNING_SOLVER',
    'SEARCHING_FOR_SOLUTION',
    'VALIDATING_RESULT',
    'SAVING_DRAFT',
    'COMPLETE',
    'FAILED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'PREPARING_INPUT';

ALTER TABLE timetable_generation_jobs
  ADD COLUMN IF NOT EXISTS exam_series_id BIGINT UNSIGNED NULL AFTER timetable_version_id,
  ADD COLUMN IF NOT EXISTS job_type ENUM(
    'SCHOOL_TIMETABLE_GENERATION',
    'SCHOOL_TIMETABLE_ASSISTED_COMPLETION',
    'EXAM_TIMETABLE_GENERATION',
    'EXAM_ROOM_ALLOCATION',
    'INVIGILATION_ALLOCATION',
    'ALTERNATIVE_SLOT_SEARCH',
    'TODAY_INTELLIGENCE_REFRESH'
  ) NOT NULL DEFAULT 'SCHOOL_TIMETABLE_GENERATION' AFTER exam_series_id,
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER requested_by,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP NULL AFTER completed_at,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL AFTER failed_at,
  ADD COLUMN IF NOT EXISTS solver_request_id VARCHAR(120) NULL AFTER cancelled_at,
  ADD COLUMN IF NOT EXISTS strategy VARCHAR(80) NULL AFTER solver_request_id,
  ADD COLUMN IF NOT EXISTS scope_type VARCHAR(80) NULL AFTER strategy,
  ADD COLUMN IF NOT EXISTS scope_reference_id BIGINT UNSIGNED NULL AFTER scope_type,
  ADD COLUMN IF NOT EXISTS objective_score DECIMAL(12,2) NULL AFTER solver_status,
  ADD COLUMN IF NOT EXISTS hard_conflict_count INT UNSIGNED NULL AFTER objective_score,
  ADD COLUMN IF NOT EXISTS soft_penalty_score DECIMAL(12,2) NULL AFTER hard_conflict_count,
  ADD COLUMN IF NOT EXISTS alternatives_count INT UNSIGNED NULL AFTER soft_penalty_score,
  ADD COLUMN IF NOT EXISTS result_snapshot JSON NULL AFTER solver_metrics;

ALTER TABLE timetable_entries
  MODIFY COLUMN entry_type ENUM(
    'LESSON',
    'SUBJECT_LESSON',
    'PRACTICAL_LESSON',
    'LABORATORY_LESSON',
    'COMPUTER_LESSON',
    'WEEKLY_ACTIVITY',
    'ASSEMBLY',
    'CHAPEL',
    'RELIGIOUS_PROGRAMME',
    'SPORTS',
    'CLUB',
    'STUDY',
    'STAFF_ACTIVITY',
    'STAFF_MEETING',
    'EXAM_PAPER',
    'PRACTICAL_EXAM',
    'COMPUTER_BASED_EXAM',
    'LISTENING_EXAM',
    'INVIGILATION',
    'ROOM_HOLD',
    'FACILITY_HOLD',
    'CUSTOM'
  ) NOT NULL DEFAULT 'LESSON';

