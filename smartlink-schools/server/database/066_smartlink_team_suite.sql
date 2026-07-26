USE smartlink_schools;

/* SmartLink Team Suite
   Additive internal CRM and operations schema. Team identities deliberately do
   not reference school tenant users. Rollback guidance is documented in
   docs/team-suite.md and must only be used after exporting internal records. */

CREATE TABLE IF NOT EXISTS team_roles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(140) NOT NULL,
  description VARCHAR(500) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_role_code (code)
);

CREATE TABLE IF NOT EXISTS team_permissions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(120) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_permission_code (code)
);

CREATE TABLE IF NOT EXISTS team_role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id,permission_id),
  CONSTRAINT fk_team_role_permission_role FOREIGN KEY (role_id) REFERENCES team_roles(id),
  CONSTRAINT fk_team_role_permission_permission FOREIGN KEY (permission_id) REFERENCES team_permissions(id)
);

CREATE TABLE IF NOT EXISTS team_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  job_title VARCHAR(160) NULL,
  phone VARCHAR(50) NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  password_changed_at TIMESTAMP NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_user_ref (public_ref),
  UNIQUE KEY uq_team_user_email (email),
  KEY idx_team_users_active (is_active,full_name),
  CONSTRAINT fk_team_user_creator FOREIGN KEY (created_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  assigned_by BIGINT UNSIGNED NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,role_id),
  CONSTRAINT fk_team_user_role_user FOREIGN KEY (user_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_user_role_role FOREIGN KEY (role_id) REFERENCES team_roles(id),
  CONSTRAINT fk_team_user_role_actor FOREIGN KEY (assigned_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_school_prospects (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  tenant_school_id BIGINT UNSIGNED NULL,
  name VARCHAR(220) NOT NULL,
  school_type ENUM('preschool','primary','secondary','combined','college','other') NOT NULL DEFAULT 'other',
  status ENUM('prospect','qualified_prospect','active_opportunity','customer','former_customer','disqualified','competitor_managed','follow_up_later','do_not_contact') NOT NULL DEFAULT 'prospect',
  location VARCHAR(180) NULL,
  district VARCHAR(120) NULL,
  physical_address VARCHAR(500) NULL,
  website VARCHAR(500) NULL,
  social_page VARCHAR(500) NULL,
  main_phone VARCHAR(50) NULL,
  whatsapp_number VARCHAR(50) NULL,
  email VARCHAR(190) NULL,
  email_domain VARCHAR(190) NULL,
  estimated_enrolment INT UNSIGNED NULL,
  estimated_fee_min DECIMAL(12,2) NULL,
  estimated_fee_max DECIMAL(12,2) NULL,
  campus_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  curriculum VARCHAR(160) NULL,
  attendance_mode ENUM('boarding','day','mixed','unknown') NOT NULL DEFAULT 'unknown',
  has_website TINYINT(1) NOT NULL DEFAULT 0,
  has_portal TINYINT(1) NOT NULL DEFAULT 0,
  has_management_system TINYINT(1) NOT NULL DEFAULT 0,
  current_software_provider VARCHAR(180) NULL,
  uses_spreadsheets TINYINT(1) NOT NULL DEFAULT 0,
  uses_paper_records TINYINT(1) NOT NULL DEFAULT 0,
  internet_reliability ENUM('unknown','poor','fair','good','excellent') NOT NULL DEFAULT 'unknown',
  computer_availability ENUM('unknown','none','limited','adequate','strong') NOT NULL DEFAULT 'unknown',
  teachers_with_laptops INT UNSIGNED NULL,
  library_computers INT UNSIGNED NULL,
  existing_system_renewal_date DATE NULL,
  technology_limitations TEXT NULL,
  ability_to_pay_score TINYINT UNSIGNED NULL,
  operational_pain_score TINYINT UNSIGNED NULL,
  digital_readiness_score TINYINT UNSIGNED NULL,
  decision_maker_access ENUM('unknown','none','indirect','direct') NOT NULL DEFAULT 'unknown',
  urgency ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  estimated_deal_value DECIMAL(14,2) NULL,
  conversion_probability DECIMAL(5,2) NULL,
  priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  lead_source VARCHAR(160) NULL,
  assigned_user_id BIGINT UNSIGNED NULL,
  pipeline_stage VARCHAR(80) NOT NULL DEFAULT 'discovered',
  next_action VARCHAR(500) NULL,
  next_action_at DATETIME NULL,
  competitor VARCHAR(180) NULL,
  main_objection VARCHAR(500) NULL,
  notes TEXT NULL,
  archived_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_school_ref (public_ref),
  KEY idx_team_school_directory (archived_at,status,priority,name),
  KEY idx_team_school_assignment (assigned_user_id,status,next_action_at),
  KEY idx_team_school_duplicate_phone (main_phone,whatsapp_number),
  KEY idx_team_school_duplicate_email (email_domain),
  KEY idx_team_school_tenant (tenant_school_id),
  CONSTRAINT fk_team_school_tenant FOREIGN KEY (tenant_school_id) REFERENCES schools(id),
  CONSTRAINT fk_team_school_assignee FOREIGN KEY (assigned_user_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_school_creator FOREIGN KEY (created_by) REFERENCES team_users(id),
  CONSTRAINT fk_team_school_updater FOREIGN KEY (updated_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_school_contacts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  full_name VARCHAR(180) NOT NULL,
  position VARCHAR(160) NULL,
  phone VARCHAR(50) NULL,
  whatsapp_number VARCHAR(50) NULL,
  email VARCHAR(190) NULL,
  preferred_channel ENUM('unknown','phone','whatsapp','email','visit') NOT NULL DEFAULT 'unknown',
  preferred_contact_time VARCHAR(120) NULL,
  influence_level ENUM('unknown','low','medium','high') NOT NULL DEFAULT 'unknown',
  decision_authority ENUM('unknown','none','recommender','joint','final') NOT NULL DEFAULT 'unknown',
  relationship_strength ENUM('unknown','weak','developing','strong') NOT NULL DEFAULT 'unknown',
  communication_consent TINYINT(1) NOT NULL DEFAULT 0,
  last_contacted_at DATETIME NULL,
  notes TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_contact_ref (public_ref),
  KEY idx_team_contact_school (school_id,is_active,full_name),
  KEY idx_team_contact_duplicates (phone,whatsapp_number,email),
  CONSTRAINT fk_team_contact_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_contact_creator FOREIGN KEY (created_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_contact_classifications (
  contact_id BIGINT UNSIGNED NOT NULL,
  classification ENUM('decision_maker','champion','influencer','blocker','end_user','technical_contact','finance_contact','unknown') NOT NULL,
  PRIMARY KEY (contact_id,classification),
  CONSTRAINT fk_team_contact_classification_contact FOREIGN KEY (contact_id) REFERENCES team_school_contacts(id)
);

CREATE TABLE IF NOT EXISTS team_school_relationships (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  related_school_id BIGINT UNSIGNED NOT NULL,
  relationship_type ENUM('duplicate','separate_campus','related_school','same_group','not_a_match') NOT NULL,
  confirmed_by BIGINT UNSIGNED NOT NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_school_relationship (school_id,related_school_id),
  CONSTRAINT fk_team_relationship_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_relationship_related FOREIGN KEY (related_school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_relationship_actor FOREIGN KEY (confirmed_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_sales_opportunities (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(220) NOT NULL,
  assigned_owner_id BIGINT UNSIGNED NOT NULL,
  stage ENUM('discovered','researching','qualified','ready_for_outreach','first_message_sent','awaiting_response','responded','needs_assessment','meeting_scheduled','demo_scheduled','demo_completed','proposal_requested','proposal_sent','negotiation','verbal_agreement','contract_sent','contract_signed','deposit_pending','closed_won','closed_lost','follow_up_later') NOT NULL DEFAULT 'discovered',
  estimated_setup_revenue DECIMAL(14,2) NOT NULL DEFAULT 0,
  estimated_term_revenue DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_expected_value DECIMAL(14,2) NOT NULL DEFAULT 0,
  probability DECIMAL(5,2) NOT NULL DEFAULT 0,
  expected_close_date DATE NULL,
  proposed_package VARCHAR(160) NULL,
  original_price DECIMAL(14,2) NULL,
  requested_discount DECIMAL(14,2) NOT NULL DEFAULT 0,
  approved_discount DECIMAL(14,2) NOT NULL DEFAULT 0,
  final_price DECIMAL(14,2) NULL,
  main_contact_id BIGINT UNSIGNED NULL,
  champion_contact_id BIGINT UNSIGNED NULL,
  decision_maker_contact_id BIGINT UNSIGNED NULL,
  implementation_owner_id BIGINT UNSIGNED NULL,
  competitor VARCHAR(180) NULL,
  main_objection VARCHAR(500) NULL,
  next_action VARCHAR(500) NULL,
  next_action_at DATETIME NULL,
  loss_reason ENUM('price_objection','competitor_selected','existing_contract','missing_feature','no_budget','no_decision_maker_access','no_response','decision_postponed','internal_relationship_issue','other') NULL,
  loss_notes TEXT NULL,
  win_notes TEXT NULL,
  contract_reference VARCHAR(500) NULL,
  contract_signed_at DATE NULL,
  payment_schedule TEXT NULL,
  planned_onboarding_date DATE NULL,
  expected_go_live_date DATE NULL,
  closed_at TIMESTAMP NULL,
  archived_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_opportunity_ref (public_ref),
  KEY idx_team_opportunity_pipeline (stage,assigned_owner_id,expected_close_date),
  KEY idx_team_opportunity_school (school_id,stage,updated_at),
  CONSTRAINT fk_team_opportunity_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_opportunity_owner FOREIGN KEY (assigned_owner_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_opportunity_main_contact FOREIGN KEY (main_contact_id) REFERENCES team_school_contacts(id),
  CONSTRAINT fk_team_opportunity_champion FOREIGN KEY (champion_contact_id) REFERENCES team_school_contacts(id),
  CONSTRAINT fk_team_opportunity_decision_maker FOREIGN KEY (decision_maker_contact_id) REFERENCES team_school_contacts(id),
  CONSTRAINT fk_team_opportunity_implementation_owner FOREIGN KEY (implementation_owner_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_opportunity_creator FOREIGN KEY (created_by) REFERENCES team_users(id),
  CONSTRAINT fk_team_opportunity_updater FOREIGN KEY (updated_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_opportunity_stage_history (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  previous_stage VARCHAR(80) NULL,
  new_stage VARCHAR(80) NOT NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  reason TEXT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_stage_history_ref (public_ref),
  KEY idx_team_stage_history_opportunity (opportunity_id,changed_at),
  CONSTRAINT fk_team_stage_history_opportunity FOREIGN KEY (opportunity_id) REFERENCES team_sales_opportunities(id),
  CONSTRAINT fk_team_stage_history_actor FOREIGN KEY (changed_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_school_activities (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  contact_id BIGINT UNSIGNED NULL,
  opportunity_id BIGINT UNSIGNED NULL,
  activity_type ENUM('whatsapp_sent','whatsapp_reply','phone_call','email_sent','email_received','school_visit','meeting','demo','proposal_sent','follow_up','internal_note','document_uploaded','stage_changed','task_completed','payment_recorded','support_created') NOT NULL,
  occurred_at DATETIME NOT NULL,
  team_user_id BIGINT UNSIGNED NOT NULL,
  summary VARCHAR(500) NOT NULL,
  notes TEXT NULL,
  outcome VARCHAR(500) NULL,
  next_action VARCHAR(500) NULL,
  next_action_at DATETIME NULL,
  visibility ENUM('team','management','finance','implementation') NOT NULL DEFAULT 'team',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_activity_ref (public_ref),
  KEY idx_team_activity_timeline (school_id,occurred_at),
  CONSTRAINT fk_team_activity_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_activity_contact FOREIGN KEY (contact_id) REFERENCES team_school_contacts(id),
  CONSTRAINT fk_team_activity_opportunity FOREIGN KEY (opportunity_id) REFERENCES team_sales_opportunities(id),
  CONSTRAINT fk_team_activity_user FOREIGN KEY (team_user_id) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_tasks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  title VARCHAR(240) NOT NULL,
  description TEXT NULL,
  school_id BIGINT UNSIGNED NULL,
  contact_id BIGINT UNSIGNED NULL,
  opportunity_id BIGINT UNSIGNED NULL,
  assigned_user_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  due_at DATETIME NOT NULL,
  priority ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  category VARCHAR(80) NOT NULL DEFAULT 'other',
  status ENUM('not_started','in_progress','waiting_on_school','blocked','completed','cancelled') NOT NULL DEFAULT 'not_started',
  reminder_at DATETIME NULL,
  completion_note TEXT NULL,
  outcome VARCHAR(500) NULL,
  follow_up_task_id BIGINT UNSIGNED NULL,
  completed_at TIMESTAMP NULL,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_task_ref (public_ref),
  KEY idx_team_task_queue (assigned_user_id,status,due_at),
  KEY idx_team_task_school (school_id,status,due_at),
  CONSTRAINT fk_team_task_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_task_contact FOREIGN KEY (contact_id) REFERENCES team_school_contacts(id),
  CONSTRAINT fk_team_task_opportunity FOREIGN KEY (opportunity_id) REFERENCES team_sales_opportunities(id),
  CONSTRAINT fk_team_task_assignee FOREIGN KEY (assigned_user_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_task_creator FOREIGN KEY (created_by) REFERENCES team_users(id),
  CONSTRAINT fk_team_task_follow_up FOREIGN KEY (follow_up_task_id) REFERENCES team_tasks(id)
);

CREATE TABLE IF NOT EXISTS team_meetings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NULL,
  meeting_type ENUM('discovery','introductory','product_demo','technical','pricing','contract','onboarding','training','support_review') NOT NULL,
  scheduled_at DATETIME NOT NULL,
  location VARCHAR(500) NULL,
  attendance_mode ENUM('remote','physical') NOT NULL DEFAULT 'physical',
  agenda TEXT NULL,
  pain_points TEXT NULL,
  current_system VARCHAR(500) NULL,
  budget_signals TEXT NULL,
  objections TEXT NULL,
  requested_features TEXT NULL,
  decision_process TEXT NULL,
  outcome ENUM('pending','strong_interest','moderate_interest','needs_another_meeting','proposal_requested','price_objection','feature_objection','existing_contract','decision_pending','not_interested','completed','cancelled') NOT NULL DEFAULT 'pending',
  next_action VARCHAR(500) NULL,
  notes TEXT NULL,
  organised_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_meeting_ref (public_ref),
  KEY idx_team_meeting_schedule (scheduled_at,outcome),
  KEY idx_team_meeting_school (school_id,scheduled_at),
  CONSTRAINT fk_team_meeting_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_meeting_opportunity FOREIGN KEY (opportunity_id) REFERENCES team_sales_opportunities(id),
  CONSTRAINT fk_team_meeting_organiser FOREIGN KEY (organised_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_meeting_participants (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  meeting_id BIGINT UNSIGNED NOT NULL,
  participant_type ENUM('team_user','school_contact') NOT NULL,
  team_user_id BIGINT UNSIGNED NULL,
  school_contact_id BIGINT UNSIGNED NULL,
  attendance_status ENUM('invited','confirmed','attended','absent') NOT NULL DEFAULT 'invited',
  UNIQUE KEY uq_team_meeting_participant_user (meeting_id,team_user_id),
  UNIQUE KEY uq_team_meeting_participant_contact (meeting_id,school_contact_id),
  CONSTRAINT fk_team_meeting_participant_meeting FOREIGN KEY (meeting_id) REFERENCES team_meetings(id),
  CONSTRAINT fk_team_meeting_participant_user FOREIGN KEY (team_user_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_meeting_participant_contact FOREIGN KEY (school_contact_id) REFERENCES team_school_contacts(id)
);

CREATE TABLE IF NOT EXISTS team_demo_checklist_items (
  meeting_id BIGINT UNSIGNED NOT NULL,
  item_code VARCHAR(80) NOT NULL,
  is_complete TINYINT(1) NOT NULL DEFAULT 0,
  completed_by BIGINT UNSIGNED NULL,
  completed_at TIMESTAMP NULL,
  PRIMARY KEY (meeting_id,item_code),
  CONSTRAINT fk_team_demo_item_meeting FOREIGN KEY (meeting_id) REFERENCES team_meetings(id),
  CONSTRAINT fk_team_demo_item_actor FOREIGN KEY (completed_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_proposals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  proposal_number VARCHAR(80) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  package_name VARCHAR(160) NOT NULL,
  campus_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  estimated_students INT UNSIGNED NULL,
  setup_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  term_subscription DECIMAL(14,2) NOT NULL DEFAULT 0,
  training_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  migration_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  website_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  optional_services_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  original_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  requested_discount DECIMAL(14,2) NOT NULL DEFAULT 0,
  approved_discount DECIMAL(14,2) NOT NULL DEFAULT 0,
  final_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  payment_terms TEXT NOT NULL,
  expires_at DATE NOT NULL,
  prepared_by BIGINT UNSIGNED NOT NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  approval_reason TEXT NULL,
  recipient_contact_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','awaiting_approval','approved','sent','viewed','accepted','rejected','expired','replaced') NOT NULL DEFAULT 'draft',
  attachment_ref VARCHAR(500) NULL,
  internal_notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_proposal_ref (public_ref),
  UNIQUE KEY uq_team_proposal_number (proposal_number),
  KEY idx_team_proposal_queue (status,expires_at,prepared_by),
  CONSTRAINT fk_team_proposal_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_proposal_opportunity FOREIGN KEY (opportunity_id) REFERENCES team_sales_opportunities(id),
  CONSTRAINT fk_team_proposal_preparer FOREIGN KEY (prepared_by) REFERENCES team_users(id),
  CONSTRAINT fk_team_proposal_approver FOREIGN KEY (approved_by) REFERENCES team_users(id),
  CONSTRAINT fk_team_proposal_recipient FOREIGN KEY (recipient_contact_id) REFERENCES team_school_contacts(id)
);

CREATE TABLE IF NOT EXISTS team_proposal_modules (
  proposal_id BIGINT UNSIGNED NOT NULL,
  module_code VARCHAR(100) NOT NULL,
  module_name VARCHAR(180) NOT NULL,
  amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (proposal_id,module_code),
  CONSTRAINT fk_team_proposal_module_proposal FOREIGN KEY (proposal_id) REFERENCES team_proposals(id)
);

CREATE TABLE IF NOT EXISTS team_proposal_approvals (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  proposal_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_discount DECIMAL(14,2) NOT NULL,
  reason TEXT NOT NULL,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  decided_by BIGINT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  decision_note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_proposal_approval_ref (public_ref),
  KEY idx_team_proposal_approval_queue (status,created_at),
  CONSTRAINT fk_team_proposal_approval_proposal FOREIGN KEY (proposal_id) REFERENCES team_proposals(id),
  CONSTRAINT fk_team_proposal_approval_requester FOREIGN KEY (requested_by) REFERENCES team_users(id),
  CONSTRAINT fk_team_proposal_approval_decider FOREIGN KEY (decided_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_onboarding_projects (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NOT NULL,
  implementation_owner_id BIGINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  expected_go_live_date DATE NOT NULL,
  actual_go_live_date DATE NULL,
  stage VARCHAR(80) NOT NULL DEFAULT 'contract_signed',
  completion_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  risk_status ENUM('on_track','watch','at_risk','blocked') NOT NULL DEFAULT 'on_track',
  main_blocker VARCHAR(500) NULL,
  notes TEXT NULL,
  go_live_approved_by BIGINT UNSIGNED NULL,
  go_live_approved_at TIMESTAMP NULL,
  override_reason TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_onboarding_ref (public_ref),
  UNIQUE KEY uq_team_onboarding_opportunity (opportunity_id),
  KEY idx_team_onboarding_pipeline (stage,risk_status,expected_go_live_date),
  KEY idx_team_onboarding_owner (implementation_owner_id,stage),
  CONSTRAINT fk_team_onboarding_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_onboarding_opportunity FOREIGN KEY (opportunity_id) REFERENCES team_sales_opportunities(id),
  CONSTRAINT fk_team_onboarding_owner FOREIGN KEY (implementation_owner_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_onboarding_approver FOREIGN KEY (go_live_approved_by) REFERENCES team_users(id),
  CONSTRAINT fk_team_onboarding_creator FOREIGN KEY (created_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_onboarding_checklist_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  item_code VARCHAR(100) NOT NULL,
  label VARCHAR(220) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  is_complete TINYINT(1) NOT NULL DEFAULT 0,
  assigned_user_id BIGINT UNSIGNED NULL,
  completed_by BIGINT UNSIGNED NULL,
  completed_at TIMESTAMP NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_onboarding_item_ref (public_ref),
  UNIQUE KEY uq_team_onboarding_item (project_id,item_code),
  KEY idx_team_onboarding_checklist (project_id,is_required,is_complete),
  CONSTRAINT fk_team_onboarding_item_project FOREIGN KEY (project_id) REFERENCES team_onboarding_projects(id),
  CONSTRAINT fk_team_onboarding_item_assignee FOREIGN KEY (assigned_user_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_onboarding_item_actor FOREIGN KEY (completed_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_subscriptions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  onboarding_project_id BIGINT UNSIGNED NULL,
  package_name VARCHAR(160) NOT NULL,
  starts_on DATE NOT NULL,
  expires_on DATE NOT NULL,
  academic_term VARCHAR(120) NULL,
  duration_months SMALLINT UNSIGNED NULL,
  amount DECIMAL(14,2) NOT NULL,
  invoice_status ENUM('not_issued','draft','issued','part_paid','paid','void') NOT NULL DEFAULT 'not_issued',
  payment_status ENUM('pending','part_paid','paid','overdue','waived') NOT NULL DEFAULT 'pending',
  grace_period_days SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  read_only_on DATE NULL,
  renewal_owner_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','active','renewal_approaching','payment_overdue','grace_period','expired','read_only','cancelled') NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_subscription_ref (public_ref),
  KEY idx_team_subscription_alerts (status,expires_on,payment_status),
  KEY idx_team_subscription_owner (renewal_owner_id,expires_on),
  CONSTRAINT fk_team_subscription_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_subscription_onboarding FOREIGN KEY (onboarding_project_id) REFERENCES team_onboarding_projects(id),
  CONSTRAINT fk_team_subscription_owner FOREIGN KEY (renewal_owner_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_subscription_creator FOREIGN KEY (created_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_support_tickets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  ticket_number VARCHAR(80) NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  reporter_name VARCHAR(180) NOT NULL,
  contact_id BIGINT UNSIGNED NULL,
  module_name VARCHAR(160) NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  severity ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  status ENUM('new','investigating','waiting_for_school','assigned_to_development','fix_ready','testing','resolved','closed','reopened') NOT NULL DEFAULT 'new',
  assigned_user_id BIGINT UNSIGNED NOT NULL,
  target_resolution_at DATETIME NULL,
  internal_notes TEXT NULL,
  resolution TEXT NULL,
  root_cause TEXT NULL,
  school_confirmation VARCHAR(500) NULL,
  resolved_at TIMESTAMP NULL,
  closed_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_ticket_ref (public_ref),
  UNIQUE KEY uq_team_ticket_number (ticket_number),
  KEY idx_team_ticket_queue (status,severity,assigned_user_id,target_resolution_at),
  KEY idx_team_ticket_school (school_id,status,created_at),
  CONSTRAINT fk_team_ticket_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id),
  CONSTRAINT fk_team_ticket_contact FOREIGN KEY (contact_id) REFERENCES team_school_contacts(id),
  CONSTRAINT fk_team_ticket_assignee FOREIGN KEY (assigned_user_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_ticket_creator FOREIGN KEY (created_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_ticket_comments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  ticket_id BIGINT UNSIGNED NOT NULL,
  author_user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  visibility ENUM('internal','school_shareable') NOT NULL DEFAULT 'internal',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_ticket_comment_ref (public_ref),
  KEY idx_team_ticket_comment_timeline (ticket_id,created_at),
  CONSTRAINT fk_team_ticket_comment_ticket FOREIGN KEY (ticket_id) REFERENCES team_support_tickets(id),
  CONSTRAINT fk_team_ticket_comment_author FOREIGN KEY (author_user_id) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_attachments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  checksum_sha256 CHAR(64) NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL,
  UNIQUE KEY uq_team_attachment_ref (public_ref),
  UNIQUE KEY uq_team_attachment_storage (storage_key),
  KEY idx_team_attachment_entity (entity_type,entity_id,archived_at),
  CONSTRAINT fk_team_attachment_uploader FOREIGN KEY (uploaded_by) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_notifications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  notification_type VARCHAR(100) NOT NULL,
  title VARCHAR(220) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  entity_type VARCHAR(80) NULL,
  entity_ref CHAR(36) NULL,
  action_path VARCHAR(500) NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_notification_ref (public_ref),
  KEY idx_team_notification_inbox (recipient_user_id,read_at,created_at),
  CONSTRAINT fk_team_notification_recipient FOREIGN KEY (recipient_user_id) REFERENCES team_users(id)
);

CREATE TABLE IF NOT EXISTS team_audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  entity_ref CHAR(36) NULL,
  school_id BIGINT UNSIGNED NULL,
  before_value JSON NULL,
  after_value JSON NULL,
  reason TEXT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_audit_ref (public_ref),
  KEY idx_team_audit_timeline (created_at,action,entity_type),
  KEY idx_team_audit_actor (actor_user_id,created_at),
  KEY idx_team_audit_school (school_id,created_at),
  CONSTRAINT fk_team_audit_actor FOREIGN KEY (actor_user_id) REFERENCES team_users(id),
  CONSTRAINT fk_team_audit_school FOREIGN KEY (school_id) REFERENCES team_school_prospects(id)
);

CREATE TABLE IF NOT EXISTS team_message_templates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  public_ref CHAR(36) NOT NULL,
  name VARCHAR(180) NOT NULL,
  channel ENUM('whatsapp','email','phone_script') NOT NULL,
  body TEXT NOT NULL,
  is_approved TINYINT(1) NOT NULL DEFAULT 0,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_template_ref (public_ref),
  KEY idx_team_template_approved (channel,is_approved,name),
  CONSTRAINT fk_team_template_approver FOREIGN KEY (approved_by) REFERENCES team_users(id),
  CONSTRAINT fk_team_template_creator FOREIGN KEY (created_by) REFERENCES team_users(id)
);

INSERT INTO team_roles (code,name,description,is_system) VALUES
  ('platform_owner','Platform Owner','Full SmartLink Team Suite authority.',1),
  ('operations_partnerships_manager','Operations and Partnerships Manager','Cross-pipeline operational management.',1),
  ('outreach_officer','Outreach Officer','Assigned prospect outreach and early-stage sales.',1),
  ('implementation_support_officer','Implementation and Support Officer','Customer onboarding and support operations.',1),
  ('finance_officer','Finance Officer','Commercial records, subscriptions and payments.',1),
  ('developer','Developer','Assigned technical support and release work.',1)
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description);

INSERT INTO team_permissions (code,name,description) VALUES
  ('TEAM_DASHBOARD_VIEW','View team dashboard','View permitted operational metrics.'),
  ('SCHOOLS_VIEW_ALL','View all schools','View all prospect and customer records.'),
  ('SCHOOLS_VIEW_ASSIGNED','View assigned schools','View school records assigned to the user.'),
  ('SCHOOLS_CREATE','Create prospects','Create prospect school records.'),
  ('SCHOOLS_UPDATE','Update schools','Update permitted school records.'),
  ('SCHOOLS_ASSIGN','Assign schools','Assign school ownership.'),
  ('CONTACTS_MANAGE','Manage contacts','Create and update school contacts.'),
  ('ACTIVITIES_MANAGE','Manage activities','Record communication and activity history.'),
  ('OPPORTUNITIES_MANAGE','Manage opportunities','Create and update sales opportunities.'),
  ('OPPORTUNITIES_ADVANCE_LATE','Advance late sales stages','Move opportunities through commercial close stages.'),
  ('TASKS_MANAGE','Manage tasks','Create, assign and complete operational tasks.'),
  ('MEETINGS_MANAGE','Manage meetings','Schedule meetings and record outcomes.'),
  ('PROPOSALS_MANAGE','Manage proposals','Prepare and update structured proposals.'),
  ('PROPOSALS_APPROVE','Approve proposals','Approve proposals and restricted discounts.'),
  ('DISCOUNTS_APPROVE','Approve discounts','Approve commercial discounts.'),
  ('ONBOARDING_MANAGE','Manage onboarding','Create and manage customer onboarding projects.'),
  ('ONBOARDING_APPROVE_GO_LIVE','Approve go-live','Approve onboarding go-live readiness.'),
  ('SUBSCRIPTIONS_VIEW','View subscriptions','View subscription and payment status.'),
  ('SUBSCRIPTIONS_MANAGE','Manage subscriptions','Create and update subscription records.'),
  ('PAYMENTS_CONFIRM','Confirm payments','Confirm customer payment state.'),
  ('SUPPORT_MANAGE','Manage support','Create and manage permitted support tickets.'),
  ('SUPPORT_VIEW_ALL','View all support','View every support ticket.'),
  ('TEAM_MEMBERS_MANAGE','Manage team members','Create users and assign roles.'),
  ('REPORTS_VIEW','View reports','View operational and financial reports.'),
  ('FINANCE_VIEW','View revenue','View sensitive commercial values.'),
  ('AUDIT_VIEW','View audit log','Read immutable internal audit history.'),
  ('SETTINGS_MANAGE','Manage settings','Manage Team Suite settings and permissions.'),
  ('DATA_EXPORT','Export data','Export authorised operational data.')
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description);

INSERT IGNORE INTO team_role_permissions (role_id,permission_id)
SELECT role.id,permission.id FROM team_roles role CROSS JOIN team_permissions permission
WHERE role.code='platform_owner';

INSERT IGNORE INTO team_role_permissions (role_id,permission_id)
SELECT role.id,permission.id FROM team_roles role JOIN team_permissions permission
  ON permission.code IN ('TEAM_DASHBOARD_VIEW','SCHOOLS_VIEW_ALL','SCHOOLS_CREATE','SCHOOLS_UPDATE','SCHOOLS_ASSIGN','CONTACTS_MANAGE','ACTIVITIES_MANAGE','OPPORTUNITIES_MANAGE','OPPORTUNITIES_ADVANCE_LATE','TASKS_MANAGE','MEETINGS_MANAGE','PROPOSALS_MANAGE','ONBOARDING_MANAGE','ONBOARDING_APPROVE_GO_LIVE','SUBSCRIPTIONS_VIEW','SUPPORT_MANAGE','SUPPORT_VIEW_ALL','REPORTS_VIEW','AUDIT_VIEW','DATA_EXPORT')
WHERE role.code='operations_partnerships_manager';

INSERT IGNORE INTO team_role_permissions (role_id,permission_id)
SELECT role.id,permission.id FROM team_roles role JOIN team_permissions permission
  ON permission.code IN ('TEAM_DASHBOARD_VIEW','SCHOOLS_VIEW_ASSIGNED','SCHOOLS_CREATE','SCHOOLS_UPDATE','CONTACTS_MANAGE','ACTIVITIES_MANAGE','OPPORTUNITIES_MANAGE','TASKS_MANAGE','MEETINGS_MANAGE')
WHERE role.code='outreach_officer';

INSERT IGNORE INTO team_role_permissions (role_id,permission_id)
SELECT role.id,permission.id FROM team_roles role JOIN team_permissions permission
  ON permission.code IN ('TEAM_DASHBOARD_VIEW','SCHOOLS_VIEW_ASSIGNED','SCHOOLS_UPDATE','ACTIVITIES_MANAGE','TASKS_MANAGE','MEETINGS_MANAGE','ONBOARDING_MANAGE','SUBSCRIPTIONS_VIEW','SUPPORT_MANAGE')
WHERE role.code='implementation_support_officer';

INSERT IGNORE INTO team_role_permissions (role_id,permission_id)
SELECT role.id,permission.id FROM team_roles role JOIN team_permissions permission
  ON permission.code IN ('TEAM_DASHBOARD_VIEW','SCHOOLS_VIEW_ALL','PROPOSALS_MANAGE','SUBSCRIPTIONS_VIEW','SUBSCRIPTIONS_MANAGE','PAYMENTS_CONFIRM','REPORTS_VIEW','FINANCE_VIEW','DATA_EXPORT')
WHERE role.code='finance_officer';

INSERT IGNORE INTO team_role_permissions (role_id,permission_id)
SELECT role.id,permission.id FROM team_roles role JOIN team_permissions permission
  ON permission.code IN ('TEAM_DASHBOARD_VIEW','SCHOOLS_VIEW_ASSIGNED','SUPPORT_MANAGE')
WHERE role.code='developer';
