import { markAnswer } from "./answerMarker.js"

const GENERATOR_VERSION = "lesson-log-v1"

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

async function chooseSubject(connection, schoolId, gradeId, studentId = null, classId = null, scheduledDate = todayIso()) {
  const [subjects] = await connection.query(
    `SELECT subj.id, subj.name,
      COUNT(DISTINCT q.id) AS approved_question_count,
      AVG(CASE WHEN stm.mastery_label IN ('weak', 'developing') THEN 100 - stm.mastery_score END) AS weakness_score,
      SUM(CASE WHEN stm.next_review_at IS NOT NULL AND stm.next_review_at <= ? THEN 1 ELSE 0 END) AS due_reviews,
      COUNT(DISTINCT recent.id) AS recent_subject_drills,
      MAX(CASE WHEN l.id IS NOT NULL THEN 100 ELSE 0 END) AS lesson_priority
     FROM question_bank q
     JOIN subjects subj ON subj.id = q.subject_id AND subj.school_id = q.school_id
     JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
      AND st.grade_id <=> q.grade_id AND st.subject_id = q.subject_id AND st.is_active = 1
     LEFT JOIN student_topic_mastery stm ON stm.school_id = q.school_id
      AND stm.student_id = ? AND stm.subject_id = q.subject_id AND stm.topic_id = q.topic_id
     LEFT JOIN drill_sessions recent ON recent.school_id = q.school_id
      AND recent.student_id = ? AND recent.subject_id = q.subject_id
      AND recent.scheduled_date >= DATE_SUB(?, INTERVAL 7 DAY)
     LEFT JOIN teacher_lesson_logs l ON l.school_id = q.school_id
      AND l.class_id = ? AND l.subject_id = q.subject_id
      AND l.status = 'finalized' AND l.coverage_status <> 'postponed'
      AND l.lesson_date >= DATE_SUB(?, INTERVAL 7 DAY)
     WHERE q.school_id = ? AND q.grade_id <=> ? AND q.approval_status = 'approved'
       AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
     GROUP BY subj.id, subj.name
     ORDER BY approved_question_count DESC, subj.name`,
    [scheduledDate, studentId || 0, studentId || 0, scheduledDate, classId || 0, scheduledDate, schoolId, gradeId || null],
  )
  if (!subjects.length) return null
  const scored = []
  for (const subject of subjects) {
    const assessment = classId ? await upcomingAssessmentScore(connection, schoolId, classId, subject.id, scheduledDate) : 0
    const subjectBalance = clamp(100 - Number(subject.recent_subject_drills || 0) * 25)
    const dueReviewScore = clamp(Number(subject.due_reviews || 0) * 25)
    const score =
      Number(subject.lesson_priority || 0) * 0.3
      + Number(subject.weakness_score || 0) * 0.25
      + dueReviewScore * 0.2
      + assessment * 0.15
      + subjectBalance * 0.1
    scored.push({
      id: Number(subject.id),
      name: subject.name,
      subject_priority: Number(score.toFixed(2)),
      subject_priority_components: {
        timetable_priority: Number(subject.lesson_priority || 0),
        student_weakness: Number(Number(subject.weakness_score || 0).toFixed(1)),
        overdue_review: dueReviewScore,
        assessment_urgency: assessment,
        subject_balance: subjectBalance,
      },
    })
  }
  return scored.sort((a, b) => b.subject_priority - a.subject_priority || a.name.localeCompare(b.name))[0] || null
}

async function loadDrillSettings(connection, schoolId) {
  let school = null
  try {
    [[school]] = await connection.query(
      `SELECT daily_drill_enabled, daily_drill_subject_mode, lesson_log_required_before_drill_generation
       FROM schools
       WHERE id = ?
       LIMIT 1`,
      [schoolId],
    )
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR") throw error
  }
  return {
    daily_drill_enabled: school?.daily_drill_enabled === undefined ? 1 : Number(school.daily_drill_enabled),
    daily_drill_subject_mode: school?.daily_drill_subject_mode || "smart_rotation",
    lesson_log_required_before_drill_generation: Number(school?.lesson_log_required_before_drill_generation || 0),
  }
}

async function topicScopeIds(connection, schoolId, subjectId, topicId) {
  const id = Number(topicId || 0)
  if (!id) return []
  const [rows] = await connection.query(
    `SELECT scoped.id
     FROM syllabus_topics seed
     JOIN syllabus_topics scoped ON scoped.school_id = seed.school_id
      AND scoped.subject_id = seed.subject_id
      AND (
        scoped.id = seed.id
        OR scoped.parent_topic_id = seed.id
        OR scoped.parent_topic_id IN (
          SELECT child.id
          FROM syllabus_topics child
          WHERE child.school_id = seed.school_id
            AND child.subject_id = seed.subject_id
            AND child.parent_topic_id = seed.id
        )
      )
     WHERE seed.school_id = ? AND seed.subject_id = ? AND seed.id = ?
     ORDER BY scoped.parent_topic_id IS NOT NULL, scoped.order_number, scoped.topic_name`,
    [schoolId, subjectId, id],
  )
  return rows.length ? rows.map((row) => Number(row.id)).filter(Boolean) : [id]
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

function dateOnly(value) {
  if (!value) return ""
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${dateOnly(fromDate)}T00:00:00Z`)
  const to = new Date(`${dateOnly(toDate)}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

function reviewUrgencyScore(nextReviewAt, scheduledDate) {
  if (!nextReviewAt) return 0
  const overdueDays = daysBetween(nextReviewAt, scheduledDate)
  if (overdueDays === null || overdueDays < 0) return 0
  if (overdueDays === 0) return 70
  if (overdueDays <= 3) return 85
  return 100
}

function lessonRelevanceScore(candidate, scheduledDate) {
  if (candidate.bucket === "prerequisite") return 40
  if (candidate.bucket === "term_plan") return 45
  if (candidate.bucket === "available") return 10
  if (!candidate.lesson_date) return candidate.bucket === "recently_taught" ? 60 : 0
  const age = daysBetween(candidate.lesson_date, scheduledDate)
  if (age === null) return 0
  if (age <= 0) return 100
  if (age <= 3) return 85
  if (age <= 7) return 70
  return 20
}

function coverageGapScore(attempts) {
  const count = Number(attempts || 0)
  if (count <= 0) return 100
  if (count < 3) return 80
  if (count < 5) return 55
  return 25
}

function priorityMultiplier(value) {
  if (value === "high") return 1.25
  if (value === "low") return 0.75
  return 1
}

function difficultyMatchScore(questionDifficulty, masteryScore, coverageStatus) {
  const difficulty = String(questionDifficulty || "easy").toLowerCase()
  const mastery = masteryScore === null || masteryScore === undefined ? 50 : Number(masteryScore)
  if (coverageStatus === "introduced") return difficulty === "easy" ? 100 : difficulty === "medium" ? 20 : 0
  if (coverageStatus === "partially_taught") return difficulty === "easy" ? 90 : difficulty === "medium" ? 85 : 15
  if (mastery < 50) return difficulty === "easy" ? 100 : difficulty === "medium" ? 80 : 20
  if (mastery < 70) return difficulty === "easy" ? 80 : difficulty === "medium" ? 100 : 40
  if (mastery < 85) return difficulty === "easy" ? 50 : difficulty === "medium" ? 100 : 75
  return difficulty === "easy" ? 35 : difficulty === "medium" ? 85 : 100
}

function noveltyScore(lastAttemptedAt, scheduledDate) {
  if (!lastAttemptedAt) return 100
  const age = daysBetween(lastAttemptedAt, scheduledDate)
  if (age === null) return 70
  if (age <= 1) return 0
  if (age <= 7) return 5
  if (age <= 13) return 25
  if (age <= 30) return 50
  return 80
}

function questionQualityScore(question) {
  if (question.quality_score !== null && question.quality_score !== undefined) return clamp(question.quality_score)
  if (question.percent_correct !== null && question.percent_correct !== undefined) {
    return clamp(100 - Math.abs(Number(question.percent_correct) - 70))
  }
  return 75
}

function topicPriority(candidate, scheduledDate, assessmentScore) {
  const mastery = candidate.mastery_score === null || candidate.mastery_score === undefined ? null : Number(candidate.mastery_score)
  const weaknessScore = mastery === null
    ? candidate.bucket === "recently_taught" ? 45 : 55
    : clamp(100 - mastery)
  const components = {
    weakness_score: weaknessScore,
    review_urgency: reviewUrgencyScore(candidate.next_review_at, scheduledDate),
    lesson_relevance: lessonRelevanceScore(candidate, scheduledDate),
    assessment_relevance: assessmentScore,
    coverage_gap: coverageGapScore(candidate.attempts),
  }
  const raw =
    components.weakness_score * 0.3
    + components.review_urgency * 0.25
    + components.lesson_relevance * 0.2
    + components.assessment_relevance * 0.15
    + components.coverage_gap * 0.1
  return {
    score: clamp(raw * priorityMultiplier(candidate.drill_priority_override)),
    components,
  }
}

function targetBucketCounts(limit, isCandidate, hasPrerequisites) {
  const total = Math.max(1, Number(limit || 5))
  const weights = isCandidate
    ? { recently_taught: 0.3, weak_topic: 0.4, spaced_review: 0.2, exam_challenge: 0.1 }
    : { recently_taught: 0.5, weak_topic: 0.3, spaced_review: 0.2 }
  const raw = Object.entries(weights).map(([bucket, weight]) => ({
    bucket,
    exact: total * weight,
    count: Math.floor(total * weight),
  }))
  let assigned = raw.reduce((sum, item) => sum + item.count, 0)
  raw
    .sort((a, b) => (b.exact - b.count) - (a.exact - a.count))
    .forEach((item) => {
      if (assigned >= total) return
      item.count += 1
      assigned += 1
    })
  const counts = Object.fromEntries(raw.map((item) => [item.bucket, item.count]))
  if (hasPrerequisites && total >= 5) {
    counts.prerequisite = 1
    if (counts.weak_topic > 1) counts.weak_topic -= 1
    else if (counts.spaced_review > 1) counts.spaced_review -= 1
    else counts.recently_taught = Math.max(0, Number(counts.recently_taught || 0) - 1)
  }
  return counts
}

async function upcomingAssessmentScore(connection, schoolId, classId, subjectId, scheduledDate) {
  const [[exam]] = await connection.query(
    `SELECT MIN(exam_date) AS next_exam_date
     FROM exam_timetable_entries
     WHERE school_id = ? AND class_id = ? AND subject_id = ?
       AND status = 'scheduled'
       AND exam_date >= ?`,
    [schoolId, classId || 0, subjectId, scheduledDate],
  )
  if (!exam?.next_exam_date) return 0
  const days = daysBetween(scheduledDate, exam.next_exam_date)
  if (days === null || days > 30) return 0
  if (days <= 7) return 100
  if (days <= 14) return 70
  return 40
}

function dedupeCandidates(candidates) {
  const byKey = new Map()
  candidates.forEach((candidate) => {
    const key = `${candidate.bucket}:${candidate.topic_id}`
    const current = byKey.get(key)
    if (!current || Number(candidate.topic_priority || 0) > Number(current.topic_priority || 0)) byKey.set(key, candidate)
  })
  return [...byKey.values()].sort((a, b) => Number(b.topic_priority || 0) - Number(a.topic_priority || 0))
}

async function loadTopicCandidates(connection, schoolId, studentId, subjectId, gradeId, classId, scheduledDate) {
  const assessmentScore = await upcomingAssessmentScore(connection, schoolId, classId, subjectId, scheduledDate)
  const candidates = []

  try {
    const [recent] = await connection.query(
      `SELECT COALESCE(tlt.syllabus_subtopic_id, tlt.syllabus_topic_id, l.main_topic_id) AS topic_id,
        st.topic_name, l.id AS lesson_log_id, l.lesson_date, l.coverage_status, l.coverage_percentage,
        COALESCE(tlt.drill_priority_override, 'normal') AS drill_priority_override,
        stm.mastery_score, stm.mastery_label, stm.attempts, stm.next_review_at,
        COALESCE(stm.consecutive_failures, 0) AS consecutive_failures,
        COALESCE(stm.intervention_needed, 0) AS intervention_needed,
        COUNT(DISTINCT q.id) AS approved_question_count
       FROM teacher_lesson_logs l
       LEFT JOIN teacher_lesson_log_topics tlt ON tlt.lesson_log_id = l.id
       JOIN syllabus_topics st ON st.id = COALESCE(tlt.syllabus_subtopic_id, tlt.syllabus_topic_id, l.main_topic_id)
        AND st.school_id = l.school_id AND st.is_active = 1
       LEFT JOIN student_topic_mastery stm ON stm.school_id = l.school_id
        AND stm.student_id = ? AND stm.subject_id = l.subject_id
        AND stm.topic_id = COALESCE(tlt.syllabus_subtopic_id, tlt.syllabus_topic_id, l.main_topic_id)
       JOIN question_bank q ON q.school_id = l.school_id AND q.subject_id = l.subject_id
        AND q.grade_id <=> ? AND q.approval_status = 'approved'
        AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
        AND (q.topic_id = st.id OR q.subtopic_id = st.id)
       WHERE l.school_id = ? AND l.class_id = ? AND l.subject_id = ?
         AND l.status = 'finalized' AND l.coverage_status <> 'postponed'
         AND l.lesson_date >= DATE_SUB(?, INTERVAL 7 DAY)
       GROUP BY topic_id, st.topic_name, l.id, l.lesson_date, l.coverage_status, l.coverage_percentage,
        tlt.drill_priority_override, stm.mastery_score, stm.mastery_label, stm.attempts, stm.next_review_at,
        stm.consecutive_failures, stm.intervention_needed`,
      [studentId, gradeId || null, schoolId, classId || 0, subjectId, scheduledDate],
    )
    candidates.push(...recent.map((row) => ({ ...row, bucket: "recently_taught", reason: "recent_lesson_log" })))
  } catch (error) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error
  }

  const [weak] = await connection.query(
    `SELECT stm.topic_id, st.topic_name, NULL AS lesson_log_id, NULL AS lesson_date,
      NULL AS coverage_status, NULL AS coverage_percentage, 'normal' AS drill_priority_override,
      stm.mastery_score, stm.mastery_label, stm.attempts, stm.next_review_at,
      COALESCE(stm.consecutive_failures, 0) AS consecutive_failures,
      COALESCE(stm.intervention_needed, 0) AS intervention_needed,
      COUNT(DISTINCT q.id) AS approved_question_count
     FROM student_topic_mastery stm
     JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id AND st.is_active = 1
     JOIN question_bank q ON q.school_id = stm.school_id AND q.subject_id = stm.subject_id
      AND q.grade_id <=> ? AND q.approval_status = 'approved'
      AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
      AND (q.topic_id = stm.topic_id OR q.subtopic_id = stm.topic_id)
     WHERE stm.school_id = ? AND stm.student_id = ? AND stm.subject_id = ?
       AND stm.mastery_label IN ('weak', 'developing')
     GROUP BY stm.topic_id, st.topic_name, stm.mastery_score, stm.mastery_label, stm.attempts,
      stm.next_review_at, stm.consecutive_failures, stm.intervention_needed`,
    [gradeId || null, schoolId, studentId, subjectId],
  )
  candidates.push(...weak.map((row) => ({ ...row, bucket: "weak_topic", reason: "weak_topic" })))

  const [review] = await connection.query(
    `SELECT stm.topic_id, st.topic_name, NULL AS lesson_log_id, NULL AS lesson_date,
      NULL AS coverage_status, NULL AS coverage_percentage, 'normal' AS drill_priority_override,
      stm.mastery_score, stm.mastery_label, stm.attempts, stm.next_review_at,
      COALESCE(stm.consecutive_failures, 0) AS consecutive_failures,
      COALESCE(stm.intervention_needed, 0) AS intervention_needed,
      COUNT(DISTINCT q.id) AS approved_question_count
     FROM student_topic_mastery stm
     JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id AND st.is_active = 1
     JOIN question_bank q ON q.school_id = stm.school_id AND q.subject_id = stm.subject_id
      AND q.grade_id <=> ? AND q.approval_status = 'approved'
      AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
      AND (q.topic_id = stm.topic_id OR q.subtopic_id = stm.topic_id)
     WHERE stm.school_id = ? AND stm.student_id = ? AND stm.subject_id = ?
       AND stm.next_review_at IS NOT NULL AND stm.next_review_at <= ?
     GROUP BY stm.topic_id, st.topic_name, stm.mastery_score, stm.mastery_label, stm.attempts,
      stm.next_review_at, stm.consecutive_failures, stm.intervention_needed`,
    [gradeId || null, schoolId, studentId, subjectId, scheduledDate],
  )
  candidates.push(...review.map((row) => ({ ...row, bucket: "spaced_review", reason: "spaced_review" })))

  try {
    const [prerequisites] = await connection.query(
      `SELECT prereq.id AS topic_id, prereq.topic_name, NULL AS lesson_log_id, NULL AS lesson_date,
        NULL AS coverage_status, NULL AS coverage_percentage, 'high' AS drill_priority_override,
        prereq_mastery.mastery_score, prereq_mastery.mastery_label, prereq_mastery.attempts, prereq_mastery.next_review_at,
        COALESCE(prereq_mastery.consecutive_failures, 0) AS consecutive_failures,
        COALESCE(prereq_mastery.intervention_needed, 0) AS intervention_needed,
        COUNT(DISTINCT q.id) AS approved_question_count
       FROM student_topic_mastery failed
       JOIN syllabus_topic_prerequisites link ON link.school_id = failed.school_id AND link.topic_id = failed.topic_id
       JOIN syllabus_topics prereq ON prereq.id = link.prerequisite_topic_id
        AND prereq.school_id = failed.school_id AND prereq.subject_id = failed.subject_id AND prereq.is_active = 1
       LEFT JOIN student_topic_mastery prereq_mastery ON prereq_mastery.school_id = failed.school_id
        AND prereq_mastery.student_id = failed.student_id AND prereq_mastery.subject_id = failed.subject_id
        AND prereq_mastery.topic_id = prereq.id
       JOIN question_bank q ON q.school_id = failed.school_id AND q.subject_id = failed.subject_id
        AND q.grade_id <=> ? AND q.approval_status = 'approved'
        AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
        AND (q.topic_id = prereq.id OR q.subtopic_id = prereq.id)
       WHERE failed.school_id = ? AND failed.student_id = ? AND failed.subject_id = ?
         AND (COALESCE(failed.consecutive_failures, 0) >= 3 OR COALESCE(failed.intervention_needed, 0) = 1 OR (failed.mastery_score < 50 AND failed.attempts >= 3))
       GROUP BY prereq.id, prereq.topic_name, prereq_mastery.mastery_score, prereq_mastery.mastery_label,
        prereq_mastery.attempts, prereq_mastery.next_review_at, prereq_mastery.consecutive_failures,
        prereq_mastery.intervention_needed`,
      [gradeId || null, schoolId, studentId, subjectId],
    )
    candidates.push(...prerequisites.map((row) => ({ ...row, bucket: "prerequisite", reason: "prerequisite_recovery" })))
  } catch (error) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error
  }

  if (!candidates.some((candidate) => candidate.bucket === "recently_taught")) {
    const [termPlan] = await connection.query(
      `SELECT ttp.topic_id, st.topic_name, NULL AS lesson_log_id, ttp.start_date AS lesson_date,
        NULL AS coverage_status, NULL AS coverage_percentage, 'normal' AS drill_priority_override,
        stm.mastery_score, stm.mastery_label, stm.attempts, stm.next_review_at,
        COALESCE(stm.consecutive_failures, 0) AS consecutive_failures,
        COALESCE(stm.intervention_needed, 0) AS intervention_needed,
        COUNT(DISTINCT q.id) AS approved_question_count
       FROM teacher_topic_plan ttp
       JOIN syllabus_topics st ON st.id = ttp.topic_id AND st.school_id = ttp.school_id AND st.is_active = 1
       LEFT JOIN student_topic_mastery stm ON stm.school_id = ttp.school_id
        AND stm.student_id = ? AND stm.subject_id = ttp.subject_id AND stm.topic_id = ttp.topic_id
       JOIN question_bank q ON q.school_id = ttp.school_id AND q.subject_id = ttp.subject_id
        AND q.grade_id <=> ? AND q.approval_status = 'approved'
        AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
        AND (q.topic_id = ttp.topic_id OR q.subtopic_id = ttp.topic_id)
       WHERE ttp.school_id = ? AND ttp.class_id = ? AND ttp.subject_id = ? AND ttp.is_current = 1
       GROUP BY ttp.topic_id, st.topic_name, ttp.start_date, stm.mastery_score, stm.mastery_label,
        stm.attempts, stm.next_review_at, stm.consecutive_failures, stm.intervention_needed
       ORDER BY ttp.start_date DESC
       LIMIT 5`,
      [studentId, gradeId || null, schoolId, classId || 0, subjectId],
    )
    candidates.push(...termPlan.map((row) => ({ ...row, bucket: "recently_taught", reason: "term_plan" })))
  }

  if (!candidates.length) {
    const [available] = await connection.query(
      `SELECT st.id AS topic_id, st.topic_name, NULL AS lesson_log_id, NULL AS lesson_date,
        NULL AS coverage_status, NULL AS coverage_percentage, 'normal' AS drill_priority_override,
        stm.mastery_score, stm.mastery_label, stm.attempts, stm.next_review_at,
        COALESCE(stm.consecutive_failures, 0) AS consecutive_failures,
        COALESCE(stm.intervention_needed, 0) AS intervention_needed,
        COUNT(DISTINCT q.id) AS approved_question_count
       FROM syllabus_topics st
       LEFT JOIN student_topic_mastery stm ON stm.school_id = st.school_id
        AND stm.student_id = ? AND stm.subject_id = st.subject_id AND stm.topic_id = st.id
       JOIN question_bank q ON q.school_id = st.school_id AND q.subject_id = st.subject_id
        AND q.grade_id <=> st.grade_id AND q.approval_status = 'approved'
        AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
        AND (q.topic_id = st.id OR q.subtopic_id = st.id)
       WHERE st.school_id = ? AND st.grade_id <=> ? AND st.subject_id = ? AND st.is_active = 1
       GROUP BY st.id, st.topic_name, stm.mastery_score, stm.mastery_label, stm.attempts, stm.next_review_at,
        stm.consecutive_failures, stm.intervention_needed
       ORDER BY st.order_number, st.topic_name
       LIMIT 10`,
      [studentId, schoolId, gradeId || null, subjectId],
    )
    candidates.push(...available.map((row) => ({ ...row, bucket: "spaced_review", reason: "approved_syllabus_fallback" })))
  }

  return dedupeCandidates(candidates.map((candidate) => {
    const priority = topicPriority(candidate, scheduledDate, assessmentScore)
    return {
      ...candidate,
      topic_id: Number(candidate.topic_id),
      lesson_log_id: candidate.lesson_log_id ? Number(candidate.lesson_log_id) : null,
      approved_question_count: Number(candidate.approved_question_count || 0),
      attempts: Number(candidate.attempts || 0),
      mastery_score: candidate.mastery_score === null || candidate.mastery_score === undefined ? null : Number(candidate.mastery_score),
      topic_priority: Number(priority.score.toFixed(2)),
      score_components: priority.components,
    }
  }))
}

async function questionsForTopic(connection, schoolId, studentId, gradeId, subjectId, candidate, scheduledDate, limit = 20) {
  const scopeIds = await topicScopeIds(connection, schoolId, subjectId, candidate.topic_id)
  const placeholders = scopeIds.map(() => "?").join(",")
  const coverageStatus = String(candidate.coverage_status || "")
  const difficultyClause = coverageStatus === "introduced"
    ? " AND q.difficulty = 'easy'"
    : coverageStatus === "partially_taught"
      ? " AND q.difficulty IN ('easy', 'medium')"
      : ""
  const [rows] = await connection.query(
    `SELECT q.*, question_usage.last_attempted_at, question_usage.attempt_count, question_usage.last_wrong_at,
      question_usage.correct_count
     FROM question_bank q
     JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
      AND st.grade_id <=> q.grade_id AND st.subject_id = q.subject_id AND st.is_active = 1
     LEFT JOIN (
       SELECT dsq.question_id, MAX(ds.scheduled_date) AS last_attempted_at,
        COUNT(*) AS attempt_count,
        MAX(CASE WHEN dsq.is_correct = 0 THEN ds.scheduled_date END) AS last_wrong_at,
        SUM(CASE WHEN dsq.is_correct = 1 THEN 1 ELSE 0 END) AS correct_count
       FROM drill_sessions ds
       JOIN drill_session_questions dsq ON dsq.drill_session_id = ds.id
       WHERE ds.school_id = ? AND ds.student_id = ?
       GROUP BY dsq.question_id
     ) question_usage ON question_usage.question_id = q.id
     WHERE q.school_id = ?
       AND q.grade_id <=> ?
       AND q.subject_id = ?
       AND (q.topic_id IN (${placeholders}) OR q.subtopic_id IN (${placeholders}))
       AND q.approval_status = 'approved'
       AND q.correct_answer IS NOT NULL
       AND q.explanation IS NOT NULL${difficultyClause}
     LIMIT ?`,
    [schoolId, studentId, schoolId, gradeId || null, subjectId, ...scopeIds, ...scopeIds, limit],
  )
  return rows.map((question) => {
    const difficultyMatch = difficultyMatchScore(question.difficulty, candidate.mastery_score, candidate.coverage_status)
    const novelty = noveltyScore(question.last_attempted_at, scheduledDate)
    const quality = questionQualityScore(question)
    const misconceptionMatch = question.last_wrong_at ? 100 : 35
    const score = candidate.topic_priority * 0.35
      + difficultyMatch * 0.25
      + novelty * 0.15
      + quality * 0.1
      + 75 * 0.1
      + misconceptionMatch * 0.05
    return {
      ...question,
      bucket: candidate.bucket,
      reason: candidate.reason,
      topic_priority: candidate.topic_priority,
      topic_score_components: candidate.score_components,
      question_score: Number(score.toFixed(2)),
    }
  })
}

function selectQuestions(scoredQuestions, bucketCounts, minimumQuestions) {
  const selected = []
  const selectedIds = new Set()
  const selectedSkills = new Set()
  const selectedSubtopics = new Set()
  const byBucket = new Map()
  scoredQuestions.forEach((question) => {
    const rows = byBucket.get(question.bucket) || []
    rows.push(question)
    byBucket.set(question.bucket, rows)
  })
  byBucket.forEach((rows, bucket) => {
    byBucket.set(bucket, rows.sort((a, b) => Number(b.question_score || 0) - Number(a.question_score || 0)))
  })

  const pick = (bucket, count) => {
    const rows = byBucket.get(bucket) || []
    let picked = 0
    for (const question of rows) {
      if (picked >= count) break
      if (selectedIds.has(Number(question.id))) continue
      const skillKey = String(question.skill_type || question.question_type || "")
      const subtopicKey = String(question.subtopic_id || question.topic_id || "")
      const diversityPenalty = (skillKey && selectedSkills.has(skillKey) ? 8 : 0) + (subtopicKey && selectedSubtopics.has(subtopicKey) ? 5 : 0)
      if (diversityPenalty >= 13 && rows.length > count + 2) continue
      selected.push(question)
      selectedIds.add(Number(question.id))
      if (skillKey) selectedSkills.add(skillKey)
      if (subtopicKey) selectedSubtopics.add(subtopicKey)
      picked += 1
    }
    return picked
  }

  Object.entries(bucketCounts).forEach(([bucket, count]) => pick(bucket, Number(count || 0)))
  const needed = Math.max(Number(minimumQuestions || 1), Object.values(bucketCounts).reduce((sum, count) => sum + Number(count || 0), 0))
  if (selected.length < needed) {
    const pool = [...scoredQuestions].sort((a, b) => Number(b.question_score || 0) - Number(a.question_score || 0))
    for (const question of pool) {
      if (selected.length >= needed) break
      if (selectedIds.has(Number(question.id))) continue
      selected.push(question)
      selectedIds.add(Number(question.id))
    }
  }

  const orderBuckets = ["recently_taught", "weak_topic", "recently_taught", "spaced_review", "weak_topic", "prerequisite", "spaced_review", "exam_challenge"]
  return selected
    .map((question, index) => ({
      question,
      index,
      order: orderBuckets.indexOf(question.bucket) === -1 ? index + orderBuckets.length : orderBuckets.indexOf(question.bucket),
    }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((item) => item.question)
}

async function buildScoredDrillPlan(connection, schoolId, profile, subjectId, options = {}) {
  const scheduledDate = options.scheduledDate || todayIso()
  const limit = Number(options.limit || 5)
  const minimumQuestions = Number(options.minimumQuestions || 1)
  const gradeId = profile.grade?.id || null
  const selectedTopicId = Number(options.topicId || 0)
  let candidates = selectedTopicId
    ? [{
        topic_id: selectedTopicId,
        topic_name: "",
        bucket: "recently_taught",
        reason: "selected_topic",
        lesson_log_id: null,
        coverage_status: null,
        coverage_percentage: null,
        drill_priority_override: "normal",
        mastery_score: null,
        attempts: 0,
        next_review_at: null,
        approved_question_count: 0,
        topic_priority: 70,
        score_components: {
          weakness_score: 50,
          review_urgency: 0,
          lesson_relevance: 70,
          assessment_relevance: 0,
          coverage_gap: 100,
        },
      }]
    : await loadTopicCandidates(connection, schoolId, profile.student_id, subjectId, gradeId, profile.class_id, scheduledDate)

  if (!candidates.length) {
    return { ok: false, reason: "No eligible taught, weak, review, or approved syllabus topics were found for this drill." }
  }

  const hasPrerequisites = candidates.some((candidate) => candidate.bucket === "prerequisite")
  const bucketCounts = targetBucketCounts(limit, Boolean(profile.grade?.is_candidate), hasPrerequisites)
  const warnings = []
  if (!candidates.some((candidate) => candidate.bucket === "recently_taught")) {
    warnings.push("No finalized recent lesson log with approved questions was available, so SmartLink used weak/review fallback topics.")
  }
  if (hasPrerequisites) {
    warnings.push("Prerequisite recovery was included because repeated failure or intervention status was detected.")
  }

  const scoredQuestionGroups = await Promise.all(
    candidates.slice(0, 16).map((candidate) => questionsForTopic(connection, schoolId, profile.student_id, gradeId, subjectId, candidate, scheduledDate, 20)),
  )
  const scoredQuestions = scoredQuestionGroups.flat()
  if (scoredQuestions.length < minimumQuestions) {
    return {
      ok: false,
      reason: "Not enough approved questions for the scored topic buckets. Generate AI drafts or approve more questions.",
      warnings,
      candidates,
      scoredQuestions,
    }
  }

  const questions = selectQuestions(scoredQuestions, bucketCounts, minimumQuestions).slice(0, limit)
  if (questions.length < minimumQuestions) {
    return {
      ok: false,
      reason: "Not enough approved questions after fallback allocation. Generate AI drafts or approve more questions.",
      warnings,
      candidates,
      scoredQuestions,
    }
  }
  const topTopicId = questions[0]?.topic_id || candidates[0]?.topic_id
  const topCandidate = candidates.find((candidate) => Number(candidate.topic_id) === Number(topTopicId)) || candidates[0]
  const finalBucketCounts = questions.reduce((totals, question) => {
    totals[question.bucket] = Number(totals[question.bucket] || 0) + 1
    return totals
  }, {})
  return {
    ok: true,
    topic: {
      topic_id: topCandidate.topic_id,
      reason: topCandidate.reason,
      lesson_log_id: topCandidate.lesson_log_id,
      coverage_status: topCandidate.coverage_status,
    },
    questions,
    candidates,
    scoredQuestions,
    bucket_allocation: {
      target: bucketCounts,
      final: finalBucketCounts,
      topic_scores: candidates.map((candidate) => ({
        topic_id: Number(candidate.topic_id),
        topic_name: candidate.topic_name || "",
        bucket: candidate.bucket,
        reason: candidate.reason,
        priority: candidate.topic_priority,
        components: candidate.score_components,
        lesson_log_id: candidate.lesson_log_id || null,
      })),
    },
    warnings,
  }
}

async function chooseRecentLessonTopic(connection, schoolId, subjectId, gradeId, classId) {
  try {
    const [[topic]] = await connection.query(
      `SELECT taught.topic_id, st.topic_name, 'recent_lesson_log' AS reason,
      taught.lesson_log_id, taught.coverage_status, taught.coverage_percentage, taught.drill_priority_override
     FROM (
       SELECT l.id AS lesson_log_id, l.school_id, l.class_id, l.subject_id, l.lesson_date,
         l.coverage_status, l.coverage_percentage,
         COALESCE(tlt.syllabus_subtopic_id, tlt.syllabus_topic_id, l.main_topic_id) AS topic_id,
         COALESCE(tlt.topic_role, 'main') AS topic_role,
         COALESCE(tlt.drill_priority_override, 'normal') AS drill_priority_override
       FROM teacher_lesson_logs l
       LEFT JOIN teacher_lesson_log_topics tlt ON tlt.lesson_log_id = l.id
       WHERE l.school_id = ? AND l.class_id = ? AND l.subject_id = ?
         AND l.status = 'finalized'
         AND l.coverage_status <> 'postponed'
         AND l.lesson_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     ) taught
     JOIN syllabus_topics st ON st.id = taught.topic_id AND st.school_id = taught.school_id AND st.is_active = 1
     JOIN question_bank q ON q.school_id = taught.school_id
      AND q.subject_id = taught.subject_id AND q.grade_id <=> ? AND q.approval_status = 'approved'
      AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
     JOIN syllabus_topics qt ON qt.id = q.topic_id AND qt.school_id = q.school_id
      AND qt.subject_id = q.subject_id AND qt.is_active = 1
     WHERE taught.topic_id IS NOT NULL
       AND (
         qt.id = taught.topic_id
         OR q.subtopic_id = taught.topic_id
         OR qt.parent_topic_id = taught.topic_id
         OR qt.parent_topic_id IN (
           SELECT child.id
           FROM syllabus_topics child
           WHERE child.school_id = taught.school_id
             AND child.subject_id = taught.subject_id
             AND child.parent_topic_id = taught.topic_id
         )
       )
     GROUP BY taught.topic_id, st.topic_name, taught.lesson_log_id, taught.lesson_date,
       taught.coverage_status, taught.coverage_percentage, taught.drill_priority_override, taught.topic_role
     ORDER BY FIELD(taught.drill_priority_override, 'high', 'normal', 'low'),
       taught.lesson_date DESC,
       FIELD(taught.coverage_status, 'fully_taught', 'revised', 'assessed', 'partially_taught', 'introduced'),
       FIELD(taught.topic_role, 'main', 'supporting', 'revision', 'prerequisite')
     LIMIT 1`,
      [schoolId, classId, subjectId, gradeId || null],
    )
    return topic || null
  } catch (error) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error
    return null
  }
}

async function chooseTopic(connection, schoolId, studentId, subjectId, gradeId, classId) {
  const recent = await chooseRecentLessonTopic(connection, schoolId, subjectId, gradeId, classId)
  if (recent) return recent

  const [[weak]] = await connection.query(
    `SELECT stm.topic_id, st.topic_name, 'weak_topic' AS reason
     FROM student_topic_mastery stm
     JOIN syllabus_topics st ON st.id = stm.topic_id AND st.school_id = stm.school_id
     JOIN question_bank q ON q.school_id = stm.school_id
      AND q.subject_id = stm.subject_id AND q.grade_id <=> ? AND q.approval_status = 'approved'
      AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
     JOIN syllabus_topics qt ON qt.id = q.topic_id AND qt.school_id = q.school_id
      AND qt.subject_id = q.subject_id AND qt.is_active = 1
     WHERE stm.school_id = ? AND stm.student_id = ? AND stm.subject_id = ?
       AND stm.mastery_label IN ('weak', 'developing')
       AND (
         qt.id = stm.topic_id
         OR q.subtopic_id = stm.topic_id
         OR qt.parent_topic_id = stm.topic_id
         OR qt.parent_topic_id IN (
           SELECT child.id
           FROM syllabus_topics child
           WHERE child.school_id = stm.school_id
             AND child.subject_id = stm.subject_id
             AND child.parent_topic_id = stm.topic_id
         )
       )
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
     JOIN question_bank q ON q.school_id = ttp.school_id
      AND q.subject_id = ttp.subject_id AND q.grade_id <=> ? AND q.approval_status = 'approved'
      AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
     JOIN syllabus_topics qt ON qt.id = q.topic_id AND qt.school_id = q.school_id
      AND qt.subject_id = q.subject_id AND qt.is_active = 1
     WHERE ttp.school_id = ? AND ttp.class_id = ? AND ttp.subject_id = ? AND ttp.is_current = 1
       AND (
         qt.id = ttp.topic_id
         OR q.subtopic_id = ttp.topic_id
         OR qt.parent_topic_id = ttp.topic_id
         OR qt.parent_topic_id IN (
           SELECT child.id
           FROM syllabus_topics child
           WHERE child.school_id = ttp.school_id
             AND child.subject_id = ttp.subject_id
             AND child.parent_topic_id = ttp.topic_id
         )
       )
     GROUP BY ttp.topic_id, st.topic_name, ttp.start_date
     ORDER BY ttp.start_date DESC
     LIMIT 1`,
    [gradeId || null, schoolId, classId, subjectId],
  )
  if (current) return current

  const [[topic]] = await connection.query(
    `SELECT st.id AS topic_id, st.topic_name, 'available_questions' AS reason
     FROM syllabus_topics st
     JOIN question_bank q ON q.school_id = st.school_id
      AND q.subject_id = st.subject_id
      AND q.grade_id <=> st.grade_id
      AND q.approval_status = 'approved'
      AND q.correct_answer IS NOT NULL AND q.explanation IS NOT NULL
     JOIN syllabus_topics qt ON qt.id = q.topic_id AND qt.school_id = q.school_id
      AND qt.subject_id = q.subject_id AND qt.is_active = 1
     WHERE st.school_id = ? AND st.grade_id <=> ? AND st.subject_id = ?
       AND st.is_active = 1
       AND (
         qt.id = st.id
         OR q.subtopic_id = st.id
         OR qt.parent_topic_id = st.id
         OR qt.parent_topic_id IN (
           SELECT child.id
           FROM syllabus_topics child
           WHERE child.school_id = st.school_id
             AND child.subject_id = st.subject_id
             AND child.parent_topic_id = st.id
         )
       )
     GROUP BY st.id, st.topic_name
     ORDER BY st.order_number, st.topic_name
     LIMIT 1`,
    [schoolId, gradeId || null, subjectId],
  )
  return topic || null
}

async function approvedQuestions(connection, schoolId, gradeId, subjectId, topicId, limit, options = {}) {
  const scopeIds = await topicScopeIds(connection, schoolId, subjectId, topicId)
  const placeholders = scopeIds.map(() => "?").join(",")
  const coverageStatus = String(options.coverage_status || "")
  const allowedDifficulties = coverageStatus === "introduced"
    ? ["easy"]
    : coverageStatus === "partially_taught"
      ? ["easy", "medium"]
      : []
  const difficultyClause = allowedDifficulties.length
    ? ` AND q.difficulty IN (${allowedDifficulties.map(() => "?").join(",")})`
    : ""
  const studentId = Number(options.studentId || 0)
  const scheduledDate = options.scheduledDate || todayIso()
  const noveltyClause = studentId
    ? ` AND NOT EXISTS (
        SELECT 1
        FROM drill_sessions past
        JOIN drill_session_questions past_q ON past_q.drill_session_id = past.id
        WHERE past.school_id = q.school_id
          AND past.student_id = ?
          AND past_q.question_id = q.id
          AND past.scheduled_date >= DATE_SUB(?, INTERVAL 7 DAY)
          AND COALESCE(past_q.is_correct, 0) = 1
      )`
    : ""
  const [rows] = await connection.query(
    `SELECT q.*
     FROM question_bank q
     JOIN syllabus_topics st ON st.id = q.topic_id AND st.school_id = q.school_id
      AND st.grade_id <=> q.grade_id AND st.subject_id = q.subject_id AND st.is_active = 1
     WHERE q.school_id = ?
       AND q.grade_id <=> ?
       AND q.subject_id = ?
       AND (q.topic_id IN (${placeholders}) OR q.subtopic_id IN (${placeholders}))
       AND q.approval_status = 'approved'
       AND q.correct_answer IS NOT NULL
       AND q.explanation IS NOT NULL${difficultyClause}${noveltyClause}
     ORDER BY FIELD(q.difficulty, 'easy', 'medium', 'hard'), RAND()
     LIMIT ?`,
    [
      schoolId,
      gradeId || null,
      subjectId,
      ...scopeIds,
      ...scopeIds,
      ...allowedDifficulties,
      ...(studentId ? [studentId, scheduledDate] : []),
      limit,
    ],
  )
  return rows
}

async function writeGenerationLog(connection, schoolId, studentId, session, subjectId, plan, scheduledDate) {
  const questions = plan.questions || []
  const candidates = plan.candidates || []
  const topic = plan.topic || {}
  try {
    await connection.query(
      `INSERT INTO daily_drill_generation_logs (
        school_id, student_id, drill_session_id, generation_date, subject_id,
        selected_lesson_log_ids_json, selected_topic_ids_json, bucket_allocation_json,
        candidate_question_ids_json, excluded_question_ids_json, final_question_ids_json,
        warnings_json, generator_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        schoolId,
        studentId,
        session.id,
        scheduledDate,
        subjectId,
        JSON.stringify([...new Set(candidates.map((candidate) => candidate.lesson_log_id).filter(Boolean).map(Number))]),
        JSON.stringify([...new Set(candidates.map((candidate) => candidate.topic_id).filter(Boolean).map(Number))]),
        JSON.stringify(plan.bucket_allocation || {}),
        JSON.stringify((plan.scoredQuestions || questions).map((question) => Number(question.id))),
        JSON.stringify([]),
        JSON.stringify(questions.map((question) => Number(question.id))),
        JSON.stringify(plan.warnings || []),
        GENERATOR_VERSION,
      ],
    )
  } catch (error) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error
  }
}

export async function generateDailyDrill(connection, schoolId, studentId, options = {}) {
  const scheduledDate = options.scheduledDate || todayIso()
  const settings = await loadDrillSettings(connection, schoolId)
  if (!settings.daily_drill_enabled) return { ok: false, reason: "Daily Drills are disabled for this school." }
  const profile = await resolveStudentProfile(connection, schoolId, studentId)
  if (!profile) return { ok: false, reason: "Student profile was not found." }
  const gradeId = profile.grade?.id || null
  const subject = options.subjectId
    ? { id: Number(options.subjectId) }
    : await chooseSubject(connection, schoolId, gradeId, studentId, profile.class_id, scheduledDate)
  if (!subject?.id) return { ok: false, reason: "Not enough approved questions for this learner's grade." }

  const [[existingCompleted]] = await connection.query(
    `SELECT id, status
     FROM drill_sessions
     WHERE school_id = ? AND student_id = ? AND subject_id = ? AND scheduled_date = ? AND status = 'completed'
     LIMIT 1`,
    [schoolId, studentId, subject.id, scheduledDate],
  )
  if (existingCompleted) {
    return { ok: true, existing: true, session_id: Number(existingCompleted.id), question_count: 0, reason: "A completed drill already exists for this subject and date." }
  }

  const plan = await buildScoredDrillPlan(connection, schoolId, profile, subject.id, {
    ...options,
    scheduledDate,
    topicId: options.topicId,
  })
  if (!plan.ok) return { ok: false, reason: plan.reason || "Not enough approved questions for this topic. Generate AI drafts or upload materials." }
  const topic = plan.topic
  if (!topic?.topic_id) return { ok: false, reason: "Not enough approved questions for this topic. Generate AI drafts or upload materials." }
  if (settings.lesson_log_required_before_drill_generation && !plan.candidates.some((candidate) => candidate.lesson_log_id) && !options.topicId) {
    return { ok: false, reason: "A finalized lesson log is required before generating Daily Drills for this class." }
  }
  const questions = plan.questions

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
      [session.id, question.id, index + 1, question.reason || question.bucket || topic.reason],
    )
  }
  await writeGenerationLog(connection, schoolId, studentId, session, subject.id, plan, scheduledDate)
  return {
    ok: true,
    session_id: Number(session.id || result.insertId),
    question_count: questions.length,
    focus_reason: topic.reason,
    bucket_allocation: plan.bucket_allocation?.final || {},
    warnings: plan.warnings || [],
  }
}

export async function updateMasteryFromAnswer(connection, schoolId, studentId, question, mark) {
  if (mark.is_correct === null || mark.is_correct === undefined) return
  const correctIncrement = mark.is_correct ? 1 : 0
  const latestPerformance = correctIncrement ? 100 : 0
  const nextReview = correctIncrement
    ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    : new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  try {
    await connection.query(
      `INSERT INTO student_topic_mastery (
        school_id, student_id, subject_id, topic_id, attempts, correct_attempts, mastery_score,
        mastery_label, latest_performance, confidence_label, trend, consecutive_failures,
        intervention_needed, intervention_reason, last_practised_at, next_review_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'low', 'steady', ?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON DUPLICATE KEY UPDATE attempts = attempts + 1,
        correct_attempts = correct_attempts + VALUES(correct_attempts),
        latest_performance = VALUES(latest_performance),
        trend = CASE
          WHEN VALUES(latest_performance) > mastery_score + 5 THEN 'improving'
          WHEN VALUES(latest_performance) < mastery_score - 5 THEN 'declining'
          ELSE 'steady'
        END,
        mastery_score = ROUND((0.75 * mastery_score) + (0.25 * VALUES(latest_performance)), 2),
        mastery_label = CASE
          WHEN ROUND((0.75 * mastery_score) + (0.25 * VALUES(latest_performance)), 2) < 50 THEN 'weak'
          WHEN ROUND((0.75 * mastery_score) + (0.25 * VALUES(latest_performance)), 2) < 70 THEN 'developing'
          WHEN ROUND((0.75 * mastery_score) + (0.25 * VALUES(latest_performance)), 2) < 85 THEN 'good'
          ELSE 'strong'
        END,
        confidence_label = CASE
          WHEN attempts + 1 < 5 THEN 'low'
          WHEN attempts + 1 < 15 THEN 'medium'
          ELSE 'high'
        END,
        consecutive_failures = IF(VALUES(correct_attempts) = 0, consecutive_failures + 1, 0),
        intervention_needed = IF(IF(VALUES(correct_attempts) = 0, consecutive_failures + 1, 0) >= 3, 1, intervention_needed),
        intervention_reason = IF(IF(VALUES(correct_attempts) = 0, consecutive_failures + 1, 0) >= 3, 'Repeated Daily Drill failures on this topic', intervention_reason),
        last_practised_at = CURRENT_TIMESTAMP,
        next_review_at = CASE
          WHEN ROUND((0.75 * mastery_score) + (0.25 * VALUES(latest_performance)), 2) < 50 THEN DATE_ADD(CURDATE(), INTERVAL 1 DAY)
          WHEN ROUND((0.75 * mastery_score) + (0.25 * VALUES(latest_performance)), 2) < 70 THEN DATE_ADD(CURDATE(), INTERVAL 3 DAY)
          WHEN ROUND((0.75 * mastery_score) + (0.25 * VALUES(latest_performance)), 2) < 85 THEN DATE_ADD(CURDATE(), INTERVAL 7 DAY)
          ELSE DATE_ADD(CURDATE(), INTERVAL 14 DAY)
        END`,
      [
        schoolId,
        studentId,
        question.subject_id,
        question.topic_id,
        correctIncrement,
        latestPerformance,
        correctIncrement ? "strong" : "weak",
        latestPerformance,
        correctIncrement ? 0 : 1,
        correctIncrement ? 0 : 0,
        correctIncrement ? null : "First failed attempt on this topic",
        nextReview,
      ],
    )
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR") throw error
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
        latestPerformance,
        correctIncrement ? "strong" : "weak",
        nextReview,
      ],
    )
  }
  try {
    await connection.query(
      `UPDATE question_bank
       SET times_attempted = times_attempted + 1,
         percent_correct = ROUND(((COALESCE(percent_correct, 0) * times_attempted) + ?) / (times_attempted + 1), 2)
       WHERE school_id = ? AND id = ?`,
      [latestPerformance, schoolId, question.id],
    )
  } catch (error) {
    if (error?.code !== "ER_BAD_FIELD_ERROR") throw error
  }
}

export { markAnswer }
