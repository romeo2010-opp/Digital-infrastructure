ALTER TABLE stations
  ADD COLUMN deleted_at TIMESTAMP(3) NULL AFTER updated_at;

ALTER TABLE user_preferences
  ADD COLUMN completed_welcome_tour TINYINT(1) NOT NULL DEFAULT 0 AFTER notify_email;

UPDATE user_preferences
SET completed_welcome_tour = 1;
