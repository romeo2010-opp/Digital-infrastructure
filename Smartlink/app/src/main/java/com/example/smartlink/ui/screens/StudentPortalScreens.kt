package com.example.smartlink.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Wallet
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.smartlink.domain.model.DailyDrill
import com.example.smartlink.domain.model.SchoolListItem
import com.example.smartlink.domain.model.StaffMetric
import com.example.smartlink.domain.model.StudentPortal
import com.example.smartlink.ui.components.SmartLinkDashboardCard
import com.example.smartlink.ui.components.SmartLinkEmptyState
import com.example.smartlink.ui.components.SmartLinkListItem
import com.example.smartlink.ui.components.SmartLinkLoadingState
import com.example.smartlink.ui.components.SmartLinkMetricStrip
import com.example.smartlink.ui.components.SmartLinkSectionHeader
import com.example.smartlink.ui.theme.SmartLinkRadius
import com.example.smartlink.ui.theme.SmartLinkSpacing
import com.example.smartlink.ui.theme.SmartLinkTone

@Composable
fun StudentHomeScreen(portal: StudentPortal, onRefresh: () -> Unit) {
    val name = portal.profile.fullName.substringBefore(" ").ifBlank { "Student" }
    LazyColumn(
        Modifier.fillMaxSize().padding(SmartLinkSpacing.page),
        verticalArrangement = Arrangement.spacedBy(SmartLinkSpacing.section),
    ) {
        item {
            SmartLinkSectionHeader(
                title = "Hello, $name",
                subtitle = portal.profile.className,
                action = { IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "Refresh") } },
            )
        }
        item {
            Surface(
                shape = RoundedCornerShape(SmartLinkRadius.hero),
                color = SmartLinkTone.Student,
                border = BorderStroke(1.dp, SmartLinkTone.Student.copy(alpha = 0.16f)),
            ) {
                Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("SMARTLINK SCHOOLS", color = SmartLinkTone.Mint, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                    Text("Your learning space", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text("Results, fees, homework, attendance and school updates in one student portal.", color = Color.White.copy(alpha = 0.78f), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        item {
            SmartLinkMetricStrip(
                metrics = portal.metrics.map { StaffMetric(it.label, it.value.ifBlank { "-" }, "student portal") },
                icons = listOf(Icons.Default.BarChart, Icons.Default.FactCheck, Icons.Default.Wallet, Icons.Default.MenuBook),
            )
        }
        item {
            SmartLinkDashboardCard("Today", "Published school activity for this learner") {
                val rows = portal.timetable.take(2) + portal.homework.take(2)
                if (rows.isEmpty()) {
                    Text("Your school publishes timetable and homework updates here.", style = MaterialTheme.typography.bodySmall, color = SmartLinkTone.Muted)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        rows.forEach { SmartLinkListItem(it, Icons.Default.Schedule) }
                    }
                }
            }
        }
    }
}

@Composable
fun StudentResultsScreen(portal: StudentPortal, onDownloadReport: (String) -> Unit) {
    StudentListScreen(
        title = "Academic results",
        subtitle = "Published results and assessment feedback",
        items = portal.results,
        icon = Icons.Default.MenuBook,
        empty = "No published results yet.",
        header = {
            portal.latestReport?.let { report ->
                SmartLinkDashboardCard(report.title, "Average ${report.average.ifBlank { "-" }} · Position ${report.position.ifBlank { "-" }}") {
                    Button(
                        onClick = { onDownloadReport(report.id) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = SmartLinkTone.Navy, contentColor = Color.White),
                        shape = RoundedCornerShape(SmartLinkRadius.control),
                    ) {
                        Icon(Icons.Default.Download, null)
                        Spacer(Modifier.width(8.dp))
                        Text("Open report PDF")
                    }
                }
                Spacer(Modifier.height(12.dp))
            }
        },
    )
}

@Composable
fun StudentFeesScreen(portal: StudentPortal) = StudentListScreen(
    title = "Fees & payments",
    subtitle = "Balances, payment records and finance status",
    items = portal.fees,
    icon = Icons.Default.Wallet,
    empty = "No fee records are available yet.",
)

@Composable
fun StudentHomeworkScreen(portal: StudentPortal) = StudentListScreen(
    title = "Homework",
    subtitle = "Assignments, due dates and completion tracking",
    items = portal.homework,
    icon = Icons.Default.Assignment,
    empty = "No homework is due right now.",
)

@Composable
fun StudentAttendanceScreen(portal: StudentPortal) = StudentListScreen(
    title = "Attendance",
    subtitle = "Daily register and attendance trend",
    items = portal.attendance,
    icon = Icons.Default.FactCheck,
    empty = "No attendance records are available yet.",
)

@Composable
fun StudentTimetableScreen(portal: StudentPortal) = StudentListScreen(
    title = "Timetable",
    subtitle = "Published lessons, exams and school schedule",
    items = portal.timetable,
    icon = Icons.Default.Schedule,
    empty = "Your timetable will appear here.",
)

@Composable
fun StudentDrillScreen(
    drill: DailyDrill?,
    loading: Boolean,
    onLoad: () -> Unit,
    onSave: (String, String) -> Unit,
    onSubmit: () -> Unit,
) = Column(Modifier.fillMaxSize().padding(SmartLinkSpacing.page)) {
    SmartLinkSectionHeader(
        title = "Daily drills",
        subtitle = "Personalized practice from weak topics",
        action = { IconButton(onClick = onLoad) { Icon(Icons.Default.Refresh, "Refresh") } },
    )
    Spacer(Modifier.height(14.dp))
    if (loading && drill == null) {
        SmartLinkLoadingState("Loading daily drill")
    } else if (drill == null) {
        SmartLinkEmptyState("Daily practice will appear when approved questions are available.")
    } else {
        SmartLinkDashboardCard(drill.subject, drill.topic) {
            Text(if (drill.status == "completed") "Completed: ${drill.percentage.ifBlank { "-" }}%" else "${drill.questions.size} questions ready", color = SmartLinkTone.Text)
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.weight(1f)) {
            items(drill.questions) { question ->
                var answer by remember(question.sessionQuestionId) { mutableStateOf(question.savedAnswer) }
                SmartLinkDashboardCard(question.text, question.type.replace("_", " ")) {
                    if (question.options.isNotEmpty()) {
                        question.options.forEach { option ->
                            Row(
                                Modifier.fillMaxWidth().selectable(answer == option) {
                                    answer = option
                                    onSave(question.sessionQuestionId, option)
                                }.padding(vertical = 5.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(answer == option, null)
                                Text(option, modifier = Modifier.padding(start = 6.dp), color = SmartLinkTone.Text)
                            }
                        }
                    } else {
                        OutlinedTextField(answer, { answer = it }, label = { Text("Your answer") }, modifier = Modifier.fillMaxWidth())
                        Button(
                            onClick = { onSave(question.sessionQuestionId, answer) },
                            enabled = answer.isNotBlank() && drill.status != "completed",
                            modifier = Modifier.padding(top = 8.dp),
                            shape = RoundedCornerShape(SmartLinkRadius.control),
                        ) { Text("Save answer") }
                    }
                }
            }
        }
        if (drill.status != "completed") {
            Button(
                onClick = onSubmit,
                enabled = drill.questions.isNotEmpty() && !loading,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = SmartLinkTone.Navy, contentColor = Color.White),
                shape = RoundedCornerShape(SmartLinkRadius.control),
            ) {
                Icon(Icons.Default.Check, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Submit drill")
            }
        }
    }
}

@Composable
fun StudentNoticesScreen(portal: StudentPortal, onReact: (String, String) -> Unit) {
    Column(Modifier.fillMaxSize().padding(SmartLinkSpacing.page)) {
        SmartLinkSectionHeader("Notices", "School announcements and updates")
        Spacer(Modifier.height(16.dp))
        if (portal.announcements.isEmpty()) {
            SmartLinkEmptyState("No announcements are available.")
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(portal.announcements) { item ->
                    SmartLinkDashboardCard(item.title, item.date) {
                        Text(item.body, color = SmartLinkTone.Text, style = MaterialTheme.typography.bodyMedium)
                        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            item.reactions.forEach { reaction ->
                                FilterChip(selected = reaction == item.myReaction, onClick = { onReact(item.id, reaction) }, label = { Text(reaction) })
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun StudentProfileScreen(portal: StudentPortal, onSignOut: () -> Unit) = Column(Modifier.fillMaxSize().padding(SmartLinkSpacing.page)) {
    SmartLinkSectionHeader("My profile", "Your school identity")
    Spacer(Modifier.height(18.dp))
    SmartLinkDashboardCard(portal.profile.fullName, portal.profile.className) {
        Text("Admission no. ${portal.profile.admissionNumber.ifBlank { "Not recorded" }}", style = MaterialTheme.typography.bodyMedium, color = SmartLinkTone.Text)
    }
    Spacer(Modifier.height(18.dp))
    OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(SmartLinkRadius.control)) {
        Icon(Icons.Default.Logout, null)
        Spacer(Modifier.width(8.dp))
        Text("Sign out")
    }
}

@Composable
private fun StudentListScreen(
    title: String,
    subtitle: String,
    items: List<SchoolListItem>,
    icon: ImageVector,
    empty: String,
    header: @Composable ColumnScope.() -> Unit = {},
) = Column(Modifier.fillMaxSize().padding(SmartLinkSpacing.page)) {
    SmartLinkSectionHeader(title, subtitle)
    Spacer(Modifier.height(14.dp))
    header()
    if (items.isEmpty()) {
        SmartLinkEmptyState(empty)
    } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(items) { SmartLinkListItem(it, icon) }
        }
    }
}
