USE smartlink_schools;

SET @school_id := (
  SELECT id
  FROM schools
  WHERE code = 'RIA'
  LIMIT 1
);

SET @timetable_id := (
  SELECT id
  FROM timetables
  WHERE school_id = @school_id AND timetable_type = 'SCHOOL_TIMETABLE'
  ORDER BY effective_from DESC, id DESC
  LIMIT 1
);

SET @owner_id := (
  SELECT id
  FROM users
  WHERE school_id = @school_id
    AND role IN ('headteacher', 'school_owner', 'super_admin')
  ORDER BY FIELD(role, 'headteacher', 'school_owner', 'super_admin'), id
  LIMIT 1
);

SET @friday_day_id := (
  SELECT id
  FROM timetable_cycle_days
  WHERE timetable_id = @timetable_id AND code = 'FRI'
  LIMIT 1
);

SET @standard_template_id := (
  SELECT id
  FROM bell_schedule_templates
  WHERE school_id = @school_id
    AND timetable_id = @timetable_id
    AND name = 'RIA Standard School Day'
  ORDER BY id
  LIMIT 1
);

SET @assigned_friday_template_id := (
  SELECT bell_template_id
  FROM timetable_day_templates
  WHERE timetable_id = @timetable_id AND cycle_day_id = @friday_day_id
  LIMIT 1
);

SET @friday_template_id := IF(
  @assigned_friday_template_id IS NOT NULL AND @assigned_friday_template_id <> @standard_template_id,
  @assigned_friday_template_id,
  (
    SELECT id
    FROM bell_schedule_templates
    WHERE school_id = @school_id
      AND timetable_id = @timetable_id
      AND id <> COALESCE(@standard_template_id, 0)
      AND name IN ('RIA Friday Half Day', 'Friday')
    ORDER BY FIELD(name, 'RIA Friday Half Day', 'Friday'), id
    LIMIT 1
  )
);

INSERT INTO bell_schedule_templates (school_id, timetable_id, name, description, is_default, active, created_by)
SELECT @school_id, @timetable_id, 'RIA Friday Half Day', 'Friday half-day teaching schedule', 0, 1, @owner_id
WHERE @school_id IS NOT NULL
  AND @timetable_id IS NOT NULL
  AND @friday_template_id IS NULL;

SET @friday_template_id := COALESCE(
  @friday_template_id,
  (
    SELECT id
    FROM bell_schedule_templates
    WHERE school_id = @school_id
      AND timetable_id = @timetable_id
      AND name = 'RIA Friday Half Day'
    ORDER BY id
    LIMIT 1
  )
);

UPDATE bell_schedule_templates
SET name = 'RIA Friday Half Day',
  description = 'Friday half-day teaching schedule',
  timetable_id = @timetable_id,
  is_default = 0,
  active = 1
WHERE id = @friday_template_id;

INSERT INTO bell_schedule_slots (
  template_id, slot_number, code, display_name, start_time, end_time,
  slot_type, teaching_allowed, can_span, sort_order
)
SELECT @friday_template_id, slot_number, code, display_name, start_time, end_time,
  slot_type, teaching_allowed, can_span, sort_order
FROM (
  SELECT 1 AS slot_number, 'P1' AS code, 'Period 1' AS display_name, '07:30:00' AS start_time, '08:10:00' AS end_time, 'TEACHING_PERIOD' AS slot_type, 1 AS teaching_allowed, 1 AS can_span, 1 AS sort_order
  UNION ALL SELECT 2, 'P2', 'Period 2', '08:10:00', '08:50:00', 'TEACHING_PERIOD', 1, 1, 2
  UNION ALL SELECT 3, 'BRK', 'Morning Break', '08:50:00', '09:05:00', 'BREAK', 0, 0, 3
  UNION ALL SELECT 4, 'P3', 'Period 3', '09:05:00', '09:45:00', 'TEACHING_PERIOD', 1, 1, 4
  UNION ALL SELECT 5, 'P4', 'Period 4', '09:45:00', '10:25:00', 'TEACHING_PERIOD', 1, 1, 5
) AS friday_slots
WHERE @friday_template_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  start_time = VALUES(start_time),
  end_time = VALUES(end_time),
  slot_type = VALUES(slot_type),
  teaching_allowed = VALUES(teaching_allowed),
  can_span = VALUES(can_span),
  sort_order = VALUES(sort_order);

INSERT INTO timetable_day_templates (timetable_id, cycle_day_id, bell_template_id, active)
SELECT @timetable_id, @friday_day_id, @friday_template_id, 1
WHERE @timetable_id IS NOT NULL
  AND @friday_day_id IS NOT NULL
  AND @friday_template_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  bell_template_id = VALUES(bell_template_id),
  active = VALUES(active);
