USE smartlink_schools;

CREATE TABLE IF NOT EXISTS bell_schedule_slot_tags (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  bell_schedule_slot_id BIGINT UNSIGNED NOT NULL,
  tag_code VARCHAR(60) NOT NULL,
  tag_name VARCHAR(120) NOT NULL,
  priority INT NOT NULL DEFAULT 50,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bell_slot_tag (school_id, bell_schedule_slot_id, tag_code),
  KEY idx_bell_slot_tags_slot (bell_schedule_slot_id, active),
  KEY idx_bell_slot_tags_code (school_id, tag_code, active),
  CONSTRAINT fk_bell_slot_tags_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_bell_slot_tags_slot FOREIGN KEY (bell_schedule_slot_id) REFERENCES bell_schedule_slots(id),
  CONSTRAINT fk_bell_slot_tags_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_bell_slot_tags_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS subject_focus_categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(60) NOT NULL,
  description TEXT NULL,
  default_priority INT NOT NULL DEFAULT 50,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subject_focus_category_code (school_id, code),
  KEY idx_subject_focus_categories_school (school_id, active, default_priority),
  CONSTRAINT fk_subject_focus_categories_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_subject_focus_categories_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_subject_focus_categories_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS subject_focus_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  focus_category_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  grade_level VARCHAR(80) NULL,
  class_id BIGINT UNSIGNED NULL,
  stream_section VARCHAR(80) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_subject_focus_assignments_scope (school_id, academic_year_id, term_id, grade_level, class_id, stream_section, active),
  KEY idx_subject_focus_assignments_subject (school_id, subject_id, active),
  KEY idx_subject_focus_assignments_category (school_id, focus_category_id, active),
  CONSTRAINT fk_subject_focus_assignments_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_subject_focus_assignments_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_subject_focus_assignments_category FOREIGN KEY (focus_category_id) REFERENCES subject_focus_categories(id),
  CONSTRAINT fk_subject_focus_assignments_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_subject_focus_assignments_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_subject_focus_assignments_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_subject_focus_assignments_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_subject_focus_assignments_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS subject_focus_rules (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  focus_category_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  scope_type ENUM('WHOLE_SCHOOL', 'GRADE', 'CLASS', 'STREAM', 'SUBJECT', 'DEPARTMENT', 'CUSTOM') NOT NULL DEFAULT 'WHOLE_SCHOOL',
  scope_reference_id BIGINT UNSIGNED NULL,
  scope_value VARCHAR(120) NULL,
  class_id BIGINT UNSIGNED NULL,
  stream_section VARCHAR(80) NULL,
  grade_level VARCHAR(80) NULL,
  preferred_slot_tags JSON NULL,
  avoided_slot_tags JSON NULL,
  preferred_slot_ids JSON NULL,
  avoided_slot_ids JSON NULL,
  severity ENUM('HARD', 'SOFT') NOT NULL DEFAULT 'SOFT',
  penalty_weight INT NOT NULL DEFAULT 50,
  max_after_lunch_per_cycle INT UNSIGNED NULL,
  max_last_period_per_cycle INT UNSIGNED NULL,
  minimum_preferred_per_cycle INT UNSIGNED NULL,
  allow_override TINYINT(1) NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_subject_focus_rules_scope (school_id, academic_year_id, term_id, scope_type, active),
  KEY idx_subject_focus_rules_category (school_id, focus_category_id, active),
  KEY idx_subject_focus_rules_subject (school_id, subject_id, active),
  CONSTRAINT fk_subject_focus_rules_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_subject_focus_rules_category FOREIGN KEY (focus_category_id) REFERENCES subject_focus_categories(id),
  CONSTRAINT fk_subject_focus_rules_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_subject_focus_rules_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_subject_focus_rules_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_subject_focus_rules_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_subject_focus_rules_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_subject_focus_rules_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS stream_scheduling_rules (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  scope_type ENUM('WHOLE_SCHOOL', 'GRADE', 'CLASS', 'STREAM', 'SUBJECT', 'CUSTOM') NOT NULL DEFAULT 'WHOLE_SCHOOL',
  scope_reference_id BIGINT UNSIGNED NULL,
  scope_value VARCHAR(120) NULL,
  grade_level VARCHAR(80) NULL,
  class_id BIGINT UNSIGNED NULL,
  stream_section VARCHAR(80) NULL,
  subject_id BIGINT UNSIGNED NULL,
  policy ENUM(
    'DISALLOW_PARALLEL_SAME_SUBJECT',
    'ALLOW_PARALLEL_SAME_SUBJECT',
    'ALLOW_ONLY_WITH_DIFFERENT_TEACHERS',
    'ALLOW_ONLY_WITH_DIFFERENT_ROOMS',
    'LIMIT_PARALLEL_SAME_SUBJECT'
  ) NOT NULL DEFAULT 'DISALLOW_PARALLEL_SAME_SUBJECT',
  severity ENUM('HARD', 'SOFT') NOT NULL DEFAULT 'HARD',
  penalty_weight INT NOT NULL DEFAULT 80,
  max_parallel_count INT UNSIGNED NULL,
  require_different_teachers TINYINT(1) NOT NULL DEFAULT 0,
  require_different_rooms TINYINT(1) NOT NULL DEFAULT 0,
  allow_override TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_stream_scheduling_rules_scope (school_id, academic_year_id, term_id, scope_type, active),
  KEY idx_stream_scheduling_rules_subject (school_id, subject_id, active),
  KEY idx_stream_scheduling_rules_class (school_id, class_id, stream_section, active),
  CONSTRAINT fk_stream_scheduling_rules_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_stream_scheduling_rules_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_stream_scheduling_rules_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_stream_scheduling_rules_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_stream_scheduling_rules_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_stream_scheduling_rules_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_stream_scheduling_rules_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT IGNORE INTO subject_focus_categories (
  school_id, name, code, description, default_priority, active
)
SELECT s.id, defaults.name, defaults.code, defaults.description, defaults.default_priority, 1
FROM schools s
CROSS JOIN (
  SELECT 'High Focus' AS name, 'HIGH_FOCUS' AS code, 'Subjects that usually benefit from earlier, higher-attention periods.' AS description, 90 AS default_priority
  UNION ALL SELECT 'Moderate Focus', 'MODERATE_FOCUS', 'Subjects that prefer settled teaching time but can move when needed.', 70
  UNION ALL SELECT 'Practical', 'PRACTICAL', 'Subjects that may need practical-friendly slots, double periods, or specialist rooms.', 65
  UNION ALL SELECT 'Flexible', 'FLEXIBLE', 'Subjects that can usually fit around stronger constraints.', 50
  UNION ALL SELECT 'Low Focus', 'LOW_FOCUS', 'Subjects suitable for lower-focus periods when the school chooses that policy.', 30
  UNION ALL SELECT 'Custom', 'CUSTOM', 'School-defined focus category.', 40
) AS defaults;
