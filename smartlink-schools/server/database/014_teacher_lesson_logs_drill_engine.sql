ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS daily_drill_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS daily_drill_subject_mode ENUM('timetable', 'fixed_rotation', 'smart_rotation') NOT NULL DEFAULT 'smart_rotation',
  ADD COLUMN IF NOT EXISTS lesson_log_reminder_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lesson_log_reminder_delay_minutes INT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS lesson_log_required_before_drill_generation TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allow_backdated_lesson_logs TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS maximum_backdate_days INT NOT NULL DEFAULT 14;

ALTER TABLE question_bank
  ADD COLUMN IF NOT EXISTS quality_score DECIMAL(5,2) NULL,
  ADD COLUMN IF NOT EXISTS times_attempted INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percent_correct DECIMAL(5,2) NULL,
  ADD COLUMN IF NOT EXISTS flag_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS syllabus_topic_prerequisites (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  prerequisite_topic_id BIGINT UNSIGNED NOT NULL,
  strength ENUM('required', 'recommended') NOT NULL DEFAULT 'recommended',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_topic_prerequisite (school_id, topic_id, prerequisite_topic_id),
  KEY idx_prerequisite_topic (school_id, prerequisite_topic_id),
  CONSTRAINT fk_topic_prereq_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_topic_prereq_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_topic_prereq_prerequisite FOREIGN KEY (prerequisite_topic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS teacher_lesson_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  timetable_entry_id BIGINT UNSIGNED NULL,
  lesson_date DATE NOT NULL,
  started_at TIME NULL,
  ended_at TIME NULL,
  status ENUM('draft', 'finalized', 'reopened', 'cancelled') NOT NULL DEFAULT 'draft',
  main_topic_id BIGINT UNSIGNED NULL,
  coverage_status ENUM('introduced', 'partially_taught', 'fully_taught', 'revised', 'assessed', 'postponed') NOT NULL DEFAULT 'introduced',
  coverage_percentage INT NOT NULL DEFAULT 0,
  lesson_outcome ENUM('students_understood', 'mixed_understanding', 'students_struggled', 'not_assessed') NOT NULL DEFAULT 'not_assessed',
  difficulty_observed ENUM('none', 'low', 'medium', 'high') NOT NULL DEFAULT 'none',
  lesson_notes TEXT NULL,
  misconceptions_observed TEXT NULL,
  homework_assigned TEXT NULL,
  recommended_drill_focus TEXT NULL,
  next_lesson_action TEXT NULL,
  finalized_at TIMESTAMP NULL,
  finalized_by BIGINT UNSIGNED NULL,
  reopened_at TIMESTAMP NULL,
  reopened_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_lesson_logs_school_date (school_id, lesson_date, status),
  KEY idx_lesson_logs_teacher (school_id, teacher_id, lesson_date),
  KEY idx_lesson_logs_class_subject (school_id, class_id, subject_id, lesson_date),
  KEY idx_lesson_logs_term (school_id, term_id, status),
  KEY idx_lesson_logs_main_topic (school_id, main_topic_id, status),
  CONSTRAINT fk_lesson_logs_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_lesson_logs_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_lesson_logs_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_lesson_logs_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_lesson_logs_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_lesson_logs_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_lesson_logs_timetable FOREIGN KEY (timetable_entry_id) REFERENCES exam_timetable_entries(id),
  CONSTRAINT fk_lesson_logs_main_topic FOREIGN KEY (main_topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_lesson_logs_finalized_by FOREIGN KEY (finalized_by) REFERENCES users(id),
  CONSTRAINT fk_lesson_logs_reopened_by FOREIGN KEY (reopened_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS teacher_lesson_log_topics (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lesson_log_id BIGINT UNSIGNED NOT NULL,
  syllabus_topic_id BIGINT UNSIGNED NOT NULL,
  syllabus_subtopic_id BIGINT UNSIGNED NULL,
  topic_role ENUM('main', 'supporting', 'prerequisite', 'revision') NOT NULL DEFAULT 'supporting',
  coverage_percentage INT NULL,
  difficulty_observed ENUM('none', 'low', 'medium', 'high') NULL,
  drill_priority_override ENUM('low', 'normal', 'high') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lesson_topic_role (lesson_log_id, syllabus_topic_id, syllabus_subtopic_id, topic_role),
  KEY idx_lesson_topic_topic (syllabus_topic_id),
  KEY idx_lesson_topic_subtopic (syllabus_subtopic_id),
  CONSTRAINT fk_lesson_topic_log FOREIGN KEY (lesson_log_id) REFERENCES teacher_lesson_logs(id) ON DELETE CASCADE,
  CONSTRAINT fk_lesson_topic_topic FOREIGN KEY (syllabus_topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_lesson_topic_subtopic FOREIGN KEY (syllabus_subtopic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS teacher_lesson_log_objectives (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lesson_log_id BIGINT UNSIGNED NOT NULL,
  learning_objective_id BIGINT UNSIGNED NOT NULL,
  achievement_status ENUM('not_started', 'partially_achieved', 'achieved', 'not_assessed') NOT NULL DEFAULT 'not_assessed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lesson_objective (lesson_log_id, learning_objective_id),
  KEY idx_lesson_objective_objective (learning_objective_id),
  CONSTRAINT fk_lesson_objective_log FOREIGN KEY (lesson_log_id) REFERENCES teacher_lesson_logs(id) ON DELETE CASCADE,
  CONSTRAINT fk_lesson_objective_objective FOREIGN KEY (learning_objective_id) REFERENCES learning_objectives(id)
);

CREATE TABLE IF NOT EXISTS teacher_lesson_log_students (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  lesson_log_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  understanding_status ENUM('understood', 'needs_support', 'absent', 'not_assessed') NOT NULL DEFAULT 'not_assessed',
  teacher_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lesson_student (lesson_log_id, student_id),
  KEY idx_lesson_student_student (student_id),
  CONSTRAINT fk_lesson_student_log FOREIGN KEY (lesson_log_id) REFERENCES teacher_lesson_logs(id) ON DELETE CASCADE,
  CONSTRAINT fk_lesson_student_student FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS lesson_log_audit_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  lesson_log_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action ENUM('created', 'updated', 'finalized', 'reopened', 'cancelled', 'topic_added', 'topic_removed') NOT NULL,
  previous_values_json JSON NULL,
  new_values_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lesson_audit_log (school_id, lesson_log_id, created_at),
  KEY idx_lesson_audit_actor (school_id, actor_user_id, created_at),
  CONSTRAINT fk_lesson_audit_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_lesson_audit_log FOREIGN KEY (lesson_log_id) REFERENCES teacher_lesson_logs(id) ON DELETE CASCADE,
  CONSTRAINT fk_lesson_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS daily_drill_generation_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  drill_session_id BIGINT UNSIGNED NULL,
  generation_date DATE NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  selected_lesson_log_ids_json JSON NULL,
  selected_topic_ids_json JSON NOT NULL,
  bucket_allocation_json JSON NOT NULL,
  candidate_question_ids_json JSON NOT NULL,
  excluded_question_ids_json JSON NULL,
  final_question_ids_json JSON NOT NULL,
  warnings_json JSON NULL,
  generator_version VARCHAR(40) NOT NULL DEFAULT 'lesson-log-v1',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_drill_generation_student (school_id, student_id, generation_date),
  KEY idx_drill_generation_session (school_id, drill_session_id),
  KEY idx_drill_generation_subject (school_id, subject_id, generation_date),
  CONSTRAINT fk_drill_generation_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_drill_generation_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_drill_generation_session FOREIGN KEY (drill_session_id) REFERENCES drill_sessions(id),
  CONSTRAINT fk_drill_generation_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
);
