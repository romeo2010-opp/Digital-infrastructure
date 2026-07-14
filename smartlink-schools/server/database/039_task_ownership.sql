USE smartlink_schools;
ALTER TABLE director_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL AFTER completion_data;
ALTER TABLE director_tasks ADD COLUMN IF NOT EXISTS deleted_by BIGINT UNSIGNED NULL AFTER deleted_at;
