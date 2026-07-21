USE smartlink_schools;

INSERT INTO schools (id, code, school_prefix, name, city, country, status)
VALUES (1, 'GREENHILL', 'GPS', 'Greenhill Cambridge Primary School', 'Blantyre', 'Malawi', 'active')
ON DUPLICATE KEY UPDATE name = VALUES(name), city = VALUES(city), school_prefix = COALESCE(school_prefix, VALUES(school_prefix));

INSERT INTO users (id, public_ref, school_id, role, full_name, email, password_hash, must_change_password, phone) VALUES
  (1, UUID(), NULL, 'super_admin', 'SmartLink Super Admin', 'super@smartlink.test', '$2a$10$QgKlxV4PpXn03iaYGdTpyOjrTGD8APTklsHrGUd2Oph1hPncZ8mlC', 1, '+265 999 000 001'),
  (2, UUID(), 1, 'school_owner', 'Mrs. Banda', 'owner@greenhill.test', '$2a$10$dK9g5JaWXEY81JlcuTA41Ok69Iz2YA.7dF9bfy3hgq.4NfiabXIby', 1, '+265 999 000 002'),
  (3, UUID(), 1, 'headteacher', 'Mr. Banda', 'head@greenhill.test', '$2a$10$7ShQXgjD.J8rF4SErRxFaeuBJqa/am0U0sm7quVPmQF4PnDgeAUO.', 1, '+265 999 000 003'),
  (4, UUID(), 1, 'bursar', 'Mrs. Phiri', 'bursar@greenhill.test', '$2a$10$LU6o6TeVDeB4SJRBGwhLq.YcSJK.8Pd1c4a5V3Trfpo5zYf4XP4ce', 1, '+265 999 000 004'),
  (5, UUID(), 1, 'teacher', 'Mr. Mwale', 'teacher@greenhill.test', '$2a$10$TI4A6NqKUv1xv.eRayMZUuHTN9pEZAf2q3svBviOz0hbXaFknomTy', 1, '+265 999 000 005'),
  (6, UUID(), 1, 'parent', 'Mrs. Namwera', 'parent@greenhill.test', '$2a$10$kGWVnQ5bxqX6jso/KHWFAOab.APQnrENOcz75ktJ2Js4V84lw4OYG', 1, '+265 999 000 006')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role), school_id = VALUES(school_id);

INSERT INTO classes (id, school_id, name, grade_level, teacher_user_id) VALUES
  (1, 1, 'Year 1A', 'Year 1', 5),
  (2, 1, 'Year 2A', 'Year 2', 5),
  (3, 1, 'Year 3A', 'Year 3', 5),
  (4, 1, 'Year 4A', 'Year 4', 5),
  (5, 1, 'Year 5A', 'Year 5', 5),
  (6, 1, 'Year 6A', 'Year 6', 5)
ON DUPLICATE KEY UPDATE grade_level = VALUES(grade_level), teacher_user_id = VALUES(teacher_user_id);

INSERT INTO subjects (id, school_id, name, code) VALUES
  (1, 1, 'Mathematics', 'MATH'),
  (2, 1, 'English', 'ENG'),
  (3, 1, 'Science', 'SCI')
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO academic_years (id, school_id, name, start_date, end_date, status, is_active) VALUES
  (1, 1, '2026', '2026-01-01', '2026-12-31', 'active', 1)
ON DUPLICATE KEY UPDATE status = VALUES(status), is_active = VALUES(is_active);

INSERT INTO terms (id, school_id, academic_year_id, name, term_number, start_date, end_date, status) VALUES
  (1, 1, 1, 'Term 2', 2, '2026-05-05', '2026-08-01', 'open')
ON DUPLICATE KEY UPDATE status = VALUES(status), start_date = VALUES(start_date), end_date = VALUES(end_date);

INSERT INTO teacher_class_subject_assignments
  (id, school_id, teacher_id, class_id, subject_id, academic_year_id, term_id, academic_year, term, role, is_active)
VALUES
  (1, 1, 5, 1, NULL, 1, 1, '2026', 'Term 2', 'class_teacher', 1),
  (2, 1, 5, 1, 1, 1, 1, '2026', 'Term 2', 'subject_teacher', 1),
  (3, 1, 5, 1, 2, 1, 1, '2026', 'Term 2', 'subject_teacher', 1),
  (4, 1, 5, 2, 1, 1, 1, '2026', 'Term 2', 'subject_teacher', 1),
  (5, 1, 5, 3, 2, 1, 1, '2026', 'Term 2', 'subject_teacher', 1)
ON DUPLICATE KEY UPDATE teacher_id = VALUES(teacher_id), subject_id = VALUES(subject_id), academic_year_id = VALUES(academic_year_id), term_id = VALUES(term_id), is_active = VALUES(is_active);

INSERT INTO students (id, public_ref, school_id, class_id, admission_no, first_name, last_name, date_of_birth, gender, status) VALUES
  (1, UUID(), 1, 1, 'GH-001', 'Tadala', 'Kamoto', '2013-04-18', 'Female', 'active'),
  (2, UUID(), 1, 2, 'GH-002', 'Blessings', 'Phiri', '2014-07-03', 'Male', 'active'),
  (3, UUID(), 1, 1, 'GH-003', 'Chisomo', 'Mwale', '2013-11-24', 'Female', 'active'),
  (4, UUID(), 1, 3, 'GH-004', 'Thandiwe', 'Kachikho', '2015-02-09', 'Female', 'active'),
  (5, UUID(), 1, 2, 'GH-005', 'Wisdom', 'Mbewe', '2014-01-15', 'Male', 'active')
ON DUPLICATE KEY UPDATE first_name = VALUES(first_name), last_name = VALUES(last_name), class_id = VALUES(class_id);

INSERT INTO student_enrollments (school_id, student_id, academic_year_id, term_id, class_id, enrollment_type, enrollment_status, start_date)
SELECT school_id, id, 1, 1, class_id, 'continued', 'active', '2026-05-05'
FROM students
WHERE school_id = 1 AND status = 'active' AND class_id IS NOT NULL
ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), enrollment_status = VALUES(enrollment_status);

INSERT INTO parent_student_links (school_id, parent_user_id, student_id, relationship)
VALUES (1, 6, 1, 'mother')
ON DUPLICATE KEY UPDATE relationship = VALUES(relationship);

INSERT INTO fee_accounts (id, school_id, student_id, term_name, amount_due, amount_paid, status, due_date) VALUES
  (1, 1, 1, 'Term 2 2025', 150000.00, 150000.00, 'paid', '2025-05-30'),
  (2, 1, 2, 'Term 2 2025', 150000.00, 125000.00, 'partial', '2025-05-30'),
  (3, 1, 3, 'Term 2 2025', 150000.00, 150000.00, 'paid', '2025-05-30'),
  (4, 1, 4, 'Term 2 2025', 150000.00, 100000.00, 'overdue', '2025-05-30'),
  (5, 1, 5, 'Term 2 2025', 150000.00, 140000.00, 'partial', '2025-05-30')
ON DUPLICATE KEY UPDATE amount_due = VALUES(amount_due), amount_paid = VALUES(amount_paid), status = VALUES(status);

INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, marked_by) VALUES
  (1, 1, 1, CURRENT_DATE, 'present', 5),
  (1, 2, 2, CURRENT_DATE, 'present', 5),
  (1, 1, 3, CURRENT_DATE, 'late', 5),
  (1, 3, 4, CURRENT_DATE, 'absent', 5),
  (1, 2, 5, CURRENT_DATE, 'present', 5)
ON DUPLICATE KEY UPDATE status = VALUES(status), marked_by = VALUES(marked_by);

INSERT INTO homework (id, school_id, class_id, subject_id, title, instructions, due_date, status, created_by) VALUES
  (1, 1, 2, 1, 'Fractions Worksheet', 'Complete exercises 1 to 12.', DATE_ADD(CURRENT_DATE, INTERVAL 1 DAY), 'pending', 5),
  (2, 1, 3, 2, 'Reading Comprehension', 'Read the short passage and answer all questions.', DATE_ADD(CURRENT_DATE, INTERVAL 2 DAY), 'pending', 5),
  (3, 1, 1, 3, 'Plant Life Cycle Diagram', 'Draw and label each stage.', DATE_ADD(CURRENT_DATE, INTERVAL 3 DAY), 'pending', 5)
ON DUPLICATE KEY UPDATE title = VALUES(title), due_date = VALUES(due_date), status = VALUES(status);

INSERT INTO messages (id, school_id, message_type, subject, body, recipient_scope, channel, delivery_status, created_by) VALUES
  (1, 1, 'announcement', 'Progress update', 'Thank you for the update on Tadala progress.', JSON_OBJECT('type', 'parent', 'student_id', 1), 'whatsapp_ready', 'sent', 5),
  (2, 1, 'homework_reminder', 'Mathematics support', 'Please can we discuss his Mathematics support plan?', JSON_OBJECT('type', 'parent', 'student_id', 2), 'sms_ready', 'pending', 5),
  (3, 1, 'announcement', 'Sports day', 'Will the sports day be on Saturday?', JSON_OBJECT('type', 'class', 'class_id', 1), 'whatsapp_ready', 'sent', 5)
ON DUPLICATE KEY UPDATE delivery_status = VALUES(delivery_status), body = VALUES(body);

INSERT INTO assessments (id, school_id, class_id, subject_id, academic_year_id, term_id, teacher_id, name, term_name, total_marks, expected_difficulty, status, created_by) VALUES
  (1, 1, 1, 1, 1, 1, 5, 'Mathematics Mid-Term', 'Term 2', 100, 'Medium', 'open', 5),
  (2, 1, 1, 2, 1, 1, 5, 'English Mid-Term', 'Term 2', 100, 'Medium', 'open', 5)
ON DUPLICATE KEY UPDATE name = VALUES(name), total_marks = VALUES(total_marks);

INSERT INTO assessment_topics (id, school_id, assessment_id, topic_name, marks_allocated, expected_difficulty) VALUES
  (1, 1, 1, 'Word Problems', 20, 'Medium'),
  (2, 1, 1, 'Fractions', 20, 'Medium'),
  (3, 1, 2, 'Comprehension', 20, 'Medium')
ON DUPLICATE KEY UPDATE topic_name = VALUES(topic_name), marks_allocated = VALUES(marks_allocated);

INSERT INTO assessment_topic_marks (school_id, assessment_topic_id, student_id, marks_obtained) VALUES
  (1, 1, 1, 9), (1, 1, 2, 8), (1, 1, 3, 7), (1, 1, 4, 10), (1, 1, 5, 8),
  (1, 2, 1, 12), (1, 2, 2, 11), (1, 2, 3, 10), (1, 2, 4, 12), (1, 2, 5, 10),
  (1, 3, 1, 13), (1, 3, 2, 12), (1, 3, 3, 13), (1, 3, 4, 12), (1, 3, 5, 11)
ON DUPLICATE KEY UPDATE marks_obtained = VALUES(marks_obtained);

INSERT INTO daily_drills (school_id, student_id, subject_id, topic_name, prompt, status, score) VALUES
  (1, 1, 1, 'Word Problems', 'Solve five two-step word problems.', 'complete', 100),
  (1, 2, 1, 'Fractions', 'Compare and simplify fractions.', 'complete', 98),
  (1, 3, 2, 'Comprehension', 'Read a passage and answer inference questions.', 'complete', 96);

INSERT INTO exam_forecast_topics (school_id, exam_track, subject_name, topic_name, frequency_score, marks_weight, recency_gap, weakness_level) VALUES
  (1, 'Cambridge Primary Checkpoint', 'Mathematics', 'Fractions', 82, 70, 45, 55),
  (1, 'Cambridge Primary Checkpoint', 'Mathematics', 'Word Problems', 78, 80, 60, 72),
  (1, 'Cambridge Primary Checkpoint', 'English', 'Comprehension', 74, 65, 50, 39);

INSERT INTO school_settings (school_id, setting_key, setting_value) VALUES
  (1, 'term', JSON_OBJECT('name', 'Term 2 2025', 'starts_on', '2025-05-05', 'ends_on', '2025-08-01')),
  (1, 'channels', JSON_OBJECT('sms', 'placeholder', 'whatsapp', 'placeholder')),
  (1, 'progression_policy', JSON_OBJECT('minimum_average', 50, 'enforce_threshold', TRUE)),
  (1, 'curriculum', JSON_OBJECT('name', 'Cambridge Primary Curriculum', 'programme', 'Cambridge Primary', 'years', JSON_ARRAY('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')))
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
