-- 053_assistant_action_logs.sql
-- Dedicated audit trail for SmartLink Assistant requests and confirmations.
-- Safe to rerun.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

CREATE TABLE IF NOT EXISTS assistant_action_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_id CHAR(26) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  session_public_id VARCHAR(64) NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'assistant',
  action_type VARCHAR(96) NOT NULL,
  intent VARCHAR(64) NULL,
  request_text TEXT NULL,
  structured_payload LONGTEXT NULL,
  outcome_status ENUM('REQUESTED','PREPARED','CONFIRMED','SUCCEEDED','BLOCKED','FAILED') NOT NULL DEFAULT 'REQUESTED',
  error_message VARCHAR(255) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_assistant_action_logs_user_time (user_id, created_at),
  KEY idx_assistant_action_logs_session_time (session_public_id, created_at),
  KEY idx_assistant_action_logs_action_time (action_type, created_at),
  KEY idx_assistant_action_logs_intent_time (intent, created_at),
  CONSTRAINT fk_assistant_action_logs_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
