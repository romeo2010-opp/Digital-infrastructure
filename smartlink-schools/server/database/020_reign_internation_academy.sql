USE smartlink_schools;

SET @ria_password_hash := '$2a$10$Rxzu8gNLg1BOaFrgpfjzi.Ji6I.kxK.m4cAFYZ4tt/sr7NOCNskJC';

INSERT INTO schools (code, school_prefix, name, city, country, status)
VALUES ('RIA', 'RIA', 'Reign Internation Academy', 'Blantyre', 'Malawi', 'active')
ON DUPLICATE KEY UPDATE
  school_prefix = VALUES(school_prefix),
  name = VALUES(name),
  city = VALUES(city),
  country = VALUES(country),
  status = VALUES(status);

SET @school_id := (
  SELECT id
  FROM schools
  WHERE code = 'RIA'
  LIMIT 1
);

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
SET is_active = IF(id = @active_year_id, 1, 0),
  status = CASE WHEN id = @active_year_id THEN 'active' ELSE status END
WHERE school_id = @school_id;

INSERT INTO terms (
  school_id, academic_year_id, name, term_number, start_date, end_date,
  revision_start_date, revision_end_date, exam_start_date, exam_end_date,
  marking_start_date, marking_end_date, closing_date, status
)
VALUES (
  @school_id, @active_year_id, 'Term 2', 2, '2026-05-04', '2026-08-07',
  '2026-07-13', '2026-07-17', '2026-07-20', '2026-07-31',
  '2026-08-03', '2026-08-06', '2026-08-07', 'open'
)
ON DUPLICATE KEY UPDATE
  start_date = VALUES(start_date),
  end_date = VALUES(end_date),
  revision_start_date = VALUES(revision_start_date),
  revision_end_date = VALUES(revision_end_date),
  exam_start_date = VALUES(exam_start_date),
  exam_end_date = VALUES(exam_end_date),
  marking_start_date = VALUES(marking_start_date),
  marking_end_date = VALUES(marking_end_date),
  closing_date = VALUES(closing_date),
  status = VALUES(status);

SET @term_id := (
  SELECT id
  FROM terms
  WHERE school_id = @school_id AND academic_year_id = @active_year_id AND term_number = 2
  LIMIT 1
);

UPDATE terms
SET status = CASE WHEN id = @term_id THEN 'open' ELSE 'closed' END
WHERE school_id = @school_id AND academic_year_id = @active_year_id AND status IN ('open', 'marking');

SET @active_year_name := (SELECT name FROM academic_years WHERE id = @active_year_id);
SET @term_name := (SELECT name FROM terms WHERE id = @term_id);

INSERT INTO curricula (school_id, name, country, is_active)
VALUES (@school_id, 'Reign Primary Curriculum', 'Malawi', 1)
ON DUPLICATE KEY UPDATE
  country = VALUES(country),
  is_active = VALUES(is_active);

SET @curriculum_id := (
  SELECT id
  FROM curricula
  WHERE school_id = @school_id AND name = 'Reign Primary Curriculum'
  LIMIT 1
);

UPDATE curricula
SET is_active = IF(id = @curriculum_id, 1, 0)
WHERE school_id = @school_id;

CREATE TEMPORARY TABLE ria_years (
  name VARCHAR(40) PRIMARY KEY,
  order_number INT NOT NULL
);

INSERT INTO ria_years (name, order_number)
VALUES
  ('Year 1', 1),
  ('Year 2', 2),
  ('Year 3', 3),
  ('Year 4', 4),
  ('Year 5', 5),
  ('Year 6', 6);

INSERT INTO grade_levels (school_id, curriculum_id, name, stage, order_number, is_candidate)
SELECT @school_id, @curriculum_id, name, 'Primary', order_number, IF(order_number = 6, 1, 0)
FROM ria_years
ON DUPLICATE KEY UPDATE
  curriculum_id = VALUES(curriculum_id),
  stage = VALUES(stage),
  order_number = VALUES(order_number),
  is_candidate = VALUES(is_candidate);

INSERT INTO subjects (school_id, name, code)
VALUES
  (@school_id, 'English', 'ENG'),
  (@school_id, 'Creative Writing', 'CW'),
  (@school_id, 'Mathematics', 'MATH'),
  (@school_id, 'Science', 'SCI')
ON DUPLICATE KEY UPDATE code = VALUES(code);

INSERT INTO users (
  school_id, role, full_name, first_name, last_name, email, password_hash,
  must_change_password, phone, gender, date_of_birth, employee_id,
  qualification, specialization, address, employment_status, role_type, is_active
)
VALUES
  (@school_id, 'school_owner', 'Amelia Reign', 'Amelia', 'Reign', 'owner@ria.com', @ria_password_hash, 0, '+265 887 430 001', 'Female', '1982-04-17', 'RIA-ADM-001', 'B.Ed Leadership', 'School Operations', 'Reign Internation Academy, Blantyre', 'active', 'admin_teacher', 1),
  (@school_id, 'headteacher', 'Jonathan Moyo', 'Jonathan', 'Moyo', 'headteacheer@ria.com', @ria_password_hash, 0, '+265 887 430 002', 'Male', '1979-11-03', 'RIA-T-001', 'M.Ed Educational Leadership', 'Primary School Leadership', 'Reign Internation Academy, Blantyre', 'active', 'headteacher', 1),
  (@school_id, 'bursar', 'Naomi Banda', 'Naomi', 'Banda', 'bursar@ria.com', @ria_password_hash, 0, '+265 887 430 003', 'Female', '1986-02-21', 'RIA-ADM-002', 'Diploma in Accounting', 'Finance', 'Reign Internation Academy, Blantyre', 'active', 'admin_teacher', 1),
  (@school_id, 'teacher', 'Ruth Mwale', 'Ruth', 'Mwale', 'year1.teacher@ria.com', @ria_password_hash, 0, '+265 887 431 001', 'Female', '1991-08-14', 'RIA-T-101', 'Diploma in Primary Education', 'Early Years', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Daniel Phiri', 'Daniel', 'Phiri', 'year2.teacher@ria.com', @ria_password_hash, 0, '+265 887 431 002', 'Male', '1989-05-08', 'RIA-T-102', 'Diploma in Primary Education', 'Lower Primary Numeracy', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Grace Tembo', 'Grace', 'Tembo', 'year3.teacher@ria.com', @ria_password_hash, 0, '+265 887 431 003', 'Female', '1990-12-19', 'RIA-T-103', 'B.Ed Primary Education', 'Reading Development', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Kelvin Chirwa', 'Kelvin', 'Chirwa', 'year4.teacher@ria.com', @ria_password_hash, 0, '+265 887 431 004', 'Male', '1988-09-27', 'RIA-T-104', 'B.Ed Primary Education', 'Upper Primary', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Martha Gondwe', 'Martha', 'Gondwe', 'year5.teacher@ria.com', @ria_password_hash, 0, '+265 887 431 005', 'Female', '1987-06-16', 'RIA-T-105', 'B.Ed Primary Education', 'Mathematics Support', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Peter Nkhoma', 'Peter', 'Nkhoma', 'year6.teacher@ria.com', @ria_password_hash, 0, '+265 887 431 006', 'Male', '1985-03-25', 'RIA-T-106', 'B.Ed Primary Education', 'Checkpoint Preparation', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Lindiwe Kachale', 'Lindiwe', 'Kachale', 'english.teacher@ria.com', @ria_password_hash, 0, '+265 887 432 001', 'Female', '1992-01-12', 'RIA-T-201', 'B.Ed Languages', 'English', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Samuel Mkandawire', 'Samuel', 'Mkandawire', 'writing.teacher@ria.com', @ria_password_hash, 0, '+265 887 432 002', 'Male', '1991-10-04', 'RIA-T-202', 'B.Ed Languages', 'Creative Writing', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Memory Jere', 'Memory', 'Jere', 'mathematics.teacher@ria.com', @ria_password_hash, 0, '+265 887 432 003', 'Female', '1989-07-23', 'RIA-T-203', 'B.Ed Mathematics', 'Mathematics', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1),
  (@school_id, 'teacher', 'Patrick Munthali', 'Patrick', 'Munthali', 'science.teacher@ria.com', @ria_password_hash, 0, '+265 887 432 004', 'Male', '1988-04-30', 'RIA-T-204', 'B.Ed Science', 'Science', 'Reign Internation Academy, Blantyre', 'active', 'teacher', 1)
ON DUPLICATE KEY UPDATE
  school_id = VALUES(school_id),
  role = VALUES(role),
  full_name = VALUES(full_name),
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  password_hash = VALUES(password_hash),
  must_change_password = VALUES(must_change_password),
  phone = VALUES(phone),
  gender = VALUES(gender),
  date_of_birth = VALUES(date_of_birth),
  employee_id = VALUES(employee_id),
  qualification = VALUES(qualification),
  specialization = VALUES(specialization),
  address = VALUES(address),
  employment_status = VALUES(employment_status),
  role_type = VALUES(role_type),
  is_active = VALUES(is_active);

SET @owner_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'owner@ria.com' LIMIT 1);
SET @headteacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'headteacheer@ria.com' LIMIT 1);
SET @year1_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'year1.teacher@ria.com' LIMIT 1);
SET @year2_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'year2.teacher@ria.com' LIMIT 1);
SET @year3_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'year3.teacher@ria.com' LIMIT 1);
SET @year4_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'year4.teacher@ria.com' LIMIT 1);
SET @year5_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'year5.teacher@ria.com' LIMIT 1);
SET @year6_teacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'year6.teacher@ria.com' LIMIT 1);

INSERT INTO classes (school_id, name, grade_level, teacher_user_id)
VALUES
  (@school_id, 'Year 1', 'Year 1', @year1_teacher_id),
  (@school_id, 'Year 2', 'Year 2', @year2_teacher_id),
  (@school_id, 'Year 3', 'Year 3', @year3_teacher_id),
  (@school_id, 'Year 4', 'Year 4', @year4_teacher_id),
  (@school_id, 'Year 5', 'Year 5', @year5_teacher_id),
  (@school_id, 'Year 6', 'Year 6', @year6_teacher_id)
ON DUPLICATE KEY UPDATE
  grade_level = VALUES(grade_level),
  teacher_user_id = VALUES(teacher_user_id);

CREATE TEMPORARY TABLE ria_students (
  class_name VARCHAR(40) NOT NULL,
  student_code VARCHAR(40) PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender VARCHAR(30) NOT NULL
);

INSERT INTO ria_students (class_name, student_code, first_name, last_name, date_of_birth, gender)
VALUES
  ('Year 1', 'RIA-Y1-001', 'Ariana', 'Banda', '2019-02-12', 'Female'),
  ('Year 1', 'RIA-Y1-002', 'Caleb', 'Mvula', '2019-05-19', 'Male'),
  ('Year 1', 'RIA-Y1-003', 'Thandiwe', 'Phiri', '2019-08-07', 'Female'),
  ('Year 1', 'RIA-Y1-004', 'Micah', 'Chirwa', '2019-11-22', 'Male'),
  ('Year 1', 'RIA-Y1-005', 'Riana', 'Kumwenda', '2018-12-18', 'Female'),
  ('Year 1', 'RIA-Y1-006', 'Ethan', 'Tembo', '2019-03-27', 'Male'),
  ('Year 2', 'RIA-Y2-001', 'Chikondi', 'Mwale', '2018-01-16', 'Female'),
  ('Year 2', 'RIA-Y2-002', 'Nathan', 'Jere', '2018-04-08', 'Male'),
  ('Year 2', 'RIA-Y2-003', 'Favour', 'Soko', '2018-07-21', 'Female'),
  ('Year 2', 'RIA-Y2-004', 'Tapiwa', 'Kachale', '2018-09-30', 'Male'),
  ('Year 2', 'RIA-Y2-005', 'Lumbani', 'Manda', '2017-12-06', 'Female'),
  ('Year 2', 'RIA-Y2-006', 'David', 'Nkhoma', '2018-02-23', 'Male'),
  ('Year 3', 'RIA-Y3-001', 'Natasha', 'Zimba', '2017-01-14', 'Female'),
  ('Year 3', 'RIA-Y3-002', 'Yamikani', 'Mkandawire', '2017-03-25', 'Male'),
  ('Year 3', 'RIA-Y3-003', 'Mercy', 'Lungu', '2017-06-03', 'Female'),
  ('Year 3', 'RIA-Y3-004', 'Joshua', 'Kalua', '2017-08-17', 'Male'),
  ('Year 3', 'RIA-Y3-005', 'Esnart', 'Nyirenda', '2016-11-29', 'Female'),
  ('Year 3', 'RIA-Y3-006', 'Blessings', 'Gondwe', '2017-10-12', 'Male'),
  ('Year 4', 'RIA-Y4-001', 'Madalitso', 'Bwanali', '2016-01-28', 'Female'),
  ('Year 4', 'RIA-Y4-002', 'Kelvin', 'Mbewe', '2016-04-10', 'Male'),
  ('Year 4', 'RIA-Y4-003', 'Memory', 'Kamanga', '2016-06-26', 'Female'),
  ('Year 4', 'RIA-Y4-004', 'Patrick', 'Munthali', '2016-09-09', 'Male'),
  ('Year 4', 'RIA-Y4-005', 'Tadala', 'Nkhata', '2015-12-15', 'Female'),
  ('Year 4', 'RIA-Y4-006', 'Innocent', 'Kondowe', '2016-02-20', 'Male'),
  ('Year 5', 'RIA-Y5-001', 'Martha', 'Kaphale', '2015-01-19', 'Female'),
  ('Year 5', 'RIA-Y5-002', 'Samuel', 'Chisale', '2015-03-31', 'Male'),
  ('Year 5', 'RIA-Y5-003', 'Agnes', 'Masina', '2015-07-13', 'Female'),
  ('Year 5', 'RIA-Y5-004', 'Peter', 'Chimwala', '2015-09-24', 'Male'),
  ('Year 5', 'RIA-Y5-005', 'Ruth', 'Bengo', '2014-12-11', 'Female'),
  ('Year 5', 'RIA-Y5-006', 'Wisdom', 'Kayira', '2015-05-06', 'Male'),
  ('Year 6', 'RIA-Y6-001', 'Naomi', 'Mataka', '2014-01-07', 'Female'),
  ('Year 6', 'RIA-Y6-002', 'Daniel', 'Mponda', '2014-04-18', 'Male'),
  ('Year 6', 'RIA-Y6-003', 'Lindiwe', 'Chimombo', '2014-06-29', 'Female'),
  ('Year 6', 'RIA-Y6-004', 'Joseph', 'Bandawe', '2014-08-20', 'Male'),
  ('Year 6', 'RIA-Y6-005', 'Faith', 'Nyaude', '2013-11-03', 'Female'),
  ('Year 6', 'RIA-Y6-006', 'Andrew', 'Chirwa', '2014-02-14', 'Male');

INSERT INTO students (
  school_id, class_id, student_id, admission_no, first_name, last_name,
  date_of_birth, gender, stream_section, enrollment_date, student_type, status
)
SELECT @school_id, c.id, roster.student_code, roster.student_code,
  roster.first_name, roster.last_name, roster.date_of_birth, roster.gender,
  'A', '2026-05-04', 'returning', 'active'
FROM ria_students roster
JOIN classes c ON c.school_id = @school_id AND c.name = roster.class_name
ON DUPLICATE KEY UPDATE
  class_id = VALUES(class_id),
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  date_of_birth = VALUES(date_of_birth),
  gender = VALUES(gender),
  stream_section = VALUES(stream_section),
  enrollment_date = VALUES(enrollment_date),
  status = VALUES(status);

INSERT INTO school_student_sequences (school_id, sequence_year, last_sequence)
VALUES (@school_id, 2026, 36)
ON DUPLICATE KEY UPDATE last_sequence = GREATEST(last_sequence, VALUES(last_sequence));

INSERT INTO student_enrollments (
  school_id, student_id, academic_year_id, term_id, class_id, stream_section,
  enrollment_type, enrollment_status, start_date
)
SELECT @school_id, s.id, @active_year_id, @term_id, s.class_id, s.stream_section,
  'continued', 'active', '2026-05-04'
FROM students s
WHERE s.school_id = @school_id AND s.student_id LIKE 'RIA-Y%'
ON DUPLICATE KEY UPDATE
  class_id = VALUES(class_id),
  stream_section = VALUES(stream_section),
  enrollment_status = VALUES(enrollment_status),
  start_date = VALUES(start_date),
  end_date = NULL;

INSERT INTO teacher_class_subject_assignments (
  school_id, teacher_id, class_id, subject_id, academic_year_id, term_id,
  academic_year, term, role, is_active, notes
)
SELECT @school_id, c.teacher_user_id, c.id, NULL, @active_year_id, @term_id,
  @active_year_name, @term_name, 'class_teacher', 1, CONCAT(c.name, ' class teacher')
FROM classes c
WHERE c.school_id = @school_id AND c.name IN ('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')
  AND NOT EXISTS (
    SELECT 1
    FROM teacher_class_subject_assignments existing
    WHERE existing.school_id = @school_id
      AND existing.class_id = c.id
      AND existing.subject_id IS NULL
      AND existing.role = 'class_teacher'
      AND (existing.academic_year_id <=> @active_year_id)
      AND (existing.term_id <=> @term_id)
  );

INSERT INTO teacher_class_subject_assignments (
  school_id, teacher_id, class_id, subject_id, academic_year_id, term_id,
  academic_year, term, role, is_active, notes
)
SELECT @school_id, c.teacher_user_id, c.id, subj.id, @active_year_id, @term_id,
  @active_year_name, @term_name, 'subject_teacher', 1, CONCAT(subj.name, ' for ', c.name)
FROM classes c
JOIN subjects subj ON subj.school_id = @school_id AND subj.code IN ('ENG', 'CW', 'MATH', 'SCI')
WHERE c.school_id = @school_id AND c.name IN ('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')
  AND NOT EXISTS (
    SELECT 1
    FROM teacher_class_subject_assignments existing
    WHERE existing.school_id = @school_id
      AND existing.class_id = c.id
      AND existing.subject_id = subj.id
      AND existing.role = 'subject_teacher'
      AND (existing.academic_year_id <=> @active_year_id)
      AND (existing.term_id <=> @term_id)
  );

INSERT INTO school_settings (school_id, setting_key, setting_value)
VALUES
  (@school_id, 'school_features', JSON_OBJECT('features', JSON_OBJECT(
    'school_timetables', TRUE,
    'exam_timetables', TRUE,
    'personal_timetable_views', TRUE,
    'student_exam_views', TRUE,
    'invigilation_views', TRUE,
    'timetable_generation', TRUE,
    'timetable_publication', TRUE,
    'daily_adjustments', TRUE
  ))),
  (@school_id, 'curriculum', JSON_OBJECT(
    'name', 'Reign Primary Curriculum',
    'programme', 'Primary',
    'years', JSON_ARRAY('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6'),
    'subjects', JSON_ARRAY('English', 'Creative Writing', 'Mathematics', 'Science')
  ))
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

INSERT INTO timetables (
  school_id, timetable_type, name, academic_year_id, term_id, cycle_type,
  effective_from, effective_to, status, setup_progress, created_by
)
VALUES (
  @school_id, 'SCHOOL_TIMETABLE', 'RIA Weekly Timetable', @active_year_id, @term_id, 'NORMAL_WEEK',
  '2026-05-04', '2026-08-07', 'PUBLISHED',
  JSON_OBJECT('classes', 6, 'subjects', 4, 'periods', 6),
  COALESCE(@headteacher_id, @owner_id)
)
ON DUPLICATE KEY UPDATE
  effective_from = VALUES(effective_from),
  effective_to = VALUES(effective_to),
  status = VALUES(status),
  setup_progress = VALUES(setup_progress);

SET @timetable_id := (
  SELECT id
  FROM timetables
  WHERE school_id = @school_id
    AND timetable_type = 'SCHOOL_TIMETABLE'
    AND academic_year_id = @active_year_id
    AND term_id = @term_id
    AND name = 'RIA Weekly Timetable'
  LIMIT 1
);

INSERT INTO timetable_versions (
  timetable_id, version_number, status, creation_method, hard_conflict_count,
  soft_penalty_score, configuration_snapshot, created_by, approved_by,
  published_by, approved_at, published_at
)
VALUES (
  @timetable_id, 1, 'PUBLISHED', 'MANUAL', 0, 0,
  JSON_OBJECT('name', 'RIA Weekly Timetable', 'term', @term_name, 'academic_year', @active_year_name),
  COALESCE(@headteacher_id, @owner_id),
  COALESCE(@headteacher_id, @owner_id),
  COALESCE(@headteacher_id, @owner_id),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  configuration_snapshot = VALUES(configuration_snapshot),
  approved_by = VALUES(approved_by),
  published_by = VALUES(published_by),
  approved_at = COALESCE(approved_at, VALUES(approved_at)),
  published_at = COALESCE(published_at, VALUES(published_at));

SET @version_id := (
  SELECT id
  FROM timetable_versions
  WHERE timetable_id = @timetable_id AND version_number = 1
  LIMIT 1
);

INSERT INTO timetable_cycle_days (timetable_id, cycle_day_number, code, display_name, weekday, sort_order, active)
VALUES
  (@timetable_id, 1, 'MON', 'Monday', 1, 1, 1),
  (@timetable_id, 2, 'TUE', 'Tuesday', 2, 2, 1),
  (@timetable_id, 3, 'WED', 'Wednesday', 3, 3, 1),
  (@timetable_id, 4, 'THU', 'Thursday', 4, 4, 1),
  (@timetable_id, 5, 'FRI', 'Friday', 5, 5, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  weekday = VALUES(weekday),
  sort_order = VALUES(sort_order),
  active = VALUES(active);

SET @bell_template_id := (
  SELECT id
  FROM bell_schedule_templates
  WHERE school_id = @school_id AND name = 'RIA Standard School Day'
  ORDER BY id
  LIMIT 1
);

INSERT INTO bell_schedule_templates (school_id, timetable_id, name, description, is_default, active, created_by)
SELECT @school_id, @timetable_id, 'RIA Standard School Day', 'Primary school day schedule', 1, 1, COALESCE(@headteacher_id, @owner_id)
WHERE @bell_template_id IS NULL;

SET @bell_template_id := (
  SELECT id
  FROM bell_schedule_templates
  WHERE school_id = @school_id AND name = 'RIA Standard School Day'
  ORDER BY id
  LIMIT 1
);

UPDATE bell_schedule_templates
SET timetable_id = @timetable_id,
  is_default = 1,
  active = 1
WHERE id = @bell_template_id;

INSERT INTO bell_schedule_slots (
  template_id, slot_number, code, display_name, start_time, end_time,
  slot_type, teaching_allowed, can_span, sort_order
)
VALUES
  (@bell_template_id, 1, 'P1', 'Period 1', '07:45:00', '08:25:00', 'TEACHING_PERIOD', 1, 1, 1),
  (@bell_template_id, 2, 'P2', 'Period 2', '08:25:00', '09:05:00', 'TEACHING_PERIOD', 1, 1, 2),
  (@bell_template_id, 3, 'BRK', 'Morning Break', '09:05:00', '09:25:00', 'BREAK', 0, 0, 3),
  (@bell_template_id, 4, 'P3', 'Period 3', '09:25:00', '10:05:00', 'TEACHING_PERIOD', 1, 1, 4),
  (@bell_template_id, 5, 'P4', 'Period 4', '10:05:00', '10:45:00', 'TEACHING_PERIOD', 1, 1, 5),
  (@bell_template_id, 6, 'LUN', 'Lunch', '10:45:00', '11:25:00', 'LUNCH', 0, 0, 6),
  (@bell_template_id, 7, 'P5', 'Period 5', '11:25:00', '12:05:00', 'TEACHING_PERIOD', 1, 1, 7),
  (@bell_template_id, 8, 'P6', 'Period 6', '12:05:00', '12:45:00', 'TEACHING_PERIOD', 1, 1, 8)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  start_time = VALUES(start_time),
  end_time = VALUES(end_time),
  slot_type = VALUES(slot_type),
  teaching_allowed = VALUES(teaching_allowed),
  can_span = VALUES(can_span),
  sort_order = VALUES(sort_order);

INSERT INTO timetable_day_templates (timetable_id, cycle_day_id, bell_template_id, active)
SELECT @timetable_id, cd.id, @bell_template_id, 1
FROM timetable_cycle_days cd
WHERE cd.timetable_id = @timetable_id
ON DUPLICATE KEY UPDATE
  bell_template_id = VALUES(bell_template_id),
  active = VALUES(active);

CREATE TEMPORARY TABLE ria_lesson_slots (
  sequence_number INT UNSIGNED PRIMARY KEY,
  weekday TINYINT UNSIGNED NOT NULL,
  slot_code VARCHAR(40) NOT NULL
);

INSERT INTO ria_lesson_slots (sequence_number, weekday, slot_code)
VALUES
  (1, 1, 'P1'), (2, 1, 'P2'), (3, 1, 'P3'), (4, 1, 'P4'), (5, 1, 'P5'), (6, 1, 'P6'),
  (7, 2, 'P1'), (8, 2, 'P2'), (9, 2, 'P3'), (10, 2, 'P4'), (11, 2, 'P5'), (12, 2, 'P6'),
  (13, 3, 'P1'), (14, 3, 'P2'), (15, 3, 'P3'), (16, 3, 'P4'), (17, 3, 'P5'), (18, 3, 'P6'),
  (19, 4, 'P1'), (20, 4, 'P2'), (21, 4, 'P3'), (22, 4, 'P4'), (23, 4, 'P5'), (24, 4, 'P6'),
  (25, 5, 'P1'), (26, 5, 'P2'), (27, 5, 'P3'), (28, 5, 'P4'), (29, 5, 'P5'), (30, 5, 'P6');

CREATE TEMPORARY TABLE ria_subject_sequence (
  sequence_number INT UNSIGNED PRIMARY KEY,
  subject_code VARCHAR(40) NOT NULL
);

INSERT INTO ria_subject_sequence (sequence_number, subject_code)
VALUES
  (1, 'MATH'), (2, 'ENG'), (3, 'SCI'), (4, 'CW'), (5, 'MATH'), (6, 'ENG'),
  (7, 'SCI'), (8, 'CW'), (9, 'MATH'), (10, 'ENG'), (11, 'SCI'), (12, 'CW'),
  (13, 'MATH'), (14, 'ENG'), (15, 'SCI'), (16, 'CW'), (17, 'MATH'), (18, 'ENG'),
  (19, 'SCI'), (20, 'CW'), (21, 'MATH'), (22, 'ENG'), (23, 'SCI'), (24, 'CW'),
  (25, 'MATH'), (26, 'ENG'), (27, 'SCI'), (28, 'CW'), (29, 'MATH'), (30, 'ENG');

CREATE TEMPORARY TABLE ria_class_offsets (
  class_name VARCHAR(40) PRIMARY KEY,
  offset_steps INT UNSIGNED NOT NULL
);

INSERT INTO ria_class_offsets (class_name, offset_steps)
VALUES
  ('Year 1', 0),
  ('Year 2', 1),
  ('Year 3', 2),
  ('Year 4', 3),
  ('Year 5', 4),
  ('Year 6', 5);

DELETE FROM timetable_entries
WHERE timetable_version_id = @version_id
  AND lock_reason = 'Published weekly timetable';

INSERT INTO timetable_entries (
  timetable_version_id, cycle_day_id, slot_start_id, slot_end_id, entry_type,
  subject_id, class_id, teacher_id, title, locked, lock_reason, created_by
)
SELECT @version_id, cd.id, slot.id, slot.id, 'LESSON',
  subj.id, c.id, c.teacher_user_id,
  CONCAT(subj.name, ' - ', c.name),
  1, 'Published weekly timetable', COALESCE(@headteacher_id, @owner_id)
FROM classes c
JOIN ria_class_offsets class_offset ON class_offset.class_name = c.name
JOIN ria_lesson_slots pattern
JOIN ria_subject_sequence subject_sequence
  ON subject_sequence.sequence_number = (((pattern.sequence_number + class_offset.offset_steps - 1) MOD 30) + 1)
JOIN timetable_cycle_days cd ON cd.timetable_id = @timetable_id AND cd.weekday = pattern.weekday
JOIN bell_schedule_slots slot ON slot.template_id = @bell_template_id AND slot.code = pattern.slot_code
JOIN subjects subj ON subj.school_id = @school_id AND subj.code = subject_sequence.subject_code
WHERE c.school_id = @school_id AND c.name IN ('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')
  AND c.teacher_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM timetable_entries existing
    WHERE existing.timetable_version_id = @version_id
      AND existing.cycle_day_id = cd.id
      AND existing.slot_start_id = slot.id
      AND existing.slot_end_id = slot.id
      AND existing.class_id = c.id
      AND existing.subject_id = subj.id
  );

INSERT INTO curriculum_period_requirements (
  school_id, academic_year_id, term_id, timetable_id, class_id, subject_id,
  teacher_id, entry_type, periods_per_cycle, block_length, priority,
  active, metadata, created_by, updated_by
)
SELECT @school_id, @active_year_id, @term_id, @timetable_id, c.id, subj.id,
  c.teacher_user_id, 'SUBJECT_LESSON',
  CASE subj.code
    WHEN 'MATH' THEN 8
    WHEN 'ENG' THEN 8
    WHEN 'SCI' THEN 7
    ELSE 7
  END,
  1,
  CASE subj.code
    WHEN 'MATH' THEN 90
    WHEN 'ENG' THEN 85
    ELSE 70
  END,
  1,
  JSON_OBJECT('programme', 'Primary', 'subject', subj.name),
  COALESCE(@headteacher_id, @owner_id),
  COALESCE(@headteacher_id, @owner_id)
FROM classes c
JOIN subjects subj ON subj.school_id = @school_id AND subj.code IN ('ENG', 'CW', 'MATH', 'SCI')
WHERE c.school_id = @school_id AND c.name IN ('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')
  AND NOT EXISTS (
    SELECT 1
    FROM curriculum_period_requirements existing
    WHERE existing.school_id = @school_id
      AND existing.academic_year_id = @active_year_id
      AND (existing.term_id <=> @term_id)
      AND (existing.timetable_id <=> @timetable_id)
      AND existing.class_id = c.id
      AND existing.subject_id = subj.id
      AND existing.active = 1
  );

UPDATE curriculum_period_requirements requirement
JOIN classes c ON c.id = requirement.class_id AND c.school_id = @school_id
JOIN subjects subj ON subj.id = requirement.subject_id AND subj.school_id = @school_id
SET requirement.periods_per_cycle = CASE subj.code
    WHEN 'MATH' THEN 8
    WHEN 'ENG' THEN 8
    WHEN 'SCI' THEN 7
    ELSE 7
  END,
  requirement.updated_by = COALESCE(@headteacher_id, @owner_id)
WHERE requirement.school_id = @school_id
  AND requirement.academic_year_id = @active_year_id
  AND (requirement.term_id <=> @term_id)
  AND (requirement.timetable_id <=> @timetable_id)
  AND c.name IN ('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')
  AND subj.code IN ('ENG', 'CW', 'MATH', 'SCI')
  AND requirement.active = 1;

UPDATE timetable_publications
SET publication_status = 'SUPERSEDED',
  superseded_at = CURRENT_TIMESTAMP
WHERE school_id = @school_id
  AND timetable_id = @timetable_id
  AND publication_status = 'ACTIVE'
  AND timetable_version_id <> @version_id;

INSERT INTO timetable_publications (
  school_id, timetable_id, timetable_version_id, publication_status,
  audience_scope, snapshot, published_by
)
VALUES (
  @school_id, @timetable_id, @version_id, 'ACTIVE',
  JSON_OBJECT('type', 'school'),
  JSON_OBJECT(
    'name', 'RIA Weekly Timetable',
    'academic_year', @active_year_name,
    'term', @term_name,
    'classes', 6,
    'subjects', JSON_ARRAY('English', 'Creative Writing', 'Mathematics', 'Science')
  ),
  COALESCE(@headteacher_id, @owner_id)
)
ON DUPLICATE KEY UPDATE
  publication_status = VALUES(publication_status),
  audience_scope = VALUES(audience_scope),
  snapshot = VALUES(snapshot),
  published_by = VALUES(published_by),
  superseded_at = NULL;

UPDATE timetables
SET current_published_version_id = @version_id,
  status = 'PUBLISHED'
WHERE id = @timetable_id;

INSERT INTO class_progression_rules (
  school_id, from_class_id, to_class_id, is_terminal_class, default_decision, is_active
)
SELECT @school_id, c.id, next_c.id,
  IF(c.name = 'Year 6', 1, 0),
  IF(c.name = 'Year 6', 'graduate', 'promote'),
  1
FROM classes c
LEFT JOIN classes next_c ON next_c.school_id = @school_id
  AND (
    (c.name = 'Year 1' AND next_c.name = 'Year 2')
    OR (c.name = 'Year 2' AND next_c.name = 'Year 3')
    OR (c.name = 'Year 3' AND next_c.name = 'Year 4')
    OR (c.name = 'Year 4' AND next_c.name = 'Year 5')
    OR (c.name = 'Year 5' AND next_c.name = 'Year 6')
  )
WHERE c.school_id = @school_id AND c.name IN ('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')
ON DUPLICATE KEY UPDATE
  to_class_id = VALUES(to_class_id),
  is_terminal_class = VALUES(is_terminal_class),
  default_decision = VALUES(default_decision),
  is_active = VALUES(is_active);

SELECT
  @school_id AS school_id,
  'Reign Internation Academy ready' AS result,
  (SELECT COUNT(*) FROM classes WHERE school_id = @school_id) AS classes,
  (SELECT COUNT(*) FROM subjects WHERE school_id = @school_id) AS subjects,
  (SELECT COUNT(*) FROM students WHERE school_id = @school_id AND status = 'active') AS students,
  (SELECT COUNT(*) FROM users WHERE school_id = @school_id AND role IN ('headteacher', 'teacher')) AS teaching_staff,
  (SELECT COUNT(*) FROM timetable_entries WHERE timetable_version_id = @version_id) AS timetable_lessons;
