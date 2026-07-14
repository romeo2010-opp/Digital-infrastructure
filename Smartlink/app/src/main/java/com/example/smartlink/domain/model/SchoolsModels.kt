package com.example.smartlink.domain.model

data class SchoolSession(val token: String, val name: String, val role: String, val schoolName: String) {
    val isStudent get() = role.equals("student", ignoreCase = true)
    val isBursar get() = role.equals("bursar", ignoreCase = true)
    val isTeacher get() = role.equals("teacher", ignoreCase = true)
    val isLeadership get() = listOf("school_owner", "headteacher", "super_admin", "staff").any { role.equals(it, ignoreCase = true) }
}
data class StudentProfile(val fullName: String, val admissionNumber: String, val className: String)
data class StudentMetric(val label: String, val value: String)
data class SchoolListItem(val id: String = "", val title: String, val detail: String, val status: String = "")
data class ReportCard(val id: String, val title: String, val average: String, val position: String)
data class Announcement(val id: String, val title: String, val body: String, val date: String, val reactions: List<String> = emptyList(), val myReaction: String = "")
data class DrillQuestion(val sessionQuestionId: String, val text: String, val type: String, val options: List<String>, val savedAnswer: String)
data class DailyDrill(val id: String, val subject: String, val topic: String, val status: String, val questions: List<DrillQuestion>, val score: String = "", val percentage: String = "")
data class StudentPortal(
    val profile: StudentProfile,
    val metrics: List<StudentMetric>,
    val results: List<SchoolListItem>,
    val latestReport: ReportCard?,
    val fees: List<SchoolListItem>,
    val attendance: List<SchoolListItem>,
    val homework: List<SchoolListItem>,
    val timetable: List<SchoolListItem>,
    val announcements: List<Announcement>,
)
data class SchoolDashboard(val students: String, val attendance: String, val balances: String, val notices: String)

data class StaffMetric(val label: String, val value: String, val helper: String = "", val tone: String = "neutral")
data class StaffModule(
    val key: String,
    val title: String,
    val subtitle: String,
    val action: String,
    val metrics: List<StaffMetric> = emptyList(),
    val rows: List<SchoolListItem> = emptyList(),
)
data class StaffWorkspace(
    val dashboard: SchoolDashboard,
    val heroMetrics: List<StaffMetric>,
    val operations: List<StaffModule>,
    val finance: List<StaffModule>,
    val learning: List<StaffModule>,
    val communication: List<StaffModule>,
    val today: List<SchoolListItem> = emptyList(),
)
