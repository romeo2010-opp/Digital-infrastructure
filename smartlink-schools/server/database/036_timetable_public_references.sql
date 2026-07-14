USE smartlink_schools;
ALTER TABLE timetables ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE timetables SET public_ref=UUID() WHERE public_ref IS NULL OR public_ref='';
ALTER TABLE timetables ADD UNIQUE INDEX IF NOT EXISTS uq_timetables_public_ref (public_ref);
ALTER TABLE timetable_versions ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE timetable_versions SET public_ref=UUID() WHERE public_ref IS NULL OR public_ref='';
ALTER TABLE timetable_versions ADD UNIQUE INDEX IF NOT EXISTS uq_timetable_versions_public_ref (public_ref);
