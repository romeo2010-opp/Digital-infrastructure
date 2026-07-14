ALTER TABLE student_guardians
  ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id,
  ADD COLUMN IF NOT EXISTS user_id BIGINT UNSIGNED NULL AFTER student_id;

UPDATE student_guardians
SET public_ref=UUID()
WHERE public_ref IS NULL OR public_ref='';

ALTER TABLE student_guardians
  MODIFY COLUMN public_ref CHAR(36) NOT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_student_guardian_public_ref (public_ref),
  ADD KEY IF NOT EXISTS idx_student_guardian_user (school_id,user_id),
  ADD CONSTRAINT fk_student_guardian_user FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE IF NOT EXISTS parent_academic_insights (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  reporting_period VARCHAR(120) NULL,
  headline VARCHAR(240) NOT NULL,
  summary_text TEXT NOT NULL,
  strengths_json JSON NOT NULL,
  focus_areas_json JSON NOT NULL,
  attendance_effect_text TEXT NULL,
  home_support_json JSON NOT NULL,
  completed_interventions_json JSON NOT NULL,
  evidence_summary_json JSON NOT NULL,
  visibility_json JSON NULL,
  status ENUM('draft','approved','published','withdrawn') NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  published_by BIGINT UNSIGNED NULL,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_parent_academic_insight_ref (public_ref),
  KEY idx_parent_academic_insight_student (school_id,student_id,status,created_at),
  CONSTRAINT fk_parent_academic_insight_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_parent_academic_insight_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_parent_academic_insight_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_parent_academic_insight_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_parent_academic_insight_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_parent_academic_insight_publisher FOREIGN KEY (published_by) REFERENCES users(id)
);
