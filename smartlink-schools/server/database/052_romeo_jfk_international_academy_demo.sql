USE smartlink_schools;

/*
 * Romeo JFK International Academy - deterministic demonstration data.
 *
 * The seed is intentionally additive and idempotent. It creates a separate
 * school so it cannot alter an existing school's test data. Re-running it
 * updates the named records and only inserts missing students, assessments,
 * results, syllabus topics and timetable rows.
 */
SET @demo_password_hash := '$2a$10$4b0XNWkHCDfId0N5wUs2juZmnAqvsyCO9ffji5HoOzm3Pw/vo7BC6';

INSERT INTO schools (code, school_prefix, name, city, country, status)
VALUES ('RJK', 'RJK', 'Romeo JFK International Academy', 'Blantyre', 'Malawi', 'active')
ON DUPLICATE KEY UPDATE
  school_prefix = VALUES(school_prefix), name = VALUES(name), city = VALUES(city),
  country = VALUES(country), status = VALUES(status);

SET @school_id := (SELECT id FROM schools WHERE code = 'RJK' LIMIT 1);

INSERT INTO academic_years (school_id, name, start_date, end_date, status, is_active)
VALUES (@school_id, '2026 Academic Year', '2026-01-05', '2026-12-04', 'active', 1)
ON DUPLICATE KEY UPDATE start_date=VALUES(start_date), end_date=VALUES(end_date), status='active', is_active=1;
SET @year_id := (SELECT id FROM academic_years WHERE school_id=@school_id AND name='2026 Academic Year' LIMIT 1);
UPDATE academic_years SET is_active=IF(id=@year_id,1,0), status=IF(id=@year_id,'active',IF(status='archived',status,'closed')) WHERE school_id=@school_id;

INSERT INTO terms (school_id, academic_year_id, name, term_number, start_date, end_date,
  revision_start_date, revision_end_date, exam_start_date, exam_end_date,
  marking_start_date, marking_end_date, closing_date, status)
VALUES (@school_id,@year_id,'Term 2',2,'2026-05-04','2026-08-07','2026-07-13','2026-07-17',
  '2026-07-20','2026-07-31','2026-08-03','2026-08-06','2026-08-07','open')
ON DUPLICATE KEY UPDATE start_date=VALUES(start_date),end_date=VALUES(end_date),
  revision_start_date=VALUES(revision_start_date),revision_end_date=VALUES(revision_end_date),
  exam_start_date=VALUES(exam_start_date),exam_end_date=VALUES(exam_end_date),
  marking_start_date=VALUES(marking_start_date),marking_end_date=VALUES(marking_end_date),
  closing_date=VALUES(closing_date),status='open';
SET @term_id := (SELECT id FROM terms WHERE school_id=@school_id AND academic_year_id=@year_id AND term_number=2 LIMIT 1);
UPDATE terms SET status=IF(id=@term_id,'open','closed') WHERE school_id=@school_id AND academic_year_id=@year_id;

INSERT INTO curricula (school_id,name,country,is_active)
VALUES (@school_id,'Romeo JFK Primary Curriculum','Malawi',1)
ON DUPLICATE KEY UPDATE country='Malawi',is_active=1;
SET @curriculum_id := (SELECT id FROM curricula WHERE school_id=@school_id AND name='Romeo JFK Primary Curriculum' LIMIT 1);

INSERT INTO grade_levels (school_id,curriculum_id,name,stage,order_number,is_candidate)
VALUES
  (@school_id,@curriculum_id,'Year 1','Primary',1,0),(@school_id,@curriculum_id,'Year 2','Primary',2,0),
  (@school_id,@curriculum_id,'Year 3','Primary',3,0),(@school_id,@curriculum_id,'Year 4','Primary',4,0),
  (@school_id,@curriculum_id,'Year 5','Primary',5,0),(@school_id,@curriculum_id,'Year 6','Primary',6,1)
ON DUPLICATE KEY UPDATE curriculum_id=VALUES(curriculum_id),stage=VALUES(stage),order_number=VALUES(order_number),is_candidate=VALUES(is_candidate);

INSERT INTO users (public_ref,school_id,role,full_name,first_name,last_name,email,password_hash,must_change_password,
  phone,employee_id,qualification,specialization,employment_status,role_type,is_active)
VALUES
  (UUID(),@school_id,'school_owner','Romeo JFK Owner','Romeo','JFK','owner@romeojfk.academy',@demo_password_hash,1,'+265 888 700 001','RJK-ADM-001','B.Ed Educational Leadership','School Operations','active','admin_teacher',1),
  (UUID(),@school_id,'headteacher','Evelyn Mbewe','Evelyn','Mbewe','headteacher@romeojfk.academy',@demo_password_hash,1,'+265 888 700 002','RJK-HT-001','M.Ed Educational Leadership','Academic Leadership','active','headteacher',1),
  (UUID(),@school_id,'bursar','Tiwonge Phiri','Tiwonge','Phiri','bursar@romeojfk.academy',@demo_password_hash,1,'+265 888 700 003','RJK-BUR-001','Diploma in Accounting','Finance','active','admin_teacher',1),
  (UUID(),@school_id,'teacher','Ruth Mwale','Ruth','Mwale','ruth.mwale@romeojfk.academy',@demo_password_hash,1,'+265 888 701 001','RJK-T-001','B.Ed Primary Education','Year 1 and Mathematics','active','teacher',1),
  (UUID(),@school_id,'teacher','Daniel Phiri','Daniel','Phiri','daniel.phiri@romeojfk.academy',@demo_password_hash,1,'+265 888 701 002','RJK-T-002','B.Ed Primary Education','Year 2 and English','active','teacher',1),
  (UUID(),@school_id,'teacher','Grace Tembo','Grace','Tembo','grace.tembo@romeojfk.academy',@demo_password_hash,1,'+265 888 701 003','RJK-T-003','B.Ed Primary Education','Year 3 and Science','active','teacher',1),
  (UUID(),@school_id,'teacher','Kelvin Chirwa','Kelvin','Chirwa','kelvin.chirwa@romeojfk.academy',@demo_password_hash,1,'+265 888 701 004','RJK-T-004','B.Ed Primary Education','Year 4 and Agriculture','active','teacher',1),
  (UUID(),@school_id,'teacher','Martha Gondwe','Martha','Gondwe','martha.gondwe@romeojfk.academy',@demo_password_hash,1,'+265 888 701 005','RJK-T-005','B.Ed Primary Education','Year 5 and Social Studies','active','teacher',1),
  (UUID(),@school_id,'teacher','Peter Nkhoma','Peter','Nkhoma','peter.nkhoma@romeojfk.academy',@demo_password_hash,1,'+265 888 701 006','RJK-T-006','B.Ed Primary Education','Year 6 and ICT','active','teacher',1)
ON DUPLICATE KEY UPDATE role=VALUES(role),full_name=VALUES(full_name),first_name=VALUES(first_name),last_name=VALUES(last_name),
  phone=VALUES(phone),employee_id=VALUES(employee_id),qualification=VALUES(qualification),
  specialization=VALUES(specialization),employment_status='active',role_type=VALUES(role_type),is_active=1;

SET @owner_id := (SELECT id FROM users WHERE school_id=@school_id AND email='owner@romeojfk.academy' LIMIT 1);
SET @headteacher_id := (SELECT id FROM users WHERE school_id=@school_id AND email='headteacher@romeojfk.academy' LIMIT 1);
SET @t1 := (SELECT id FROM users WHERE school_id=@school_id AND email='ruth.mwale@romeojfk.academy' LIMIT 1);
SET @t2 := (SELECT id FROM users WHERE school_id=@school_id AND email='daniel.phiri@romeojfk.academy' LIMIT 1);
SET @t3 := (SELECT id FROM users WHERE school_id=@school_id AND email='grace.tembo@romeojfk.academy' LIMIT 1);
SET @t4 := (SELECT id FROM users WHERE school_id=@school_id AND email='kelvin.chirwa@romeojfk.academy' LIMIT 1);
SET @t5 := (SELECT id FROM users WHERE school_id=@school_id AND email='martha.gondwe@romeojfk.academy' LIMIT 1);
SET @t6 := (SELECT id FROM users WHERE school_id=@school_id AND email='peter.nkhoma@romeojfk.academy' LIMIT 1);

INSERT INTO classes (public_ref,school_id,name,grade_level,teacher_user_id)
VALUES
  (UUID(),@school_id,'Year 1','Year 1',@t1),(UUID(),@school_id,'Year 2','Year 2',@t2),
  (UUID(),@school_id,'Year 3','Year 3',@t3),(UUID(),@school_id,'Year 4','Year 4',@t4),
  (UUID(),@school_id,'Year 5','Year 5',@t5),(UUID(),@school_id,'Year 6','Year 6',@t6)
ON DUPLICATE KEY UPDATE grade_level=VALUES(grade_level),teacher_user_id=VALUES(teacher_user_id);

INSERT INTO subjects (public_ref,school_id,name,code)
VALUES
  (UUID(),@school_id,'Mathematics','MATH'),(UUID(),@school_id,'English','ENG'),
  (UUID(),@school_id,'Science','SCI'),(UUID(),@school_id,'Agriculture','AGR'),
  (UUID(),@school_id,'Social Studies','SOC'),(UUID(),@school_id,'Computer Studies','ICT')
ON DUPLICATE KEY UPDATE code=VALUES(code);

SET @math_id := (SELECT id FROM subjects WHERE school_id=@school_id AND code='MATH' LIMIT 1);
SET @eng_id := (SELECT id FROM subjects WHERE school_id=@school_id AND code='ENG' LIMIT 1);
SET @sci_id := (SELECT id FROM subjects WHERE school_id=@school_id AND code='SCI' LIMIT 1);
SET @agr_id := (SELECT id FROM subjects WHERE school_id=@school_id AND code='AGR' LIMIT 1);
SET @soc_id := (SELECT id FROM subjects WHERE school_id=@school_id AND code='SOC' LIMIT 1);
SET @ict_id := (SELECT id FROM subjects WHERE school_id=@school_id AND code='ICT' LIMIT 1);

/* Every class has a class teacher and every subject has an assigned teacher. */
DELETE a1 FROM teacher_class_subject_assignments a1
JOIN teacher_class_subject_assignments a2
  ON a2.school_id=a1.school_id AND a2.class_id=a1.class_id AND a2.role='class_teacher'
  AND a2.academic_year_id=@year_id AND a2.term_id=@term_id AND a2.id<a1.id
WHERE a1.school_id=@school_id AND a1.role='class_teacher' AND a1.academic_year_id=@year_id AND a1.term_id=@term_id;
INSERT INTO teacher_class_subject_assignments (school_id,teacher_id,class_id,subject_id,academic_year_id,term_id,academic_year,term,role,is_active,notes)
SELECT @school_id,c.teacher_user_id,c.id,NULL,@year_id,@term_id,'2026 Academic Year','Term 2','class_teacher',1,CONCAT(c.name,' class teacher')
FROM classes c WHERE c.school_id=@school_id
  AND NOT EXISTS (SELECT 1 FROM teacher_class_subject_assignments a WHERE a.school_id=@school_id AND a.class_id=c.id AND a.subject_id IS NULL AND a.role='class_teacher' AND a.academic_year_id=@year_id AND a.term_id=@term_id AND a.is_active=1);

INSERT INTO teacher_class_subject_assignments (school_id,teacher_id,class_id,subject_id,academic_year_id,term_id,academic_year,term,role,is_active,notes)
SELECT @school_id,
  CASE s.code WHEN 'MATH' THEN @t1 WHEN 'ENG' THEN @t2 WHEN 'SCI' THEN @t3 WHEN 'AGR' THEN @t4 WHEN 'SOC' THEN @t5 ELSE @t6 END,
  c.id,s.id,@year_id,@term_id,'2026 Academic Year','Term 2','subject_teacher',1,CONCAT(s.name,' for ',c.name)
FROM classes c JOIN subjects s ON s.school_id=@school_id
WHERE c.school_id=@school_id AND s.code IN ('MATH','ENG','SCI','AGR','SOC','ICT')
  AND NOT EXISTS (SELECT 1 FROM teacher_class_subject_assignments a WHERE a.school_id=@school_id AND a.class_id=c.id AND a.subject_id=s.id AND a.academic_year_id=@year_id AND a.term_id=@term_id AND a.is_active=1);

/* Four learners per class (24 total), with stable admission numbers. */
INSERT INTO students (public_ref,school_id,class_id,student_id,admission_no,first_name,last_name,date_of_birth,gender,stream_section,enrollment_date,student_type,status)
SELECT UUID(),@school_id,c.id,CONCAT('RJK-2026-',LPAD((c.id-(SELECT MIN(id) FROM classes WHERE school_id=@school_id))*4+n.n,4,'0')),
  CONCAT('RJK-2026-',LPAD((c.id-(SELECT MIN(id) FROM classes WHERE school_id=@school_id))*4+n.n,4,'0')),
  ELT(n.n,'Amina','Banda','Chisomo','Dalitso'),
  ELT(n.n,'Kachale','Mbewe','Phiri','Tembo'),
  DATE_ADD('2014-01-10',INTERVAL ((c.id-(SELECT MIN(id) FROM classes WHERE school_id=@school_id))*4+n.n) MONTH),
  IF(MOD(n.n,2)=0,'Male','Female'),'A','2026-05-04',IF(n.n=4,'new','returning'),'active'
FROM classes c
JOIN (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) n
WHERE c.school_id=@school_id
  AND NOT EXISTS (SELECT 1 FROM students st WHERE st.school_id=@school_id AND st.admission_no=CONCAT('RJK-2026-',LPAD((c.id-(SELECT MIN(id) FROM classes WHERE school_id=@school_id))*4+n.n,4,'0')));

INSERT INTO student_enrollments (school_id,student_id,academic_year_id,term_id,class_id,stream_section,enrollment_type,enrollment_status,start_date)
SELECT @school_id,s.id,@year_id,@term_id,s.class_id,s.stream_section,s.student_type,'active',s.enrollment_date
FROM students s
WHERE s.school_id=@school_id
  AND NOT EXISTS (SELECT 1 FROM student_enrollments se WHERE se.school_id=@school_id AND se.student_id=s.id AND se.academic_year_id=@year_id AND se.term_id=@term_id);

/* Syllabus: five sequenced topics for every subject. Topics 1-2 are taught,
   topic 3 is in progress and 4-5 are intentionally not started (mid-term). */
INSERT INTO syllabus_topics (public_ref,school_id,curriculum_id,subject_id,topic_name,description,term,order_number,source_type,is_active)
SELECT UUID(),@school_id,@curriculum_id,s.id,
  CASE t.n WHEN 1 THEN CONCAT(s.name,' foundations') WHEN 2 THEN CONCAT(s.name,' skills and practice') WHEN 3 THEN CONCAT(s.name,' applied problem solving') WHEN 4 THEN CONCAT(s.name,' projects and investigations') ELSE CONCAT(s.name,' revision and extension') END,
  CASE t.n WHEN 1 THEN 'Core concepts and vocabulary.' WHEN 2 THEN 'Guided practice and worked examples.' WHEN 3 THEN 'Application, reasoning and transfer.' WHEN 4 THEN 'Practical project planned for later in the term.' ELSE 'End-of-term consolidation and extension.' END,
  'Term 2',t.n,'teacher_created',1
FROM subjects s JOIN (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) t
WHERE s.school_id=@school_id
  AND NOT EXISTS (SELECT 1 FROM syllabus_topics st WHERE st.school_id=@school_id AND st.subject_id=s.id AND st.order_number=t.n AND st.term='Term 2');

INSERT INTO syllabus_topic_prerequisites (school_id,topic_id,prerequisite_topic_id,strength)
SELECT @school_id,t2.id,t1.id,'required'
FROM syllabus_topics t1 JOIN syllabus_topics t2 ON t2.school_id=t1.school_id AND t2.subject_id=t1.subject_id AND t2.order_number=t1.order_number+1
WHERE t1.school_id=@school_id AND t1.term='Term 2' AND t1.order_number IN (1,2)
  AND NOT EXISTS (SELECT 1 FROM syllabus_topic_prerequisites p WHERE p.school_id=@school_id AND p.topic_id=t2.id AND p.prerequisite_topic_id=t1.id);

INSERT INTO curriculum_delivery_records (public_ref,school_id,academic_year_id,term_id,class_id,subject_id,teacher_id,topic_id,
  planned_start_date,planned_completion_date,actual_start_date,actual_completion_date,planned_lesson_count,completed_lesson_count,
  periods_spent,lifecycle_status,teacher_confidence,teacher_notes,assessed_status,class_mastery_score,mastery_confidence_score,
  students_assessed,students_below_threshold,revision_required,evidence_source,last_recalculated_at)
SELECT UUID(),@school_id,@year_id,@term_id,c.id,s.id,a.teacher_id,t.id,
  DATE_ADD('2026-05-04',INTERVAL (t.order_number-1)*14 DAY),DATE_ADD('2026-05-04',INTERVAL t.order_number*14 DAY),
  IF(t.order_number<=2,DATE_ADD('2026-05-04',INTERVAL (t.order_number-1)*14 DAY),NULL),
  IF(t.order_number<=2,DATE_ADD('2026-05-04',INTERVAL t.order_number*14-2 DAY),NULL),
  4,IF(t.order_number<=2,4,0),IF(t.order_number<=2,4,0),
  CASE WHEN t.order_number<=2 THEN 'TAUGHT' WHEN t.order_number=3 THEN 'IN_PROGRESS' ELSE 'PLANNED' END,
  CASE WHEN t.order_number<=2 THEN 'high' ELSE 'medium' END,
  CASE WHEN t.order_number=2 THEN 'Taught and assessed; use the result evidence to target revision.' ELSE NULL END,
  IF(t.order_number=2,1,0),IF(t.order_number=2,CASE WHEN s.code='MATH' THEN 51 ELSE 68 END,NULL),IF(t.order_number=2,68,NULL),
  IF(t.order_number=2,4,0),IF(t.order_number=2,2,0),IF(t.order_number=2,1,0),'romeo_jfk_mid_term_demo',CURRENT_TIMESTAMP
FROM classes c JOIN subjects s ON s.school_id=@school_id
JOIN syllabus_topics t ON t.school_id=@school_id AND t.subject_id=s.id AND t.term='Term 2'
JOIN teacher_class_subject_assignments a ON a.school_id=@school_id AND a.class_id=c.id AND a.subject_id=s.id AND a.academic_year_id=@year_id AND a.term_id=@term_id AND a.is_active=1
WHERE c.school_id=@school_id
  AND NOT EXISTS (SELECT 1 FROM curriculum_delivery_records d WHERE d.school_id=@school_id AND d.academic_year_id=@year_id AND d.term_id=@term_id AND d.class_id=c.id AND d.subject_id=s.id AND d.topic_id=t.id AND d.subtopic_id IS NULL AND d.learning_objective_id IS NULL);

/* Four exam sessions and 144 class/subject assessments (well above the
   requested 20), with three approved evidence sessions for Academic Intelligence. */
INSERT INTO exam_sessions (school_id,academic_year_id,term_id,name,exam_type,status,operating_mode,start_date,end_date,notes,created_by)
VALUES
  (@school_id,@year_id,@term_id,'Term 2 Baseline Assessment','custom','results_approved','NORMAL_LESSONS_CONTINUE','2026-05-18','2026-05-22','Baseline evidence for the current term.',@owner_id),
  (@school_id,@year_id,@term_id,'Term 2 Progress Check','custom','results_approved','NORMAL_LESSONS_CONTINUE','2026-06-22','2026-06-26','A second formative evidence point before the mid-term checkpoint.',@owner_id),
  (@school_id,@year_id,@term_id,'Term 2 Mid-Term Assessment','mid_term','results_approved','PARTIAL_SUSPENSION','2026-07-20','2026-07-24','Mid-term checkpoint; some syllabus topics remain planned.',@owner_id),
  (@school_id,@year_id,@term_id,'Term 2 End-of-Term Examination','end_of_term','scheduled','FULL_SCHOOL_SUSPENSION','2026-07-27','2026-07-31','Upcoming end-of-term session.',@owner_id)
ON DUPLICATE KEY UPDATE status=VALUES(status),notes=VALUES(notes),start_date=VALUES(start_date),end_date=VALUES(end_date);

INSERT INTO assessments (school_id,exam_session_id,class_id,subject_id,academic_year_id,term_id,teacher_id,name,assessment_type,term_name,total_marks,duration_minutes,instructions,expected_difficulty,status,approved_by,approved_at,created_by)
SELECT @school_id,es.id,c.id,s.id,@year_id,@term_id,a.teacher_id,
  CONCAT(es.name,' - ',c.name,' - ',s.name),
  CASE es.exam_type WHEN 'mid_term' THEN 'mid_term' WHEN 'end_of_term' THEN 'end_of_term_exam' ELSE 'class_test' END,
  'Term 2',100,90,'Answer all questions. Show working where applicable.','Medium',
  CASE WHEN es.exam_type='end_of_term' THEN 'scheduled' ELSE 'results_approved' END,
  IF(es.exam_type='end_of_term',NULL,@owner_id),IF(es.exam_type='end_of_term',NULL,CURRENT_TIMESTAMP),@owner_id
FROM exam_sessions es JOIN classes c ON c.school_id=@school_id JOIN subjects s ON s.school_id=@school_id
JOIN teacher_class_subject_assignments a ON a.school_id=@school_id AND a.class_id=c.id AND a.subject_id=s.id AND a.academic_year_id=@year_id AND a.term_id=@term_id AND a.is_active=1
WHERE es.school_id=@school_id AND es.academic_year_id=@year_id AND es.term_id=@term_id
  AND NOT EXISTS (SELECT 1 FROM assessments x WHERE x.school_id=@school_id AND x.exam_session_id=es.id AND x.class_id=c.id AND x.subject_id=s.id);

INSERT INTO result_batches (public_ref,school_id,exam_session_id,assessment_id,academic_year_id,term_id,class_id,subject_id,teacher_id,status,submitted_at,submitted_by,approved_at,approved_by)
SELECT UUID(),a.school_id,a.exam_session_id,a.id,a.academic_year_id,a.term_id,a.class_id,a.subject_id,a.teacher_id,
  'approved',CURRENT_TIMESTAMP,a.teacher_id,CURRENT_TIMESTAMP,@owner_id
FROM assessments a
WHERE a.school_id=@school_id AND a.status='results_approved'
  AND NOT EXISTS (SELECT 1 FROM result_batches rb WHERE rb.school_id=@school_id AND rb.assessment_id=a.id);

INSERT INTO result_entries (school_id,result_batch_id,student_id,enrollment_id,score,grade,comment,status,last_saved_at)
SELECT @school_id,rb.id,st.id,se.id,
  CASE WHEN MOD(st.id,7)=0 THEN 38+MOD(st.id,8) ELSE 58+MOD(st.id*3,38) END,
  CASE WHEN (CASE WHEN MOD(st.id,7)=0 THEN 38+MOD(st.id,8) ELSE 58+MOD(st.id*3,38) END) >= 75 THEN 'A' WHEN (CASE WHEN MOD(st.id,7)=0 THEN 38+MOD(st.id,8) ELSE 58+MOD(st.id*3,38) END) >= 60 THEN 'B' ELSE 'C' END,
  CASE WHEN MOD(st.id,7)=0 THEN 'Needs targeted support and a follow-up check.' ELSE 'Steady evidence from the demonstration paper.' END,
  'approved',CURRENT_TIMESTAMP
FROM result_batches rb
JOIN students st ON st.school_id=@school_id AND st.class_id=rb.class_id AND st.status='active'
JOIN student_enrollments se ON se.school_id=@school_id AND se.student_id=st.id AND se.class_id=rb.class_id AND se.academic_year_id=@year_id AND se.term_id=@term_id AND se.enrollment_status='active'
WHERE rb.school_id=@school_id
  AND NOT EXISTS (SELECT 1 FROM result_entries re WHERE re.school_id=@school_id AND re.result_batch_id=rb.id AND re.student_id=st.id);

/* A small attendance history makes readiness confidence meaningful. */
INSERT INTO attendance_records (school_id,class_id,student_id,attendance_date,status,note,marked_by)
SELECT @school_id,st.class_id,st.id,DATE_ADD('2026-06-01',INTERVAL d.n DAY),IF(MOD(st.id+d.n,11)=0,'late','present'),'Romeo JFK demonstration attendance',@t1
FROM students st JOIN (SELECT 0 n UNION ALL SELECT 3 UNION ALL SELECT 6 UNION ALL SELECT 9 UNION ALL SELECT 12 UNION ALL SELECT 15 UNION ALL SELECT 18 UNION ALL SELECT 21 UNION ALL SELECT 24 UNION ALL SELECT 27) d
WHERE st.school_id=@school_id AND NOT EXISTS (SELECT 1 FROM attendance_records ar WHERE ar.school_id=@school_id AND ar.student_id=st.id AND ar.attendance_date=DATE_ADD('2026-06-01',INTERVAL d.n DAY));

/* Timetable: active, approved and published, with five days × three periods
   for all six classes. */
INSERT INTO timetable_rooms (school_id,code,name,room_type,capacity,exam_capacity,home_class_id,active,created_by)
SELECT @school_id,CONCAT('RJK-',REPLACE(c.name,' ','')),CONCAT(c.name,' Classroom'),'ordinary_classroom',40,40,c.id,1,@owner_id
FROM classes c WHERE c.school_id=@school_id
  AND NOT EXISTS (SELECT 1 FROM timetable_rooms r WHERE r.school_id=@school_id AND r.code=CONCAT('RJK-',REPLACE(c.name,' ','')));
INSERT INTO timetables (public_ref,school_id,timetable_type,name,academic_year_id,term_id,cycle_type,timetable_cycle_weeks,effective_from,effective_to,status,setup_progress,created_by)
VALUES (UUID(),@school_id,'SCHOOL_TIMETABLE','Romeo JFK Term 2 Published Timetable',@year_id,@term_id,'NORMAL_WEEK',1,'2026-05-04','2026-08-07','PUBLISHED',JSON_OBJECT('classes',6,'published',true),@owner_id)
ON DUPLICATE KEY UPDATE status='PUBLISHED',effective_from=VALUES(effective_from),effective_to=VALUES(effective_to),setup_progress=VALUES(setup_progress);
SET @timetable_id := (SELECT id FROM timetables WHERE school_id=@school_id AND name='Romeo JFK Term 2 Published Timetable' LIMIT 1);
INSERT INTO timetable_versions (public_ref,timetable_id,version_number,status,creation_method,generation_strategy,solver_status,hard_conflict_count,soft_penalty_score,change_summary,publication_notes,approved_by,approved_at,published_by,published_at,created_by)
VALUES (UUID(),@timetable_id,1,'PUBLISHED','MANUAL','TEACHER_FRIENDLY','FEASIBLE',0,0,'Initial Romeo JFK demonstration timetable','Published for all teachers and classes.',@owner_id,CURRENT_TIMESTAMP,@owner_id,CURRENT_TIMESTAMP,@owner_id)
ON DUPLICATE KEY UPDATE status='PUBLISHED',approved_by=@owner_id,approved_at=CURRENT_TIMESTAMP,published_by=@owner_id,published_at=CURRENT_TIMESTAMP;
SET @version_id := (SELECT id FROM timetable_versions WHERE timetable_id=@timetable_id AND version_number=1 LIMIT 1);
UPDATE timetables SET status='PUBLISHED',current_published_version_id=@version_id WHERE id=@timetable_id;

INSERT INTO timetable_cycle_days (timetable_id,cycle_day_number,code,display_name,weekday,sort_order,active)
VALUES (@timetable_id,1,'MON','Monday',1,1,1),(@timetable_id,2,'TUE','Tuesday',2,2,1),(@timetable_id,3,'WED','Wednesday',3,3,1),(@timetable_id,4,'THU','Thursday',4,4,1),(@timetable_id,5,'FRI','Friday',5,5,1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),weekday=VALUES(weekday),active=1;
INSERT INTO bell_schedule_templates (school_id,timetable_id,name,description,is_default,active,created_by)
SELECT @school_id,@timetable_id,'Romeo JFK Standard Day','Three teaching periods for the demonstration timetable.',1,1,@owner_id
WHERE NOT EXISTS (SELECT 1 FROM bell_schedule_templates WHERE school_id=@school_id AND timetable_id=@timetable_id AND name='Romeo JFK Standard Day');
SET @bell_id := (SELECT id FROM bell_schedule_templates WHERE school_id=@school_id AND timetable_id=@timetable_id AND name='Romeo JFK Standard Day' ORDER BY id LIMIT 1);
UPDATE bell_schedule_templates SET active=IF(id=@bell_id,1,0),is_default=IF(id=@bell_id,1,0) WHERE school_id=@school_id AND timetable_id=@timetable_id;
INSERT INTO bell_schedule_slots (template_id,slot_number,code,display_name,start_time,end_time,slot_type,teaching_allowed,can_span,sort_order)
VALUES (@bell_id,1,'P1','Period 1','07:30:00','08:30:00','TEACHING_PERIOD',1,1,1),(@bell_id,2,'P2','Period 2','08:45:00','09:45:00','TEACHING_PERIOD',1,1,2),(@bell_id,3,'P3','Period 3','10:15:00','11:15:00','TEACHING_PERIOD',1,1,3)
ON DUPLICATE KEY UPDATE start_time=VALUES(start_time),end_time=VALUES(end_time),teaching_allowed=1;
DELETE FROM timetable_entries
WHERE timetable_version_id=@version_id
  AND (slot_start_id NOT IN (SELECT id FROM bell_schedule_slots WHERE template_id=@bell_id)
    OR cycle_day_id NOT IN (SELECT id FROM timetable_cycle_days WHERE timetable_id=@timetable_id));
DELETE FROM timetable_day_templates WHERE timetable_id=@timetable_id AND bell_template_id<>@bell_id;
DELETE FROM bell_schedule_slots WHERE template_id IN (SELECT id FROM bell_schedule_templates WHERE timetable_id=@timetable_id AND id<>@bell_id)
  AND id NOT IN (SELECT slot_start_id FROM timetable_entries WHERE timetable_version_id=@version_id)
  AND id NOT IN (SELECT slot_end_id FROM timetable_entries WHERE timetable_version_id=@version_id);
DELETE FROM bell_schedule_templates WHERE timetable_id=@timetable_id AND id<>@bell_id
  AND id NOT IN (SELECT bell_template_id FROM timetable_day_templates WHERE timetable_id=@timetable_id);
INSERT INTO timetable_day_templates (timetable_id,cycle_day_id,bell_template_id)
SELECT @timetable_id,id,@bell_id FROM timetable_cycle_days WHERE timetable_id=@timetable_id AND active=1
ON DUPLICATE KEY UPDATE bell_template_id=VALUES(bell_template_id);

INSERT INTO timetable_entries (timetable_version_id,cycle_day_id,slot_start_id,slot_end_id,entry_type,subject_id,class_id,teacher_id,room_id,title,locked,manually_modified,created_by,updated_by)
SELECT @version_id,cd.id,bs.id,bs.id,'LESSON',s.id,c.id,
  CASE s.code WHEN 'MATH' THEN @t1 WHEN 'ENG' THEN @t2 WHEN 'SCI' THEN @t3 WHEN 'AGR' THEN @t4 WHEN 'SOC' THEN @t5 ELSE @t6 END,
  r.id,CONCAT(c.name,' · ',s.name),0,0,@owner_id,@owner_id
FROM timetable_cycle_days cd JOIN bell_schedule_slots bs ON bs.template_id=@bell_id
JOIN classes c ON c.school_id=@school_id
JOIN subjects s ON s.school_id=@school_id AND s.code = CASE MOD(cd.cycle_day_number + bs.slot_number + c.id,6)
  WHEN 0 THEN 'MATH' WHEN 1 THEN 'ENG' WHEN 2 THEN 'SCI' WHEN 3 THEN 'AGR' WHEN 4 THEN 'SOC' ELSE 'ICT' END
JOIN timetable_rooms r ON r.school_id=@school_id AND r.home_class_id=c.id
WHERE cd.timetable_id=@timetable_id
  AND NOT EXISTS (SELECT 1 FROM timetable_entries e WHERE e.timetable_version_id=@version_id AND e.cycle_day_id=cd.id AND e.slot_start_id=bs.id AND e.class_id=c.id);

INSERT INTO timetable_publications (school_id,timetable_id,timetable_version_id,publication_status,audience_scope,snapshot,published_by)
VALUES (@school_id,@timetable_id,@version_id,'ACTIVE',JSON_OBJECT('roles',JSON_ARRAY('teacher','headteacher','school_owner','student','parent')),
  JSON_OBJECT('name','Romeo JFK Term 2 Published Timetable','class_count',6,'published',true),@owner_id)
ON DUPLICATE KEY UPDATE publication_status='ACTIVE',snapshot=VALUES(snapshot),published_by=@owner_id,published_at=CURRENT_TIMESTAMP;

/* A visible recommendation gives the Academic Intelligence page an actionable
   example immediately, even before the result-ingestion pass is run. */
INSERT INTO academic_recommendations (public_ref,school_id,recommendation_type,audience_role,assigned_user_id,class_id,subject_id,title,reason,evidence_json,suggested_action,priority,confidence_score,rule_key,dedupe_window,created_by)
SELECT UUID(),@school_id,'assessment_follow_up','teacher',@t1,c.id,@math_id,'Review mathematics evidence before the next topic','Mid-term demonstration scores include a below-threshold cohort and the next mathematics topic is not yet taught.',JSON_OBJECT('source','romeo_jfk_demo','students_below_threshold',1,'syllabus_phase','mid_term'),'Run a short diagnostic and revisit the common prerequisite before progressing.','high',70,'romeo_jfk_demo_math_follow_up','2026-demo',@headteacher_id
FROM classes c WHERE c.school_id=@school_id AND c.name='Year 1'
  AND NOT EXISTS (SELECT 1 FROM academic_recommendations r WHERE r.school_id=@school_id AND r.rule_key='romeo_jfk_demo_math_follow_up');
