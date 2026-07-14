package com.example.smartlink.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.smartlink.domain.model.SchoolSession
import com.example.smartlink.domain.model.StaffModule
import com.example.smartlink.domain.model.StaffWorkspace
import com.example.smartlink.navigation.StaffRoute
import com.example.smartlink.ui.components.SmartLinkDashboardCard
import com.example.smartlink.ui.components.SmartLinkEmptyState
import com.example.smartlink.ui.components.SmartLinkListItem
import com.example.smartlink.ui.components.SmartLinkMetricStrip
import com.example.smartlink.ui.components.SmartLinkSectionHeader
import com.example.smartlink.ui.theme.SmartLinkRadius
import com.example.smartlink.ui.theme.SmartLinkSpacing
import com.example.smartlink.ui.theme.SmartLinkTone

@Composable
fun StaffPortalScreen(
    session: SchoolSession,
    workspace: StaffWorkspace,
    route: StaffRoute,
    onRouteChange: (StaffRoute) -> Unit,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
) {
    LazyColumn(
        Modifier.fillMaxSize().padding(SmartLinkSpacing.page),
        verticalArrangement = Arrangement.spacedBy(SmartLinkSpacing.section),
    ) {
        item {
            StaffPortalTabs(route, session, onRouteChange)
        }
        item {
            StaffPortalHero(route, session, onRefresh)
        }
        when (route) {
            StaffRoute.Command -> {
                item {
                    SmartLinkMetricStrip(
                        metrics = workspace.heroMetrics,
                        icons = listOf(Icons.Default.Groups, Icons.Default.Checklist, Icons.Default.ReceiptLong, Icons.Default.Message),
                    )
                }
                item {
                    TodayPanel(workspace)
                }
                item {
                    PortalGrid(workspace)
                }
            }
            StaffRoute.Students -> moduleItems(workspace.operations.filter { it.key == "students" }, Icons.Default.Groups)
            StaffRoute.Attendance -> moduleItems(workspace.operations.filter { it.key == "attendance" }, Icons.Default.Checklist)
            StaffRoute.Finance -> moduleItems(workspace.finance, Icons.Default.ReceiptLong)
            StaffRoute.Learning -> moduleItems(workspace.learning, Icons.Default.Assignment)
            StaffRoute.Results -> moduleItems(workspace.learning.filter { it.key == "results" }, Icons.Default.BarChart)
            StaffRoute.Messages -> moduleItems(workspace.communication, Icons.Default.Message)
            StaffRoute.Settings -> item { SettingsPanel(session, onSignOut) }
        }
    }
}

private fun LazyColumnScopeModule.moduleItems(modules: List<StaffModule>, icon: ImageVector) {
    if (modules.isEmpty()) {
        item { SmartLinkEmptyState("This portal is available when your account has matching web permissions.") }
        return
    }
    modules.forEach { module ->
        item { StaffModulePanel(module, icon) }
    }
}

private typealias LazyColumnScopeModule = androidx.compose.foundation.lazy.LazyListScope

@Composable
private fun StaffPortalTabs(route: StaffRoute, session: SchoolSession, onRouteChange: (StaffRoute) -> Unit) {
    val routes = StaffRoute.entries.filter {
        when (it) {
            StaffRoute.Students, StaffRoute.Attendance -> !session.isBursar && (session.isTeacher || session.isLeadership)
            StaffRoute.Finance -> session.isBursar || session.isLeadership
            StaffRoute.Learning, StaffRoute.Results -> session.isTeacher || session.isLeadership
            StaffRoute.Messages -> !session.isBursar && (session.isTeacher || session.isLeadership)
            else -> true
        }
    }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(routes) { item ->
            FilterChip(
                selected = route == item,
                onClick = { onRouteChange(item) },
                label = { Text(item.label) },
                leadingIcon = { Icon(routeIcon(item), null) },
            )
        }
    }
}

@Composable
private fun StaffPortalHero(route: StaffRoute, session: SchoolSession, onRefresh: () -> Unit) {
    val accent = portalAccent(route)
    Surface(
        shape = RoundedCornerShape(SmartLinkRadius.hero),
        color = accent,
        border = BorderStroke(1.dp, accent.copy(alpha = 0.18f)),
    ) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text(route.portal.uppercase(), color = SmartLinkTone.Mint, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                    Text(portalTitle(route), color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                }
                IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "Refresh", tint = Color.White) }
            }
            Text(portalSubtitle(route, session.schoolName), color = Color.White.copy(alpha = 0.78f), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun TodayPanel(workspace: StaffWorkspace) {
    SmartLinkDashboardCard("Today", "Timetable, alerts and operational signals") {
        if (workspace.today.isEmpty()) {
            Text("Today intelligence appears here after timetable and alert packets are published.", color = SmartLinkTone.Muted, style = MaterialTheme.typography.bodySmall)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                workspace.today.take(4).forEach { SmartLinkListItem(it, Icons.Default.CalendarMonth) }
            }
        }
    }
}

@Composable
private fun PortalGrid(workspace: StaffWorkspace) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        (workspace.operations + workspace.finance + workspace.learning + workspace.communication).forEach { module ->
            SmartLinkDashboardCard(module.title, module.subtitle) {
                Button(
                    onClick = {},
                    enabled = false,
                    shape = RoundedCornerShape(SmartLinkRadius.control),
                    colors = ButtonDefaults.buttonColors(disabledContainerColor = SmartLinkTone.MutedPanel, disabledContentColor = SmartLinkTone.Muted),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(module.action) }
            }
        }
    }
}

@Composable
private fun StaffModulePanel(module: StaffModule, icon: ImageVector) {
    SmartLinkDashboardCard(module.title, module.subtitle) {
        if (module.metrics.isNotEmpty()) {
            SmartLinkMetricStrip(module.metrics, listOf(icon, Icons.Default.BarChart))
            Spacer(Modifier.height(12.dp))
        }
        if (module.rows.isEmpty()) {
            SmartLinkEmptyState("No ${module.title.lowercase()} records are available in this portal yet.", modifier = Modifier.height(220.dp))
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                module.rows.take(12).forEach { SmartLinkListItem(it, icon) }
            }
        }
    }
}

@Composable
private fun SettingsPanel(session: SchoolSession, onSignOut: () -> Unit) {
    SmartLinkDashboardCard("Workspace", "Profile, preferences, security and app session") {
        Text(session.name, color = SmartLinkTone.Ink, fontWeight = FontWeight.SemiBold)
        Text("${session.role} · ${session.schoolName}", color = SmartLinkTone.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 3.dp))
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = onSignOut,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = SmartLinkTone.Navy, contentColor = Color.White),
            shape = RoundedCornerShape(SmartLinkRadius.control),
        ) { Text("Sign out") }
    }
}

private fun routeIcon(route: StaffRoute) = when (route) {
    StaffRoute.Command -> Icons.Default.School
    StaffRoute.Students -> Icons.Default.Groups
    StaffRoute.Attendance -> Icons.Default.Checklist
    StaffRoute.Finance -> Icons.Default.ReceiptLong
    StaffRoute.Learning -> Icons.Default.Assignment
    StaffRoute.Results -> Icons.Default.BarChart
    StaffRoute.Messages -> Icons.Default.Inbox
    StaffRoute.Settings -> Icons.Default.Settings
}

private fun portalAccent(route: StaffRoute) = when (route) {
    StaffRoute.Finance -> SmartLinkTone.Bursar
    StaffRoute.Learning, StaffRoute.Results -> SmartLinkTone.Learning
    StaffRoute.Messages -> SmartLinkTone.Student
    else -> SmartLinkTone.Navy
}

private fun portalTitle(route: StaffRoute) = when (route) {
    StaffRoute.Command -> "School command centre"
    StaffRoute.Students -> "Student registry"
    StaffRoute.Attendance -> "Daily attendance"
    StaffRoute.Finance -> "Bursar dashboard"
    StaffRoute.Learning -> "Teaching & learning"
    StaffRoute.Results -> "Results entry"
    StaffRoute.Messages -> "Messages"
    StaffRoute.Settings -> "Settings"
}

private fun portalSubtitle(route: StaffRoute, schoolName: String) = when (route) {
    StaffRoute.Command -> "$schoolName operations, attendance, finance and academic health."
    StaffRoute.Students -> "Class placement, guardian contacts and learner support."
    StaffRoute.Attendance -> "Present, late, absent and unmarked learner follow-up."
    StaffRoute.Finance -> "Collections, arrears, receipts and account controls."
    StaffRoute.Learning -> "Homework, lesson activity, weak topics and academic support."
    StaffRoute.Results -> "Marks entry, assessment averages and report-card readiness."
    StaffRoute.Messages -> "Parent and staff communication from operational context."
    StaffRoute.Settings -> "Workspace preferences, account identity and security."
}
