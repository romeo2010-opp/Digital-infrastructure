USE smartlink_schools;

/* Lesson logs record ordinary school timetable periods. Migration 014 linked
   the column to exam_timetable_entries by mistake. Preserve only values that
   already resolve to an exact same-school class, subject and teacher period;
   ambiguous legacy exam ids are cleared instead of being relabelled. */
UPDATE teacher_lesson_logs lesson
LEFT JOIN timetable_entries entry
  ON entry.id=lesson.timetable_entry_id
  AND entry.class_id=lesson.class_id
  AND entry.subject_id=lesson.subject_id
  AND entry.teacher_id=lesson.teacher_id
LEFT JOIN timetable_versions version ON version.id=entry.timetable_version_id
LEFT JOIN timetables timetable
  ON timetable.id=version.timetable_id AND timetable.school_id=lesson.school_id
SET lesson.timetable_entry_id=NULL
WHERE lesson.timetable_entry_id IS NOT NULL AND timetable.id IS NULL;

ALTER TABLE teacher_lesson_logs
  DROP FOREIGN KEY IF EXISTS fk_lesson_logs_timetable,
  ADD CONSTRAINT fk_lesson_logs_timetable
    FOREIGN KEY (timetable_entry_id) REFERENCES timetable_entries(id);
