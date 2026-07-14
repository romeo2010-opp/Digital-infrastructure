import { rankSearchResults } from "./awareSearchService.js"
import { SCHOOL_PERMISSIONS } from "./authorizationService.js"

const DATA_ENTITIES = new Set(["students", "teachers", "guardians", "classes", "subjects", "fees", "discounts", "leave", "attendance", "homework", "assessments", "results", "support", "calendar", "messages"])

const NAVIGATION_CATALOG = [
  { id: "dashboard", title: "Dashboard", subtitle: "School command centre and current priorities", route: "/dashboard", keywords: "home overview command centre key metrics" },
  { id: "students", title: "Students", subtitle: "Learner registry, admissions and profiles", route: "/students", entity: "students", permission: SCHOOL_PERMISSIONS.STUDENTS_VIEW, keywords: "learners pupils children admission registry" },
  { id: "teachers", title: "Teachers", subtitle: "Teaching staff and assignments", route: "/teachers", entity: "teachers", roles: ["school_owner", "headteacher", "director", "owner"], keywords: "staff educators faculty assignments" },
  { id: "classes", title: "Classes", subtitle: "Classes, streams and enrolled learners", route: "/classes", entity: "classes", permission: SCHOOL_PERMISSIONS.STUDENTS_VIEW, keywords: "grades forms streams year groups" },
  { id: "parents", title: "Parents and Guardians", subtitle: "Guardian contacts and linked learners", route: "/parents", entity: "guardians", permission: SCHOOL_PERMISSIONS.STUDENTS_VIEW, keywords: "parents guardians caregivers contacts" },
  { id: "attendance", title: "Attendance", subtitle: "Daily registers, absences and lateness", route: "/attendance", entity: "attendance", permission: SCHOOL_PERMISSIONS.ATTENDANCE_MANAGE, keywords: "present absent sick late register" },
  { id: "homework", title: "Homework", subtitle: "Assignments, submissions and due dates", route: "/homework", entity: "homework", permission: SCHOOL_PERMISSIONS.ACADEMICS_MANAGE, keywords: "coursework tasks pending overdue" },
  { id: "results", title: "Results and Marksheets", subtitle: "Enter, publish and review assessment marks", route: "/results", entity: "results", permission: SCHOOL_PERMISSIONS.ACADEMICS_MANAGE, keywords: "marks scores gradebook report cards" },
  { id: "assessments", title: "Assessment Builder", subtitle: "Create tests, examinations and marking materials", route: "/exam-builder", entity: "assessments", permission: SCHOOL_PERMISSIONS.ACADEMICS_MANAGE, keywords: "exam paper test quiz builder" },
  { id: "assessment-insights", title: "Assessment Insights", subtitle: "Weak topics and class evidence", route: "/assessment-insights", entity: "assessments", permission: SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW, keywords: "analysis weak topics performance" },
  { id: "academic-intelligence", title: "Academic Intelligence", subtitle: "Evidence, mastery, pacing and readiness", route: "/academic-intelligence", entity: "reports", permission: SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW, keywords: "mastery evidence trends readiness insights" },
  { id: "learner-support", title: "Learner Support Centre", subtitle: "Support cases, interventions and reviews", route: "/learner-support", entity: "support", permission: SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE, keywords: "remediation reassessment intervention evidence" },
  { id: "daily-drills", title: "Daily Drills", subtitle: "Adaptive learner practice and drill evidence", route: "/daily-drill", entity: "assessments", permission: SCHOOL_PERMISSIONS.ACADEMICS_MANAGE, keywords: "practice questions revision adaptive" },
  { id: "calendar", title: "School Calendar", subtitle: "Events, meetings and academic dates", route: "/calendar", entity: "calendar", keywords: "schedule events dates meetings holidays" },
  { id: "timetables", title: "Timetables", subtitle: "Teaching and examination schedules", route: "/timetables", entity: "timetable", permission: SCHOOL_PERMISSIONS.ACADEMICS_MANAGE, keywords: "periods lessons rooms invigilation schedule" },
  { id: "fees", title: "Fees and Payments", subtitle: "Accounts, balances, receipts and reconciliation", route: "/fees", entity: "fees", permission: SCHOOL_PERMISSIONS.FEES_VIEW, keywords: "finance tuition arrears paid unpaid receipt" },
  { id: "discounts", title: "Discounts and Bursaries", subtitle: "Discount, bursary and scholarship requests", route: "/finance/discounts-bursaries", entity: "discounts", permission: SCHOOL_PERMISSIONS.FEES_VIEW, keywords: "waiver scholarship approval concession" },
  { id: "leave", title: "Staff Leave", subtitle: "Leave requests, approvals and coverage", route: "/staff/leave", entity: "leave", permission: SCHOOL_PERMISSIONS.LEAVE_VIEW, keywords: "holiday absence vacation requests" },
  { id: "library", title: "Library", subtitle: "Catalogue, loans and teaching resources", route: "/library/dashboard", entity: "library", permission: SCHOOL_PERMISSIONS.LIBRARY_DASHBOARD_VIEW, keywords: "books borrowing catalogue archive resources" },
  { id: "messages", title: "Messages", subtitle: "School notices and communication", route: "/messages", entity: "messages", permission: SCHOOL_PERMISSIONS.MESSAGES_MANAGE, keywords: "announcements notices communication" },
  { id: "reports", title: "Reports", subtitle: "Academic, attendance and finance reports", route: "/reports", entity: "reports", permission: SCHOOL_PERMISSIONS.REPORTS_VIEW, keywords: "analytics summaries exports statistics" },
  { id: "settings", title: "Settings", subtitle: "School configuration, users and security", route: "/settings/preferences", entity: "settings", roles: ["school_owner", "headteacher", "director", "owner"], keywords: "configuration preferences permissions users security" },
]

const hasPermission = (permissions, code) => !code || permissions.has(code)
const hasRole = (user, roles) => !roles || roles.includes(String(user?.role || "").toLowerCase())

function classScope(ids, column) {
  if (!Array.isArray(ids)) return { sql: "", params: [] }
  if (!ids.length) return { sql: " AND 1=0", params: [] }
  return { sql: ` AND ${column} IN (${ids.map(() => "?").join(",")})`, params: ids }
}

function dateScope(dateRange, column) {
  if (dateRange === "today") return ` AND DATE(${column})=CURDATE()`
  if (dateRange === "yesterday") return ` AND DATE(${column})=DATE_SUB(CURDATE(),INTERVAL 1 DAY)`
  if (dateRange === "tomorrow") return ` AND DATE(${column})=DATE_ADD(CURDATE(),INTERVAL 1 DAY)`
  if (dateRange === "this_week") return ` AND YEARWEEK(${column},1)=YEARWEEK(CURDATE(),1)`
  if (dateRange === "this_month") return ` AND YEAR(${column})=YEAR(CURDATE()) AND MONTH(${column})=MONTH(CURDATE())`
  return ""
}

function rows(result) { return result?.[0] || [] }

function wantsFactory(interpretation) {
  if (interpretation.requestedEntity) return (entity) => entity === interpretation.requestedEntity || (entity === "assessments" && interpretation.requestedEntity === "results")
  const explicit = interpretation.entities.filter((entity) => DATA_ENTITIES.has(entity))
  const hasRecognizedEntity = interpretation.entities.length > 0
  return (entity) => (!hasRecognizedEntity && !explicit.length) || explicit.includes(entity) || (entity === "assessments" && explicit.includes("results"))
}

function navigationResults(user, permissions, interpretation) {
  const allowed = NAVIGATION_CATALOG.filter((item) => hasPermission(permissions, item.permission) && hasRole(user, item.roles))
  return rankSearchResults(allowed.map((item) => ({
    id: `nav-${item.id}`, title: item.title, subtitle: item.subtitle, route: item.route, resultType: "NAVIGATION",
    groupType: "navigation", groupLabel: "Navigation", searchEntity: item.entity || "navigation", keywords: `${item.keywords || ""} ${item.entity || ""}`,
  })), interpretation, 12)
}

export async function searchSchoolRecords({ db, schoolId, session, user, teacherClassIds, permissions: permissionList, interpretation, limit = 20 }) {
  const permissions = new Set(permissionList || [])
  const wants = wantsFactory(interpretation)
  const candidateLimit = Math.min(500, Math.max(80, Number(limit || 20) * 10))
  const setupRequired = Boolean(session?.setupRequired)
  const canStudents = hasPermission(permissions, SCHOOL_PERMISSIONS.STUDENTS_VIEW)
  const canAcademics = hasPermission(permissions, SCHOOL_PERMISSIONS.ACADEMICS_MANAGE) || hasPermission(permissions, SCHOOL_PERMISSIONS.ACADEMIC_INTELLIGENCE_VIEW)
  const canAttendance = hasPermission(permissions, SCHOOL_PERMISSIONS.ATTENDANCE_MANAGE)
  const canSupport = hasPermission(permissions, SCHOOL_PERMISSIONS.ACADEMIC_INTERVENTION_MANAGE)
  const canFees = hasPermission(permissions, SCHOOL_PERMISSIONS.FEES_VIEW)
  const canLeave = hasPermission(permissions, SCHOOL_PERMISSIONS.LEAVE_VIEW)
  const canMessages = hasPermission(permissions, SCHOOL_PERMISSIONS.MESSAGES_MANAGE)
  const role = String(user?.role || "").toLowerCase()
  const isTeacher = role === "teacher"
  const canSearchTeachers = ["school_owner", "headteacher", "director", "owner"].includes(role)

  const studentScope = classScope(teacherClassIds, "se.class_id")
  const classTableScope = classScope(teacherClassIds, "c.id")
  const attendanceScope = classScope(teacherClassIds, "ar.class_id")
  const homeworkScope = classScope(teacherClassIds, "h.class_id")
  const assessmentScope = isTeacher ? { sql: ` AND (a.teacher_id=? OR a.created_by=? OR EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=a.school_id AND tcsa.teacher_id=? AND tcsa.class_id=a.class_id AND tcsa.subject_id=a.subject_id AND tcsa.is_active=1))`, params: [user.id, user.id, user.id] } : { sql: "", params: [] }
  const resultScope = isTeacher ? { sql: ` AND (rb.teacher_id=? OR a.created_by=? OR EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=rb.school_id AND tcsa.teacher_id=? AND tcsa.class_id=rb.class_id AND tcsa.subject_id=rb.subject_id AND tcsa.is_active=1))`, params: [user.id, user.id, user.id] } : { sql: "", params: [] }
  const supportScope = isTeacher ? { sql: ` AND (lsc.owner_user_id=? OR EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=lsc.school_id AND tcsa.teacher_id=? AND tcsa.class_id=lsc.class_id AND tcsa.subject_id=lsc.subject_id AND tcsa.is_active=1))`, params: [user.id, user.id] } : { sql: "", params: [] }

  let feeCondition = ""
  if (interpretation.primaryState === "outstanding" || interpretation.primaryState === "overdue") feeCondition = " AND f.amount_due+f.penalty_amount-f.discount_amount-f.amount_paid>0"
  if (interpretation.primaryState === "partial") feeCondition = " AND f.amount_paid>0 AND f.amount_due+f.penalty_amount-f.discount_amount-f.amount_paid>0"
  if (interpretation.primaryState === "paid") feeCondition = " AND f.amount_paid>0 AND f.amount_due+f.penalty_amount-f.discount_amount-f.amount_paid<=0"

  let attendanceCondition = ""
  if (["absent", "present", "late"].includes(interpretation.primaryState)) attendanceCondition = " AND ar.status=?"
  const attendanceStateParams = attendanceCondition ? [interpretation.primaryState] : []

  let homeworkCondition = ""
  if (interpretation.primaryState === "overdue") homeworkCondition = " AND h.due_date<CURDATE() AND h.status<>'closed'"
  else if (interpretation.primaryState === "pending") homeworkCondition = " AND h.status='pending'"
  else if (interpretation.primaryState === "resolved") homeworkCondition = " AND h.status='closed'"

  let assessmentCondition = ""
  if (interpretation.primaryState === "published") assessmentCondition = " AND a.status IN ('approved','scheduled','marking','results_submitted','results_approved','locked')"
  else if (interpretation.primaryState === "draft" || interpretation.primaryState === "pending") assessmentCondition = " AND a.status IN ('draft','open','ready_for_review')"

  let resultCondition = ""
  if (interpretation.primaryState === "published") resultCondition = " AND rb.status IN ('approved','locked')"
  else if (interpretation.primaryState === "draft" || interpretation.primaryState === "pending") resultCondition = " AND rb.status IN ('draft','submitted','returned')"

  let supportCondition = ""
  if (interpretation.primaryState === "resolved") supportCondition = " AND lsc.status='resolved'"
  else if (interpretation.primaryState === "active" || interpretation.primaryState === "pending") supportCondition = " AND lsc.status NOT IN ('resolved','closed_inconclusive')"
  else if (interpretation.primaryState === "overdue") supportCondition = " AND lsc.next_review_at<CURRENT_TIMESTAMP AND lsc.status NOT IN ('resolved','closed_inconclusive')"

  const jobs = {
    students: canStudents && wants("students") && !setupRequired ? db.query(`SELECT s.public_ref id,CONCAT(s.first_name,' ',s.last_name) title,CONCAT(c.name,' · ',s.admission_no) subtitle,'STUDENT' resultType,c.name className,s.status,CONCAT(s.first_name,' ',s.last_name,' ',s.admission_no,' ',COALESCE(s.student_id,''),' ',c.name) keywords,CONCAT('/students/',s.public_ref) route FROM student_enrollments se JOIN students s ON s.id=se.student_id AND s.school_id=se.school_id JOIN classes c ON c.id=se.class_id AND c.school_id=se.school_id WHERE se.school_id=? AND se.academic_year_id=? AND se.term_id=? AND se.enrollment_status='active' AND s.status='active'${studentScope.sql} ORDER BY s.last_name,s.first_name LIMIT ?`, [schoolId, session.academicYearId, session.termId, ...studentScope.params, candidateLimit]) : Promise.resolve([[]]),
    guardians: canStudents && wants("guardians") && !setupRequired ? db.query(`SELECT CONCAT('guardian-',sg.id) id,sg.full_name title,CONCAT(s.first_name,' ',s.last_name,' · ',sg.relationship) subtitle,'GUARDIAN' resultType,c.name className,CONCAT(s.first_name,' ',s.last_name) student,sg.primary_phone status,CONCAT(sg.full_name,' ',COALESCE(sg.primary_phone,''),' ',COALESCE(sg.email,''),' ',s.first_name,' ',s.last_name,' ',c.name) keywords,CONCAT('/students/',s.public_ref) route FROM student_guardians sg JOIN students s ON s.school_id=sg.school_id AND s.id=sg.student_id JOIN student_enrollments se ON se.school_id=s.school_id AND se.student_id=s.id AND se.academic_year_id=? AND se.term_id=? AND se.enrollment_status='active' JOIN classes c ON c.school_id=se.school_id AND c.id=se.class_id WHERE sg.school_id=?${studentScope.sql} ORDER BY sg.full_name LIMIT ?`, [session.academicYearId, session.termId, schoolId, ...studentScope.params, candidateLimit]) : Promise.resolve([[]]),
    classes: canStudents && wants("classes") ? db.query(`SELECT c.public_ref id,c.name title,CONCAT(COALESCE(c.grade_level,'Class'),' · ',COUNT(DISTINCT se.student_id),' learners') subtitle,'CLASS' resultType,u.full_name status,CONCAT(c.name,' ',COALESCE(c.grade_level,''),' ',COALESCE(u.full_name,'')) keywords,CONCAT('/classes/',c.public_ref) route FROM classes c LEFT JOIN users u ON u.school_id=c.school_id AND u.id=c.teacher_user_id LEFT JOIN student_enrollments se ON se.school_id=c.school_id AND se.class_id=c.id${setupRequired ? "" : " AND se.academic_year_id=? AND se.term_id=? AND se.enrollment_status='active'"} WHERE c.school_id=?${classTableScope.sql} GROUP BY c.id,c.public_ref,c.name,c.grade_level,u.full_name ORDER BY c.name LIMIT ?`, [...(setupRequired ? [] : [session.academicYearId, session.termId]), schoolId, ...classTableScope.params, candidateLimit]) : Promise.resolve([[]]),
    teachers: canSearchTeachers && wants("teachers") ? db.query(`SELECT public_ref id,full_name title,COALESCE(phone,email,'No contact') subtitle,'TEACHER' resultType,employment_status status,CONCAT(full_name,' ',COALESCE(email,''),' ',COALESCE(phone,''),' ',role) keywords,CONCAT('/teachers/',public_ref) route FROM users WHERE school_id=? AND role IN ('teacher','headteacher') ORDER BY full_name LIMIT ?`, [schoolId, candidateLimit]) : Promise.resolve([[]]),
    subjects: canAcademics && wants("subjects") ? db.query(`SELECT CONCAT('subject-',sub.id) id,sub.name title,COALESCE(sub.code,'Curriculum subject') subtitle,'SUBJECT' resultType,CONCAT(sub.name,' ',COALESCE(sub.code,'')) keywords,'/syllabus' route FROM subjects sub WHERE sub.school_id=?${isTeacher ? " AND EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=sub.school_id AND tcsa.subject_id=sub.id AND tcsa.teacher_id=? AND tcsa.is_active=1)" : ""} ORDER BY sub.name LIMIT ?`, [schoolId, ...(isTeacher ? [user.id] : []), candidateLimit]) : Promise.resolve([[]]),
    fees: canFees && wants("fees") && !setupRequired ? db.query(`SELECT CONCAT('fee-',f.id) id,CONCAT(s.first_name,' ',s.last_name) title,CONCAT(c.name,' · MWK ',FORMAT(f.amount_due+f.penalty_amount-f.discount_amount-f.amount_paid,0)) subtitle,'FEE' resultType,c.name className,f.status,CASE WHEN f.amount_due+f.penalty_amount-f.discount_amount-f.amount_paid<=0 THEN 'paid' WHEN f.amount_paid>0 THEN 'partial' ELSE 'outstanding' END searchState,CONCAT(s.first_name,' ',s.last_name,' ',c.name,' ',f.status,' ',f.term_name) keywords,'/fees/accounts' route FROM fee_accounts f JOIN students s ON s.school_id=f.school_id AND s.id=f.student_id JOIN student_enrollments se ON se.school_id=s.school_id AND se.student_id=s.id AND se.academic_year_id=? AND se.term_id=? AND se.enrollment_status='active' JOIN classes c ON c.school_id=se.school_id AND c.id=se.class_id WHERE f.school_id=?${feeCondition}${studentScope.sql} ORDER BY (f.amount_due+f.penalty_amount-f.discount_amount-f.amount_paid) DESC LIMIT ?`, [session.academicYearId, session.termId, schoolId, ...studentScope.params, candidateLimit]) : Promise.resolve([[]]),
    discounts: canFees && wants("discounts") ? db.query(`SELECT CONCAT('discount-',d.id) id,CONCAT(s.first_name,' ',s.last_name) title,CONCAT(REPLACE(d.discount_type,'_',' '),' · ',IF(d.amount_type='percent',CONCAT(d.amount_value,'%'),CONCAT('MWK ',FORMAT(d.amount_value,0)))) subtitle,'DISCOUNT' resultType,d.status,CONCAT(s.first_name,' ',s.last_name,' ',d.discount_type,' ',d.status) keywords,'/finance/discounts-bursaries' route FROM finance_discounts d JOIN students s ON s.school_id=d.school_id AND s.id=d.student_id WHERE d.school_id=?${interpretation.primaryState === "pending" ? " AND d.status='pending'" : ""} ORDER BY d.created_at DESC LIMIT ?`, [schoolId, candidateLimit]) : Promise.resolve([[]]),
    leave: canLeave && wants("leave") ? db.query(`SELECT lr.public_ref id,u.full_name title,CONCAT(REPLACE(lr.leave_type,'_',' '),' · ',lr.start_date,' to ',lr.end_date) subtitle,'LEAVE' resultType,lr.status,CONCAT(u.full_name,' ',lr.leave_type,' ',lr.status) keywords,CONCAT('/staff/leave/',lr.public_ref) route FROM staff_leave_requests lr JOIN users u ON u.school_id=lr.school_id AND u.id=lr.staff_user_id WHERE lr.school_id=?${interpretation.primaryState === "active" ? " AND lr.status='approved' AND CURDATE() BETWEEN lr.start_date AND lr.end_date" : interpretation.primaryState === "pending" ? " AND lr.status='pending'" : ""}${dateScope(interpretation.dateRange, "lr.start_date")} ORDER BY lr.start_date DESC LIMIT ?`, [schoolId, candidateLimit]) : Promise.resolve([[]]),
    attendance: canAttendance && wants("attendance") ? db.query(`SELECT CONCAT('attendance-',ar.id) id,CONCAT(s.first_name,' ',s.last_name) title,CONCAT(c.name,' · ',ar.attendance_date) subtitle,'ATTENDANCE' resultType,c.name className,ar.status,ar.status searchState,CONCAT(s.first_name,' ',s.last_name,' ',c.name,' ',ar.status,' ',COALESCE(ar.note,'')) keywords,CONCAT('/students/',s.public_ref) route,${interpretation.dateRange ? "1" : "0"} searchDateMatch FROM attendance_records ar JOIN students s ON s.school_id=ar.school_id AND s.id=ar.student_id JOIN classes c ON c.school_id=ar.school_id AND c.id=ar.class_id WHERE ar.school_id=?${attendanceCondition}${dateScope(interpretation.dateRange, "ar.attendance_date")}${attendanceScope.sql} ORDER BY ar.attendance_date DESC,ar.id DESC LIMIT ?`, [schoolId, ...attendanceStateParams, ...attendanceScope.params, candidateLimit]) : Promise.resolve([[]]),
    homework: canAcademics && wants("homework") ? db.query(`SELECT CONCAT('homework-',h.id) id,h.title,CONCAT(c.name,' · ',sub.name,' · due ',h.due_date) subtitle,'HOMEWORK' resultType,c.name className,h.status,CASE WHEN h.due_date<CURDATE() AND h.status<>'closed' THEN 'overdue' ELSE h.status END searchState,CONCAT(h.title,' ',COALESCE(h.instructions,''),' ',c.name,' ',sub.name,' ',h.status) keywords,'/homework' route FROM homework h JOIN classes c ON c.school_id=h.school_id AND c.id=h.class_id JOIN subjects sub ON sub.school_id=h.school_id AND sub.id=h.subject_id WHERE h.school_id=?${homeworkCondition}${dateScope(interpretation.dateRange, "h.due_date")}${homeworkScope.sql}${isTeacher ? " AND (h.created_by=? OR EXISTS (SELECT 1 FROM teacher_class_subject_assignments tcsa WHERE tcsa.school_id=h.school_id AND tcsa.teacher_id=? AND tcsa.class_id=h.class_id AND tcsa.subject_id=h.subject_id AND tcsa.is_active=1))" : ""} ORDER BY h.due_date DESC LIMIT ?`, [schoolId, ...homeworkScope.params, ...(isTeacher ? [user.id, user.id] : []), candidateLimit]) : Promise.resolve([[]]),
    assessments: canAcademics && wants("assessments") ? db.query(`SELECT CONCAT('assessment-',a.id) id,a.name title,CONCAT(c.name,' · ',sub.name,' · ',REPLACE(a.assessment_type,'_',' ')) subtitle,'ASSESSMENT' resultType,c.name className,a.status,CONCAT(a.name,' ',c.name,' ',sub.name,' ',a.assessment_type,' ',a.status,' ',a.term_name) keywords,CONCAT('/exam-builder/',a.id) route FROM assessments a JOIN classes c ON c.school_id=a.school_id AND c.id=a.class_id JOIN subjects sub ON sub.school_id=a.school_id AND sub.id=a.subject_id WHERE a.school_id=?${assessmentCondition}${dateScope(interpretation.dateRange, "a.created_at")}${assessmentScope.sql} ORDER BY a.updated_at DESC LIMIT ?`, [schoolId, ...assessmentScope.params, candidateLimit]) : Promise.resolve([[]]),
    results: canAcademics && wants("results") && !setupRequired ? db.query(`SELECT CONCAT('result-',re.id) id,CONCAT(s.first_name,' ',s.last_name) title,CONCAT(a.name,' · ',sub.name,' · ',CASE WHEN re.status='absent' THEN 'Absent' WHEN re.score IS NULL THEN 'No mark' ELSE CONCAT(re.score,'/',a.total_marks) END) subtitle,'RESULT' resultType,c.name className,rb.status,rb.status searchState,CONCAT(s.first_name,' ',s.last_name,' ',COALESCE(s.admission_no,''),' ',a.name,' ',c.name,' ',sub.name,' ',COALESCE(re.grade,''),' ',rb.status) keywords,CONCAT('/results/',a.id) route FROM result_entries re JOIN result_batches rb ON rb.school_id=re.school_id AND rb.id=re.result_batch_id JOIN assessments a ON a.school_id=rb.school_id AND a.id=rb.assessment_id JOIN students s ON s.school_id=re.school_id AND s.id=re.student_id JOIN classes c ON c.school_id=rb.school_id AND c.id=rb.class_id JOIN subjects sub ON sub.school_id=rb.school_id AND sub.id=rb.subject_id WHERE re.school_id=? AND rb.academic_year_id=? AND rb.term_id=?${resultCondition}${dateScope(interpretation.dateRange, "re.updated_at")}${resultScope.sql} ORDER BY re.updated_at DESC LIMIT ?`, [schoolId, session.academicYearId, session.termId, ...resultScope.params, candidateLimit]) : Promise.resolve([[]]),
    support: canSupport && wants("support") ? db.query(`SELECT lsc.public_ref id,COALESCE(CONCAT(s.first_name,' ',s.last_name),c.name,'Support group') title,CONCAT(COALESCE(sub.name,'Cross-subject'),' · ',REPLACE(lsc.case_type,'_',' ')) subtitle,'SUPPORT' resultType,c.name className,lsc.status,lsc.status searchState,CONCAT(COALESCE(s.first_name,''),' ',COALESCE(s.last_name,''),' ',COALESCE(c.name,''),' ',COALESCE(sub.name,''),' ',COALESCE(st.topic_name,''),' ',lsc.case_type,' ',lsc.status,' ',lsc.current_summary) keywords,CONCAT('/learner-support/',lsc.public_ref) route FROM learner_support_cases lsc LEFT JOIN students s ON s.school_id=lsc.school_id AND s.id=lsc.learner_id LEFT JOIN classes c ON c.school_id=lsc.school_id AND c.id=lsc.class_id LEFT JOIN subjects sub ON sub.school_id=lsc.school_id AND sub.id=lsc.subject_id LEFT JOIN syllabus_topics st ON st.school_id=lsc.school_id AND st.id=lsc.primary_topic_id WHERE lsc.school_id=?${supportCondition}${supportScope.sql} ORDER BY lsc.updated_at DESC LIMIT ?`, [schoolId, ...supportScope.params, candidateLimit]) : Promise.resolve([[]]),
    calendar: wants("calendar") ? db.query(`SELECT CONCAT('event-',se.id) id,se.title,CONCAT(REPLACE(se.event_type,'_',' '),' · ',se.start_datetime) subtitle,'EVENT' resultType,CONCAT(se.title,' ',COALESCE(se.description,''),' ',se.event_type,' ',se.visibility) keywords,'/calendar' route,${interpretation.dateRange ? "1" : "0"} searchDateMatch FROM school_events se WHERE se.school_id=?${dateScope(interpretation.dateRange, "se.start_datetime")} ORDER BY se.start_datetime DESC LIMIT ?`, [schoolId, candidateLimit]) : Promise.resolve([[]]),
    messages: canMessages && wants("messages") ? db.query(`SELECT CONCAT('message-',m.id) id,m.subject title,LEFT(m.body,180) subtitle,'MESSAGE' resultType,m.delivery_status status,CONCAT(m.subject,' ',m.body,' ',m.message_type,' ',m.delivery_status) keywords,'/messages' route FROM messages m WHERE m.school_id=? ORDER BY m.created_at DESC LIMIT ?`, [schoolId, candidateLimit]) : Promise.resolve([[]]),
  }

  const entries = await Promise.all(Object.entries(jobs).map(async ([key, job]) => [key, rows(await job)]))
  const candidateGroups = entries.map(([type, candidates]) => {
    const ranked = rankSearchResults(candidates.map((row) => ({ ...row, id: String(row.id), groupType: type })), interpretation, limit)
    const label = { students: "Learners", guardians: "Parents and Guardians", classes: "Classes", teachers: "Teachers", subjects: "Subjects", fees: "Fees", discounts: "Discounts", leave: "Staff Leave", payroll: "Payroll", attendance: "Attendance", homework: "Homework", assessments: "Assessments", results: "Results", support: "Learner Support", calendar: "Calendar", messages: "Messages" }[type] || type
    return { type, label, results: ranked.map((row) => ({ ...row, groupLabel: label, matchedField: row.matchedField || "best semantic match" })) }
  }).filter((group) => group.results.length)

  const navigation = navigationResults(user, permissions, interpretation)
  if (navigation.length) candidateGroups.unshift({ type: "navigation", label: "Navigation", results: navigation })
  const ranked = rankSearchResults(candidateGroups.flatMap((group) => group.results), interpretation, limit)
  const rankedKeys = new Set(ranked.map((result) => `${result.groupType}:${result.id}`))
  const groups = candidateGroups.map((group) => ({
    ...group,
    results: group.results.filter((result) => rankedKeys.has(`${result.groupType}:${result.id}`)),
  })).filter((group) => group.results.length)
  return { groups, results: ranked, total: ranked.length }
}
