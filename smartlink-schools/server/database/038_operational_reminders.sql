USE smartlink_schools;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS rule_key VARCHAR(100) NULL AFTER failure_reason;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_window VARCHAR(40) NULL AFTER rule_key;
ALTER TABLE notifications ADD UNIQUE INDEX IF NOT EXISTS uq_notification_dedupe (school_id,recipient_user_id,rule_key,linked_entity_type,linked_entity_id,dedupe_window);

CREATE TABLE IF NOT EXISTS reminder_rules (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, school_id BIGINT UNSIGNED NOT NULL, rule_key VARCHAR(100) NOT NULL,
 module ENUM('academics','finance','staff','admissions','operations') NOT NULL, trigger_type VARCHAR(80) NOT NULL,
 reminder_before_minutes INT NULL, reminder_after_minutes INT NULL, escalation_after_minutes INT NULL,
 escalate_to_role VARCHAR(60) NULL, is_enabled TINYINT(1) NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_reminder_rule (school_id,rule_key), CONSTRAINT fk_reminder_rule_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS message_templates (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, school_id BIGINT UNSIGNED NOT NULL, provider VARCHAR(40) NOT NULL DEFAULT 'meta_cloud_api',
 template_key VARCHAR(100) NOT NULL, provider_template_name VARCHAR(160) NULL,
 category ENUM('fee_reminder','marks_reminder','attendance_reminder','escalation','general') NOT NULL DEFAULT 'general',
 language_code VARCHAR(20) NOT NULL DEFAULT 'en', body_preview TEXT NULL, is_approved TINYINT(1) NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_message_template (school_id,provider,template_key,language_code), CONSTRAINT fk_message_template_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS staff_attendance (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, public_ref CHAR(36) NOT NULL, school_id BIGINT UNSIGNED NOT NULL,
 staff_user_id BIGINT UNSIGNED NOT NULL, attendance_date DATE NOT NULL,
 status ENUM('present','absent','late','excused','unrecorded') NOT NULL DEFAULT 'present', check_in_time TIME NULL, check_out_time TIME NULL,
 source ENUM('manual','self_check_in','qr_code','import') NOT NULL DEFAULT 'manual', recorded_by BIGINT UNSIGNED NULL, notes VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_staff_attendance_day (school_id,staff_user_id,attendance_date), UNIQUE KEY uq_staff_attendance_ref (public_ref),
 CONSTRAINT fk_staff_attendance_school FOREIGN KEY (school_id) REFERENCES schools(id), CONSTRAINT fk_staff_attendance_staff FOREIGN KEY (staff_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS staff_attendance_settings (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, school_id BIGINT UNSIGNED NOT NULL, expected_arrival_time TIME NOT NULL DEFAULT '08:00:00',
 late_after_minutes INT UNSIGNED NOT NULL DEFAULT 15, require_daily_staff_attendance TINYINT(1) NOT NULL DEFAULT 1,
 allow_teacher_self_check_in TINYINT(1) NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_staff_attendance_settings (school_id),
 CONSTRAINT fk_staff_attendance_settings_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

ALTER TABLE fee_payment_promises ADD COLUMN IF NOT EXISTS public_ref CHAR(36) NULL AFTER id;
UPDATE fee_payment_promises SET public_ref=UUID() WHERE public_ref IS NULL OR public_ref='';
ALTER TABLE fee_payment_promises ADD UNIQUE INDEX IF NOT EXISTS uq_fee_promises_ref (public_ref);
ALTER TABLE fee_payment_promises ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(40) NULL AFTER guardian_name;
