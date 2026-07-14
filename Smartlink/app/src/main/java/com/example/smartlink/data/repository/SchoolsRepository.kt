package com.example.smartlink.data.repository

import android.content.Context
import com.example.smartlink.data.network.SchoolsApiClient
import com.example.smartlink.data.network.text
import com.example.smartlink.domain.model.Announcement
import com.example.smartlink.domain.model.DailyDrill
import com.example.smartlink.domain.model.DrillQuestion
import com.example.smartlink.domain.model.ReportCard
import com.example.smartlink.domain.model.SchoolDashboard
import com.example.smartlink.domain.model.SchoolListItem
import com.example.smartlink.domain.model.SchoolSession
import com.example.smartlink.domain.model.StaffMetric
import com.example.smartlink.domain.model.StaffModule
import com.example.smartlink.domain.model.StaffWorkspace
import com.example.smartlink.domain.model.StudentMetric
import com.example.smartlink.domain.model.StudentPortal
import com.example.smartlink.domain.model.StudentProfile
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

interface SchoolsRepository {
    suspend fun restoreSession(): SchoolSession?
    suspend fun signIn(identifier: String, password: String, studentLogin: Boolean): SchoolSession
    suspend fun studentPortal(token: String): StudentPortal
    suspend fun todayDrill(token: String): DailyDrill?
    suspend fun saveDrillAnswer(token: String, drillId: String, questionId: String, answer: String)
    suspend fun submitDrill(token: String, drillId: String): DailyDrill?
    suspend fun reactToAnnouncement(token: String, announcementId: String, reaction: String)
    suspend fun reportPdf(token: String, reportId: String): ByteArray
    suspend fun schoolDashboard(token: String): SchoolDashboard
    suspend fun staffWorkspace(token: String): StaffWorkspace
    fun signOut()
}

class RemoteSchoolsRepository(context: Context) : SchoolsRepository {
    private val api = SchoolsApiClient(context)

    override suspend fun restoreSession() = api.session()?.toDomain()
    override suspend fun signIn(identifier: String, password: String, studentLogin: Boolean) = api.login(identifier, password, studentLogin).toDomain()
    override fun signOut() = api.clear()
    override suspend fun studentPortal(token: String): StudentPortal = api.studentPortal(token).toStudentPortal()
    override suspend fun todayDrill(token: String) = api.todayDrill(token).child("drill").takeUnless { it.isEmpty() }?.toDailyDrill()
    override suspend fun saveDrillAnswer(token: String, drillId: String, questionId: String, answer: String) {
        api.answerDrill(token, drillId, questionId, answer)
    }
    override suspend fun submitDrill(token: String, drillId: String) = api.submitDrill(token, drillId).child("drill").takeUnless { it.isEmpty() }?.toDailyDrill()
    override suspend fun reactToAnnouncement(token: String, announcementId: String, reaction: String) {
        api.reactToAnnouncement(token, announcementId, reaction)
    }
    override suspend fun reportPdf(token: String, reportId: String) = api.downloadReportCard(token, reportId)
    override suspend fun schoolDashboard(token: String): SchoolDashboard = api.dashboard(token).toSchoolDashboard()

    override suspend fun staffWorkspace(token: String): StaffWorkspace {
        val dashboard = safeObject { api.dashboard(token) }.toSchoolDashboard()
        val students = safeList { safeObject { api.students(token) }.rows("students").map(::studentRow) }
        val feeAccounts = safeList { safeObject { api.feeAccounts(token) }.rows("feeAccounts", "fee_accounts", "accounts").map(::feeRow) }
        val feesSummary = safeObject { api.fees(token) }.child("summary")
        val attendance = safeList { safeObject { api.attendance(token) }.rows("attendance").map(::attendanceRow) }
        val homework = safeList { safeObject { api.homework(token) }.rows("homework", "assignments").map(::homeworkRow) }
        val results = safeList { safeObject { api.results(token) }.rows("results").map(::resultRow) }
        val today = safeList { safeObject { api.schoolToday(token) }.toTodayRows() }
        val notifications = safeList { safeObject { api.notifications(token) }.rows("notifications", "items").map(::notificationRow) }

        val outstanding = feeAccounts.count { !it.status.equals("paid", ignoreCase = true) }
        val present = attendance.count { it.status.equals("present", ignoreCase = true) }
        val absent = attendance.count { it.status.equals("absent", ignoreCase = true) || it.status.equals("late", ignoreCase = true) }
        val marked = attendance.count { !it.status.equals("unmarked", ignoreCase = true) }
        val attendanceRate = if (marked > 0) "${((present.toDouble() / marked.toDouble()) * 100).formatPercent()}%" else dashboard.attendance.ifBlank { "0%" }
        val balanceValue = feesSummary.value("outstandingBalance", "outstanding_balance").ifBlank { dashboard.balances }

        val hero = listOf(
            StaffMetric("Students", dashboard.students.ifBlank { students.size.toString() }, "active learner scope", "neutral"),
            StaffMetric("Attendance", attendanceRate, "today's marked register", if (absent > 0) "warn" else "good"),
            StaffMetric("Outstanding", money(balanceValue), "bursar balance queue", if (outstanding > 0) "warn" else "good"),
            StaffMetric("Notices", dashboard.notices.ifBlank { notifications.size.toString() }, "school communication", "neutral"),
        )

        return StaffWorkspace(
            dashboard = dashboard,
            heroMetrics = hero,
            operations = listOf(
                StaffModule(
                    key = "students",
                    title = "Students",
                    subtitle = "Student registry, guardians, class placement and fee status.",
                    action = "Add student",
                    metrics = listOf(
                        StaffMetric("Visible", students.size.toString(), "learners", "neutral"),
                        StaffMetric("With balances", students.count { it.detail.contains("MWK", ignoreCase = true) }.toString(), "fee linked", "warn"),
                    ),
                    rows = students,
                ),
                StaffModule(
                    key = "attendance",
                    title = "Attendance",
                    subtitle = "Daily register with present, late, absent and unmarked states.",
                    action = "Save register",
                    metrics = listOf(
                        StaffMetric("Present", present.toString(), "today", "good"),
                        StaffMetric("Follow up", absent.toString(), "late or absent", if (absent > 0) "warn" else "good"),
                    ),
                    rows = attendance,
                ),
            ),
            finance = listOf(
                StaffModule(
                    key = "finance",
                    title = "Bursar Dashboard",
                    subtitle = "Collections, accounts, invoices, receipts and arrears follow-up.",
                    action = "Record payment",
                    metrics = listOf(
                        StaffMetric("Accounts", feeAccounts.size.toString(), "fee accounts", "neutral"),
                        StaffMetric("Outstanding", money(balanceValue), "current term", if (outstanding > 0) "warn" else "good"),
                    ),
                    rows = feeAccounts,
                ),
            ),
            learning = listOf(
                StaffModule(
                    key = "homework",
                    title = "Homework",
                    subtitle = "Assignments, due dates, submissions and parent reminders.",
                    action = "Create homework",
                    metrics = listOf(
                        StaffMetric("Assignments", homework.size.toString(), "this term", "neutral"),
                        StaffMetric("Pending", homework.count { !it.status.equals("completed", ignoreCase = true) }.toString(), "open work", "warn"),
                    ),
                    rows = homework,
                ),
                StaffModule(
                    key = "results",
                    title = "Results",
                    subtitle = "Marks entry, averages, report-card readiness and academic review.",
                    action = "Enter marks",
                    metrics = listOf(
                        StaffMetric("Assessments", results.size.toString(), "active term", "neutral"),
                        StaffMetric("Marked", results.count { it.detail.contains("marked", ignoreCase = true) }.toString(), "with scores", "good"),
                    ),
                    rows = results,
                ),
            ),
            communication = listOf(
                StaffModule(
                    key = "messages",
                    title = "Messages",
                    subtitle = "Parent and staff communication for fees, homework and attendance.",
                    action = "Compose",
                    metrics = listOf(StaffMetric("Inbox", notifications.size.toString(), "recent notices", "neutral")),
                    rows = notifications,
                ),
            ),
            today = today,
        )
    }
}

private fun SchoolsApiClient.Session.toDomain() = SchoolSession(token, name, role, school)

private fun JsonObject.toSchoolDashboard(): SchoolDashboard {
    val summary = child("summary").or(child("metrics")).or(this)
    return SchoolDashboard(
        students = summary.value("students", "totalStudents", "total_students", "studentCount"),
        attendance = summary.value("attendance", "attendanceRate", "attendance_rate"),
        balances = summary.value("outstanding", "arrears", "outstandingBalance", "outstanding_balance"),
        notices = summary.value("notices", "notifications", "messageCount", "message_count"),
    )
}

private fun JsonObject.toStudentPortal(): StudentPortal {
    val profile = child("profile")
    val results = child("results")
    val fees = child("fees")
    val feesSummary = fees.child("summary")
    val attendance = child("attendance")
    return StudentPortal(
        profile = StudentProfile(profile.value("full_name", "fullName", "name"), profile.value("admission_no", "student_id", "studentCode"), profile.value("class_name", "className")),
        metrics = listOf(
            StudentMetric("Average", results.value("average", "overall_average", "percentage")),
            StudentMetric("Attendance", attendance.value("percentage", "attendance_rate")),
            StudentMetric("Fee balance", money(feesSummary.value("outstanding_balance", "balance", "outstandingBalance"))),
            StudentMetric("Class rank", results.value("rank", "class_rank")),
        ),
        results = rowsFrom("results", "subjects", "items").map { SchoolListItem(it.value("id"), it.value("subject_name", "subject", "name").ifBlank { "Subject" }, it.values("score", "percentage", "grade", "remark"), it.value("status")) },
        latestReport = child("results").child("latest_report").takeUnless { it.isEmpty() }?.let { ReportCard(it.value("report_card_id", "id"), it.value("exam_session_name", "term_name").ifBlank { "Latest report" }, it.value("average_score", "average"), it.value("position", "rank")) },
        fees = fees.rows("accounts", "items", "feeAccounts").map(::feeRow).ifEmpty {
            listOf(SchoolListItem("fees", "Current balance", money(feesSummary.value("outstanding_balance", "balance", "outstandingBalance")), feesSummary.value("status")))
        },
        attendance = attendance.rows("records", "items", "attendance").map(::attendanceRow).ifEmpty {
            listOf(SchoolListItem("attendance", "Attendance this term", attendance.value("percentage", "attendance_rate"), attendance.value("status")))
        },
        homework = rowsFrom("homework", "assignments").map { SchoolListItem(it.value("id"), it.value("title", "subject").ifBlank { "Homework" }, it.values("due_date", "dueDate", "description", "subject_name"), it.value("submission_status", "status")) },
        timetable = rowsFrom("timetable", "entries").map { SchoolListItem(it.value("id"), it.value("subject_name", "subject", "title").ifBlank { "Lesson" }, it.values("exam_date", "day", "start_time", "time", "room", "facility_name"), it.value("status")) },
        announcements = rowsFrom("notices", "items")
            .filter { it.value("source").ifBlank { "announcement" } == "announcement" }
            .map {
                Announcement(
                    id = it.value("id"),
                    title = it.value("title"),
                    body = it.value("body", "message"),
                    date = it.value("date", "created_at"),
                    reactions = (it["reactions"] as? JsonArray)?.mapNotNull { item -> item.toString().trim('"').takeIf(String::isNotBlank) } ?: listOf("Like", "Love", "Seen"),
                    myReaction = it.value("my_reaction", "myReaction"),
                )
            },
    )
}

private fun JsonObject.toDailyDrill() = DailyDrill(
    id = value("id"),
    subject = value("subject_name", "subject").ifBlank { "Daily practice" },
    topic = value("focus_topic_name", "topic").ifBlank { "Daily review" },
    status = value("status"),
    questions = rows("questions").map { question ->
        DrillQuestion(
            sessionQuestionId = question.value("session_question_id", "id"),
            text = question.value("question_text", "text"),
            type = question.value("question_type", "type"),
            options = questionOptions(question),
            savedAnswer = question.value("student_answer", "answer"),
        )
    },
    score = value("score"),
    percentage = value("percentage"),
)

private fun studentRow(row: JsonObject): SchoolListItem {
    val fullName = row.name().ifBlank { "Student" }
    val detail = listOf(row.value("class_name", "className"), row.value("admission_no", "student_code", "student_id"), money(row.value("fee_balance", "balance"))).filter { it.isNotBlank() }.joinToString(" · ")
    return SchoolListItem(row.value("id", "student_id"), fullName, detail, row.value("status").ifBlank { "active" })
}

private fun feeRow(row: JsonObject): SchoolListItem {
    val fullName = row.name().ifBlank { row.value("student_name", "student") }.ifBlank { "Student account" }
    val detail = listOf(row.value("class_name", "className"), row.value("term_name", "termName"), money(row.value("balance", "outstanding_balance", "amount_due"))).filter { it.isNotBlank() }.joinToString(" · ")
    return SchoolListItem(row.value("id"), fullName, detail, row.value("status").ifBlank { if (detail.contains("MWK 0")) "paid" else "open" })
}

private fun attendanceRow(row: JsonObject): SchoolListItem {
    val title = row.name().ifBlank { row.value("student", "student_name").ifBlank { "Attendance record" } }
    val detail = listOf(row.value("class_name", "className"), row.value("attendance_date", "date"), row.value("note")).filter { it.isNotBlank() }.joinToString(" · ")
    return SchoolListItem(row.value("student_id", "id"), title, detail, row.value("status").ifBlank { "unmarked" })
}

private fun homeworkRow(row: JsonObject): SchoolListItem {
    val counts = listOf(row.value("assigned_count", "assigned"), row.value("submitted_count", "submitted")).filter { it.isNotBlank() }
    val detail = listOf(row.value("class_name", "className"), row.value("subject_name", "subject"), row.value("due_date", "dueDate"), counts.joinToString("/").takeIf { it.isNotBlank() }?.let { "$it submitted" }).filterNotNull().filter { it.isNotBlank() }.joinToString(" · ")
    return SchoolListItem(row.value("id"), row.value("title").ifBlank { "Homework" }, detail, row.value("status").ifBlank { "pending" })
}

private fun resultRow(row: JsonObject): SchoolListItem {
    val detail = listOf(row.value("exam_session_name", "examSession"), row.value("class_name", "className"), row.value("subject_name", "subject"), row.value("average_score", "average").takeIf { it.isNotBlank() }?.let { "$it% avg" }, row.value("marked_students", "markedStudents").takeIf { it.isNotBlank() }?.let { "$it marked" }).filterNotNull().filter { it.isNotBlank() }.joinToString(" · ")
    return SchoolListItem(row.value("id"), row.value("assessment_name", "assessment", "name").ifBlank { "Assessment" }, detail, row.value("status"))
}

private fun notificationRow(row: JsonObject) = SchoolListItem(
    id = row.value("id"),
    title = row.value("title", "subject").ifBlank { "School notice" },
    detail = row.values("body", "message", "created_at", "date"),
    status = row.value("status", "type"),
)

private fun JsonObject.toTodayRows(): List<SchoolListItem> {
    val lessons = rows("currentLessons", "current_lessons", "lessons", "items").map {
        SchoolListItem(it.value("id"), it.value("subject_name", "subject", "title").ifBlank { "Lesson" }, it.values("class_name", "teacher_name", "start_time", "end_time", "room"), it.value("status").ifBlank { "today" })
    }
    val alerts = rows("alerts", "notifications").map(::notificationRow)
    return lessons + alerts
}

private fun questionOptions(question: JsonObject): List<String> {
    val raw = question["options"] ?: question["answer_options"] ?: return emptyList()
    return when (raw) {
        is JsonArray -> raw.map { item -> if (item is JsonObject) item.value("text", "label", "value") else item.toString().trim('"') }
        else -> emptyList()
    }.filter { it.isNotBlank() }
}

private suspend fun safeObject(loader: suspend () -> JsonObject): JsonObject = runCatching { loader() }.getOrDefault(JsonObject(emptyMap()))
private suspend fun <T> safeList(loader: suspend () -> List<T>): List<T> = runCatching { loader() }.getOrDefault(emptyList())

private fun JsonObject.child(key: String) = this[key] as? JsonObject ?: JsonObject(emptyMap())
private fun JsonObject.or(other: JsonObject) = if (isEmpty()) other else this
private fun JsonObject.rows(vararg keys: String): List<JsonObject> {
    keys.forEach { key ->
        val value = this[key]
        if (value is JsonArray) return value.mapNotNull { it as? JsonObject }
        if (value is JsonObject) {
            val nested = value.rows("items", "records", "rows")
            if (nested.isNotEmpty()) return nested
        }
    }
    return emptyList()
}

private fun JsonObject.rowsFrom(vararg path: String): List<JsonObject> {
    var node = this
    path.dropLast(1).forEach { node = node.child(it) }
    return node.rows(path.last())
}

private fun JsonObject.value(vararg keys: String) = keys.asSequence()
    .map { key -> text(key).ifBlank { this[key]?.toString()?.trim('"') ?: "" } }
    .firstOrNull { it.isNotBlank() && it != "null" }
    .orEmpty()

private fun JsonObject.values(vararg keys: String) = keys.map { value(it) }.filter { it.isNotBlank() }.joinToString(" · ")

private fun JsonObject.name(): String {
    val direct = value("full_name", "fullName", "name")
    if (direct.isNotBlank()) return direct
    return listOf(value("first_name", "firstName"), value("last_name", "lastName")).filter { it.isNotBlank() }.joinToString(" ")
}

private fun money(raw: String): String {
    val clean = raw.replace(",", "").removePrefix("MWK").removePrefix("MK").trim()
    return clean.toDoubleOrNull()?.let { "MWK ${"%,.0f".format(it)}" } ?: raw
}

private fun Double.formatPercent(): String = if (isFinite()) "%.1f".format(this) else "0.0"
