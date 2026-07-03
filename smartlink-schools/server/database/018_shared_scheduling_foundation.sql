USE smartlink_schools;

CREATE TABLE IF NOT EXISTS school_facilities (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  campus_id BIGINT UNSIGNED NULL,
  facility_code VARCHAR(60) NOT NULL,
  name VARCHAR(160) NOT NULL,
  facility_type ENUM(
    'CLASSROOM',
    'SCIENCE_LABORATORY',
    'BIOLOGY_LABORATORY',
    'CHEMISTRY_LABORATORY',
    'PHYSICS_LABORATORY',
    'GENERAL_LABORATORY',
    'COMPUTER_LABORATORY',
    'LANGUAGE_LABORATORY',
    'LIBRARY',
    'WORKSHOP',
    'ART_ROOM',
    'MUSIC_ROOM',
    'HOME_ECONOMICS_ROOM',
    'AGRICULTURE_FACILITY',
    'SPORTS_GROUND',
    'HALL',
    'MEETING_ROOM',
    'SPECIAL_NEEDS_ROOM',
    'EXAMINATION_ROOM',
    'CUSTOM'
  ) NOT NULL DEFAULT 'CLASSROOM',
  facility_type_label VARCHAR(120) NULL,
  description TEXT NULL,
  building VARCHAR(120) NULL,
  floor_label VARCHAR(60) NULL,
  normal_capacity INT UNSIGNED NULL,
  examination_capacity INT UNSIGNED NULL,
  workstation_count INT UNSIGNED NULL,
  functional_computer_count INT UNSIGNED NULL,
  is_accessible TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  can_host_normal_lessons TINYINT(1) NOT NULL DEFAULT 1,
  can_host_examinations TINYINT(1) NOT NULL DEFAULT 0,
  can_host_practical_examinations TINYINT(1) NOT NULL DEFAULT 0,
  can_host_computer_examinations TINYINT(1) NOT NULL DEFAULT 0,
  can_host_listening_examinations TINYINT(1) NOT NULL DEFAULT 0,
  can_host_multiple_groups TINYINT(1) NOT NULL DEFAULT 0,
  requires_supervision TINYINT(1) NOT NULL DEFAULT 0,
  booking_required TINYINT(1) NOT NULL DEFAULT 0,
  power_required TINYINT(1) NOT NULL DEFAULT 0,
  network_required TINYINT(1) NOT NULL DEFAULT 0,
  setup_buffer_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  cleanup_buffer_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  default_technician_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  metadata JSON NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_facilities_code (school_id, facility_code),
  KEY idx_school_facilities_type (school_id, facility_type, active),
  KEY idx_school_facilities_exam (school_id, can_host_examinations, active),
  CONSTRAINT fk_school_facilities_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_school_facilities_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_school_facilities_updated_by FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT fk_school_facilities_technician FOREIGN KEY (default_technician_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS facility_equipment (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'general',
  total_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  usable_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_facility_equipment_name (school_id, name),
  KEY idx_facility_equipment_category (school_id, category, active),
  CONSTRAINT fk_facility_equipment_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_facility_equipment_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS facility_equipment_assignments (
  facility_id BIGINT UNSIGNED NOT NULL,
  equipment_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  condition_status ENUM('GOOD', 'FAIR', 'DAMAGED', 'MAINTENANCE', 'RETIRED') NOT NULL DEFAULT 'GOOD',
  available_for_exams TINYINT(1) NOT NULL DEFAULT 1,
  available_for_lessons TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (facility_id, equipment_id),
  CONSTRAINT fk_facility_equipment_assignment_facility FOREIGN KEY (facility_id) REFERENCES school_facilities(id),
  CONSTRAINT fk_facility_equipment_assignment_equipment FOREIGN KEY (equipment_id) REFERENCES facility_equipment(id)
);

CREATE TABLE IF NOT EXISTS facility_subject_eligibility (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  facility_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  allowed_lesson_types JSON NULL,
  allowed_exam_types JSON NULL,
  preferred TINYINT(1) NOT NULL DEFAULT 0,
  required_equipment JSON NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_facility_subject (facility_id, subject_id),
  KEY idx_facility_subject_school (school_id, subject_id, active),
  CONSTRAINT fk_facility_subject_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_facility_subject_facility FOREIGN KEY (facility_id) REFERENCES school_facilities(id),
  CONSTRAINT fk_facility_subject_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS facility_availability_rules (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  facility_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  cycle_day_id BIGINT UNSIGNED NULL,
  weekday TINYINT UNSIGNED NULL,
  slot_start_id BIGINT UNSIGNED NULL,
  slot_end_id BIGINT UNSIGNED NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  availability_status ENUM('AVAILABLE', 'PREFERRED', 'RESTRICTED', 'UNAVAILABLE', 'MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE',
  reason VARCHAR(255) NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  recurring TINYINT(1) NOT NULL DEFAULT 1,
  approved_status ENUM('DRAFT', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_facility_availability_facility (school_id, facility_id, academic_year_id, term_id),
  KEY idx_facility_availability_day (facility_id, weekday, cycle_day_id, availability_status),
  CONSTRAINT fk_facility_availability_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_facility_availability_facility FOREIGN KEY (facility_id) REFERENCES school_facilities(id),
  CONSTRAINT fk_facility_availability_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_facility_availability_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_facility_availability_cycle_day FOREIGN KEY (cycle_day_id) REFERENCES timetable_cycle_days(id),
  CONSTRAINT fk_facility_availability_slot_start FOREIGN KEY (slot_start_id) REFERENCES bell_schedule_slots(id),
  CONSTRAINT fk_facility_availability_slot_end FOREIGN KEY (slot_end_id) REFERENCES bell_schedule_slots(id),
  CONSTRAINT fk_facility_availability_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS weekly_school_activities (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  name VARCHAR(180) NOT NULL,
  activity_type ENUM('ASSEMBLY', 'CHAPEL', 'RELIGIOUS_PROGRAMME', 'CLUB', 'SPORTS', 'GUIDANCE_COUNSELLING', 'LIBRARY_PROGRAMME', 'WEEKLY_TEST', 'REMEDIAL', 'STAFF_MEETING', 'DEPARTMENT_MEETING', 'STUDY', 'CLEANING', 'BROADCAST', 'STUDENT_LEADERSHIP', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
  activity_type_label VARCHAR(120) NULL,
  description TEXT NULL,
  recurrence_type ENUM('WEEKLY', 'CYCLE_DAY', 'WEEK_A', 'WEEK_B', 'EVERY_N_WEEKS', 'SELECTED_DATES', 'TERM_RANGE', 'CUSTOM') NOT NULL DEFAULT 'WEEKLY',
  recurrence_interval INT UNSIGNED NULL,
  selected_dates JSON NULL,
  weekday TINYINT UNSIGNED NULL,
  cycle_day_id BIGINT UNSIGNED NULL,
  start_slot_id BIGINT UNSIGNED NULL,
  end_slot_id BIGINT UNSIGNED NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  scope_type ENUM('WHOLE_SCHOOL', 'SELECTED_GRADES', 'SELECTED_CLASSES', 'SELECTED_STREAMS', 'SELECTED_STUDENT_GROUPS', 'SELECTED_DEPARTMENTS', 'STAFF_ONLY', 'CUSTOM') NOT NULL DEFAULT 'WHOLE_SCHOOL',
  facility_id BIGINT UNSIGNED NULL,
  responsible_teacher_id BIGINT UNSIGNED NULL,
  responsible_department_id BIGINT UNSIGNED NULL,
  attendance_required TINYINT(1) NOT NULL DEFAULT 0,
  blocks_normal_lessons TINYINT(1) NOT NULL DEFAULT 1,
  allows_exam_override TINYINT(1) NOT NULL DEFAULT 1,
  exam_policy ENUM('CONTINUE_DURING_EXAMS', 'SUSPEND_DURING_EXAMS', 'REQUIRE_MANUAL_DECISION', 'MOVE_TO_ALTERNATIVE_TIME', 'EXAMS_CANNOT_OVERRIDE') NOT NULL DEFAULT 'REQUIRE_MANUAL_DECISION',
  appears_on_student_timetables TINYINT(1) NOT NULL DEFAULT 1,
  appears_on_teacher_timetables TINYINT(1) NOT NULL DEFAULT 1,
  notify_on_change TINYINT(1) NOT NULL DEFAULT 0,
  priority INT NOT NULL DEFAULT 50,
  locked_by_default TINYINT(1) NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_weekly_activities_scope (school_id, academic_year_id, term_id, active),
  KEY idx_weekly_activities_day (school_id, weekday, cycle_day_id, active),
  KEY idx_weekly_activities_facility (school_id, facility_id, active),
  CONSTRAINT fk_weekly_activity_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_weekly_activity_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_weekly_activity_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_weekly_activity_cycle_day FOREIGN KEY (cycle_day_id) REFERENCES timetable_cycle_days(id),
  CONSTRAINT fk_weekly_activity_start_slot FOREIGN KEY (start_slot_id) REFERENCES bell_schedule_slots(id),
  CONSTRAINT fk_weekly_activity_end_slot FOREIGN KEY (end_slot_id) REFERENCES bell_schedule_slots(id),
  CONSTRAINT fk_weekly_activity_facility FOREIGN KEY (facility_id) REFERENCES school_facilities(id),
  CONSTRAINT fk_weekly_activity_teacher FOREIGN KEY (responsible_teacher_id) REFERENCES users(id),
  CONSTRAINT fk_weekly_activity_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_weekly_activity_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS weekly_school_activity_scope_assignments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  activity_id BIGINT UNSIGNED NOT NULL,
  scope_type VARCHAR(80) NOT NULL,
  scope_reference_id BIGINT UNSIGNED NULL,
  scope_value VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_weekly_activity_scope (activity_id, scope_type, scope_reference_id, scope_value),
  KEY idx_weekly_activity_scope_school (school_id, scope_type, scope_reference_id),
  CONSTRAINT fk_weekly_activity_scope_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_weekly_activity_scope_activity FOREIGN KEY (activity_id) REFERENCES weekly_school_activities(id)
);

CREATE TABLE IF NOT EXISTS school_closure_dates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  closure_date DATE NOT NULL,
  closure_type ENUM('HOLIDAY', 'EMERGENCY_CLOSURE', 'STAFF_DEVELOPMENT', 'PUBLIC_EVENT', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
  title VARCHAR(180) NOT NULL,
  reason VARCHAR(255) NULL,
  blocks_lessons TINYINT(1) NOT NULL DEFAULT 1,
  blocks_exams TINYINT(1) NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_closure_date (school_id, closure_date, title),
  KEY idx_school_closures_context (school_id, academic_year_id, term_id, active),
  CONSTRAINT fk_school_closure_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_school_closure_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_school_closure_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_school_closure_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_session_templates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  exam_session_id BIGINT UNSIGNED NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  session_date DATE NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  reporting_time TIME NULL,
  setup_buffer_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  reading_time_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  writing_time_minutes INT UNSIGNED NULL,
  collection_buffer_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  source_availability_window JSON NULL,
  override_type VARCHAR(80) NULL,
  override_reason VARCHAR(255) NULL,
  approved_by BIGINT UNSIGNED NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_exam_templates_context (school_id, academic_year_id, term_id, active),
  KEY idx_exam_templates_session (exam_session_id, session_date),
  CONSTRAINT fk_exam_template_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_exam_template_session FOREIGN KEY (exam_session_id) REFERENCES exam_sessions(id),
  CONSTRAINT fk_exam_template_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_exam_template_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_exam_template_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_exam_template_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS exam_schedule_overrides (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  examination_series_id BIGINT UNSIGNED NOT NULL,
  override_type ENUM('NORMAL_LESSONS_CONTINUE', 'PARTIAL_SUSPENSION', 'FULL_SCHOOL_SUSPENSION', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
  target_type ENUM('WHOLE_SCHOOL', 'GRADE', 'CLASS', 'STREAM', 'STUDENT_GROUP', 'FACILITY', 'WEEKLY_ACTIVITY', 'SCHOOL_TIMETABLE_ENTRY', 'CUSTOM') NOT NULL,
  target_reference_id BIGINT UNSIGNED NULL,
  target_value VARCHAR(160) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  reason VARCHAR(255) NOT NULL,
  approval_status ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_exam_overrides_scope (school_id, examination_series_id, approval_status),
  KEY idx_exam_overrides_target (school_id, target_type, target_reference_id),
  CONSTRAINT fk_exam_override_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_exam_override_session FOREIGN KEY (examination_series_id) REFERENCES exam_sessions(id),
  CONSTRAINT fk_exam_override_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_exam_override_created_by FOREIGN KEY (created_by) REFERENCES users(id)
);

ALTER TABLE timetable_rooms
  ADD COLUMN IF NOT EXISTS facility_id BIGINT UNSIGNED NULL AFTER id;

ALTER TABLE timetable_rooms
  ADD INDEX IF NOT EXISTS idx_timetable_rooms_facility (facility_id);

ALTER TABLE timetable_requirements
  ADD COLUMN IF NOT EXISTS required_facility_id BIGINT UNSIGNED NULL AFTER required_room_id;

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
    'INVIGILATION',
    'ROOM_HOLD',
    'FACILITY_HOLD',
    'CUSTOM'
  ) NOT NULL DEFAULT 'LESSON';

ALTER TABLE timetable_entries
  ADD COLUMN IF NOT EXISTS facility_id BIGINT UNSIGNED NULL AFTER room_id,
  ADD COLUMN IF NOT EXISTS assistant_teacher_id BIGINT UNSIGNED NULL AFTER teacher_id,
  ADD COLUMN IF NOT EXISTS source_weekly_activity_id BIGINT UNSIGNED NULL AFTER source_requirement_id,
  ADD COLUMN IF NOT EXISTS required_equipment_json JSON NULL AFTER source_weekly_activity_id,
  ADD COLUMN IF NOT EXISTS notify_on_publication TINYINT(1) NOT NULL DEFAULT 0 AFTER required_equipment_json;

ALTER TABLE timetable_entries
  ADD INDEX IF NOT EXISTS idx_timetable_entries_facility (timetable_version_id, facility_id, cycle_day_id, calendar_date),
  ADD INDEX IF NOT EXISTS idx_timetable_entries_weekly_activity (source_weekly_activity_id);

ALTER TABLE daily_schedule_adjustments
  ADD COLUMN IF NOT EXISTS replacement_facility_id BIGINT UNSIGNED NULL AFTER replacement_room_id;

ALTER TABLE exam_sessions
  ADD COLUMN IF NOT EXISTS operating_mode ENUM('NORMAL_LESSONS_CONTINUE', 'PARTIAL_SUSPENSION', 'FULL_SCHOOL_SUSPENSION', 'CUSTOM') NOT NULL DEFAULT 'NORMAL_LESSONS_CONTINUE' AFTER status,
  ADD COLUMN IF NOT EXISTS source_availability_snapshot JSON NULL AFTER notes,
  ADD COLUMN IF NOT EXISTS override_policy JSON NULL AFTER source_availability_snapshot;

ALTER TABLE exam_timetable_entries
  ADD COLUMN IF NOT EXISTS facility_id BIGINT UNSIGNED NULL AFTER room,
  ADD COLUMN IF NOT EXISTS setup_buffer_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER end_time,
  ADD COLUMN IF NOT EXISTS reading_time_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER setup_buffer_minutes,
  ADD COLUMN IF NOT EXISTS collection_buffer_minutes INT UNSIGNED NOT NULL DEFAULT 0 AFTER reading_time_minutes,
  ADD COLUMN IF NOT EXISTS source_availability_window JSON NULL AFTER collection_buffer_minutes,
  ADD COLUMN IF NOT EXISTS override_id BIGINT UNSIGNED NULL AFTER source_availability_window;

ALTER TABLE exam_timetable_entries
  ADD INDEX IF NOT EXISTS idx_exam_timetable_facility (school_id, facility_id, exam_date, start_time, end_time);

INSERT INTO school_facilities (
  school_id,
  facility_code,
  name,
  facility_type,
  facility_type_label,
  building,
  floor_label,
  normal_capacity,
  examination_capacity,
  is_accessible,
  active,
  can_host_normal_lessons,
  can_host_examinations,
  can_host_practical_examinations,
  can_host_computer_examinations,
  can_host_multiple_groups,
  created_by,
  metadata
)
SELECT
  tr.school_id,
  tr.code,
  tr.name,
  CASE tr.room_type
    WHEN 'laboratory' THEN 'GENERAL_LABORATORY'
    WHEN 'computer_lab' THEN 'COMPUTER_LABORATORY'
    WHEN 'library' THEN 'LIBRARY'
    WHEN 'workshop' THEN 'WORKSHOP'
    WHEN 'art_room' THEN 'ART_ROOM'
    WHEN 'music_room' THEN 'MUSIC_ROOM'
    WHEN 'sports_ground' THEN 'SPORTS_GROUND'
    WHEN 'hall' THEN 'HALL'
    WHEN 'special_needs' THEN 'SPECIAL_NEEDS_ROOM'
    WHEN 'office' THEN 'MEETING_ROOM'
    WHEN 'custom' THEN 'CUSTOM'
    ELSE 'CLASSROOM'
  END,
  tr.room_type,
  tr.building,
  tr.floor_label,
  tr.capacity,
  tr.exam_capacity,
  CASE WHEN JSON_EXTRACT(COALESCE(tr.accessibility, JSON_OBJECT()), '$.accessible') = true THEN 1 ELSE 0 END,
  tr.active,
  1,
  CASE WHEN tr.exam_capacity IS NULL THEN 0 ELSE 1 END,
  CASE WHEN tr.room_type IN ('laboratory', 'computer_lab', 'workshop') THEN 1 ELSE 0 END,
  CASE WHEN tr.room_type = 'computer_lab' THEN 1 ELSE 0 END,
  0,
  tr.created_by,
  JSON_OBJECT('source', 'timetable_rooms', 'timetable_room_id', tr.id, 'equipment', tr.equipment)
FROM timetable_rooms tr
LEFT JOIN school_facilities sf ON sf.school_id = tr.school_id AND sf.facility_code = tr.code
WHERE sf.id IS NULL;

UPDATE timetable_rooms tr
JOIN school_facilities sf ON sf.school_id = tr.school_id AND sf.facility_code = tr.code
SET tr.facility_id = sf.id
WHERE tr.facility_id IS NULL;
