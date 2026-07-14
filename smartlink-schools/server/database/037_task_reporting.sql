USE smartlink_schools;
ALTER TABLE director_tasks ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE director_tasks SET public_ref=UUID() WHERE public_ref IS NULL OR public_ref='';
ALTER TABLE director_tasks ADD UNIQUE INDEX IF NOT EXISTS uq_director_tasks_public_ref (public_ref);
ALTER TABLE director_tasks ADD COLUMN IF NOT EXISTS context_snapshot JSON NULL AFTER linked_entity_id;
ALTER TABLE director_tasks ADD COLUMN IF NOT EXISTS completion_notes TEXT NULL AFTER completed_at;
ALTER TABLE director_tasks ADD COLUMN IF NOT EXISTS completion_data JSON NULL AFTER completion_notes;

CREATE TABLE IF NOT EXISTS director_task_evidence (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  evidence_type ENUM('student','receipt','payment','document','link','note','metric','other') NOT NULL DEFAULT 'other',
  label VARCHAR(180) NOT NULL,
  reference_value VARCHAR(255) NULL,
  url VARCHAR(500) NULL,
  metadata JSON NULL,
  added_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_evidence_public_ref (public_ref),
  KEY idx_task_evidence_scope (school_id,task_id,created_at),
  CONSTRAINT fk_task_evidence_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_task_evidence_task FOREIGN KEY (task_id) REFERENCES director_tasks(id),
  CONSTRAINT fk_task_evidence_user FOREIGN KEY (added_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS director_task_activity (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action ENUM('created','assigned','started','updated','evidence_added','completed','cancelled','reopened') NOT NULL,
  detail TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_activity_public_ref (public_ref),
  KEY idx_task_activity_scope (school_id,task_id,created_at),
  CONSTRAINT fk_task_activity_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_task_activity_task FOREIGN KEY (task_id) REFERENCES director_tasks(id),
  CONSTRAINT fk_task_activity_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
);
