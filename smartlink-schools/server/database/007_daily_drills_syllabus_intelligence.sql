CREATE TABLE IF NOT EXISTS curricula (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  country VARCHAR(120) NOT NULL DEFAULT 'Malawi',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_curricula_school_name (school_id, name),
  CONSTRAINT fk_curricula_school FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE TABLE IF NOT EXISTS grade_levels (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  curriculum_id BIGINT UNSIGNED NULL,
  name VARCHAR(80) NOT NULL,
  stage VARCHAR(80) NULL,
  order_number INT NULL,
  is_candidate TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_grade_levels_school_name (school_id, name),
  KEY idx_grade_levels_curriculum (school_id, curriculum_id),
  CONSTRAINT fk_grade_levels_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_grade_levels_curriculum FOREIGN KEY (curriculum_id) REFERENCES curricula(id)
);

CREATE TABLE IF NOT EXISTS exam_tracks (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  curriculum_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  track_type ENUM('foundation', 'preparation', 'candidate', 'custom') NOT NULL DEFAULT 'foundation',
  grade_id BIGINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exam_tracks_school_name (school_id, name),
  CONSTRAINT fk_exam_tracks_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_exam_tracks_curriculum FOREIGN KEY (curriculum_id) REFERENCES curricula(id),
  CONSTRAINT fk_exam_tracks_grade FOREIGN KEY (grade_id) REFERENCES grade_levels(id)
);

CREATE TABLE IF NOT EXISTS syllabus_uploads (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  curriculum_id BIGINT UNSIGNED NULL,
  level_id BIGINT UNSIGNED NULL,
  grade_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NULL,
  academic_year_id BIGINT UNSIGNED NULL,
  term_id BIGINT UNSIGNED NULL,
  material_type ENUM('full_syllabus', 'scheme_of_work', 'teacher_notes', 'exam_outline', 'past_internal_paper', 'marking_scheme', 'topic_list', 'other') NOT NULL DEFAULT 'other',
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  extracted_text_path VARCHAR(500) NULL,
  processing_status ENUM('uploaded', 'extracting', 'pending_review', 'approved', 'failed') NOT NULL DEFAULT 'uploaded',
  ai_model_used VARCHAR(120) NULL,
  extraction_summary_json JSON NULL,
  error_message VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_syllabus_uploads_scope (school_id, subject_id, grade_id, processing_status),
  CONSTRAINT fk_syllabus_uploads_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_syllabus_uploads_user FOREIGN KEY (uploaded_by) REFERENCES users(id),
  CONSTRAINT fk_syllabus_uploads_curriculum FOREIGN KEY (curriculum_id) REFERENCES curricula(id),
  CONSTRAINT fk_syllabus_uploads_grade FOREIGN KEY (grade_id) REFERENCES grade_levels(id),
  CONSTRAINT fk_syllabus_uploads_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_syllabus_uploads_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_syllabus_uploads_term FOREIGN KEY (term_id) REFERENCES terms(id)
);

CREATE TABLE IF NOT EXISTS syllabus_extracted_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  upload_id BIGINT UNSIGNED NOT NULL,
  school_id BIGINT UNSIGNED NOT NULL,
  item_type ENUM('topic', 'subtopic', 'objective', 'skill', 'assessment_note') NOT NULL,
  parent_extracted_item_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  term VARCHAR(80) NULL,
  suggested_week INT NULL,
  exam_relevance ENUM('low', 'medium', 'high') NULL,
  keywords_json JSON NULL,
  confidence DECIMAL(4,3) NOT NULL DEFAULT 0,
  status ENUM('pending_review', 'approved', 'rejected', 'merged') NOT NULL DEFAULT 'pending_review',
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  merged_into_topic_id BIGINT UNSIGNED NULL,
  raw_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_extracted_items_upload (school_id, upload_id, status),
  KEY idx_extracted_items_parent (school_id, parent_extracted_item_id),
  CONSTRAINT fk_extracted_items_upload FOREIGN KEY (upload_id) REFERENCES syllabus_uploads(id),
  CONSTRAINT fk_extracted_items_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_extracted_items_parent FOREIGN KEY (parent_extracted_item_id) REFERENCES syllabus_extracted_items(id),
  CONSTRAINT fk_extracted_items_approved_by FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS syllabus_topics (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  curriculum_id BIGINT UNSIGNED NULL,
  level_id BIGINT UNSIGNED NULL,
  grade_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  parent_topic_id BIGINT UNSIGNED NULL,
  topic_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  term VARCHAR(80) NULL,
  order_number INT NULL,
  source_type ENUM('default_template', 'syllabus_upload', 'teacher_created', 'ai_extracted') NOT NULL DEFAULT 'teacher_created',
  source_upload_id BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_syllabus_topic_scope (school_id, grade_id, subject_id, topic_name),
  KEY idx_syllabus_topics_scope (school_id, grade_id, subject_id, is_active),
  KEY idx_syllabus_topics_parent (school_id, parent_topic_id),
  CONSTRAINT fk_syllabus_topics_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_syllabus_topics_curriculum FOREIGN KEY (curriculum_id) REFERENCES curricula(id),
  CONSTRAINT fk_syllabus_topics_grade FOREIGN KEY (grade_id) REFERENCES grade_levels(id),
  CONSTRAINT fk_syllabus_topics_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_syllabus_topics_parent FOREIGN KEY (parent_topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_syllabus_topics_upload FOREIGN KEY (source_upload_id) REFERENCES syllabus_uploads(id),
  CONSTRAINT fk_syllabus_topics_approved_by FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS learning_objectives (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  topic_id BIGINT UNSIGNED NOT NULL,
  objective_text TEXT NOT NULL,
  skill_type VARCHAR(80) NULL,
  exam_relevance ENUM('low', 'medium', 'high') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_learning_objectives_topic (topic_id),
  CONSTRAINT fk_learning_objectives_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS question_bank (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  curriculum_id BIGINT UNSIGNED NULL,
  grade_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  subtopic_id BIGINT UNSIGNED NULL,
  question_type ENUM('multiple_choice', 'true_false', 'short_answer', 'structured', 'essay') NOT NULL DEFAULT 'multiple_choice',
  question_text TEXT NOT NULL,
  options_json JSON NULL,
  correct_answer TEXT NULL,
  accepted_answers_json JSON NULL,
  explanation TEXT NULL,
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'easy',
  skill_type VARCHAR(80) NULL,
  marks INT NOT NULL DEFAULT 1,
  source_type ENUM('smartlink_original', 'teacher_created', 'school_upload', 'ai_generated', 'licensed_partner', 'past_paper_style') NOT NULL DEFAULT 'teacher_created',
  approval_status ENUM('draft', 'pending_review', 'approved', 'rejected', 'flagged') NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  ai_model_used VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_question_bank_scope (school_id, grade_id, subject_id, topic_id, approval_status),
  CONSTRAINT fk_question_bank_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_question_bank_curriculum FOREIGN KEY (curriculum_id) REFERENCES curricula(id),
  CONSTRAINT fk_question_bank_grade FOREIGN KEY (grade_id) REFERENCES grade_levels(id),
  CONSTRAINT fk_question_bank_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_question_bank_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_question_bank_subtopic FOREIGN KEY (subtopic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_question_bank_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_question_bank_approved_by FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS question_explanations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  question_id BIGINT UNSIGNED NOT NULL,
  explanation_type ENUM('basic', 'simple', 'step_by_step', 'exam_style', 'common_mistake', 'hint') NOT NULL DEFAULT 'basic',
  explanation_text TEXT NOT NULL,
  approval_status ENUM('draft', 'pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'pending_review',
  created_by_ai TINYINT(1) NOT NULL DEFAULT 0,
  approved_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_question_explanations_question (question_id, approval_status),
  CONSTRAINT fk_question_explanations_question FOREIGN KEY (question_id) REFERENCES question_bank(id),
  CONSTRAINT fk_question_explanations_approved_by FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS generated_question_batches (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  grade_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  subtopic_id BIGINT UNSIGNED NULL,
  number_requested INT NOT NULL DEFAULT 5,
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'easy',
  question_type ENUM('multiple_choice', 'true_false', 'short_answer', 'structured', 'essay') NOT NULL DEFAULT 'multiple_choice',
  status ENUM('generating', 'pending_review', 'approved', 'failed') NOT NULL DEFAULT 'generating',
  ai_model_used VARCHAR(120) NULL,
  generation_prompt TEXT NULL,
  raw_response_json JSON NULL,
  error_message VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_generated_batches_scope (school_id, teacher_id, status),
  CONSTRAINT fk_generated_batches_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_generated_batches_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_generated_batches_grade FOREIGN KEY (grade_id) REFERENCES grade_levels(id),
  CONSTRAINT fk_generated_batches_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_generated_batches_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id),
  CONSTRAINT fk_generated_batches_subtopic FOREIGN KEY (subtopic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS generated_question_batch_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_generated_batch_question (batch_id, question_id),
  CONSTRAINT fk_generated_batch_items_batch FOREIGN KEY (batch_id) REFERENCES generated_question_batches(id),
  CONSTRAINT fk_generated_batch_items_question FOREIGN KEY (question_id) REFERENCES question_bank(id)
);

CREATE TABLE IF NOT EXISTS drill_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  grade_id BIGINT UNSIGNED NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  exam_track_id BIGINT UNSIGNED NULL,
  scheduled_date DATE NOT NULL,
  focus_topic_id BIGINT UNSIGNED NULL,
  focus_reason VARCHAR(255) NULL,
  status ENUM('pending', 'in_progress', 'completed', 'missed') NOT NULL DEFAULT 'pending',
  total_questions INT NOT NULL DEFAULT 0,
  score DECIMAL(8,2) NULL,
  percentage DECIMAL(5,2) NULL,
  time_taken_seconds INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_drill_student_subject_date (school_id, student_id, subject_id, scheduled_date),
  KEY idx_drill_sessions_student (school_id, student_id, scheduled_date, status),
  CONSTRAINT fk_drill_sessions_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_drill_sessions_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_drill_sessions_grade FOREIGN KEY (grade_id) REFERENCES grade_levels(id),
  CONSTRAINT fk_drill_sessions_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_drill_sessions_exam_track FOREIGN KEY (exam_track_id) REFERENCES exam_tracks(id),
  CONSTRAINT fk_drill_sessions_focus_topic FOREIGN KEY (focus_topic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS drill_session_questions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  drill_session_id BIGINT UNSIGNED NOT NULL,
  question_id BIGINT UNSIGNED NOT NULL,
  order_number INT NOT NULL DEFAULT 1,
  reason VARCHAR(120) NULL,
  student_answer TEXT NULL,
  is_correct TINYINT(1) NULL,
  marks_awarded DECIMAL(8,2) NULL,
  mistake_type VARCHAR(80) NULL,
  ai_feedback TEXT NULL,
  answered_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_drill_session_question (drill_session_id, question_id),
  CONSTRAINT fk_drill_session_questions_session FOREIGN KEY (drill_session_id) REFERENCES drill_sessions(id),
  CONSTRAINT fk_drill_session_questions_question FOREIGN KEY (question_id) REFERENCES question_bank(id)
);

CREATE TABLE IF NOT EXISTS student_topic_mastery (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  correct_attempts INT NOT NULL DEFAULT 0,
  mastery_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  mastery_label ENUM('weak', 'developing', 'good', 'strong') NOT NULL DEFAULT 'weak',
  last_practised_at TIMESTAMP NULL,
  next_review_at DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_topic_mastery (school_id, student_id, subject_id, topic_id),
  KEY idx_student_topic_mastery_review (school_id, student_id, next_review_at, mastery_label),
  CONSTRAINT fk_student_topic_mastery_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_student_topic_mastery_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_student_topic_mastery_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_student_topic_mastery_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS ai_explanation_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NULL,
  question_id BIGINT UNSIGNED NULL,
  drill_session_id BIGINT UNSIGNED NULL,
  ai_model_used VARCHAR(120) NULL,
  prompt_context_json JSON NULL,
  ai_response TEXT NULL,
  user_feedback ENUM('helpful', 'not_helpful', 'flagged') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_explanation_logs_scope (school_id, student_id, created_at),
  CONSTRAINT fk_ai_explanation_logs_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_ai_explanation_logs_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_ai_explanation_logs_question FOREIGN KEY (question_id) REFERENCES question_bank(id),
  CONSTRAINT fk_ai_explanation_logs_drill FOREIGN KEY (drill_session_id) REFERENCES drill_sessions(id)
);

CREATE TABLE IF NOT EXISTS teacher_topic_plan (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  topic_id BIGINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_teacher_topic_plan_current (school_id, class_id, subject_id, is_current),
  CONSTRAINT fk_teacher_topic_plan_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_teacher_topic_plan_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_teacher_topic_plan_teacher FOREIGN KEY (teacher_id) REFERENCES users(id),
  CONSTRAINT fk_teacher_topic_plan_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_teacher_topic_plan_topic FOREIGN KEY (topic_id) REFERENCES syllabus_topics(id)
);

CREATE TABLE IF NOT EXISTS school_ai_settings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  school_id BIGINT UNSIGNED NOT NULL,
  ai_enabled TINYINT(1) NOT NULL DEFAULT 1,
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_ai_settings (school_id),
  CONSTRAINT fk_school_ai_settings_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_school_ai_settings_user FOREIGN KEY (updated_by) REFERENCES users(id)
);

INSERT INTO curricula (school_id, name, country, is_active)
SELECT id, 'Malawi National Curriculum', 'Malawi', 1
FROM schools
ON DUPLICATE KEY UPDATE is_active = VALUES(is_active);

INSERT INTO grade_levels (school_id, curriculum_id, name, stage, order_number, is_candidate)
SELECT s.id, c.id, grade_name, stage_name, order_no, candidate
FROM schools s
JOIN curricula c ON c.school_id = s.id AND c.name = 'Malawi National Curriculum'
CROSS JOIN (
  SELECT 'Standard 1' AS grade_name, 'Primary' AS stage_name, 1 AS order_no, 0 AS candidate UNION ALL
  SELECT 'Standard 2', 'Primary', 2, 0 UNION ALL
  SELECT 'Standard 3', 'Primary', 3, 0 UNION ALL
  SELECT 'Standard 4', 'Primary', 4, 0 UNION ALL
  SELECT 'Standard 5', 'Primary', 5, 0 UNION ALL
  SELECT 'Standard 6', 'Primary', 6, 0 UNION ALL
  SELECT 'Standard 7', 'Primary', 7, 0 UNION ALL
  SELECT 'Standard 8', 'Primary', 8, 1 UNION ALL
  SELECT 'Form 1', 'Secondary', 9, 0 UNION ALL
  SELECT 'Form 2', 'Secondary', 10, 1 UNION ALL
  SELECT 'Form 3', 'Secondary', 11, 0 UNION ALL
  SELECT 'Form 4', 'Secondary', 12, 1
) seed
WHERE 1 = 1
ON DUPLICATE KEY UPDATE curriculum_id = VALUES(curriculum_id), stage = VALUES(stage), order_number = VALUES(order_number), is_candidate = VALUES(is_candidate);

INSERT INTO exam_tracks (school_id, curriculum_id, name, track_type, grade_id, is_active)
SELECT s.id, c.id, track_name, track_type, gl.id, 1
FROM schools s
JOIN curricula c ON c.school_id = s.id AND c.name = 'Malawi National Curriculum'
CROSS JOIN (
  SELECT 'Foundation Assessment' AS track_name, 'foundation' AS track_type, NULL AS grade_name UNION ALL
  SELECT 'PSLCE Preparation Mode', 'preparation', 'Standard 7' UNION ALL
  SELECT 'PSLCE Candidate Mode', 'candidate', 'Standard 8' UNION ALL
  SELECT 'JCE Foundation Mode', 'foundation', 'Form 1' UNION ALL
  SELECT 'JCE Candidate Mode', 'candidate', 'Form 2' UNION ALL
  SELECT 'MSCE Foundation Mode', 'foundation', 'Form 3' UNION ALL
  SELECT 'MSCE Candidate Mode', 'candidate', 'Form 4'
) seed
LEFT JOIN grade_levels gl ON gl.school_id = s.id AND gl.name = seed.grade_name
WHERE 1 = 1
ON DUPLICATE KEY UPDATE curriculum_id = VALUES(curriculum_id), track_type = VALUES(track_type), grade_id = VALUES(grade_id), is_active = VALUES(is_active);

INSERT INTO subjects (school_id, name, code)
SELECT s.id, subject_name, UPPER(REPLACE(subject_name, ' ', '_'))
FROM schools s
CROSS JOIN (
  SELECT 'English' AS subject_name UNION ALL
  SELECT 'Mathematics' UNION ALL
  SELECT 'Chichewa' UNION ALL
  SELECT 'Science and Technology' UNION ALL
  SELECT 'Biology' UNION ALL
  SELECT 'Chemistry' UNION ALL
  SELECT 'Physics' UNION ALL
  SELECT 'Geography' UNION ALL
  SELECT 'History' UNION ALL
  SELECT 'Agriculture' UNION ALL
  SELECT 'Bible Knowledge' UNION ALL
  SELECT 'Computer Studies'
) seed
WHERE 1 = 1
ON DUPLICATE KEY UPDATE code = COALESCE(subjects.code, VALUES(code));

INSERT INTO syllabus_topics (school_id, curriculum_id, grade_id, subject_id, topic_name, description, term, order_number, source_type, approved_by, is_active)
SELECT s.id, c.id, gl.id, subj.id, seed.topic_name, seed.description, seed.term_name, seed.order_number, 'default_template', owner.id, 1
FROM schools s
JOIN curricula c ON c.school_id = s.id AND c.name = 'Malawi National Curriculum'
CROSS JOIN (
  SELECT 'Standard 1' AS grade_name, 'Mathematics' AS subject_name, 'Counting and number bonds' AS topic_name, 'Count objects, compare numbers and solve simple number bonds.' AS description, 'Term 1' AS term_name, 1 AS order_number UNION ALL
  SELECT 'Standard 1', 'Mathematics', 'Addition within 20', 'Use number facts and objects to add within 20.', 'Term 1', 2 UNION ALL
  SELECT 'Standard 1', 'English', 'Comprehension', 'Read short passages and answer simple questions.', 'Term 1', 1 UNION ALL
  SELECT 'Standard 1', 'English', 'Grammar basics', 'Use nouns, verbs and sentence punctuation.', 'Term 1', 2 UNION ALL
  SELECT 'Form 4', 'Mathematics', 'Algebra', 'Manipulate expressions and solve equations.', 'Term 1', 1 UNION ALL
  SELECT 'Form 4', 'Mathematics', 'Geometry', 'Apply properties of shapes, angles and constructions.', 'Term 1', 2 UNION ALL
  SELECT 'Form 4', 'Mathematics', 'Probability', 'Calculate likelihood and interpret probability notation.', 'Term 2', 3 UNION ALL
  SELECT 'Form 4', 'Mathematics', 'Trigonometry', 'Use ratios and identities to solve triangles.', 'Term 2', 4 UNION ALL
  SELECT 'Form 4', 'Biology', 'Genetics', 'Explain inheritance, genes, alleles and variation.', 'Term 1', 1 UNION ALL
  SELECT 'Form 4', 'Biology', 'Transport in Plants', 'Describe water and mineral movement in plants.', 'Term 1', 2 UNION ALL
  SELECT 'Form 4', 'Biology', 'Enzymes', 'Explain enzyme action and factors affecting enzymes.', 'Term 2', 3 UNION ALL
  SELECT 'Form 4', 'Biology', 'Ecology', 'Explain food chains, ecosystems and conservation.', 'Term 2', 4 UNION ALL
  SELECT 'Form 4', 'English', 'Comprehension', 'Read texts for meaning, inference and vocabulary.', 'Term 1', 1 UNION ALL
  SELECT 'Form 4', 'English', 'Summary Writing', 'Condense passages while preserving key ideas.', 'Term 1', 2 UNION ALL
  SELECT 'Form 4', 'English', 'Grammar', 'Apply sentence structure and correct usage.', 'Term 2', 3 UNION ALL
  SELECT 'Form 4', 'English', 'Composition', 'Write organized essays with appropriate style.', 'Term 2', 4
) seed
JOIN grade_levels gl ON gl.school_id = s.id AND gl.name = seed.grade_name
JOIN subjects subj ON subj.school_id = s.id AND subj.name = seed.subject_name
LEFT JOIN (
  SELECT school_id, MIN(id) AS id
  FROM users
  WHERE role IN ('school_owner', 'headteacher') AND is_active = 1
  GROUP BY school_id
) owner ON owner.school_id = s.id
WHERE 1 = 1
ON DUPLICATE KEY UPDATE description = VALUES(description), term = VALUES(term), is_active = 1;

INSERT INTO question_bank (
  school_id, curriculum_id, grade_id, subject_id, topic_id, question_type, question_text, options_json,
  correct_answer, accepted_answers_json, explanation, difficulty, skill_type, marks, source_type, approval_status, created_by, approved_by, approved_at
)
SELECT st.school_id, st.curriculum_id, st.grade_id, st.subject_id, st.id, seed.question_type, seed.question_text, seed.options_json,
  seed.correct_answer, seed.accepted_answers_json, seed.explanation, seed.difficulty, seed.skill_type, seed.marks,
  'smartlink_original', 'approved', owner.id, owner.id, CURRENT_TIMESTAMP
FROM syllabus_topics st
JOIN subjects subj ON subj.id = st.subject_id AND subj.school_id = st.school_id
JOIN grade_levels gl ON gl.id = st.grade_id AND gl.school_id = st.school_id
LEFT JOIN (
  SELECT school_id, MIN(id) AS id
  FROM users
  WHERE role IN ('school_owner', 'headteacher') AND is_active = 1
  GROUP BY school_id
) owner ON owner.school_id = st.school_id
JOIN (
  SELECT 'Standard 1' AS grade_name, 'Mathematics' AS subject_name, 'Counting and number bonds' AS topic_name,
    'multiple_choice' AS question_type,
    'What number comes after 7?' AS question_text,
    JSON_ARRAY(JSON_OBJECT('label','A','text','6'), JSON_OBJECT('label','B','text','8'), JSON_OBJECT('label','C','text','10')) AS options_json,
    'B' AS correct_answer,
    JSON_ARRAY('8','eight') AS accepted_answers_json,
    'After 7, the next counting number is 8.' AS explanation,
    'easy' AS difficulty, 'recall' AS skill_type, 1 AS marks UNION ALL
  SELECT 'Standard 1', 'Mathematics', 'Addition within 20', 'short_answer', 'What is 9 + 4?', NULL, '13', JSON_ARRAY('13','thirteen'), 'Adding 4 to 9 gives 13.', 'easy', 'application', 1 UNION ALL
  SELECT 'Standard 1', 'English', 'Comprehension', 'multiple_choice', 'Which word means a young learner at school?', JSON_ARRAY(JSON_OBJECT('label','A','text','Student'), JSON_OBJECT('label','B','text','Market'), JSON_OBJECT('label','C','text','Stone')), 'A', JSON_ARRAY('student','learner'), 'A student is a learner who attends school.', 'easy', 'vocabulary', 1 UNION ALL
  SELECT 'Standard 1', 'English', 'Grammar basics', 'true_false', 'A sentence should start with a capital letter.', NULL, 'true', JSON_ARRAY('true','yes'), 'A complete sentence begins with a capital letter.', 'easy', 'recall', 1
) seed ON seed.grade_name = gl.name
  AND seed.subject_name = subj.name
  AND seed.topic_name = st.topic_name
WHERE NOT EXISTS (
  SELECT 1 FROM question_bank existing
  WHERE existing.school_id = st.school_id
    AND existing.topic_id = st.id
    AND existing.question_text = seed.question_text
);

INSERT INTO question_explanations (question_id, explanation_type, explanation_text, approval_status, created_by_ai, approved_by)
SELECT q.id, 'basic', q.explanation, 'approved', 0, q.approved_by
FROM question_bank q
WHERE q.approval_status = 'approved'
  AND q.explanation IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM question_explanations existing
    WHERE existing.question_id = q.id AND existing.explanation_type = 'basic'
  );
