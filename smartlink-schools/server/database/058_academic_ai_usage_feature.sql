-- Ensure academic narration is auditable in the shared AI usage ledger.
SET @has_ai_usage_logs := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_usage_logs'
);
SET @ai_usage_ddl := IF(
  @has_ai_usage_logs > 0,
  "ALTER TABLE ai_usage_logs MODIFY COLUMN feature_name ENUM('syllabus_extraction','question_generation','explanation_adaptation','explanation_tts','exam_paper_extraction','assessment_pdf_import','academic_intelligence','ai_test') NOT NULL",
  "SELECT 1"
);
PREPARE ai_usage_stmt FROM @ai_usage_ddl;
EXECUTE ai_usage_stmt;
DEALLOCATE PREPARE ai_usage_stmt;
