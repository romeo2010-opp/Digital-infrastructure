ALTER TABLE manual_syllabus_entries
  MODIFY status ENUM('draft', 'pending_review', 'approved', 'revision_requested', 'rejected') NOT NULL DEFAULT 'pending_review';
