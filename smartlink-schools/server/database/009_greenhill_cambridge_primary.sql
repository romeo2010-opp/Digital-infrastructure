SET @school_id := (
  SELECT id
  FROM schools
  WHERE code = 'GREENHILL'
  ORDER BY id
  LIMIT 1
);

UPDATE schools
SET name = 'Greenhill Cambridge Primary School',
  country = 'Malawi',
  status = 'active'
WHERE id = @school_id;

INSERT INTO curricula (school_id, name, country, is_active)
VALUES (@school_id, 'Cambridge Primary Curriculum', 'Cambridge International', 1)
ON DUPLICATE KEY UPDATE country = VALUES(country), is_active = 1;

SET @cambridge_curriculum_id := (
  SELECT id
  FROM curricula
  WHERE school_id = @school_id AND name = 'Cambridge Primary Curriculum'
  LIMIT 1
);

UPDATE curricula
SET is_active = 0
WHERE school_id = @school_id AND id <> @cambridge_curriculum_id;

CREATE TEMPORARY TABLE greenhill_cambridge_years (
  name VARCHAR(40) PRIMARY KEY,
  order_number INT NOT NULL,
  is_candidate TINYINT(1) NOT NULL
);

INSERT INTO greenhill_cambridge_years (name, order_number, is_candidate)
VALUES
  ('Year 1', 1, 0),
  ('Year 2', 2, 0),
  ('Year 3', 3, 0),
  ('Year 4', 4, 0),
  ('Year 5', 5, 0),
  ('Year 6', 6, 1);

INSERT INTO grade_levels (school_id, curriculum_id, name, stage, order_number, is_candidate)
SELECT @school_id, @cambridge_curriculum_id, name, 'Cambridge Primary', order_number, is_candidate
FROM greenhill_cambridge_years
ON DUPLICATE KEY UPDATE
  curriculum_id = VALUES(curriculum_id),
  stage = VALUES(stage),
  order_number = VALUES(order_number),
  is_candidate = VALUES(is_candidate);

CREATE TEMPORARY TABLE greenhill_grade_alias_names (
  canonical_name VARCHAR(40) NOT NULL,
  alias_name VARCHAR(40) NOT NULL
);

INSERT INTO greenhill_grade_alias_names (canonical_name, alias_name)
VALUES
  ('Year 1', 'Standard 1'), ('Year 1', 'Grade 1'), ('Year 1', 'Primary 1'),
  ('Year 2', 'Standard 2'), ('Year 2', 'Grade 2'), ('Year 2', 'Primary 2'),
  ('Year 3', 'Standard 3'), ('Year 3', 'Grade 3'), ('Year 3', 'Primary 3'),
  ('Year 4', 'Standard 4'), ('Year 4', 'Grade 4'), ('Year 4', 'Primary 4'),
  ('Year 5', 'Standard 5'), ('Year 5', 'Grade 5'), ('Year 5', 'Primary 5'),
  ('Year 6', 'Standard 6'), ('Year 6', 'Grade 6'), ('Year 6', 'Primary 6');

CREATE TEMPORARY TABLE greenhill_grade_aliases AS
SELECT old_grade.id AS alias_id, canonical_grade.id AS canonical_id
FROM greenhill_grade_alias_names names
JOIN grade_levels old_grade
  ON old_grade.school_id = @school_id AND old_grade.name = names.alias_name
JOIN grade_levels canonical_grade
  ON canonical_grade.school_id = @school_id AND canonical_grade.name = names.canonical_name
WHERE old_grade.id <> canonical_grade.id;

UPDATE syllabus_uploads upload
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = upload.grade_id
SET upload.grade_id = grade_map.canonical_id,
  upload.curriculum_id = @cambridge_curriculum_id
WHERE upload.school_id = @school_id;

UPDATE syllabus_document_chunks chunk
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = chunk.grade_id
SET chunk.grade_id = grade_map.canonical_id
WHERE chunk.school_id = @school_id;

CREATE TEMPORARY TABLE greenhill_duplicate_alias_topics AS
SELECT alias_topic.id AS alias_id, canonical_topic.id AS canonical_id
FROM syllabus_topics alias_topic
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = alias_topic.grade_id
JOIN syllabus_topics canonical_topic
  ON canonical_topic.school_id = alias_topic.school_id
  AND canonical_topic.grade_id = grade_map.canonical_id
  AND canonical_topic.subject_id <=> alias_topic.subject_id
  AND canonical_topic.topic_name = alias_topic.topic_name
WHERE alias_topic.school_id = @school_id
  AND alias_topic.id <> canonical_topic.id;

UPDATE syllabus_topics child_topic
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = child_topic.parent_topic_id
SET child_topic.parent_topic_id = topic_map.canonical_id
WHERE child_topic.school_id = @school_id;

UPDATE syllabus_document_chunks chunk
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = chunk.topic_id
SET chunk.topic_id = topic_map.canonical_id
WHERE chunk.school_id = @school_id;

UPDATE question_bank question
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = question.topic_id
SET question.topic_id = topic_map.canonical_id,
  question.curriculum_id = @cambridge_curriculum_id
WHERE question.school_id = @school_id;

UPDATE question_bank question
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = question.subtopic_id
SET question.subtopic_id = topic_map.canonical_id,
  question.curriculum_id = @cambridge_curriculum_id
WHERE question.school_id = @school_id;

UPDATE generated_question_batches batch
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = batch.topic_id
SET batch.topic_id = topic_map.canonical_id
WHERE batch.school_id = @school_id;

UPDATE generated_question_batches batch
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = batch.subtopic_id
SET batch.subtopic_id = topic_map.canonical_id
WHERE batch.school_id = @school_id;

UPDATE drill_sessions session
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = session.focus_topic_id
SET session.focus_topic_id = topic_map.canonical_id
WHERE session.school_id = @school_id;

UPDATE learning_objectives objective
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = objective.topic_id
SET objective.topic_id = topic_map.canonical_id;

UPDATE teacher_topic_plan plan
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = plan.topic_id
SET plan.topic_id = topic_map.canonical_id
WHERE plan.school_id = @school_id;

DELETE mastery
FROM student_topic_mastery mastery
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = mastery.topic_id
JOIN student_topic_mastery existing
  ON existing.school_id = mastery.school_id
  AND existing.student_id = mastery.student_id
  AND existing.subject_id = mastery.subject_id
  AND existing.topic_id = topic_map.canonical_id
WHERE mastery.school_id = @school_id;

UPDATE student_topic_mastery mastery
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = mastery.topic_id
SET mastery.topic_id = topic_map.canonical_id
WHERE mastery.school_id = @school_id;

DELETE alias_topic
FROM syllabus_topics alias_topic
JOIN greenhill_duplicate_alias_topics topic_map ON topic_map.alias_id = alias_topic.id
WHERE alias_topic.school_id = @school_id;

UPDATE syllabus_topics topic
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = topic.grade_id
SET topic.grade_id = grade_map.canonical_id,
  topic.curriculum_id = @cambridge_curriculum_id
WHERE topic.school_id = @school_id;

UPDATE question_bank question
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = question.grade_id
SET question.grade_id = grade_map.canonical_id,
  question.curriculum_id = @cambridge_curriculum_id
WHERE question.school_id = @school_id;

UPDATE generated_question_batches batch
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = batch.grade_id
SET batch.grade_id = grade_map.canonical_id
WHERE batch.school_id = @school_id;

UPDATE drill_sessions session
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = session.grade_id
SET session.grade_id = grade_map.canonical_id
WHERE session.school_id = @school_id;

UPDATE exam_tracks track
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = track.grade_id
SET track.grade_id = grade_map.canonical_id
WHERE track.school_id = @school_id;

DELETE old_grade
FROM grade_levels old_grade
JOIN greenhill_grade_aliases grade_map ON grade_map.alias_id = old_grade.id
WHERE old_grade.school_id = @school_id;

CREATE TEMPORARY TABLE greenhill_primary_grade_keep AS
SELECT id
FROM grade_levels
WHERE school_id = @school_id AND name IN ('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6');

CREATE TEMPORARY TABLE greenhill_removed_grades AS
SELECT id
FROM grade_levels
WHERE school_id = @school_id
  AND id NOT IN (SELECT id FROM greenhill_primary_grade_keep);

CREATE TEMPORARY TABLE greenhill_removed_topics AS
SELECT id
FROM syllabus_topics
WHERE school_id = @school_id
  AND grade_id IN (SELECT id FROM greenhill_removed_grades);

CREATE TEMPORARY TABLE greenhill_removed_questions AS
SELECT id
FROM question_bank
WHERE school_id = @school_id
  AND (
    grade_id IN (SELECT id FROM greenhill_removed_grades)
    OR topic_id IN (SELECT id FROM greenhill_removed_topics)
    OR subtopic_id IN (SELECT id FROM greenhill_removed_topics)
  );

CREATE TEMPORARY TABLE greenhill_removed_batches AS
SELECT id
FROM generated_question_batches
WHERE school_id = @school_id
  AND (
    grade_id IN (SELECT id FROM greenhill_removed_grades)
    OR topic_id IN (SELECT id FROM greenhill_removed_topics)
    OR subtopic_id IN (SELECT id FROM greenhill_removed_topics)
  );

DELETE FROM drill_session_questions
WHERE question_id IN (SELECT id FROM greenhill_removed_questions);

DELETE FROM generated_question_batch_items
WHERE batch_id IN (SELECT id FROM greenhill_removed_batches)
  OR question_id IN (SELECT id FROM greenhill_removed_questions);

DELETE FROM ai_explanation_logs
WHERE school_id = @school_id AND question_id IN (SELECT id FROM greenhill_removed_questions);

DELETE FROM question_explanations
WHERE question_id IN (SELECT id FROM greenhill_removed_questions);

DELETE FROM question_bank
WHERE id IN (SELECT id FROM greenhill_removed_questions);

DELETE FROM generated_question_batches
WHERE id IN (SELECT id FROM greenhill_removed_batches);

DELETE FROM learning_objectives
WHERE topic_id IN (SELECT id FROM greenhill_removed_topics);

DELETE FROM teacher_topic_plan
WHERE school_id = @school_id AND topic_id IN (SELECT id FROM greenhill_removed_topics);

DELETE FROM student_topic_mastery
WHERE school_id = @school_id AND topic_id IN (SELECT id FROM greenhill_removed_topics);

UPDATE drill_sessions
SET focus_topic_id = NULL
WHERE school_id = @school_id AND focus_topic_id IN (SELECT id FROM greenhill_removed_topics);

UPDATE syllabus_document_chunks
SET topic_id = NULL
WHERE school_id = @school_id AND topic_id IN (SELECT id FROM greenhill_removed_topics);

DELETE FROM syllabus_topics
WHERE id IN (SELECT id FROM greenhill_removed_topics);

UPDATE drill_sessions
SET exam_track_id = NULL
WHERE school_id = @school_id;

DELETE FROM exam_tracks
WHERE school_id = @school_id;

UPDATE syllabus_uploads
SET grade_id = NULL
WHERE school_id = @school_id AND grade_id IN (SELECT id FROM greenhill_removed_grades);

UPDATE syllabus_document_chunks
SET grade_id = NULL
WHERE school_id = @school_id AND grade_id IN (SELECT id FROM greenhill_removed_grades);

UPDATE drill_sessions
SET grade_id = NULL
WHERE school_id = @school_id AND grade_id IN (SELECT id FROM greenhill_removed_grades);

DELETE FROM grade_levels
WHERE school_id = @school_id
  AND id IN (SELECT id FROM greenhill_removed_grades);

UPDATE syllabus_uploads
SET curriculum_id = @cambridge_curriculum_id
WHERE school_id = @school_id
  AND grade_id IN (SELECT id FROM greenhill_primary_grade_keep);

UPDATE syllabus_topics
SET curriculum_id = @cambridge_curriculum_id
WHERE school_id = @school_id
  AND grade_id IN (SELECT id FROM greenhill_primary_grade_keep);

UPDATE question_bank
SET curriculum_id = @cambridge_curriculum_id
WHERE school_id = @school_id
  AND (
    grade_id IN (SELECT id FROM greenhill_primary_grade_keep)
    OR topic_id IN (
      SELECT id
      FROM syllabus_topics
      WHERE school_id = @school_id AND grade_id IN (SELECT id FROM greenhill_primary_grade_keep)
    )
    OR subtopic_id IN (
      SELECT id
      FROM syllabus_topics
      WHERE school_id = @school_id AND grade_id IN (SELECT id FROM greenhill_primary_grade_keep)
    )
  );

SET @year5_id := (SELECT id FROM grade_levels WHERE school_id = @school_id AND name = 'Year 5' LIMIT 1);
SET @year6_id := (SELECT id FROM grade_levels WHERE school_id = @school_id AND name = 'Year 6' LIMIT 1);

INSERT INTO exam_tracks (school_id, curriculum_id, name, track_type, grade_id, is_active)
VALUES
  (@school_id, @cambridge_curriculum_id, 'Cambridge Primary Foundation', 'foundation', NULL, 1),
  (@school_id, @cambridge_curriculum_id, 'Cambridge Primary Checkpoint Preparation', 'preparation', @year5_id, 1),
  (@school_id, @cambridge_curriculum_id, 'Cambridge Primary Checkpoint', 'candidate', @year6_id, 1)
ON DUPLICATE KEY UPDATE
  curriculum_id = VALUES(curriculum_id),
  track_type = VALUES(track_type),
  grade_id = VALUES(grade_id),
  is_active = VALUES(is_active);

SET @headteacher_id := (SELECT id FROM users WHERE school_id = @school_id AND email = 'headteacher@greenhill.test' LIMIT 1);
SET @year1_teacher_id := COALESCE((SELECT id FROM users WHERE school_id = @school_id AND email = 'p1.teacher@greenhill.test' LIMIT 1), @headteacher_id);
SET @year2_teacher_id := COALESCE((SELECT id FROM users WHERE school_id = @school_id AND email = 'p2.teacher@greenhill.test' LIMIT 1), @headteacher_id);
SET @year3_teacher_id := COALESCE((SELECT id FROM users WHERE school_id = @school_id AND email = 'p3.teacher@greenhill.test' LIMIT 1), @headteacher_id);
SET @year4_teacher_id := COALESCE((SELECT id FROM users WHERE school_id = @school_id AND email = 'p4.teacher@greenhill.test' LIMIT 1), @headteacher_id);
SET @year5_teacher_id := COALESCE((SELECT id FROM users WHERE school_id = @school_id AND email = 'math.teacher@greenhill.test' LIMIT 1), @headteacher_id);
SET @year6_teacher_id := COALESCE((SELECT id FROM users WHERE school_id = @school_id AND email = 'english.teacher@greenhill.test' LIMIT 1), @headteacher_id);

UPDATE classes SET name = 'Year 1A', grade_level = 'Year 1', teacher_user_id = @year1_teacher_id WHERE school_id = @school_id AND name IN ('P.1A', 'Primary 1A', 'Grade 1A');
UPDATE classes SET name = 'Year 2A', grade_level = 'Year 2', teacher_user_id = @year2_teacher_id WHERE school_id = @school_id AND name IN ('P.2A', 'Primary 2A', 'Grade 2A');
UPDATE classes SET name = 'Year 3A', grade_level = 'Year 3', teacher_user_id = @year3_teacher_id WHERE school_id = @school_id AND name IN ('P.3A', 'Primary 3A', 'Grade 3A');
UPDATE classes SET name = 'Year 4A', grade_level = 'Year 4', teacher_user_id = @year4_teacher_id WHERE school_id = @school_id AND name IN ('P.4A', 'Primary 4A', 'Grade 4A');
UPDATE classes SET name = 'Year 5A', grade_level = 'Year 5', teacher_user_id = @year5_teacher_id WHERE school_id = @school_id AND name IN ('P.5A', 'P.5B', 'Primary 5A', 'Grade 5A');
UPDATE classes SET name = 'Year 6A', grade_level = 'Year 6', teacher_user_id = @year6_teacher_id WHERE school_id = @school_id AND name IN ('P.6A', 'P.6B', 'Primary 6A', 'Grade 6A');

INSERT INTO classes (school_id, name, grade_level, teacher_user_id)
VALUES
  (@school_id, 'Year 1A', 'Year 1', @year1_teacher_id),
  (@school_id, 'Year 2A', 'Year 2', @year2_teacher_id),
  (@school_id, 'Year 3A', 'Year 3', @year3_teacher_id),
  (@school_id, 'Year 4A', 'Year 4', @year4_teacher_id),
  (@school_id, 'Year 5A', 'Year 5', @year5_teacher_id),
  (@school_id, 'Year 6A', 'Year 6', @year6_teacher_id)
ON DUPLICATE KEY UPDATE
  grade_level = VALUES(grade_level),
  teacher_user_id = VALUES(teacher_user_id);

SET @active_year_id := (
  SELECT id FROM academic_years
  WHERE school_id = @school_id AND is_active = 1
  ORDER BY start_date DESC, id DESC
  LIMIT 1
);
SET @term_id := (
  SELECT id FROM terms
  WHERE school_id = @school_id AND academic_year_id = @active_year_id AND status IN ('open', 'marking')
  ORDER BY FIELD(status, 'open', 'marking'), term_number DESC, id DESC
  LIMIT 1
);
SET @active_year_name := (SELECT name FROM academic_years WHERE id = @active_year_id);
SET @term_name := (SELECT name FROM terms WHERE id = @term_id);

UPDATE teacher_class_subject_assignments a
JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
SET a.notes = CASE
  WHEN a.role = 'class_teacher' THEN CONCAT(c.name, ' class teacher')
  ELSE CONCAT('Subject teacher for ', c.name)
END
WHERE a.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A');

INSERT INTO teacher_class_subject_assignments (
  school_id, teacher_id, class_id, subject_id, academic_year_id, term_id,
  academic_year, term, role, is_active, notes
)
SELECT @school_id, COALESCE(c.teacher_user_id, @headteacher_id), c.id, NULL, @active_year_id, @term_id,
  COALESCE(@active_year_name, ''), COALESCE(@term_name, ''), 'class_teacher', 1, CONCAT(c.name, ' class teacher')
FROM classes c
WHERE c.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A')
  AND NOT EXISTS (
    SELECT 1 FROM teacher_class_subject_assignments existing
    WHERE existing.school_id = @school_id
      AND existing.class_id = c.id
      AND existing.role = 'class_teacher'
      AND existing.subject_id IS NULL
      AND (existing.academic_year_id <=> @active_year_id)
      AND (existing.term_id <=> @term_id)
  );

INSERT INTO teacher_class_subject_assignments (
  school_id, teacher_id, class_id, subject_id, academic_year_id, term_id,
  academic_year, term, role, is_active, notes
)
SELECT @school_id,
  CASE subj.code
    WHEN 'MATH' THEN @year5_teacher_id
    WHEN 'ENG' THEN @year6_teacher_id
    WHEN 'SCI' THEN @year3_teacher_id
    ELSE COALESCE(c.teacher_user_id, @headteacher_id)
  END,
  c.id,
  subj.id,
  @active_year_id,
  @term_id,
  COALESCE(@active_year_name, ''),
  COALESCE(@term_name, ''),
  'subject_teacher',
  1,
  CONCAT(subj.name, ' for ', c.name)
FROM classes c
JOIN subjects subj ON subj.school_id = c.school_id AND subj.code IN ('MATH', 'ENG', 'SCI')
WHERE c.school_id = @school_id AND c.name IN ('Year 1A', 'Year 2A', 'Year 3A', 'Year 4A', 'Year 5A', 'Year 6A')
  AND NOT EXISTS (
    SELECT 1 FROM teacher_class_subject_assignments existing
    WHERE existing.school_id = @school_id
      AND existing.class_id = c.id
      AND existing.subject_id = subj.id
      AND existing.role = 'subject_teacher'
      AND (existing.academic_year_id <=> @active_year_id)
      AND (existing.term_id <=> @term_id)
  );

DELETE FROM class_progression_rules
WHERE school_id = @school_id;

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
  (@school_id, 'curriculum', JSON_OBJECT('name', 'Cambridge Primary Curriculum', 'programme', 'Cambridge Primary', 'years', JSON_ARRAY('Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6')))
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
