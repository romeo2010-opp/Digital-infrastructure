import { markAnswer } from "./answerMarker.js"

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function gradeNameCandidates(classRow = {}) {
  const values = [classRow.grade_level, classRow.name].filter(Boolean).map(String)
  const candidates = new Set(values)
  values.forEach((value) => {
    const primary = value.match(/P\.?\s*(\d+)/i)
    const grade = value.match(/grade\s*(\d+)/i)
    const standard = value.match(/standard\s*(\d+)/i)
    const form = value.match(/form\s*(\d+)/i)
    if (primary) candidates.add(`Standard ${primary[1]}`)
    if (grade) candidates.add(`Standard ${grade[1]}`)
    if (standard) candidates.add(`Standard ${standard[1]}`)
    if (form) candidates.add(`Form ${form[1]}`)
  })
  return [...candidates]
}

async function resolveStudentProfile(connection, schoolId, studentId) {
  const [[profile]] = await connection.query(
    `SELECT s.id AS student_id, s.school_id, c.id AS class_id, c.name AS class_name, c.grade_level,
      se.id AS enrollment_id, se.academic_year_id, se.term_id
     FROM students s
     LEFT JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
      AND se.enrollment_status = 'active'
     LEFT JOIN classes c ON c.id = COALESCE(se.class_id, s.class_id) AND c.school_id = s.school_id
     WHERE s.school_id = ? AND s.id = ? AND s.status = 'active'
     ORDER BY se.created_at DESC, se.id DESC
     LIMIT 1`,
    [schoolId, studentId],
  )
  if (!profile) return null
  const candidates = gradeNameCandidates(profile)
  const [grades] = candidates.length
    ? await connection.query(
        `SELECT * FROM grade_levels WHERE school_id = ? AND name IN (${candidates.map(() => "?").join(",")}) ORDER BY order_number LIMIT 1`,
        [schoolId, ...candidates],
      )
    : [[]]
  return { ...profile, grade: grades[0] || null }
}

async function chooseSubject(connection, schoolId, gradeId) {
  const [subjects] = await connection.query(
    `SELECT DISTINCT subj.id, subj.name
     FROM question_bank q
     JOIN subjects subj ON subj.id = q.subject_id AND subj.school_id = q.school_id
     JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
      AND st.grade_id <=> q.grade_id AND st.subject_id = q.subject_id AND st.is_active = 1
     WHERE q.school_id = ? AND q.grade_id <=> ? AND q.approval_status = 'approved'
     ORDER BY RAND()
     LIMIT 1`,
    [schoolId, gradeId || null],
  )
  return subjects[0] || null
}

async function chooseTopic(connection, schoolId, studentId, subjectId, gradeId, classId) {
  const [[weak]] = await connection.query(
    `SELECT stm.topic_id, st.topic_name, 'weak_topic' AS reason
     FROM student_topic_mastery stm
     JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id
     JOIN question_bank q ON q.school_id = stm.school_id AND q.topic_id = stm.topic_id
      AND q.subject_id = stm.subject_id AND q.grade_id <=> ? AND q.approval_status = 'approved'
     WHERE stm.school_id = ? AND stm.student_id = ? AND stm.subject_id = ?
       AND stm.mastery_label IN ('weak', 'developing')
     GROUP BY stm.topic_id, st.topic_name, stm.mastery_score, stm.next_review_at
     ORDER BY stm.mastery_score ASC, stm.next_review_at ASC
     LIMIT 1`,
    [gradeId || null, schoolId, studentId, subjectId],
  )
  if (weak) return weak

  const [[current]] = await connection.query(
    `SELECT ttp.topic_id, st.topic_name, 'current_topic' AS reason
     FROM teacher_topic_plan ttp
     JOIN syllabus_topics st ON st.id = ttp.topic_id AND st.school_id = ttp.school_id
     JOIN question_bank q ON q.school_id = ttp.school_id AND q.topic_id = ttp.topic_id
      AND q.subject_id = ttp.subject_id AND q.grade_id <=> ? AND q.approval_status = 'approved'
     WHERE ttp.school_id = ? AND ttp.class_id = ? AND ttp.subject_id = ? AND ttp.is_current = 1
     GROUP BY ttp.topic_id, st.topic_name, ttp.start_date
     ORDER BY ttp.start_date DESC
     LIMIT 1`,
    [gradeId || null, schoolId, classId, subjectId],
  )
  if (current) return current

  const [[topic]] = await connection.query(
    `SELECT st.id AS topic_id, st.topic_name, 'available_questions' AS reason
     FROM syllabus_topics st
     JOIN question_bank q ON q.topic_id = st.id AND q.school_id = st.school_id
     WHERE st.school_id = ? AND st.grade_id <=> ? AND st.subject_id = ?
       AND st.is_active = 1 AND q.approval_status = 'approved'
     GROUP BY st.id, st.topic_name
     ORDER BY st.order_number, st.topic_name
     LIMIT 1`,
    [schoolId, gradeId || null, subjectId],
  )
  return topic || null
}

async function approvedQuestions(connection, schoolId, gradeId, subjectId, topicId, limit) {
  const [rows] = await connection.query(
    `SELECT q.*
     FROM question_bank q
     JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
      AND st.grade_id <=> q.grade_id AND st.subject_id = q.subject_id AND st.is_active = 1
     WHERE q.school_id = ?
       AND q.grade_id <=> ?
       AND q.subject_id = ?
       AND q.topic_id = ?
       AND q.approval_status = 'approved'
       AND q.correct_answer IS NOT NULL
       AND q.explanation IS NOT NULL
     ORDER BY RAND()
     LIMIT ?`,
    [schoolId, gradeId || null, subjectId, topicId, limit],
  )
  return rows
}

export async function generateDailyDrill(connection, schoolId, studentId, options = {}) {
  const scheduledDate = options.scheduledDate || todayIso()
  const profile = await resolveStudentProfile(connection, schoolId, studentId)
  if (!profile) return { ok: false, reason: "Student profile was not found." }
  const gradeId = profile.grade?.id || null
  const subject = options.subjectId
    ? { id: Number(options.subjectId) }
    : await chooseSubject(connection, schoolId, gradeId)
  if (!subject?.id) return { ok: false, reason: "Not enough approved questions for this learner's grade." }

  const topic = options.topicId
    ? { topic_id: Number(options.topicId), reason: "selected_topic" }
    : await chooseTopic(connection, schoolId, studentId, subject.id, gradeId, profile.class_id)
  if (!topic?.topic_id) return { ok: false, reason: "Not enough approved questions for this topic. Generate AI drafts or upload materials." }

  const questions = await approvedQuestions(connection, schoolId, gradeId, subject.id, topic.topic_id, Number(options.limit || 5))
  if (questions.length < Number(options.minimumQuestions || 1)) {
    return { ok: false, reason: "Not enough approved questions for this topic. Generate AI drafts or upload materials." }
  }

  const [result] = await connection.query(
    `INSERT INTO drill_sessions (
      school_id, student_id, grade_id, subject_id, scheduled_date, focus_topic_id, focus_reason, status, total_questions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ON DUPLICATE KEY UPDATE focus_topic_id = VALUES(focus_topic_id),
      focus_reason = VALUES(focus_reason),
      total_questions = VALUES(total_questions),
      status = IF(status = 'completed', status, 'pending')`,
    [schoolId, studentId, gradeId, subject.id, scheduledDate, topic.topic_id, topic.reason, questions.length],
  )
  const [[session]] = await connection.query(
    `SELECT * FROM drill_sessions WHERE school_id = ? AND student_id = ? AND subject_id = ? AND scheduled_date = ? LIMIT 1`,
    [schoolId, studentId, subject.id, scheduledDate],
  )
  await connection.query("DELETE FROM drill_session_questions WHERE drill_session_id = ? AND student_answer IS NULL", [session.id])
  for (const [index, question] of questions.entries()) {
    await connection.query(
      `INSERT IGNORE INTO drill_session_questions (drill_session_id, question_id, order_number, reason)
       VALUES (?, ?, ?, ?)`,
      [session.id, question.id, index + 1, topic.reason],
    )
  }
  return { ok: true, session_id: Number(session.id || result.insertId), question_count: questions.length }
}

export async function updateMasteryFromAnswer(connection, schoolId, studentId, question, mark) {
  if (mark.is_correct === null || mark.is_correct === undefined) return
  const correctIncrement = mark.is_correct ? 1 : 0
  await connection.query(
    `INSERT INTO student_topic_mastery (
      school_id, student_id, subject_id, topic_id, attempts, correct_attempts, mastery_score, mastery_label, last_practised_at, next_review_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON DUPLICATE KEY UPDATE attempts = attempts + 1,
      correct_attempts = correct_attempts + VALUES(correct_attempts),
      mastery_score = ROUND(((correct_attempts + VALUES(correct_attempts)) / (attempts + 1)) * 100, 2),
      mastery_label = CASE
        WHEN ROUND(((correct_attempts + VALUES(correct_attempts)) / (attempts + 1)) * 100, 2) < 50 THEN 'weak'
        WHEN ROUND(((correct_attempts + VALUES(correct_attempts)) / (attempts + 1)) * 100, 2) < 70 THEN 'developing'
        WHEN ROUND(((correct_attempts + VALUES(correct_attempts)) / (attempts + 1)) * 100, 2) < 85 THEN 'good'
        ELSE 'strong'
      END,
      last_practised_at = CURRENT_TIMESTAMP,
      next_review_at = CASE
        WHEN ROUND(((correct_attempts + VALUES(correct_attempts)) / (attempts + 1)) * 100, 2) < 50 THEN DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        WHEN ROUND(((correct_attempts + VALUES(correct_attempts)) / (attempts + 1)) * 100, 2) < 70 THEN DATE_ADD(CURDATE(), INTERVAL 3 DAY)
        WHEN ROUND(((correct_attempts + VALUES(correct_attempts)) / (attempts + 1)) * 100, 2) < 85 THEN DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        ELSE DATE_ADD(CURDATE(), INTERVAL 14 DAY)
      END`,
    [
      schoolId,
      studentId,
      question.subject_id,
      question.topic_id,
      correctIncrement,
      correctIncrement ? 100 : 0,
      correctIncrement ? "strong" : "weak",
      correctIncrement ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) : new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    ],
  )
}

export { markAnswer }
