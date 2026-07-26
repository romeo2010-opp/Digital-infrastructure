function isoDate(value = new Date()) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value || "").slice(0, 10)
}

function idOrNull(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : null
}

function gradeNameCandidates(classRow = {}) {
  const values = [classRow.grade_level, classRow.name].filter(Boolean).map(String)
  const candidates = new Set(values)
  values.forEach((value) => {
    const primary = value.match(/P\.?\s*(\d+)/i)
    const grade = value.match(/grade\s*(\d+)/i)
    const year = value.match(/year\s*(\d+)/i)
    const stage = value.match(/stage\s*(\d+)/i)
    const standard = value.match(/standard\s*(\d+)/i)
    const form = value.match(/form\s*(\d+)/i)
    if (primary) candidates.add(`Standard ${primary[1]}`)
    if (grade) candidates.add(`Standard ${grade[1]}`)
    if (year) candidates.add(`Year ${year[1]}`)
    if (stage) candidates.add(`Year ${stage[1]}`)
    if (standard) candidates.add(`Standard ${standard[1]}`)
    if (form) candidates.add(`Form ${form[1]}`)
  })
  return [...candidates]
}

async function resolveClassGradeId(connection, schoolId, classId) {
  if (!classId) return null
  const [[classRow]] = await connection.query(
    "SELECT id, name, grade_level FROM classes WHERE school_id = ? AND id = ? LIMIT 1",
    [schoolId, classId],
  )
  if (!classRow) return null
  const candidates = gradeNameCandidates(classRow)
  if (!candidates.length) return null
  const [grades] = await connection.query(
    `SELECT id
     FROM grade_levels
     WHERE school_id = ? AND name IN (${candidates.map(() => "?").join(",")})
     ORDER BY order_number, id
     LIMIT 1`,
    [schoolId, ...candidates],
  )
  return grades[0]?.id || null
}

function sessionClause(session, alias = "a") {
  if (!session || session.setupRequired || !Number(session.academicYearId) || !Number(session.termId)) return { clause: " AND 1=0", params: [] }
  return {
    clause: ` AND ${alias}.academic_year_id = ? AND ${alias}.term_id = ?`,
    params: [session.academicYearId, session.termId],
  }
}

async function getAssignments(connection, schoolId, user, session) {
  const role = String(user?.role || "").toLowerCase()
  const isTeacher = role === "teacher"
  const scoped = sessionClause(session, "a")
  const params = [schoolId]
  let teacherFilter = ""
  if (isTeacher) {
    teacherFilter = " AND a.teacher_id = ?"
    params.push(user.id)
  }
  const [rows] = await connection.query(
    `SELECT DISTINCT a.class_id, c.name AS class_name, c.grade_level,
      a.subject_id, subj.name AS subject_name, a.teacher_id, u.full_name AS teacher_name
     FROM teacher_class_subject_assignments a
     JOIN classes c ON c.id = a.class_id AND c.school_id = a.school_id
     LEFT JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
     LEFT JOIN users u ON u.id = a.teacher_id AND u.school_id = a.school_id
     WHERE a.school_id = ? AND a.is_active = 1${teacherFilter}${scoped.clause}
     ORDER BY c.name, subj.name`,
    [...params, ...scoped.params],
  )

  return rows.filter((row) => row.subject_id)
}

export async function getLessonLogSuggestions(connection, schoolId, user, session, filters = {}) {
  const lessonDate = isoDate(filters.lesson_date || filters.date || new Date())
  const assignments = await getAssignments(connection, schoolId, user, session)
  const teacher = String(user?.role || "").toLowerCase() === "teacher"
  const sessionReady = !session?.setupRequired && Number(session?.academicYearId) > 0 && Number(session?.termId) > 0
  const requestedClassId = idOrNull(filters.class_id)
  const requestedSubjectId = idOrNull(filters.subject_id)
  const selectedAssignment = assignments.find((row) => {
    const classOk = requestedClassId ? Number(row.class_id) === requestedClassId : true
    const subjectOk = requestedSubjectId ? Number(row.subject_id) === requestedSubjectId : true
    return classOk && subjectOk
  }) || assignments[0] || null
  if (teacher && (requestedClassId || requestedSubjectId) && (!selectedAssignment
    || (requestedClassId && Number(selectedAssignment.class_id) !== requestedClassId)
    || (requestedSubjectId && Number(selectedAssignment.subject_id) !== requestedSubjectId))) {
    throw new HttpError(403, "Teachers can only request lesson suggestions for their currently assigned class and subject.")
  }
  const classId = sessionReady ? (teacher ? idOrNull(selectedAssignment?.class_id) : requestedClassId || idOrNull(selectedAssignment?.class_id)) : null
  const subjectId = sessionReady ? (teacher ? idOrNull(selectedAssignment?.subject_id) : requestedSubjectId || idOrNull(selectedAssignment?.subject_id)) : null
  const teacherId = teacher ? idOrNull(user?.id) : idOrNull(filters.teacher_id) || idOrNull(selectedAssignment?.teacher_id) || idOrNull(user?.id)
  const gradeId = await resolveClassGradeId(connection, schoolId, classId)

  const plannedParams = [schoolId, classId || 0, subjectId || 0]
  let plannedSessionClause = ""
  if (!session?.setupRequired) {
    plannedSessionClause = " AND (ttp.start_date <= ? AND (ttp.end_date IS NULL OR ttp.end_date >= ?))"
    plannedParams.push(lessonDate, lessonDate)
  }
  const [plannedTopics] = classId && subjectId
    ? await connection.query(
        `SELECT ttp.id AS plan_id, ttp.topic_id, st.topic_name, st.description, ttp.start_date, ttp.end_date,
          ttp.is_current, 'term_plan' AS source
         FROM teacher_topic_plan ttp
         JOIN syllabus_topics st ON st.id = ttp.topic_id AND st.school_id = ttp.school_id
         WHERE ttp.school_id = ? AND ttp.class_id = ? AND ttp.subject_id = ?${plannedSessionClause}
         ORDER BY ttp.is_current DESC, ttp.start_date DESC, st.order_number, st.topic_name
         LIMIT 8`,
        plannedParams,
      )
    : [[]]

  const [unfinishedTopics] = classId && subjectId
    ? await connection.query(
        `SELECT l.id AS lesson_log_id, l.lesson_date, l.coverage_status, l.coverage_percentage,
          COALESCE(tlt.syllabus_subtopic_id, tlt.syllabus_topic_id, l.main_topic_id) AS topic_id,
          st.topic_name, l.lesson_notes, l.next_lesson_action, 'unfinished_previous_lesson' AS source
         FROM teacher_lesson_logs l
         LEFT JOIN teacher_lesson_log_topics tlt ON tlt.lesson_log_id = l.id
         LEFT JOIN syllabus_topics st ON st.id = COALESCE(tlt.syllabus_subtopic_id, tlt.syllabus_topic_id, l.main_topic_id)
         WHERE l.school_id = ? AND l.class_id = ? AND l.subject_id = ?
           AND l.academic_year_id=? AND l.term_id=?
           AND l.status = 'finalized'
           AND l.coverage_status IN ('introduced', 'partially_taught')
         ORDER BY l.lesson_date DESC, FIELD(tlt.topic_role, 'main', 'supporting', 'revision', 'prerequisite')
         LIMIT 6`,
        [schoolId, classId, subjectId, session.academicYearId, session.termId],
      )
    : [[]]

  const [recentLogs] = classId && subjectId
    ? await connection.query(
        `SELECT l.id, l.lesson_date, l.status, l.coverage_status, l.coverage_percentage,
          l.lesson_outcome, l.difficulty_observed, l.main_topic_id, st.topic_name, u.full_name AS teacher_name
         FROM teacher_lesson_logs l
         LEFT JOIN syllabus_topics st ON st.id = l.main_topic_id AND st.school_id = l.school_id
         LEFT JOIN users u ON u.id = l.teacher_id
         WHERE l.school_id = ? AND l.class_id = ? AND l.subject_id = ?
           AND l.academic_year_id=? AND l.term_id=?
         ORDER BY l.lesson_date DESC, l.updated_at DESC
         LIMIT 5`,
        [schoolId, classId, subjectId, session.academicYearId, session.termId],
      )
    : [[]]

  const [syllabusTopics] = subjectId
    ? await connection.query(
        `SELECT st.id, st.parent_topic_id, st.topic_name, st.description, st.term, st.order_number,
          lo.id AS objective_id, lo.objective_text, lo.skill_type
         FROM syllabus_topics st
         LEFT JOIN learning_objectives lo ON lo.topic_id = st.id
         WHERE st.school_id = ? AND st.subject_id = ? AND st.is_active = 1
           AND (? IS NULL OR st.grade_id <=> ?)
         ORDER BY st.parent_topic_id IS NOT NULL, st.order_number, st.topic_name, lo.id
         LIMIT 180`,
        [schoolId, subjectId, gradeId, gradeId],
      )
    : [[]]

  const topicMap = new Map()
  syllabusTopics.forEach((row) => {
    const existing = topicMap.get(Number(row.id)) || {
      id: Number(row.id),
      parent_topic_id: row.parent_topic_id ? Number(row.parent_topic_id) : null,
      topic_name: row.topic_name,
      description: row.description,
      term: row.term,
      order_number: row.order_number,
      objectives: [],
    }
    if (row.objective_id) {
      existing.objectives.push({
        id: Number(row.objective_id),
        objective_text: row.objective_text,
        skill_type: row.skill_type,
      })
    }
    topicMap.set(Number(row.id), existing)
  })

  const [upcomingAssessments] = classId && subjectId
    ? await connection.query(
        `SELECT id, name, status, total_marks, expected_difficulty, created_at
         FROM assessments
         WHERE school_id = ? AND class_id = ? AND subject_id = ?
           AND academic_year_id=? AND term_id=?
           AND status NOT IN ('cancelled', 'archived')
         ORDER BY created_at DESC
         LIMIT 5`,
        [schoolId, classId, subjectId, session.academicYearId, session.termId],
      )
    : [[]]

  const mainTopic = unfinishedTopics[0] || plannedTopics[0] || null
  const message = mainTopic
    ? `Based on the term plan and recent lessons, SmartLink thinks you taught ${mainTopic.topic_name}. Please confirm or change it.`
    : "Choose the class and subject, then confirm the approved syllabus topic taught today."

  return {
    lesson_date: lessonDate,
    teacher_id: teacherId,
    academic_year_id: session?.academicYearId || null,
    term_id: session?.termId || null,
    class_id: classId,
    subject_id: subjectId,
    grade_id: gradeId,
    assignments,
    selected_assignment: selectedAssignment,
    planned_topics: plannedTopics,
    unfinished_topics: unfinishedTopics,
    recent_logs: recentLogs,
    syllabus_topics: [...topicMap.values()],
    upcoming_assessments: upcomingAssessments,
    suggested: {
      main_topic_id: mainTopic?.topic_id || null,
      main_topic_name: mainTopic?.topic_name || "",
      coverage_status: unfinishedTopics[0] ? "partially_taught" : "introduced",
      source: unfinishedTopics[0]?.source || plannedTopics[0]?.source || "teacher_selection",
      message,
    },
  }
}
import { HttpError } from "../../utils/http.js"
