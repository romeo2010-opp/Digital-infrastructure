import { pool } from "../config/db.js"
import { getScopedSchoolId, getTeacherClassIds, scopedInClause } from "../utils/tenantScope.js"
import { getActiveAcademicSession, sessionPayload } from "../services/academicSessionService.js"

export async function getDashboard(req, res) {
  const schoolId = getScopedSchoolId(req)
  const session = await getActiveAcademicSession(schoolId)
  if (session.setupRequired) {
    return res.json({
      totalStudents: 0,
      fees: { collected: 0, outstanding: 0, studentsWithBalance: 0 },
      attendance: { present: 0, late: 0, absent: 0, rate: 0 },
      pendingHomework: 0,
      recentMessages: [],
      weakestTopics: [],
      setup_required: true,
      message: session.message,
      session: sessionPayload(session),
      scope: { role: req.user.role, classIds: null },
    })
  }
  const teacherClassIds = await getTeacherClassIds(req, schoolId)
  const studentClassScope = scopedInClause(teacherClassIds, "se.class_id")
  const attendanceClassScope = scopedInClause(teacherClassIds, "ar.class_id")
  const homeworkClassScope = scopedInClause(teacherClassIds, "h.class_id")
  const assessmentClassScope = scopedInClause(teacherClassIds, "a.class_id")

  const [[studentCounts], [feeRows], [attendanceRows], [homeworkRows], [messageRows], [topicRows]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total_students
       FROM student_enrollments se
       JOIN students s ON s.id = se.student_id AND s.school_id = se.school_id
       WHERE se.school_id = ? AND se.academic_year_id = ? AND se.term_id = ?
        AND se.enrollment_status = 'active' AND s.status = 'active'${studentClassScope.clause}`,
      [schoolId, session.academicYearId, session.termId, ...studentClassScope.params],
    ),
    pool.query(
      `SELECT
        COALESCE(SUM(amount_due), 0) AS total_due,
        COALESCE(SUM(amount_paid), 0) AS total_paid,
        SUM(CASE WHEN amount_due > amount_paid THEN 1 ELSE 0 END) AS students_with_balance
      FROM fee_accounts f
      JOIN students s ON s.id = f.student_id AND s.school_id = f.school_id
      JOIN student_enrollments se ON se.student_id = s.id AND se.school_id = s.school_id
        AND se.academic_year_id = ? AND se.term_id = ? AND se.enrollment_status = 'active'
      WHERE f.school_id = ?${studentClassScope.clause}`,
      [session.academicYearId, session.termId, schoolId, ...studentClassScope.params],
    ),
    pool.query(
      `SELECT
        COUNT(*) AS marked,
        SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent
      FROM attendance_records ar
      WHERE ar.school_id = ? AND ar.attendance_date = CURRENT_DATE${attendanceClassScope.clause}`,
      [schoolId, ...attendanceClassScope.params],
    ),
    pool.query(
      `SELECT COUNT(*) AS pending_homework
       FROM homework h
       WHERE h.school_id = ? AND h.due_date >= CURRENT_DATE${homeworkClassScope.clause}`,
      [schoolId, ...homeworkClassScope.params],
    ),
    pool.query(
      `SELECT id, message_type, subject, delivery_status, created_at
       FROM messages
       WHERE school_id = ?${req.user?.role === "teacher" ? " AND created_by = ?" : ""}
       ORDER BY created_at DESC LIMIT 5`,
      req.user?.role === "teacher" ? [schoolId, req.user.id] : [schoolId],
    ),
    pool.query(
      `SELECT subj.name AS subject_name, at.topic_name,
        ROUND(AVG((atm.marks_obtained / NULLIF(at.marks_allocated, 0)) * 100), 1) AS average_score
       FROM assessment_topics at
       JOIN assessments a ON a.id = at.assessment_id AND a.school_id = at.school_id
       JOIN subjects subj ON subj.id = a.subject_id AND subj.school_id = a.school_id
       LEFT JOIN assessment_topic_marks atm ON atm.assessment_topic_id = at.id AND atm.school_id = at.school_id
       WHERE at.school_id = ? AND a.academic_year_id = ? AND a.term_id = ?${assessmentClassScope.clause}
       GROUP BY subj.name, at.topic_name
       ORDER BY average_score ASC
       LIMIT 5`,
      [schoolId, session.academicYearId, session.termId, ...assessmentClassScope.params],
    ),
  ])

  const attendance = attendanceRows[0] || {}
  const marked = Number(attendance.marked || 0)
  const present = Number(attendance.present || 0)

  res.json({
    totalStudents: Number(studentCounts[0]?.total_students || 0),
    fees: {
      collected: Number(feeRows[0]?.total_paid || 0),
      outstanding: Number(feeRows[0]?.total_due || 0) - Number(feeRows[0]?.total_paid || 0),
      studentsWithBalance: Number(feeRows[0]?.students_with_balance || 0),
    },
    attendance: {
      present,
      late: Number(attendance.late || 0),
      absent: Number(attendance.absent || 0),
      rate: marked ? (present / marked) * 100 : 0,
    },
    pendingHomework: Number(homeworkRows[0]?.pending_homework || 0),
    recentMessages: messageRows,
    weakestTopics: topicRows,
    scope: {
      role: req.user.role,
      classIds: teacherClassIds || null,
    },
    setup_required: false,
    session: sessionPayload(session),
  })
}
