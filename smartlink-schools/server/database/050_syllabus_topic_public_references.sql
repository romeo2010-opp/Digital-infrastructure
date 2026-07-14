ALTER TABLE syllabus_topics
  ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;

UPDATE syllabus_topics
SET public_ref=UUID()
WHERE public_ref IS NULL OR public_ref='';

ALTER TABLE syllabus_topics
  MODIFY COLUMN public_ref CHAR(36) NOT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_syllabus_topics_public_ref (public_ref);
