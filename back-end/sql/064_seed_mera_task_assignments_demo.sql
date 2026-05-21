-- 064_seed_mera_task_assignments_demo.sql
-- Optional demo task assignments for the MERA regulator workflow.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

SET @station_one_id := (SELECT id FROM stations ORDER BY id ASC LIMIT 1);
SET @station_two_id := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 1);
SET @station_three_id := (SELECT id FROM stations ORDER BY id ASC LIMIT 1 OFFSET 2);
SET @station_one_public_id := (SELECT public_id FROM stations WHERE id = @station_one_id LIMIT 1);
SET @station_two_public_id := (SELECT public_id FROM stations WHERE id = @station_two_id LIMIT 1);
SET @station_three_public_id := (SELECT public_id FROM stations WHERE id = @station_three_id LIMIT 1);
SET @station_one_name := (SELECT name FROM stations WHERE id = @station_one_id LIMIT 1);
SET @station_two_name := (SELECT name FROM stations WHERE id = @station_two_id LIMIT 1);
SET @station_three_name := (SELECT name FROM stations WHERE id = @station_three_id LIMIT 1);
SET @station_one_district := (SELECT city FROM stations WHERE id = @station_one_id LIMIT 1);
SET @station_two_district := (SELECT city FROM stations WHERE id = @station_two_id LIMIT 1);
SET @station_three_district := (SELECT city FROM stations WHERE id = @station_three_id LIMIT 1);
SET @supervisor_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000003' LIMIT 1);
SET @field_officer_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000004' LIMIT 1);
SET @complaints_analyst_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000005' LIMIT 1);
SET @market_analyst_id := (SELECT id FROM mera_users WHERE public_id = 'MERA0000000000000000000008' LIMIT 1);

INSERT INTO regulator_tasks (
  task_number,
  title,
  description,
  type,
  category,
  priority,
  status,
  district,
  station_id,
  station_name,
  linked_entity_type,
  linked_entity_id,
  evidence_summary,
  assigned_to_user_id,
  assigned_by_user_id,
  due_at
)
SELECT
  'TASK-2026-000001',
  'Review refusal-to-sell complaint',
  'Verify public complaint evidence, call the station manager, and determine whether a field inspection is required.',
  'COMPLAINT_REVIEW',
  'Complaint triage',
  'HIGH',
  'ASSIGNED',
  @station_two_district,
  @station_two_id,
  @station_two_name,
  'COMPLAINT',
  'MERACMPLT000000000000000002',
  'Complaint photo and reporter statement are available in the complaint record.',
  @complaints_analyst_id,
  @supervisor_id,
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
FROM DUAL
WHERE @station_two_id IS NOT NULL AND @supervisor_id IS NOT NULL AND @complaints_analyst_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  status = VALUES(status),
  assigned_to_user_id = VALUES(assigned_to_user_id),
  due_at = VALUES(due_at);

INSERT INTO regulator_tasks (
  task_number,
  title,
  description,
  type,
  category,
  priority,
  status,
  district,
  station_id,
  station_name,
  linked_entity_type,
  linked_entity_id,
  evidence_summary,
  assigned_to_user_id,
  assigned_by_user_id,
  due_at,
  acknowledged_at,
  started_at
)
SELECT
  'TASK-2026-000002',
  'Inspect pump price display variance',
  'Conduct a spot check and compare pump-side pricing against the regulated board and recent price report.',
  'PRICE_VIOLATION_REVIEW',
  'Pricing compliance',
  'MEDIUM',
  'IN_PROGRESS',
  @station_one_district,
  @station_one_id,
  @station_one_name,
  'STATION',
  @station_one_public_id,
  'Previous fuel price report indicates a possible variance.',
  @field_officer_id,
  @supervisor_id,
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 DAY),
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 2 HOUR),
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)
FROM DUAL
WHERE @station_one_id IS NOT NULL AND @supervisor_id IS NOT NULL AND @field_officer_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  acknowledged_at = VALUES(acknowledged_at),
  started_at = VALUES(started_at);

INSERT INTO regulator_tasks (
  task_number,
  title,
  description,
  type,
  category,
  priority,
  status,
  district,
  station_id,
  station_name,
  linked_entity_type,
  linked_entity_id,
  assigned_to_user_id,
  assigned_by_user_id,
  due_at
)
SELECT
  'TASK-2026-000003',
  'Overdue queue disorder review',
  'Review queue manipulation reports and prepare a supervisor recommendation.',
  'QUEUE_DISORDER_REVIEW',
  'Queue compliance',
  'HIGH',
  'ACKNOWLEDGED',
  @station_three_district,
  @station_three_id,
  @station_three_name,
  'STATION',
  @station_three_public_id,
  @field_officer_id,
  @supervisor_id,
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)
FROM DUAL
WHERE @station_three_id IS NOT NULL AND @supervisor_id IS NOT NULL AND @field_officer_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  due_at = VALUES(due_at);

INSERT INTO regulator_tasks (
  task_number,
  title,
  description,
  type,
  category,
  priority,
  status,
  district,
  station_id,
  station_name,
  linked_entity_type,
  linked_entity_id,
  evidence_summary,
  assigned_to_user_id,
  assigned_by_user_id,
  due_at
)
SELECT
  'TASK-2026-000004',
  'Critical hoarding investigation',
  'Investigate prolonged dry-status signals against recent delivery evidence and complaint surge factors.',
  'HOARDING_INVESTIGATION',
  'Hoarding intelligence',
  'CRITICAL',
  'ASSIGNED',
  @station_three_district,
  @station_three_id,
  @station_three_name,
  'HOARDING_RISK_ALERT',
  @station_three_public_id,
  'Hoarding risk score and public complaint pattern require urgent review.',
  @market_analyst_id,
  @supervisor_id,
  DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 8 HOUR)
FROM DUAL
WHERE @station_three_id IS NOT NULL AND @supervisor_id IS NOT NULL AND @market_analyst_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  priority = VALUES(priority),
  status = VALUES(status),
  due_at = VALUES(due_at);

INSERT INTO regulator_tasks (
  task_number,
  title,
  description,
  type,
  category,
  priority,
  status,
  district,
  station_id,
  station_name,
  linked_entity_type,
  linked_entity_id,
  assigned_to_user_id,
  assigned_by_user_id,
  due_at,
  acknowledged_at,
  started_at,
  completed_at,
  completion_notes
)
SELECT
  'TASK-2026-000005',
  'Completed field visit follow-up',
  'Confirm that the station corrected display signage after inspection.',
  'FIELD_VISIT',
  'Inspection follow-up',
  'LOW',
  'COMPLETED',
  @station_one_district,
  @station_one_id,
  @station_one_name,
  'INSPECTION',
  'MERAINSP0000000000000000001',
  @field_officer_id,
  @supervisor_id,
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 2 DAY),
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 4 DAY),
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 3 DAY),
  DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 2 DAY),
  'Station display correction verified and documented.'
FROM DUAL
WHERE @station_one_id IS NOT NULL AND @supervisor_id IS NOT NULL AND @field_officer_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  completed_at = VALUES(completed_at),
  completion_notes = VALUES(completion_notes);

INSERT INTO regulator_task_activity_logs (task_id, actor_user_id, action, new_value)
SELECT id, assigned_by_user_id, 'TASK_CREATED', task_number
FROM regulator_tasks
WHERE task_number IN (
  'TASK-2026-000001',
  'TASK-2026-000002',
  'TASK-2026-000003',
  'TASK-2026-000004',
  'TASK-2026-000005'
)
AND NOT EXISTS (
  SELECT 1
  FROM regulator_task_activity_logs existing_log
  WHERE existing_log.task_id = regulator_tasks.id
    AND existing_log.action = 'TASK_CREATED'
);

INSERT INTO regulator_task_notes (task_id, author_user_id, note, visibility)
SELECT id, assigned_by_user_id, 'Demo assignment created for MERA task workflow testing.', 'INTERNAL'
FROM regulator_tasks
WHERE task_number IN (
  'TASK-2026-000001',
  'TASK-2026-000002',
  'TASK-2026-000003',
  'TASK-2026-000004',
  'TASK-2026-000005'
)
AND NOT EXISTS (
  SELECT 1
  FROM regulator_task_notes existing_note
  WHERE existing_note.task_id = regulator_tasks.id
    AND existing_note.note = 'Demo assignment created for MERA task workflow testing.'
);
