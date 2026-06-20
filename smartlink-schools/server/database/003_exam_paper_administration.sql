USE smartlink_schools;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS administering_teacher_id BIGINT UNSIGNED NULL AFTER teacher_id;
