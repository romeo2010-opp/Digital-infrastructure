USE smartlink_schools;

ALTER TABLE students ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE students SET public_ref = UUID() WHERE public_ref IS NULL OR public_ref = '';
ALTER TABLE students ADD UNIQUE INDEX IF NOT EXISTS uq_students_public_ref (public_ref);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE classes SET public_ref = UUID() WHERE public_ref IS NULL OR public_ref = '';
ALTER TABLE classes ADD UNIQUE INDEX IF NOT EXISTS uq_classes_public_ref (public_ref);

ALTER TABLE users ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE users SET public_ref = UUID() WHERE public_ref IS NULL OR public_ref = '';
ALTER TABLE users ADD UNIQUE INDEX IF NOT EXISTS uq_users_public_ref (public_ref);

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE subjects SET public_ref = UUID() WHERE public_ref IS NULL OR public_ref = '';
ALTER TABLE subjects ADD UNIQUE INDEX IF NOT EXISTS uq_subjects_public_ref (public_ref);

ALTER TABLE result_batches ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE result_batches SET public_ref = UUID() WHERE public_ref IS NULL OR public_ref = '';
ALTER TABLE result_batches ADD UNIQUE INDEX IF NOT EXISTS uq_result_batches_public_ref (public_ref);

ALTER TABLE student_withdrawals ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE student_withdrawals SET public_ref = UUID() WHERE public_ref IS NULL OR public_ref = '';
ALTER TABLE student_withdrawals ADD UNIQUE INDEX IF NOT EXISTS uq_withdrawals_public_ref (public_ref);
