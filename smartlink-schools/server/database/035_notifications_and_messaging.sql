USE smartlink_schools;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  recipient_user_id BIGINT UNSIGNED NULL,
  recipient_role VARCHAR(60) NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  category ENUM('finance','academics','staff','admissions','operations','system') NOT NULL DEFAULT 'system',
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  channel ENUM('in_app','whatsapp','email','sms') NOT NULL DEFAULT 'in_app',
  status ENUM('pending','sent','failed','read','dismissed') NOT NULL DEFAULT 'sent',
  linked_entity_type VARCHAR(80) NULL,
  linked_entity_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP NULL,
  read_at TIMESTAMP NULL,
  failure_reason VARCHAR(255) NULL,
  UNIQUE KEY uq_notifications_public_ref (public_ref),
  KEY idx_notifications_recipient (school_id, recipient_user_id, status, created_at),
  CONSTRAINT fk_notifications_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  CONSTRAINT fk_notifications_creator FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS school_whatsapp_settings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, school_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('meta_cloud_api') NOT NULL DEFAULT 'meta_cloud_api', business_account_id VARCHAR(160) NULL,
  phone_number_id VARCHAR(160) NULL, display_phone_number VARCHAR(40) NULL, access_token_encrypted TEXT NULL,
  webhook_verify_token VARCHAR(255) NULL, is_enabled TINYINT(1) NOT NULL DEFAULT 0, configured_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_whatsapp (school_id), CONSTRAINT fk_whatsapp_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS message_outbox (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, public_ref CHAR(36) NOT NULL, school_id BIGINT UNSIGNED NOT NULL,
  recipient_type ENUM('user','guardian','staff') NOT NULL, recipient_user_id BIGINT UNSIGNED NULL, recipient_name VARCHAR(160) NULL,
  recipient_phone VARCHAR(40) NULL, channel ENUM('whatsapp','in_app','email','sms') NOT NULL, template_key VARCHAR(100) NULL,
  message_body TEXT NOT NULL, status ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued', provider_message_id VARCHAR(255) NULL,
  linked_entity_type VARCHAR(80) NULL, linked_entity_id BIGINT UNSIGNED NULL, error_message VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at TIMESTAMP NULL,
  UNIQUE KEY uq_outbox_public_ref (public_ref), KEY idx_outbox_scope (school_id,status,created_at), CONSTRAINT fk_outbox_school FOREIGN KEY (school_id) REFERENCES schools(id)
);
