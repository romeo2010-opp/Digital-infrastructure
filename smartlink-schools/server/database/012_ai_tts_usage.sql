SET @has_table := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_usage_logs'
);
SET @ddl := IF(
  @has_table > 0,
  "ALTER TABLE ai_usage_logs MODIFY COLUMN feature_name ENUM('syllabus_extraction', 'question_generation', 'explanation_adaptation', 'explanation_tts', 'ai_test') NOT NULL",
  "SELECT 1"
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
