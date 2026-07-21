USE smartlink_schools;

SET @school_id := 1;
SET @demo_password_hash := '$2a$10$DnEcFlwc8PvKflxlzWHWO.fKt2UTi8ReqzZLibmsqsFnc21cLM03u';

START TRANSACTION;

INSERT INTO schools (id, code, school_prefix, name, city, country, status)
VALUES (@school_id, 'GREENHILL', 'GPS', 'Greenhill Cambridge Primary School', 'Blantyre', 'Malawi', 'active')
ON DUPLICATE KEY UPDATE
  school_prefix = VALUES(school_prefix),
  name = VALUES(name),
  city = VALUES(city),
  country = VALUES(country),
  status = VALUES(status);

DELETE FROM report_cards WHERE school_id = @school_id;
DELETE sr
FROM subject_results sr
JOIN term_results tr ON tr.id = sr.term_result_id AND tr.school_id = sr.school_id
WHERE sr.school_id = @school_id;
DELETE re
FROM result_entries re
JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
WHERE re.school_id = @school_id;
DELETE atm
FROM assessment_topic_marks atm
JOIN assessment_topics atp ON atp.id = atm.assessment_topic_id AND atp.school_id = atm.school_id
WHERE atm.school_id = @school_id;
DELETE FROM exam_timetable_entries WHERE school_id = @school_id;
DELETE FROM result_batches WHERE school_id = @school_id;
DELETE FROM assessment_topics WHERE school_id = @school_id;
DELETE FROM assessments WHERE school_id = @school_id;
DELETE FROM exam_sessions WHERE school_id = @school_id;
DELETE FROM promotion_decision_cleanup_audit WHERE school_id = @school_id;
DELETE FROM promotion_decisions WHERE school_id = @school_id;
DELETE FROM term_closures WHERE school_id = @school_id;
DELETE FROM homework_submissions WHERE school_id = @school_id;
DELETE FROM homework WHERE school_id = @school_id;
DELETE FROM daily_drills WHERE school_id = @school_id;
DELETE FROM attendance_records WHERE school_id = @school_id;
DELETE fp
FROM fee_payments fp
JOIN fee_accounts fa ON fa.id = fp.fee_account_id AND fa.school_id = fp.school_id
WHERE fp.school_id = @school_id;
DELETE FROM fee_accounts WHERE school_id = @school_id;
DELETE FROM messages WHERE school_id = @school_id;
DELETE FROM parent_student_links WHERE school_id = @school_id;
DELETE FROM student_fee_profiles WHERE school_id = @school_id;
DELETE FROM student_guardians WHERE school_id = @school_id;
DELETE FROM term_results WHERE school_id = @school_id;
DELETE FROM student_enrollment_cleanup_audit WHERE school_id = @school_id;
DELETE FROM student_enrollments WHERE school_id = @school_id;
DELETE FROM students WHERE school_id = @school_id;
DELETE FROM teacher_class_subject_assignments WHERE school_id = @school_id;
UPDATE classes SET teacher_user_id = NULL WHERE school_id = @school_id;
DELETE FROM users WHERE school_id = @school_id AND role IN ('headteacher', 'teacher', 'parent', 'student');

INSERT INTO academic_years (school_id, name, start_date, end_date, status, is_active)
VALUES (@school_id, '2026 Academic Year', '2026-01-05', '2026-12-04', 'active', 1)
ON DUPLICATE KEY UPDATE
  start_date = VALUES(start_date),
  end_date = VALUES(end_date),
  status = VALUES(status),
  is_active = VALUES(is_active);

SET @active_year_id := (
  SELECT id
  FROM academic_years
  WHERE school_id = @school_id AND name = '2026 Academic Year'
  LIMIT 1
);

UPDATE academic_years
SET
  is_active = IF(id = @active_year_id, 1, 0),
  status = CASE
    WHEN id = @active_year_id THEN 'active'
    WHEN status = 'archived' THEN status
    ELSE 'closed'
  END
WHERE school_id = @school_id;

INSERT INTO terms (school_id, academic_year_id, name, term_number, start_date, end_date, status)
VALUES (@school_id, @active_year_id, 'Term 2', 2, '2026-05-05', '2026-08-01', 'open')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  start_date = VALUES(start_date),
  end_date = VALUES(end_date),
  status = VALUES(status);

SET @term_id := (
  SELECT id
  FROM terms
  WHERE school_id = @school_id AND academic_year_id = @active_year_id AND term_number = 2
  LIMIT 1
);

UPDATE terms
SET status = CASE WHEN id = @term_id THEN 'open' ELSE 'closed' END
WHERE school_id = @school_id AND academic_year_id = @active_year_id;

UPDATE terms
SET status = 'closed'
WHERE school_id = @school_id AND id <> @term_id AND status IN ('open', 'marking');

SET @active_year_name := (SELECT name FROM academic_years WHERE id = @active_year_id);
SET @term_name := (SELECT name FROM terms WHERE id = @term_id);
SET @fee_term_name := CONCAT(@term_name, ' ', @active_year_name);

INSERT INTO classes (school_id, name, grade_level) VALUES
  (@school_id, 'Year 1A', 'Year 1'),
  (@school_id, 'Year 2A', 'Year 2'),
  (@school_id, 'Year 3A', 'Year 3'),
  (@school_id, 'Year 4A', 'Year 4'),
  (@school_id, 'Year 5A', 'Year 5'),
  (@school_id, 'Year 6A', 'Year 6')
ON DUPLICATE KEY UPDATE grade_level = VALUES(grade_level);

INSERT INTO subjects (school_id, name, code) VALUES
  (@school_id, 'Mathematics', 'MATH'),
  (@school_id, 'English', 'ENG'),
  (@school_id, 'Science', 'SCI'),
  (@school_id, 'Chichewa', 'CHI'),
  (@school_id, 'Social Studies', 'SOC')
ON DUPLICATE KEY UPDATE code = VALUES(code);

SET @math_id := (SELECT id FROM subjects WHERE school_id = @school_id AND code = 'MATH' LIMIT 1);
SET @english_id := (SELECT id FROM subjects WHERE school_id = @school_id AND code = 'ENG' LIMIT 1);
SET @science_id := (SELECT id FROM subjects WHERE school_id = @school_id AND code = 'SCI' LIMIT 1);
SET @chichewa_id := (SELECT id FROM subjects WHERE school_id = @school_id AND code = 'CHI' LIMIT 1);
SET @social_id := (SELECT id FROM subjects WHERE school_id = @school_id AND code = 'SOC' LIMIT 1);

INSERT INTO users (
  public_ref, school_id, role, full_name, first_name, last_name, email, password_hash,
  must_change_password, phone, gender, employee_id, qualification, specialization,
  address, employment_status, role_type, is_active
) VALUES
  (UUID(), @school_id, 'school_owner', 'Agnes Banda', 'Agnes', 'Banda', 'owner@greenhill.test', @demo_password_hash, 1, '+265 999 100 001', 'Female', 'GPS-ADM-001', 'B.Ed Leadership', 'School Operations', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'admin_teacher', 1),
  (UUID(), @school_id, 'bursar', 'Patrick Mbewe', 'Patrick', 'Mbewe', 'bursar@greenhill.test', @demo_password_hash, 1, '+265 999 100 002', 'Male', 'GPS-ADM-002', 'Diploma in Accounting', 'Finance', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'admin_teacher', 1)
ON DUPLICATE KEY UPDATE
  role = VALUES(role),
  full_name = VALUES(full_name),
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  phone = VALUES(phone),
  employee_id = VALUES(employee_id),
  qualification = VALUES(qualification),
  specialization = VALUES(specialization),
  employment_status = VALUES(employment_status),
  role_type = VALUES(role_type),
  is_active = VALUES(is_active);

INSERT INTO users (
  public_ref, school_id, role, full_name, first_name, last_name, email, password_hash,
  must_change_password, phone, gender, date_of_birth, employee_id, qualification,
  specialization, address, employment_status, role_type, is_active
) VALUES
  (UUID(), @school_id, 'headteacher', 'Elizabeth Phiri', 'Elizabeth', 'Phiri', 'headteacher@greenhill.test', @demo_password_hash, 1, '+265 999 110 001', 'Female', '1981-03-14', 'GPS-T-001', 'B.Ed Primary Education', 'School Leadership', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'headteacher', 1),
  (UUID(), @school_id, 'teacher', 'Joseph Mvula', 'Joseph', 'Mvula', 'deputy@greenhill.test', @demo_password_hash, 1, '+265 999 110 002', 'Male', '1984-09-22', 'GPS-T-002', 'B.Ed Education', 'Deputy Headteacher', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'deputy_headteacher', 1),
  (UUID(), @school_id, 'teacher', 'Grace Moyo', 'Grace', 'Moyo', 'p1.teacher@greenhill.test', @demo_password_hash, 1, '+265 999 110 003', 'Female', '1990-01-18', 'GPS-T-003', 'Diploma in Education', 'Early Grade Literacy', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'teacher', 1),
  (UUID(), @school_id, 'teacher', 'Samuel Kachingwe', 'Samuel', 'Kachingwe', 'p2.teacher@greenhill.test', @demo_password_hash, 1, '+265 999 110 004', 'Male', '1988-07-05', 'GPS-T-004', 'Diploma in Education', 'Numeracy', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'teacher', 1),
  (UUID(), @school_id, 'teacher', 'Mercy Chirwa', 'Mercy', 'Chirwa', 'p3.teacher@greenhill.test', @demo_password_hash, 1, '+265 999 110 005', 'Female', '1992-12-11', 'GPS-T-005', 'B.Ed Primary Education', 'Science and Health', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'teacher', 1),
  (UUID(), @school_id, 'teacher', 'Daniel Nkhata', 'Daniel', 'Nkhata', 'p4.teacher@greenhill.test', @demo_password_hash, 1, '+265 999 110 006', 'Male', '1986-05-30', 'GPS-T-006', 'B.Ed Primary Education', 'Upper Primary', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'teacher', 1),
  (UUID(), @school_id, 'teacher', 'Ruth Tembo', 'Ruth', 'Tembo', 'math.teacher@greenhill.test', @demo_password_hash, 1, '+265 999 110 007', 'Female', '1989-10-03', 'GPS-T-007', 'B.Ed Mathematics', 'Mathematics', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'teacher', 1),
  (UUID(), @school_id, 'teacher', 'Andrew Gondwe', 'Andrew', 'Gondwe', 'english.teacher@greenhill.test', @demo_password_hash, 1, '+265 999 110 008', 'Male', '1991-02-19', 'GPS-T-008', 'B.Ed Languages', 'English and Chichewa', 'Greenhill Cambridge Primary School, Blantyre', 'active', 'teacher', 1)
ON DUPLICATE KEY UPDATE
  role = VALUES(role),
  full_name = VALUES(full_name),
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  phone = VALUES(phone),
  gender = VALUES(gender),
  date_of_birth = VALUES(date_of_birth),
  employee_id = VALUES(employee_id),
  qualification = VALUES(qualification),
  specialization = VALUES(specialization),
  employment_status = VALUES(employment_status),
  role_type = VALUES(role_type),
  is_active = VALUES(is_active);

UPDATE users SET public_ref = UUID() WHERE school_id = @school_id AND (public_ref IS NULL OR public_ref = '');

SET @headteacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'headteacher@greenhill.test' LIMIT 1);
SET @deputy_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'deputy@greenhill.test' LIMIT 1);
SET @p1_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'p1.teacher@greenhill.test' LIMIT 1);
SET @p2_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'p2.teacher@greenhill.test' LIMIT 1);
SET @p3_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'p3.teacher@greenhill.test' LIMIT 1);
SET @p4_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'p4.teacher@greenhill.test' LIMIT 1);
SET @math_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'math.teacher@greenhill.test' LIMIT 1);
SET @english_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'english.teacher@greenhill.test' LIMIT 1);

UPDATE classes SET teacher_user_id = CASE name
  WHEN 'Year 1A' THEN @p1_teacher_id
  WHEN 'Year 2A' THEN @p2_teacher_id
  WHEN 'Year 3A' THEN @p3_teacher_id
  WHEN 'Year 4A' THEN @p4_teacher_id
  WHEN 'Year 5A' THEN @math_teacher_id
  WHEN 'Year 6A' THEN @english_teacher_id
  ELSE teacher_user_id
END
WHERE school_id = @school_id;

INSERT INTO teacher_class_subject_assignments (
  school_id, teacher_id, class_id, subject_id, academic_year_id, term_id,
  academic_year, term, role, is_active, notes
)
SELECT @school_id, c.teacher_user_id, c.id, NULL, @active_year_id, @term_id,
  @active_year_name, @term_name, 'class_teacher', 1, CONCAT(c.name, ' class teacher')
FROM classes c
WHERE c.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A');

INSERT INTO teacher_class_subject_assignments (
  school_id, teacher_id, class_id, subject_id, academic_year_id, term_id,
  academic_year, term, role, is_active, notes
)
SELECT @school_id,
  CASE subj.code
    WHEN 'MATH' THEN @math_teacher_id
    WHEN 'ENG' THEN @english_teacher_id
    WHEN 'CHI' THEN @english_teacher_id
    WHEN 'SCI' THEN @p3_teacher_id
    ELSE @deputy_id
  END,
  c.id,
  subj.id,
  @active_year_id,
  @term_id,
  @active_year_name,
  @term_name,
  'subject_teacher',
  1,
  CONCAT(subj.name, ' for ', c.name)
FROM classes c
JOIN subjects subj ON subj.school_id = c.school_id AND subj.code IN ('MATH', 'ENG', 'SCI', 'CHI', 'SOC')
WHERE c.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A');

INSERT INTO students (
  public_ref, school_id, class_id, student_id, admission_no, first_name, last_name,
  date_of_birth, gender, stream_section, enrollment_date, student_type, status
) VALUES
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 1A'), 'GPS-2026-00001', 'GPS-2026-00001', 'Thoko', 'Banda', '2019-02-12', 'Female', 'A', '2026-05-05', 'new', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 1A'), 'GPS-2026-00002', 'GPS-2026-00002', 'Yamikani', 'Phiri', '2019-06-21', 'Male', 'A', '2026-05-05', 'new', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 1A'), 'GPS-2026-00003', 'GPS-2026-00003', 'Tadala', 'Mbewe', '2018-11-09', 'Female', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 1A'), 'GPS-2026-00004', 'GPS-2026-00004', 'Blessings', 'Nkhoma', '2019-09-30', 'Male', 'A', '2026-05-05', 'new', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 1A'), 'GPS-2026-00005', 'GPS-2026-00005', 'Chikondi', 'Chirwa', '2018-12-17', 'Female', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 1A'), 'GPS-2026-00006', 'GPS-2026-00006', 'Pemphero', 'Kumwenda', '2019-04-04', 'Male', 'A', '2026-05-05', 'new', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 2A'), 'GPS-2026-00007', 'GPS-2026-00007', 'Ruth', 'Jere', '2018-01-25', 'Female', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 2A'), 'GPS-2026-00008', 'GPS-2026-00008', 'Mphatso', 'Mvula', '2018-08-13', 'Male', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 2A'), 'GPS-2026-00009', 'GPS-2026-00009', 'Lumbani', 'Tembo', '2017-10-01', 'Female', 'A', '2026-05-05', 'transfer', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 2A'), 'GPS-2026-00010', 'GPS-2026-00010', 'Dalitso', 'Kachale', '2018-03-19', 'Male', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 2A'), 'GPS-2026-00011', 'GPS-2026-00011', 'Madalitso', 'Soko', '2018-05-07', 'Female', 'A', '2026-05-05', 'new', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 2A'), 'GPS-2026-00012', 'GPS-2026-00012', 'Takondwa', 'Ngoma', '2017-12-28', 'Male', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 3A'), 'GPS-2026-00013', 'GPS-2026-00013', 'Memory', 'Kondowe', '2017-02-03', 'Female', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 3A'), 'GPS-2026-00014', 'GPS-2026-00014', 'Gift', 'Mkandawire', '2017-07-16', 'Male', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 3A'), 'GPS-2026-00015', 'GPS-2026-00015', 'Natasha', 'Kaphale', '2016-09-08', 'Female', 'A', '2026-05-05', 'transfer', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 3A'), 'GPS-2026-00016', 'GPS-2026-00016', 'Tapiwa', 'Lungu', '2017-11-20', 'Male', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 3A'), 'GPS-2026-00017', 'GPS-2026-00017', 'Esnart', 'Kalua', '2017-04-14', 'Female', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 3A'), 'GPS-2026-00018', 'GPS-2026-00018', 'Innocent', 'Nyirenda', '2016-12-02', 'Male', 'A', '2026-05-05', 'new', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 4A'), 'GPS-2026-00019', 'GPS-2026-00019', 'Chisomo', 'Mwale', '2016-01-29', 'Female', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 4A'), 'GPS-2026-00020', 'GPS-2026-00020', 'Patrick', 'Munthali', '2016-06-18', 'Male', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 4A'), 'GPS-2026-00021', 'GPS-2026-00021', 'Favour', 'Manda', '2015-08-24', 'Female', 'A', '2026-05-05', 'transfer', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 4A'), 'GPS-2026-00022', 'GPS-2026-00022', 'Kelvin', 'Nyirenda', '2016-10-10', 'Male', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 4A'), 'GPS-2026-00023', 'GPS-2026-00023', 'Martha', 'Kamanga', '2016-03-05', 'Female', 'A', '2026-05-05', 'returning', 'active'),
  (UUID(), @school_id, (SELECT id FROM classes WHERE school_id = @school_id AND name = 'Year 4A'), 'GPS-2026-00024', 'GPS-2026-00024', 'Wisdom', 'Zimba', '2015-12-12', 'Male', 'A', '2026-05-05', 'new', 'active');

UPDATE students
SET previous_school = 'Namiwawa Primary School'
WHERE school_id = @school_id AND student_type = 'transfer';

UPDATE students SET public_ref = UUID() WHERE school_id = @school_id AND (public_ref IS NULL OR public_ref = '');

INSERT INTO school_student_sequences (school_id, sequence_year, last_sequence)
VALUES (@school_id, 2026, 24)
ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, VALUES(last_sequence));

INSERT INTO student_enrollments (
  school_id, student_id, academic_year_id, term_id, class_id, stream_section,
  enrollment_type, enrollment_status, start_date
)
SELECT @school_id, s.id, @active_year_id, @term_id, s.class_id, s.stream_section,
  s.student_type, 'active', s.enrollment_date
FROM students s
WHERE s.school_id = @school_id;

INSERT INTO student_guardians (
  public_ref, school_id, student_id, guardian_number, full_name, relationship,
  primary_phone, secondary_phone, email, national_id
)
SELECT UUID(), @school_id, s.id, 1,
  CONCAT('Mrs. ', s.last_name),
  'guardian',
  CONCAT('+265 888 ', LPAD(200000 + ROW_NUMBER() OVER (ORDER BY s.admission_no), 6, '0')),
  NULL,
  LOWER(CONCAT('guardian.', REPLACE(s.admission_no, '-', ''), '@greenhill.test')),
  NULL
FROM students s
WHERE s.school_id = @school_id;

INSERT INTO student_fee_profiles (
  school_id, student_id, fee_category, payment_plan, discount_percent, discount_reason
)
SELECT @school_id, s.id,
  CASE WHEN MOD(CAST(RIGHT(s.admission_no, 2) AS UNSIGNED), 8) = 0 THEN 'bursary' ELSE 'standard' END,
  'termly',
  CASE WHEN MOD(CAST(RIGHT(s.admission_no, 2) AS UNSIGNED), 8) = 0 THEN 25 ELSE 0 END,
  CASE WHEN MOD(CAST(RIGHT(s.admission_no, 2) AS UNSIGNED), 8) = 0 THEN 'Community bursary support' ELSE NULL END
FROM students s
WHERE s.school_id = @school_id;

INSERT INTO fee_accounts (school_id, student_id, term_name, amount_due, amount_paid, status, due_date)
SELECT @school_id, s.id, @fee_term_name,
  150000.00,
  CASE MOD(CAST(RIGHT(s.admission_no, 2) AS UNSIGNED), 4)
    WHEN 0 THEN 150000.00
    WHEN 1 THEN 100000.00
    WHEN 2 THEN 75000.00
    ELSE 0.00
  END,
  CASE MOD(CAST(RIGHT(s.admission_no, 2) AS UNSIGNED), 4)
    WHEN 0 THEN 'paid'
    WHEN 1 THEN 'partial'
    WHEN 2 THEN 'partial'
    ELSE 'overdue'
  END,
  '2026-06-30'
FROM students s
WHERE s.school_id = @school_id;

INSERT INTO attendance_records (school_id, class_id, student_id, attendance_date, status, note, marked_by)
SELECT @school_id, s.class_id, s.id, CURRENT_DATE,
  CASE MOD(CAST(RIGHT(s.admission_no, 2) AS UNSIGNED), 6)
    WHEN 0 THEN 'absent'
    WHEN 1 THEN 'present'
    WHEN 2 THEN 'present'
    WHEN 3 THEN 'late'
    WHEN 4 THEN 'present'
    ELSE 'sick'
  END,
  CASE MOD(CAST(RIGHT(s.admission_no, 2) AS UNSIGNED), 6)
    WHEN 0 THEN 'Guardian notified'
    WHEN 3 THEN 'Arrived after assembly'
    WHEN 5 THEN 'Clinic visit reported'
    ELSE NULL
  END,
  c.teacher_user_id
FROM students s
JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
WHERE s.school_id = @school_id;

INSERT INTO homework (school_id, class_id, subject_id, title, instructions, due_date, status, created_by)
SELECT @school_id, c.id, @english_id, CONCAT(c.name, ' Reading Practice'),
  'Read the assigned passage and answer the questions in the exercise book.',
  DATE_ADD(CURRENT_DATE, INTERVAL 2 DAY), 'pending', c.teacher_user_id
FROM classes c
WHERE c.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A');

INSERT INTO homework (school_id, class_id, subject_id, title, instructions, due_date, status, created_by)
SELECT @school_id, c.id, @math_id, CONCAT(c.name, ' Number Work'),
  'Complete the number patterns and word problems.',
  DATE_ADD(CURRENT_DATE, INTERVAL 3 DAY), 'pending', @math_teacher_id
FROM classes c
WHERE c.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A');

INSERT INTO assessments (
  school_id, class_id, subject_id, academic_year_id, term_id, teacher_id,
  name, assessment_type, term_name, total_marks, duration_minutes,
  expected_difficulty, status, created_by
)
SELECT @school_id, c.id, subj.id, @active_year_id, @term_id,
  CASE WHEN subj.code = 'MATH' THEN @math_teacher_id ELSE @english_teacher_id END,
  CASE
    WHEN subj.code = 'MATH' THEN CONCAT(c.name, ' Mathematics Class Test')
    ELSE CONCAT(c.name, ' English Reading Quiz')
  END,
  CASE WHEN subj.code = 'MATH' THEN 'class_test' ELSE 'quiz' END,
  @term_name,
  100,
  CASE WHEN subj.code = 'MATH' THEN 60 ELSE 45 END,
  'Medium',
  'open',
  CASE WHEN subj.code = 'MATH' THEN @math_teacher_id ELSE @english_teacher_id END
FROM classes c
JOIN subjects subj ON subj.school_id = c.school_id AND subj.code IN ('MATH', 'ENG')
WHERE c.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A');

INSERT INTO result_batches (
  school_id, assessment_id, academic_year_id, term_id, class_id, subject_id,
  teacher_id, status
)
SELECT a.school_id, a.id, @active_year_id, @term_id, a.class_id, a.subject_id,
  COALESCE(a.teacher_id, a.created_by), 'draft'
FROM assessments a
WHERE a.school_id = @school_id AND a.academic_year_id = @active_year_id AND a.term_id = @term_id;

INSERT INTO result_entries (
  school_id, result_batch_id, student_id, enrollment_id, score, grade, comment,
  status, last_saved_at
)
SELECT scored.school_id, scored.result_batch_id, scored.student_id, scored.enrollment_id,
  scored.score,
  CASE
    WHEN scored.score >= 80 THEN 'A'
    WHEN scored.score >= 70 THEN 'B'
    WHEN scored.score >= 60 THEN 'C'
    WHEN scored.score >= 50 THEN 'D'
    ELSE 'E'
  END,
  CASE
    WHEN scored.score >= 75 THEN 'Strong progress'
    WHEN scored.score >= 60 THEN 'Satisfactory progress'
    ELSE 'Needs support and practice'
  END,
  'draft',
  NOW()
FROM (
  SELECT rb.school_id, rb.id AS result_batch_id, s.id AS student_id, se.id AS enrollment_id,
    45 + MOD((CAST(RIGHT(s.admission_no, 2) AS UNSIGNED) * 7) + rb.id, 51) AS score
  FROM result_batches rb
  JOIN students s ON s.school_id = rb.school_id AND s.class_id = rb.class_id
  JOIN student_enrollments se ON se.school_id = s.school_id
    AND se.student_id = s.id
    AND se.academic_year_id = rb.academic_year_id
    AND se.term_id = rb.term_id
  WHERE rb.school_id = @school_id AND rb.academic_year_id = @active_year_id AND rb.term_id = @term_id
) scored;

INSERT INTO term_results (
  school_id, student_id, enrollment_id, academic_year_id, term_id, class_id,
  stream_section, total_score, average_score, grade, position, status
)
SELECT summarized.school_id, summarized.student_id, summarized.enrollment_id,
  @active_year_id, @term_id, summarized.class_id, summarized.stream_section,
  summarized.total_score, summarized.average_score,
  CASE
    WHEN summarized.average_score >= 80 THEN 'A'
    WHEN summarized.average_score >= 70 THEN 'B'
    WHEN summarized.average_score >= 60 THEN 'C'
    WHEN summarized.average_score >= 50 THEN 'D'
    ELSE 'E'
  END,
  NULL,
  'generated'
FROM (
  SELECT rb.school_id, re.student_id, re.enrollment_id, se.class_id, se.stream_section,
    SUM(re.score) AS total_score,
    ROUND(AVG(re.score), 2) AS average_score
  FROM result_entries re
  JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
  JOIN student_enrollments se ON se.id = re.enrollment_id AND se.school_id = re.school_id
  WHERE rb.school_id = @school_id AND rb.academic_year_id = @active_year_id AND rb.term_id = @term_id
  GROUP BY rb.school_id, re.student_id, re.enrollment_id, se.class_id, se.stream_section
) summarized;

INSERT INTO subject_results (
  school_id, term_result_id, subject_id, teacher_id, assessment_id, result_batch_id,
  score, grade, comment
)
SELECT re.school_id, tr.id, rb.subject_id, rb.teacher_id, rb.assessment_id, rb.id,
  re.score, re.grade, re.comment
FROM result_entries re
JOIN result_batches rb ON rb.id = re.result_batch_id AND rb.school_id = re.school_id
JOIN term_results tr ON tr.school_id = re.school_id
  AND tr.student_id = re.student_id
  AND tr.enrollment_id = re.enrollment_id
  AND tr.academic_year_id = rb.academic_year_id
  AND tr.term_id = rb.term_id
WHERE re.school_id = @school_id AND rb.academic_year_id = @active_year_id AND rb.term_id = @term_id;

INSERT INTO report_cards (
  school_id, student_id, enrollment_id, academic_year_id, term_id,
  term_result_id, status, generated_by
)
SELECT @school_id, tr.student_id, tr.enrollment_id, @active_year_id, @term_id,
  tr.id, 'generated', @headteacher_id
FROM term_results tr
WHERE tr.school_id = @school_id AND tr.academic_year_id = @active_year_id AND tr.term_id = @term_id;

DELETE FROM class_progression_rules WHERE school_id = @school_id;
INSERT INTO class_progression_rules (school_id, from_class_id, to_class_id, is_terminal_class, default_decision, is_active)
SELECT @school_id, c.id, next_c.id,
  CASE WHEN c.name = 'Year 6A' THEN 1 ELSE 0 END,
  CASE WHEN c.name = 'Year 6A' THEN 'graduate' ELSE 'promote' END,
  1
FROM classes c
LEFT JOIN classes next_c ON next_c.school_id = c.school_id AND next_c.name = CASE c.name
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
  (@school_id, 'term', JSON_OBJECT('name', @fee_term_name, 'starts_on', '2026-05-05', 'ends_on', '2026-08-01')),
  (@school_id, 'progression_policy', JSON_OBJECT('minimum_average', 50, 'enforce_threshold', TRUE)),
  (@school_id, 'curriculum', JSON_OBJECT('name', 'Cambridge Primary Curriculum', 'programme', 'Cambridge Primary', 'years', JSON_ARRAY('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')))
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

COMMIT;
