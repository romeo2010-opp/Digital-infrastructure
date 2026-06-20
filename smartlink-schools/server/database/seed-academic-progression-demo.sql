USE smartlink_schools;

SET @school_id := 1;
SET @owner_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'owner@greenhill.test' LIMIT 1);
SET @headteacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'headteacher@greenhill.test' LIMIT 1);
SET @bursar_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'bursar@greenhill.test' LIMIT 1);
SET @p1_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'p1.teacher@greenhill.test' LIMIT 1);
SET @p2_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'p2.teacher@greenhill.test' LIMIT 1);
SET @p3_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'p3.teacher@greenhill.test' LIMIT 1);
SET @p4_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'p4.teacher@greenhill.test' LIMIT 1);
SET @math_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'math.teacher@greenhill.test' LIMIT 1);
SET @english_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'english.teacher@greenhill.test' LIMIT 1);
SET @student_password_hash := '$2a$10$TNcOXdQJHJXZyKBtcIcS/OG0wLuDwqSE6D3RIPU8n.mVZFWMzwGI2';

START TRANSACTION;
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM report_cards WHERE school_id = @school_id;
DELETE FROM subject_results WHERE school_id = @school_id;
DELETE FROM term_results WHERE school_id = @school_id;
DELETE FROM result_entries WHERE school_id = @school_id;
DELETE FROM result_batches WHERE school_id = @school_id;
DELETE FROM assessment_topic_marks WHERE school_id = @school_id;
DELETE FROM assessment_topics WHERE school_id = @school_id;
DELETE FROM assessment_question_options WHERE school_id = @school_id;
DELETE FROM assessment_questions WHERE school_id = @school_id;
DELETE FROM assessment_blocks WHERE school_id = @school_id;
DELETE FROM assessment_media WHERE school_id = @school_id;
DELETE FROM exam_timetable_entries WHERE school_id = @school_id;
DELETE FROM assessments WHERE school_id = @school_id;
DELETE FROM exam_sessions WHERE school_id = @school_id;
DELETE FROM assessment_instance_results WHERE school_id = @school_id;
DELETE FROM assessment_instance_items WHERE school_id = @school_id;
DELETE FROM assessment_instances WHERE school_id = @school_id;
DELETE FROM recurring_assessment_templates WHERE school_id = @school_id;
DELETE FROM school_events WHERE school_id = @school_id;
DELETE FROM messages WHERE school_id = @school_id;
DELETE FROM term_timeline_markers WHERE school_id = @school_id;
DELETE FROM term_closures WHERE school_id = @school_id;
DELETE FROM promotion_decision_cleanup_audit WHERE school_id = @school_id;
DELETE FROM promotion_decisions WHERE school_id = @school_id;
DELETE FROM student_enrollment_cleanup_audit WHERE school_id = @school_id;
DELETE FROM attendance_records WHERE school_id = @school_id;
DELETE FROM daily_drills WHERE school_id = @school_id;
DELETE FROM homework_submissions WHERE school_id = @school_id;
DELETE FROM fee_payments WHERE school_id = @school_id;
DELETE FROM fee_accounts WHERE school_id = @school_id;
DELETE FROM student_fee_profiles WHERE school_id = @school_id;
DELETE FROM parent_student_links WHERE school_id = @school_id;
DELETE FROM student_guardians WHERE school_id = @school_id;
DELETE FROM student_enrollments WHERE school_id = @school_id;
DELETE FROM students WHERE school_id = @school_id;
DELETE FROM users WHERE school_id = @school_id AND role IN ('student', 'parent');
DELETE FROM terms WHERE school_id = @school_id;
DELETE FROM academic_years WHERE school_id = @school_id;
DELETE FROM school_student_sequences WHERE school_id = @school_id;
DELETE FROM teacher_class_subject_assignments WHERE school_id = @school_id;

SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO academic_years (school_id, name, start_date, end_date, status, is_active)
VALUES (@school_id, '2026 Demonstration Academic Year', '2026-01-12', '2026-12-04', 'active', 1);
SET @year_id := LAST_INSERT_ID();

INSERT INTO terms (school_id, academic_year_id, name, term_number, start_date, end_date, status)
VALUES
  (@school_id, @year_id, 'Term 1', 1, '2026-01-12', '2026-04-03', 'archived'),
  (@school_id, @year_id, 'Term 2', 2, '2026-04-20', '2026-07-17', 'archived'),
  (@school_id, @year_id, 'Term 3', 3, '2026-08-03', '2026-11-27', 'open');
SET @term3_id := (SELECT id FROM terms WHERE school_id = @school_id AND academic_year_id = @year_id AND term_number = 3 LIMIT 1);

CREATE TEMPORARY TABLE demo_numbers (seq INT PRIMARY KEY);
INSERT INTO demo_numbers (seq) VALUES
  (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),
  (13),(14),(15),(16),(17),(18),(19),(20),(21),(22),(23),(24);

CREATE TEMPORARY TABLE demo_classes AS
SELECT id AS class_id,
  CASE name
    WHEN 'Year 1A' THEN 'Y1'
    WHEN 'Year 2A' THEN 'Y2'
    WHEN 'Year 3A' THEN 'Y3'
    WHEN 'Year 4A' THEN 'Y4'
    WHEN 'Year 5A' THEN 'Y5'
    ELSE 'Y6'
  END AS class_code,
  name AS class_name,
  CASE name
    WHEN 'Year 1A' THEN @p1_teacher_id
    WHEN 'Year 2A' THEN @p2_teacher_id
    WHEN 'Year 3A' THEN @p3_teacher_id
    WHEN 'Year 4A' THEN @p4_teacher_id
    WHEN 'Year 5A' THEN @math_teacher_id
    ELSE @english_teacher_id
  END AS class_teacher_id
FROM classes
WHERE school_id = @school_id AND name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A');

CREATE TEMPORARY TABLE demo_student_seed AS
SELECT
  c.class_id,
  c.class_code,
  n.seq,
  ELT(MOD(n.seq + c.class_id, 24) + 1,
    'Amina','Kelvin','Zione','Bright','Loveness','Tiwonge','Chisomo','Fumbani',
    'Mphatso','Yamikani','Jessie','Tamanda','Ellen','Stanley','Rachael','Victor',
    'Lydia','Henry','Bertha','Isaac','Naomi','Charles','Esther','Peter') AS first_name,
  ELT(MOD((n.seq * 2) + c.class_id, 24) + 1,
    'Mkandawire','Nyasulu','Mwanza','Kaunda','Juma','Nyirenda','Kumwenda','Sakala',
    'Mwale','Kalua','Chipeta','Nyondo','Chimwemwe','Zulu','Soko','Mbewe',
    'Kachingwe','Bandawe','Mwafulirwa','Chonde','Mhone','Kaliyati','Nkhoma','Phiri') AS last_name,
  IF(MOD(n.seq + c.class_id, 2) = 0, 'Female', 'Male') AS gender,
  DATE_ADD(
    CASE c.class_code
      WHEN 'P1' THEN DATE('2018-02-01')
      WHEN 'P2' THEN DATE('2017-02-01')
      WHEN 'P3' THEN DATE('2016-02-01')
      ELSE DATE('2015-02-01')
    END,
    INTERVAL n.seq DAY
  ) AS date_of_birth,
  'A' AS stream_section,
  CONVERT(CONCAT('SL-', c.class_code, '-', LPAD(n.seq, 3, '0')) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS student_code,
  CONVERT(CONCAT('ADM-', c.class_code, '-', LPAD(n.seq, 3, '0')) USING utf8mb4) COLLATE utf8mb4_unicode_ci AS admission_no
FROM demo_classes c
CROSS JOIN demo_numbers n;

INSERT INTO students (
  school_id, class_id, student_id, admission_no, first_name, last_name,
  date_of_birth, gender, stream_section, enrollment_date, student_type, status
)
SELECT @school_id, class_id, student_code, admission_no, first_name, last_name,
  date_of_birth, gender, stream_section, '2026-01-12', 'returning', 'active'
FROM demo_student_seed
ORDER BY class_id, seq;

INSERT INTO users (
  school_id, role, full_name, first_name, last_name, email, password_hash,
  must_change_password, gender, date_of_birth, is_active
)
SELECT @school_id, 'student', CONCAT(first_name, ' ', last_name), first_name, last_name,
  LOWER(CONCAT(student_code, '@students.greenhill.test')),
  @student_password_hash, 0, gender, date_of_birth, 1
FROM demo_student_seed
ORDER BY class_id, seq
ON DUPLICATE KEY UPDATE
  role = VALUES(role),
  full_name = VALUES(full_name),
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  password_hash = VALUES(password_hash),
  must_change_password = VALUES(must_change_password),
  gender = VALUES(gender),
  date_of_birth = VALUES(date_of_birth),
  is_active = VALUES(is_active);

UPDATE students s
JOIN demo_student_seed seed ON seed.student_code = s.student_id
JOIN users u ON u.school_id = s.school_id AND u.email = LOWER(CONCAT(seed.student_code, '@students.greenhill.test'))
SET s.user_id = u.id
WHERE s.school_id = @school_id;

INSERT INTO student_enrollments (
  school_id, student_id, academic_year_id, term_id, class_id, stream_section,
  enrollment_type, enrollment_status, start_date
)
SELECT @school_id, s.id, @year_id, @term3_id, seed.class_id, seed.stream_section,
  'continued', 'active', '2026-08-03'
FROM demo_student_seed seed
JOIN students s ON s.school_id = @school_id AND s.student_id = seed.student_code;

INSERT INTO student_guardians (school_id, student_id, guardian_number, full_name, relationship, primary_phone, email)
SELECT @school_id, s.id, 1,
  CONCAT(seed.last_name, ' Guardian ', LPAD(seed.seq, 2, '0')),
  IF(MOD(seed.seq, 2) = 0, 'mother', 'father'),
  CONCAT('+265 888 ', LPAD(seed.class_id, 3, '0'), ' ', LPAD(seed.seq, 3, '0')),
  LOWER(CONCAT(seed.student_code, '.guardian@greenhill.test'))
FROM demo_student_seed seed
JOIN students s ON s.school_id = @school_id AND s.student_id = seed.student_code;

INSERT INTO student_fee_profiles (school_id, student_id, fee_category, payment_plan, discount_percent, discount_reason)
SELECT @school_id, s.id,
  CASE WHEN seed.seq IN (6, 18) THEN 'bursary' WHEN seed.seq = 12 THEN 'scholarship' ELSE 'standard' END,
  'termly',
  CASE WHEN seed.seq IN (6, 18) THEN 25 WHEN seed.seq = 12 THEN 100 ELSE 0 END,
  'Generated for academic progression demo'
FROM demo_student_seed seed
JOIN students s ON s.school_id = @school_id AND s.student_id = seed.student_code;

INSERT INTO fee_accounts (school_id, student_id, term_name, amount_due, amount_paid, status, due_date)
SELECT @school_id, s.id, 'Term 3',
  95000,
  CASE WHEN seed.seq % 5 = 0 THEN 40000 ELSE 95000 END,
  CASE WHEN seed.seq % 5 = 0 THEN 'partial' ELSE 'paid' END,
  CASE WHEN seed.seq % 5 = 0 THEN '2026-06-05' ELSE '2026-09-04' END
FROM demo_student_seed seed
JOIN students s ON s.school_id = @school_id AND s.student_id = seed.student_code;

INSERT INTO fee_payments (school_id, fee_account_id, amount, payment_method, reference, receipt_no, recorded_by, paid_at)
SELECT @school_id, fa.id, fa.amount_paid,
  CASE WHEN seed.seq % 3 = 0 THEN 'mobile_money' ELSE 'cash' END,
  CONCAT('DEMO-', seed.student_code),
  CONCAT('RCPT-', REPLACE(seed.student_code, '-', ''), '-T3'),
  COALESCE(@bursar_id, @owner_id),
  TIMESTAMP('2026-08-18 09:00:00') + INTERVAL seed.seq HOUR
FROM demo_student_seed seed
JOIN students s ON s.school_id = @school_id AND s.student_id = seed.student_code
JOIN fee_accounts fa ON fa.school_id = @school_id AND fa.student_id = s.id AND fa.term_name = 'Term 3'
WHERE fa.amount_paid > 0;

CREATE TEMPORARY TABLE demo_attendance_days (
  day_no INT PRIMARY KEY,
  attendance_date DATE NOT NULL
);
INSERT INTO demo_attendance_days (day_no, attendance_date) VALUES
  (1, '2026-08-04'), (2, '2026-08-05'), (3, '2026-08-06'), (4, '2026-08-07'),
  (5, '2026-08-10'), (6, '2026-08-11'), (7, '2026-08-12'), (8, '2026-08-13'),
  (9, '2026-08-14'), (10, '2026-08-17'), (11, '2026-08-18'), (12, '2026-08-19');

INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, note, marked_by)
SELECT @school_id, seed.class_id, s.id, days.attendance_date,
  CASE
    WHEN MOD(seed.seq + days.day_no, 17) = 0 THEN 'absent'
    WHEN MOD(seed.seq + days.day_no, 13) = 0 THEN 'late'
    ELSE 'present'
  END,
  CASE
    WHEN MOD(seed.seq + days.day_no, 17) = 0 THEN 'Absent on class register.'
    WHEN MOD(seed.seq + days.day_no, 13) = 0 THEN 'Arrived after first period.'
    ELSE NULL
  END,
  dc.class_teacher_id
FROM demo_student_seed seed
JOIN students s ON s.school_id = @school_id AND s.student_id = seed.student_code
JOIN demo_classes dc ON dc.class_id = seed.class_id
CROSS JOIN demo_attendance_days days;

INSERT INTO school_student_sequences (school_id, sequence_year, last_sequence)
VALUES (@school_id, 2026, 96);

INSERT INTO teacher_class_subject_assignments (
  school_id, teacher_id, class_id, subject_id, stream_section, academic_year_id, term_id,
  academic_year, term, role, is_active, notes
)
SELECT @school_id, class_teacher_id, class_id, NULL, 'A', @year_id, @term3_id,
  '2026', 'Term 3', 'class_teacher', 1, 'Demo class teacher'
FROM demo_classes;

CREATE TEMPORARY TABLE demo_subjects (
  subject_id BIGINT UNSIGNED NOT NULL,
  subject_code VARCHAR(20) NOT NULL,
  subject_order INT NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL
);
INSERT INTO demo_subjects (subject_id, subject_code, subject_order, teacher_id)
SELECT id, code,
  CASE code WHEN 'MATH' THEN 1 WHEN 'ENG' THEN 2 WHEN 'SCI' THEN 3 WHEN 'CHI' THEN 4 ELSE 5 END,
  CASE code WHEN 'MATH' THEN @math_teacher_id WHEN 'ENG' THEN @english_teacher_id WHEN 'CHI' THEN @english_teacher_id WHEN 'SCI' THEN @p3_teacher_id ELSE @p4_teacher_id END
FROM subjects
WHERE school_id = @school_id AND code IN ('MATH', 'ENG', 'SCI', 'CHI', 'SOC');

INSERT INTO teacher_class_subject_assignments (
  school_id, teacher_id, class_id, subject_id, stream_section, academic_year_id, term_id,
  academic_year, term, role, is_active, notes
)
SELECT @school_id, ds.teacher_id, dc.class_id, ds.subject_id, 'A', @year_id, @term3_id,
  '2026', 'Term 3', 'subject_teacher', 1, 'Demo subject teacher'
FROM demo_classes dc
CROSS JOIN demo_subjects ds;

INSERT INTO homework (school_id, class_id, subject_id, title, instructions, due_date, status, created_by)
SELECT @school_id, dc.class_id, ds.subject_id,
  CONCAT(dc.class_name, ' ', subj.name, ' Practice Set'),
  CONCAT('Complete the ', subj.name, ' practice questions and bring the exercise book for marking.'),
  DATE_ADD('2026-08-20', INTERVAL ds.subject_order * 3 DAY),
  'pending',
  ds.teacher_id
FROM demo_classes dc
JOIN demo_subjects ds ON ds.subject_order IN (1, 2, 3)
JOIN subjects subj ON subj.id = ds.subject_id AND subj.school_id = @school_id;

INSERT INTO homework_submissions (school_id, homework_id, student_id, status, submitted_at)
SELECT @school_id, h.id, s.id,
  CASE WHEN MOD(seed.seq + h.subject_id, 6) = 0 THEN 'late' ELSE 'submitted' END,
  TIMESTAMP(h.due_date, '15:30:00') + INTERVAL seed.seq MINUTE
FROM homework h
JOIN demo_student_seed seed ON seed.class_id = h.class_id
JOIN students s ON s.school_id = @school_id AND s.student_id = seed.student_code
WHERE h.school_id = @school_id
  AND h.title LIKE '%Practice Set'
  AND MOD(seed.seq + h.subject_id, 3) = 0;

DELETE FROM class_progression_rules WHERE school_id = @school_id;
INSERT INTO class_progression_rules (school_id, from_class_id, to_class_id, is_terminal_class, default_decision, is_active)
SELECT @school_id, c.id,
  next_c.id,
  CASE WHEN c.name = 'Year 6A' THEN 1 ELSE 0 END,
  CASE WHEN c.name = 'Year 6A' THEN 'graduate' ELSE 'promote' END,
  1
FROM classes c
LEFT JOIN classes next_c ON next_c.school_id = c.school_id
  AND next_c.name = CASE c.name
    WHEN 'Year 1A' THEN 'Year 2A'
    WHEN 'Year 2A' THEN 'Year 3A'
    WHEN 'Year 3A' THEN 'Year 4A'
    WHEN 'Year 4A' THEN 'Year 5A'
    WHEN 'Year 5A' THEN 'Year 6A'
    ELSE NULL
  END
WHERE c.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A');

INSERT INTO school_settings (school_id, setting_key, setting_value)
VALUES
  (@school_id, 'progression_policy', JSON_OBJECT('minimum_average', 50, 'enforce_threshold', TRUE)),
  (@school_id, 'curriculum', JSON_OBJECT('name', 'Cambridge Primary Curriculum', 'programme', 'Cambridge Primary', 'years', JSON_ARRAY('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')))
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

INSERT INTO exam_sessions (school_id, academic_year_id, term_id, name, exam_type, status, start_date, end_date, notes, created_by)
VALUES (@school_id, @year_id, @term3_id, 'Term 3 School-Wide Examination', 'end_of_term', 'results_approved', '2026-11-09', '2026-11-20', 'Seeded school-wide exam session.', COALESCE(@headteacher_id, @owner_id));
SET @exam_session_id := LAST_INSERT_ID();

INSERT INTO assessments (
  school_id, exam_session_id, class_id, stream_section, subject_id, academic_year_id, term_id,
  teacher_id, administering_teacher_id, name, assessment_type, term_name, total_marks,
  duration_minutes, instructions, expected_difficulty, status, created_by
)
SELECT @school_id, @exam_session_id, dc.class_id, 'A', ds.subject_id, @year_id, @term3_id,
  ds.teacher_id, dc.class_teacher_id,
  CONCAT(dc.class_name, ' ', subj.name, ' End of Term Exam'),
  'end_of_term_exam', 'Term 3', 100, 90,
  'Answer all questions in the spaces provided.',
  'Medium', 'results_approved', COALESCE(@headteacher_id, @owner_id)
FROM demo_classes dc
CROSS JOIN demo_subjects ds
JOIN subjects subj ON subj.id = ds.subject_id AND subj.school_id = @school_id;

INSERT INTO exam_timetable_entries (
  school_id, exam_session_id, assessment_id, academic_year_id, term_id,
  class_id, stream_section, subject_id, exam_date, start_time, end_time,
  room, invigilator_teacher_id, status
)
SELECT @school_id, @exam_session_id, a.id, @year_id, @term3_id,
  a.class_id, 'A', a.subject_id,
  DATE_ADD('2026-11-09', INTERVAL ds.subject_order - 1 DAY),
  CASE WHEN ds.subject_order IN (1, 3, 5) THEN '08:00:00' ELSE '10:00:00' END,
  CASE WHEN ds.subject_order IN (1, 3, 5) THEN '09:30:00' ELSE '11:30:00' END,
  CONCAT('Room ', dc.class_code),
  a.administering_teacher_id,
  'scheduled'
FROM assessments a
JOIN demo_classes dc ON dc.class_id = a.class_id
JOIN demo_subjects ds ON ds.subject_id = a.subject_id
WHERE a.school_id = @school_id AND a.exam_session_id = @exam_session_id;

INSERT INTO result_batches (
  school_id, exam_session_id, assessment_id, academic_year_id, term_id, class_id,
  stream_section, subject_id, teacher_id, status, submitted_at, submitted_by, approved_at, approved_by
)
SELECT @school_id, @exam_session_id, a.id, @year_id, @term3_id, a.class_id,
  'A', a.subject_id, a.teacher_id, 'approved',
  CURRENT_TIMESTAMP, a.teacher_id, CURRENT_TIMESTAMP, COALESCE(@headteacher_id, @owner_id)
FROM assessments a
WHERE a.school_id = @school_id AND a.term_id = @term3_id;

CREATE TEMPORARY TABLE demo_scores AS
SELECT
  s.id AS student_id,
  se.id AS enrollment_id,
  seed.class_id,
  seed.stream_section,
  seed.seq,
  a.id AS assessment_id,
  a.subject_id,
  rb.id AS result_batch_id,
  a.teacher_id,
  ROUND(
    CASE
      WHEN seed.seq <= 4 THEN 35 + (seed.seq * 2) + MOD(ds.subject_order, 2)
      ELSE 55 + MOD((seed.seq * 7) + (ds.subject_order * 5) + (seed.class_id * 3), 41)
    END,
    2
  ) AS score
FROM demo_student_seed seed
JOIN students s ON s.school_id = @school_id AND s.student_id = seed.student_code
JOIN student_enrollments se ON se.school_id = @school_id AND se.student_id = s.id AND se.term_id = @term3_id
JOIN assessments a ON a.school_id = @school_id AND a.term_id = @term3_id AND a.class_id = seed.class_id
JOIN demo_subjects ds ON ds.subject_id = a.subject_id
JOIN result_batches rb ON rb.school_id = @school_id AND rb.assessment_id = a.id;

INSERT INTO result_entries (school_id, result_batch_id, student_id, enrollment_id, score, grade, comment, status, last_saved_at)
SELECT @school_id, result_batch_id, student_id, enrollment_id, score,
  CASE WHEN score >= 80 THEN 'A' WHEN score >= 70 THEN 'B' WHEN score >= 60 THEN 'C' WHEN score >= 50 THEN 'D' ELSE 'E' END,
  CASE WHEN score < 50 THEN 'Needs targeted support before promotion.' ELSE 'Completed.' END,
  'approved', CURRENT_TIMESTAMP
FROM demo_scores;

INSERT INTO term_results (
  school_id, student_id, enrollment_id, academic_year_id, term_id, class_id,
  stream_section, total_score, average_score, grade, status
)
SELECT @school_id, student_id, enrollment_id, @year_id, @term3_id, class_id, 'A',
  ROUND(SUM(score), 2),
  ROUND(AVG(score), 1),
  CASE
    WHEN AVG(score) >= 80 THEN 'A'
    WHEN AVG(score) >= 70 THEN 'B'
    WHEN AVG(score) >= 60 THEN 'C'
    WHEN AVG(score) >= 50 THEN 'D'
    ELSE 'E'
  END,
  'approved'
FROM demo_scores
GROUP BY student_id, enrollment_id, class_id;

CREATE TEMPORARY TABLE demo_term_positions AS
SELECT id,
  ROW_NUMBER() OVER (
    PARTITION BY class_id
    ORDER BY average_score DESC, total_score DESC, student_id ASC
  ) AS position
FROM term_results
WHERE school_id = @school_id AND academic_year_id = @year_id AND term_id = @term3_id;

UPDATE term_results tr
JOIN demo_term_positions ranked ON ranked.id = tr.id
SET tr.position = ranked.position
WHERE tr.school_id = @school_id;

INSERT INTO subject_results (
  school_id, term_result_id, subject_id, teacher_id, assessment_id, result_batch_id,
  score, grade, comment
)
SELECT @school_id, tr.id, ds.subject_id, ds.teacher_id, ds.assessment_id, ds.result_batch_id,
  ds.score,
  CASE WHEN ds.score >= 80 THEN 'A' WHEN ds.score >= 70 THEN 'B' WHEN ds.score >= 60 THEN 'C' WHEN ds.score >= 50 THEN 'D' ELSE 'E' END,
  CASE WHEN ds.score < 50 THEN 'Needs targeted support.' ELSE 'Completed.' END
FROM demo_scores ds
JOIN term_results tr ON tr.school_id = @school_id AND tr.student_id = ds.student_id AND tr.term_id = @term3_id;

INSERT INTO report_cards (
  school_id, student_id, enrollment_id, academic_year_id, term_id, exam_session_id,
  term_result_id, status, generated_by
)
SELECT @school_id, tr.student_id, tr.enrollment_id, @year_id, @term3_id, @exam_session_id,
  tr.id, 'approved', COALESCE(@headteacher_id, @owner_id)
FROM term_results tr
WHERE tr.school_id = @school_id AND tr.term_id = @term3_id;

INSERT INTO school_events (
  school_id, academic_year_id, term_id, title, description, event_type,
  start_datetime, end_datetime, all_day, created_by, visibility, source_type, status
)
VALUES
  (@school_id, @year_id, @term3_id, 'Term 3 Exam Week', 'School-wide end of term examinations.', 'exam_week', '2026-11-09 07:30:00', '2026-11-20 15:30:00', 0, COALESCE(@headteacher_id, @owner_id), 'whole_school', 'academic_timeline', 'scheduled'),
  (@school_id, @year_id, @term3_id, 'Fee Balance Follow-Up', 'Parents and guardians should clear remaining Term 3 balances before report card collection.', 'academic_deadline', '2026-09-04 07:30:00', '2026-09-04 15:30:00', 0, COALESCE(@bursar_id, @owner_id), 'students', 'manual', 'scheduled'),
  (@school_id, @year_id, @term3_id, 'Class Reading Afternoon', 'Class teachers will issue reading logs for home practice.', 'school_event', '2026-08-28 13:00:00', '2026-08-28 15:00:00', 0, COALESCE(@headteacher_id, @owner_id), 'whole_school', 'manual', 'scheduled'),
  (@school_id, @year_id, @term3_id, 'Progression Approval Window', 'Headteacher reviews class progression before opening the next academic year.', 'term_closing_week', '2026-11-30 07:30:00', '2026-12-04 15:30:00', 0, COALESCE(@headteacher_id, @owner_id), 'staff_only', 'academic_timeline', 'scheduled');

INSERT INTO messages (school_id, message_type, subject, body, recipient_scope, channel, delivery_status, created_by)
SELECT @school_id, 'announcement',
  CONCAT(dc.class_name, ' homework check'),
  'Class teachers will check homework books during the first period.',
  JSON_OBJECT('type', 'class', 'class_id', dc.class_id),
  'in_app',
  'sent',
  COALESCE(dc.class_teacher_id, @headteacher_id, @owner_id)
FROM demo_classes dc;

COMMIT;

SELECT
  @year_id AS academic_year_id,
  @term3_id AS open_term_id,
  (SELECT COUNT(*) FROM students WHERE school_id = @school_id) AS students_seeded,
  (SELECT COUNT(*) FROM assessments WHERE school_id = @school_id AND term_id = @term3_id) AS assessments_seeded,
  (SELECT COUNT(*) FROM result_entries WHERE school_id = @school_id) AS result_entries_seeded;
