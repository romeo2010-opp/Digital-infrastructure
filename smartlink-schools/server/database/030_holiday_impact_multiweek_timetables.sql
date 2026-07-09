USE smartlink_schools;

ALTER TABLE school_events
  ADD COLUMN IF NOT EXISTS class_impact ENUM(
    'ALL_CLASSES_SUSPENDED',
    'HALF_DAY',
    'NO_CLASSES_SUSPENDED'
  ) NOT NULL DEFAULT 'NO_CLASSES_SUSPENDED' AFTER event_type,
  ADD COLUMN IF NOT EXISTS half_day_closing_time TIME NULL AFTER class_impact;

UPDATE school_events
SET class_impact = CASE
    WHEN event_type IN ('holiday', 'closure') THEN 'ALL_CLASSES_SUSPENDED'
    ELSE 'NO_CLASSES_SUSPENDED'
  END
WHERE class_impact IS NULL OR class_impact = '';

ALTER TABLE school_closure_dates
  ADD COLUMN IF NOT EXISTS source_event_id BIGINT UNSIGNED NULL AFTER term_id,
  ADD COLUMN IF NOT EXISTS class_impact ENUM(
    'ALL_CLASSES_SUSPENDED',
    'HALF_DAY',
    'NO_CLASSES_SUSPENDED'
  ) NOT NULL DEFAULT 'ALL_CLASSES_SUSPENDED' AFTER closure_type,
  ADD COLUMN IF NOT EXISTS half_day_closing_time TIME NULL AFTER class_impact;

ALTER TABLE school_closure_dates
  ADD INDEX IF NOT EXISTS idx_school_closures_event (school_id, source_event_id),
  ADD INDEX IF NOT EXISTS idx_school_closures_date_impact (school_id, closure_date, class_impact, active);

UPDATE school_closure_dates
SET class_impact = CASE
    WHEN blocks_lessons = 1 THEN 'ALL_CLASSES_SUSPENDED'
    ELSE 'NO_CLASSES_SUSPENDED'
  END
WHERE class_impact IS NULL OR class_impact = '';

ALTER TABLE timetables
  ADD COLUMN IF NOT EXISTS timetable_cycle_weeks INT UNSIGNED NOT NULL DEFAULT 1 AFTER cycle_type;

ALTER TABLE timetable_entries
  ADD COLUMN IF NOT EXISTS cycle_week INT UNSIGNED NOT NULL DEFAULT 1 AFTER timetable_version_id;

ALTER TABLE timetable_entries
  ADD INDEX IF NOT EXISTS idx_timetable_entries_cycle_week (timetable_version_id, cycle_week, cycle_day_id, slot_start_id, slot_end_id);

INSERT INTO school_settings (school_id, setting_key, setting_value)
SELECT s.id, 'timetable_policy', JSON_OBJECT(
    'timetable_cycle_weeks', 1,
    'max_timetable_cycle_weeks', 4,
    'allow_duplicate_weeks', FALSE,
    'default_half_day_closing_time', '12:00:00'
  )
FROM schools s
WHERE NOT EXISTS (
  SELECT 1
  FROM school_settings existing
  WHERE existing.school_id = s.id
    AND existing.setting_key = 'timetable_policy'
);
