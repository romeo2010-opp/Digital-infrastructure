USE smartlink_schools;

SET @school_id := (SELECT id FROM schools WHERE name = 'Greenhill Cambridge Primary School' LIMIT 1);
SET @owner_id := (SELECT id FROM users WHERE school_id=@school_id AND role IN ('school_owner','director','owner') ORDER BY id LIMIT 1);
SET @teacher_id := (SELECT id FROM users WHERE school_id=@school_id AND role='teacher' ORDER BY id LIMIT 1);
SET @headteacher_id := (SELECT id FROM users WHERE school_id=@school_id AND role='headteacher' ORDER BY id LIMIT 1);
SET @class_id := (SELECT class_id FROM teacher_class_subject_assignments WHERE school_id=@school_id AND teacher_id=@teacher_id AND subject_id IS NOT NULL AND is_active=1 ORDER BY id LIMIT 1);
SET @subject_id := (SELECT subject_id FROM teacher_class_subject_assignments WHERE school_id=@school_id AND teacher_id=@teacher_id AND class_id=@class_id AND subject_id IS NOT NULL AND is_active=1 ORDER BY id LIMIT 1);
SET @topic_id := (SELECT id FROM syllabus_topics WHERE school_id=@school_id AND subject_id=@subject_id AND is_active=1 ORDER BY order_number,id LIMIT 1);
SET @year_id := (SELECT id FROM academic_years WHERE school_id=@school_id AND status='active' ORDER BY start_date DESC LIMIT 1);
SET @term_id := (SELECT id FROM terms WHERE school_id=@school_id AND academic_year_id=@year_id AND status IN ('open','marking','closed') ORDER BY term_number DESC LIMIT 1);
SET @demo_password_hash := '$2a$10$DnEcFlwc8PvKflxlzWHWO.fKt2UTi8ReqzZLibmsqsFnc21cLM03u';

INSERT INTO users (public_ref,school_id,role,full_name,first_name,last_name,email,password_hash,must_change_password,phone,employee_id,qualification,specialization,employment_status,role_type,is_active)
SELECT UUID(),@school_id,'librarian','Mervis Nkhoma','Mervis','Nkhoma','librarian@greenhill.test',@demo_password_hash,1,'+265 999 110 020','GPS-LIB-001','Diploma in Library and Information Studies','School Library and Records','active','admin_teacher',1
WHERE @school_id IS NOT NULL
ON DUPLICATE KEY UPDATE role='librarian',full_name=VALUES(full_name),is_active=1;
SET @librarian_id := (SELECT id FROM users WHERE school_id=@school_id AND email='librarian@greenhill.test' LIMIT 1);

INSERT INTO library_resources (public_ref,school_id,title,author,publisher,edition,publication_year,isbn,category,subject_id,class_level,shelf_location,acquisition_source,acquisition_date,replacement_cost,status,notes,created_by)
SELECT UUID(),@school_id,'Junior Mathematics for Malawi','T. Chirwa','Dzuka Publishing','3rd',2024,'978-99960-88-41-2','Textbook',@subject_id,'Upper Primary','MATH-A-03','School purchase','2026-01-15',18500,'active','Core class textbook set.',@librarian_id
WHERE @school_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM library_resources WHERE school_id=@school_id AND title='Junior Mathematics for Malawi');
SET @book_id := (SELECT id FROM library_resources WHERE school_id=@school_id AND title='Junior Mathematics for Malawi' LIMIT 1);

INSERT INTO library_resource_copies (public_ref,school_id,resource_id,barcode,condition_status,availability_status)
SELECT UUID(),@school_id,@book_id,CONCAT('GH-MATH-',LPAD(seed.n,3,'0')),'good',IF(seed.n=1,'borrowed','available')
FROM (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5) seed
WHERE @book_id IS NOT NULL
ON DUPLICATE KEY UPDATE resource_id=VALUES(resource_id);

SET @copy_id := (SELECT id FROM library_resource_copies WHERE school_id=@school_id AND resource_id=@book_id AND barcode='GH-MATH-001' LIMIT 1);
SET @student_id := (SELECT se.student_id FROM student_enrollments se WHERE se.school_id=@school_id AND se.class_id=@class_id AND se.enrollment_status='active' ORDER BY se.id LIMIT 1);
INSERT INTO library_loans (public_ref,school_id,resource_copy_id,borrower_type,borrower_student_id,issue_date,expected_return_date,issued_by,condition_on_issue,status,penalty_note)
SELECT UUID(),@school_id,@copy_id,'student',@student_id,DATE_SUB(CURDATE(),INTERVAL 21 DAY),DATE_SUB(CURDATE(),INTERVAL 7 DAY),@librarian_id,'good','overdue','Contact guardian; no automatic financial penalty configured.'
WHERE @copy_id IS NOT NULL AND @student_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM library_loans WHERE school_id=@school_id AND resource_copy_id=@copy_id AND status IN ('borrowed','overdue'));

INSERT INTO library_computers (public_ref,school_id,device_name,library_location,device_type,operating_system,serial_number,working_status,internet_available,printer_connected,assigned_purpose,last_maintenance_date,issue_notes)
SELECT UUID(),@school_id,'Library Desk 01','Main Library · Circulation Desk','Desktop','Ubuntu 24.04','GH-LIB-PC-001','active',1,1,'Librarian administration and printing','2026-06-20',NULL
WHERE @school_id IS NOT NULL
ON DUPLICATE KEY UPDATE working_status='active',internet_available=1,printer_connected=1;
INSERT INTO library_computers (public_ref,school_id,device_name,library_location,device_type,operating_system,serial_number,working_status,internet_available,printer_connected,assigned_purpose,last_maintenance_date,issue_notes)
SELECT UUID(),@school_id,'Library Search 02','Main Library · Resource Desk','Desktop','Windows 11','GH-LIB-PC-002','maintenance',0,0,'Teacher resource and archive search','2026-05-04','Network adapter requires replacement.'
WHERE @school_id IS NOT NULL
ON DUPLICATE KEY UPDATE working_status='maintenance',issue_notes=VALUES(issue_notes);

INSERT INTO curriculum_delivery_records (public_ref,school_id,academic_year_id,term_id,class_id,subject_id,teacher_id,topic_id,planned_start_date,planned_completion_date,actual_start_date,actual_completion_date,planned_lesson_count,completed_lesson_count,periods_spent,lifecycle_status,teacher_confidence,teacher_notes,assessed_status,class_mastery_score,mastery_confidence_score,students_assessed,students_below_threshold,revision_required,evidence_source,last_recalculated_at)
SELECT UUID(),@school_id,@year_id,@term_id,@class_id,@subject_id,@teacher_id,@topic_id,DATE_SUB(CURDATE(),INTERVAL 14 DAY),DATE_SUB(CURDATE(),INTERVAL 3 DAY),DATE_SUB(CURDATE(),INTERVAL 13 DAY),DATE_SUB(CURDATE(),INTERVAL 2 DAY),4,4,4,'REQUIRES_REVISION','medium','Delivery completed, but a paper check showed uneven understanding.',1,48,68,28,16,1,'demo_assessment_evidence',CURRENT_TIMESTAMP
WHERE @topic_id IS NOT NULL AND @term_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM curriculum_delivery_records WHERE school_id=@school_id AND academic_year_id=@year_id AND term_id=@term_id AND class_id=@class_id AND subject_id=@subject_id AND topic_id=@topic_id AND subtopic_id IS NULL AND learning_objective_id IS NULL)
ON DUPLICATE KEY UPDATE lifecycle_status='REQUIRES_REVISION',class_mastery_score=48,mastery_confidence_score=68,students_below_threshold=16,revision_required=1;

INSERT INTO academic_recommendations (public_ref,school_id,recommendation_type,audience_role,assigned_user_id,class_id,subject_id,topic_id,title,reason,evidence_json,suggested_action,priority,confidence_score,estimated_effort_minutes,due_at,status,rule_key,dedupe_window,created_by)
SELECT UUID(),@school_id,'prerequisite_revision','teacher',@teacher_id,@class_id,@subject_id,@topic_id,'Revisit the weak prerequisite before advancing','The class has completed this topic, but demonstrated mastery is 48%. A dependent topic may be academically risky.',JSON_OBJECT('class_mastery',48,'confidence',68,'students_below_threshold',16),'Run a 15-minute paper-based diagnostic, revise the common prerequisite gap, then reassess.','high',68,30,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 3 DAY),'NEW','demo_prerequisite_revision','2026-demo',@headteacher_id
WHERE @topic_id IS NOT NULL
ON DUPLICATE KEY UPDATE status='NEW',reason=VALUES(reason),evidence_json=VALUES(evidence_json);

INSERT INTO academic_interventions (public_ref,school_id,class_id,subject_id,topic_id,intervention_type,issue,evidence_json,assigned_teacher_id,priority,start_date,review_date,action_plan,parent_notification_status,outcome,status,created_by)
SELECT UUID(),@school_id,@class_id,@subject_id,@topic_id,'whole_class_revision','Topic taught but not yet mastered',JSON_OBJECT('mastery_score',48,'confidence_score',68),@teacher_id,'high',CURDATE(),DATE_ADD(CURDATE(),INTERVAL 7 DAY),'Use worked examples, guided paper practice and a short reassessment.','not_required','pending','active',@headteacher_id
WHERE @topic_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM academic_interventions WHERE school_id=@school_id AND class_id=@class_id AND topic_id=@topic_id AND status='active');

INSERT INTO institutional_archive_records (public_ref,school_id,academic_year_id,term_id,record_type,source_entity_type,title,metadata_json,confidentiality,archive_status)
SELECT UUID(),@school_id,@year_id,@term_id,'archive_preparation','term','Current term archive preparation',JSON_OBJECT('assessment_papers','27/30','marking_schemes','25/30','missing_files',8,'metadata_warnings',14),'normal','METADATA_WARNING'
WHERE @term_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM institutional_archive_records WHERE school_id=@school_id AND term_id=@term_id AND record_type='archive_preparation');
