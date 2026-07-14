USE smartlink_schools;

-- question_number remains the internal numeric ordering key. display_number is
-- the exact reference printed on the source paper (for example 3(a)(ii)).
ALTER TABLE assessment_questions
  ADD COLUMN IF NOT EXISTS display_number VARCHAR(80) NULL AFTER question_number,
  ADD COLUMN IF NOT EXISTS source_import_question_id BIGINT UNSIGNED NULL AFTER display_number;

ALTER TABLE assessment_import_assets
  ADD COLUMN IF NOT EXISTS source_asset_key VARCHAR(120) NULL AFTER linked_question_temp_id;

ALTER TABLE assessment_import_questions
  MODIFY COLUMN question_number VARCHAR(80) NOT NULL,
  MODIFY COLUMN parent_question_number VARCHAR(80) NULL;

ALTER TABLE assessment_import_marking_items
  MODIFY COLUMN question_number VARCHAR(80) NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessment_question_import_source
  ON assessment_questions(source_import_question_id);
