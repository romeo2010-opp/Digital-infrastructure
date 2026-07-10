package com.example.smartlink.data.repository

import android.content.Context
import com.example.smartlink.data.network.SchoolsApiClient
import com.example.smartlink.data.network.text
import com.example.smartlink.domain.model.*
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
    fun signOut()
}

class RemoteSchoolsRepository(context: Context) : SchoolsRepository {
    private val api = SchoolsApiClient(context)
    override suspend fun restoreSession() = api.session()?.toDomain()
    override suspend fun signIn(identifier: String, password: String, studentLogin: Boolean) = api.login(identifier, password, studentLogin).toDomain()
    override fun signOut() = api.clear()
    override suspend fun studentPortal(token: String): StudentPortal = api.studentPortal(token).toStudentPortal()
    override suspend fun todayDrill(token: String) = api.todayDrill(token).child("drill").takeUnless { it.isEmpty() }?.toDailyDrill()
    override suspend fun saveDrillAnswer(token: String, drillId: String, questionId: String, answer: String) { api.answerDrill(token, drillId, questionId, answer) }
    override suspend fun submitDrill(token: String, drillId: String) = api.submitDrill(token, drillId).child("drill").takeUnless { it.isEmpty() }?.toDailyDrill()
    override suspend fun reactToAnnouncement(token: String, announcementId: String, reaction: String) { api.reactToAnnouncement(token, announcementId, reaction) }
    override suspend fun reportPdf(token: String, reportId: String) = api.downloadReportCard(token, reportId)
    override suspend fun schoolDashboard(token: String): SchoolDashboard {
        val root = api.dashboard(token); val summary = root.child("summary").or(root.child("metrics"))
        return SchoolDashboard(summary.value("students", "totalStudents"), summary.value("attendance", "attendanceRate"), summary.value("outstanding", "arrears"), summary.value("notices", "notifications"))
    }
}

private fun SchoolsApiClient.Session.toDomain() = SchoolSession(token, name, role, school)
private fun JsonObject.toStudentPortal(): StudentPortal {
    val profile = child("profile")
    val results = child("results")
    val fees = child("fees").child("summary")
    val attendance = child("attendance")
    return StudentPortal(
        StudentProfile(profile.value("full_name", "name"), profile.value("admission_no", "student_id"), profile.value("class_name")),
        listOf(StudentMetric("Average", results.value("average", "overall_average", "percentage")), StudentMetric("Attendance", attendance.value("percentage", "attendance_rate")), StudentMetric("Fee balance", money(fees.value("outstanding_balance", "balance"))), StudentMetric("Class rank", results.value("rank", "class_rank"))),
        items("results", "subjects", "items").map { SchoolListItem(it.value("id"), it.value("subject_name", "subject", "name").ifBlank { "Subject" }, it.values("score", "percentage", "grade", "remark"), it.value("status")) },
        child("results").child("latest_report").takeUnless { it.isEmpty() }?.let { ReportCard(it.value("report_card_id", "id"), it.value("exam_session_name", "term_name").ifBlank { "Latest report" }, it.value("average_score"), it.value("position")) },
        items("homework", "assignments").map { SchoolListItem(it.value("id"), it.value("title", "subject").ifBlank { "Homework" }, it.values("due_date", "dueDate", "description"), it.value("submission_status", "status")) },
        items("timetable", "entries").map { SchoolListItem(it.value("id"), it.value("subject_name", "subject", "title").ifBlank { "Lesson" }, it.values("exam_date", "day", "start_time", "time", "room", "facility_name"), it.value("status")) },
        items("notices", "items").filter { it.value("source") == "announcement" }.map { Announcement(it.value("id"), it.value("title"), it.value("body"), it.value("date"), (it["reactions"] as? JsonArray)?.mapNotNull { item -> item.toString().trim('"').takeIf(String::isNotBlank) } ?: listOf("Like", "Love", "Seen"), it.value("my_reaction")) },
    )
}
private fun JsonObject.toDailyDrill() = DailyDrill(value("id"), value("subject_name").ifBlank { "Daily practice" }, value("focus_topic_name").ifBlank { "Daily review" }, value("status"), items("questions").map { question -> DrillQuestion(question.value("session_question_id"), question.value("question_text"), question.value("question_type"), questionOptions(question), question.value("student_answer")) }, value("score"), value("percentage"))
private fun questionOptions(question: JsonObject): List<String> { val raw = question["options"] ?: question["answer_options"] ?: return emptyList(); return when (raw) { is JsonArray -> raw.map { item -> if (item is JsonObject) item.value("text", "label", "value") else item.toString().trim('"') }; else -> emptyList() }.filter { it.isNotBlank() } }
private fun JsonObject.child(key: String) = this[key] as? JsonObject ?: JsonObject(emptyMap())
private fun JsonObject.or(other: JsonObject) = if (isEmpty()) other else this
private fun JsonObject.value(vararg keys: String) = keys.asSequence().map { text(it).ifBlank { this[it]?.toString()?.trim('"') ?: "" } }.firstOrNull { it.isNotBlank() }.orEmpty()
private fun JsonObject.values(vararg keys: String) = keys.map { value(it) }.filter { it.isNotBlank() }.joinToString(" · ")
private fun JsonObject.items(vararg path: String): List<JsonObject> { var node = this; path.dropLast(1).forEach { node = node.child(it) }; return (node[path.last()] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList() }
private fun money(raw: String) = raw.toDoubleOrNull()?.let { "MWK ${"%,.0f".format(it)}" } ?: raw
