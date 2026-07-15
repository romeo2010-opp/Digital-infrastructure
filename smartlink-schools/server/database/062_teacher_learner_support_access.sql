USE smartlink_schools;

/* Teacher access extensions for the canonical learner-support lifecycle.
   Cases, evidence, cycles, sessions, reassessments and notifications remain in
   the existing 060/059 structures. */

CREATE TABLE IF NOT EXISTS learner_support_case_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  assigned_user_id BIGINT UNSIGNED NOT NULL,
  assignment_type ENUM('owner','support_teacher','action') NOT NULL DEFAULT 'support_teacher',
  assignment_status ENUM('assigned','acknowledged','reassignment_requested','completed','removed') NOT NULL DEFAULT 'assigned',
  action_label VARCHAR(180) NULL,
  due_at TIMESTAMP NULL,
  acknowledged_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  assigned_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_assignment_ref (public_ref),
  UNIQUE KEY uq_support_assignment_active (school_id,case_id,assigned_user_id,assignment_type),
  KEY idx_support_assignment_queue (school_id,assigned_user_id,assignment_status,due_at),
  KEY idx_support_assignment_case (school_id,case_id,assignment_status),
  CONSTRAINT fk_support_assignment_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_assignment_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_assignment_user FOREIGN KEY (assigned_user_id) REFERENCES users(id),
  CONSTRAINT fk_support_assignment_assigner FOREIGN KEY (assigned_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learner_support_case_notes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  author_user_id BIGINT UNSIGNED NOT NULL,
  visibility ENUM('teacher_academic','support_team','coordinator_only','headteacher_only','guardian_meeting','administrative_restricted') NOT NULL DEFAULT 'teacher_academic',
  note_text TEXT NOT NULL,
  status ENUM('active','corrected','withdrawn') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_support_note_ref (public_ref),
  KEY idx_support_note_case (school_id,case_id,status,created_at),
  KEY idx_support_note_author (school_id,author_user_id,created_at),
  CONSTRAINT fk_support_note_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_support_note_case FOREIGN KEY (case_id) REFERENCES learner_support_cases(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_note_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_support_note_author FOREIGN KEY (author_user_id) REFERENCES users(id)
);

ALTER TABLE intervention_sessions
  MODIFY COLUMN status ENUM('planned','completed','partially_completed','cancelled','learner_absent','teacher_absent','rescheduled','missed') NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS duration_minutes INT UNSIGNED NULL AFTER completed_at,
  ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(80) NULL AFTER duration_minutes,
  ADD COLUMN IF NOT EXISTS target_topic_id BIGINT UNSIGNED NULL AFTER delivery_method,
  ADD COLUMN IF NOT EXISTS target_objective_id BIGINT UNSIGNED NULL AFTER target_topic_id,
  ADD COLUMN IF NOT EXISTS teacher_observation TEXT NULL AFTER teacher_notes,
  ADD COLUMN IF NOT EXISTS next_action TEXT NULL AFTER practice_assigned,
  ADD CONSTRAINT fk_intervention_session_topic FOREIGN KEY (target_topic_id) REFERENCES syllabus_topics(id),
  ADD CONSTRAINT fk_intervention_session_objective FOREIGN KEY (target_objective_id) REFERENCES learning_objectives(id);

ALTER TABLE academic_intervention_reassessments
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMP NULL AFTER comparability_json;
