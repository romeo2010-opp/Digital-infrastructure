USE smartlink_schools;

CREATE TABLE IF NOT EXISTS director_tasks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  category ENUM('finance','academics','staff','admissions','operations','general') NOT NULL DEFAULT 'general',
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  status ENUM('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
  assigned_to_user_id BIGINT UNSIGNED NULL,
  assigned_by_user_id BIGINT UNSIGNED NOT NULL,
  due_date DATE NULL,
  linked_entity_type VARCHAR(80) NULL,
  linked_entity_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  KEY idx_director_tasks_scope (school_id, status, due_date, priority),
  KEY idx_director_tasks_assignee (school_id, assigned_to_user_id, status),
  CONSTRAINT fk_director_tasks_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_director_tasks_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users(id),
  CONSTRAINT fk_director_tasks_assigner FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS director_notes (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  note TEXT NOT NULL,
  visibility ENUM('director_only','leadership') NOT NULL DEFAULT 'director_only',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_director_notes_entity (school_id, entity_type, entity_id, created_at),
  CONSTRAINT fk_director_notes_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_director_notes_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS fee_payment_promises (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  guardian_name VARCHAR(160) NULL,
  promised_amount DECIMAL(14,2) NOT NULL,
  promised_date DATE NOT NULL,
  note TEXT NULL,
  status ENUM('pending','fulfilled','missed','cancelled') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_fee_promises_scope (school_id, status, promised_date),
  CONSTRAINT fk_fee_promises_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_fee_promises_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_fee_promises_user FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS director_daily_closures (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  closure_date DATE NOT NULL,
  completed_by BIGINT UNSIGNED NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_director_daily_closure (school_id, closure_date),
  CONSTRAINT fk_director_closure_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_director_closure_user FOREIGN KEY (completed_by) REFERENCES users(id)
);
