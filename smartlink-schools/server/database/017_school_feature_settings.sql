INSERT INTO school_settings (school_id, setting_key, setting_value)
SELECT
  id,
  'school_features',
  JSON_OBJECT(
    'features',
    JSON_OBJECT(
      'school_timetables', true,
      'exam_timetables', true,
      'personal_timetable_views', true,
      'student_exam_views', true,
      'invigilation_views', true,
      'timetable_generation', true,
      'timetable_publication', true,
      'daily_adjustments', false
    )
  )
FROM schools
ON DUPLICATE KEY UPDATE setting_value = setting_value;
