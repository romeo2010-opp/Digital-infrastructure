USE smartlink_schools;

/* Lesson logs record ordinary school timetable periods. Migration 014 linked
   the column to exam_timetable_entries by mistake, so every existing non-NULL
   value is an exam-table identifier (or an ambiguous numeric collision). The
   two ID spaces have no provenance marker; clear all legacy values rather than
   silently relabel an exam period as an ordinary lesson period. Restrict the
   cleanup to installations where the old foreign key is still present so a
   safe migration rerun cannot erase timetable links written after correction. */
UPDATE teacher_lesson_logs lesson
JOIN information_schema.key_column_usage legacy_constraint
  ON legacy_constraint.constraint_schema=DATABASE()
 AND legacy_constraint.table_schema=DATABASE()
 AND legacy_constraint.table_name='teacher_lesson_logs'
 AND legacy_constraint.column_name='timetable_entry_id'
 AND legacy_constraint.constraint_name='fk_lesson_logs_timetable'
 AND legacy_constraint.referenced_table_name='exam_timetable_entries'
SET lesson.timetable_entry_id=NULL
WHERE lesson.timetable_entry_id IS NOT NULL;

ALTER TABLE teacher_lesson_logs
  DROP FOREIGN KEY IF EXISTS fk_lesson_logs_timetable,
  ADD CONSTRAINT fk_lesson_logs_timetable
    FOREIGN KEY (timetable_entry_id) REFERENCES timetable_entries(id);
