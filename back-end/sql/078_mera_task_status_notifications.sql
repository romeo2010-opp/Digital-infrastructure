SET NAMES utf8mb4;
SET time_zone = '+00:00';
USE smartlink;

ALTER TABLE mera_notifications
  MODIFY COLUMN type ENUM(
    'TASK_ASSIGNED',
    'TASK_REASSIGNED',
    'TASK_DUE_SOON',
    'TASK_OVERDUE',
    'TASK_STATUS_CHANGED',
    'TASK_ESCALATED',
    'TASK_COMPLETED'
  ) NOT NULL;
