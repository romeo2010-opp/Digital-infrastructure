package com.example.smartlink.ui

import android.content.Intent
import androidx.core.content.FileProvider
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.smartlink.navigation.StudentRoute
import com.example.smartlink.ui.components.*
import com.example.smartlink.ui.screens.*
import com.example.smartlink.ui.state.SchoolsUiState
import com.example.smartlink.ui.viewmodel.SchoolsViewModel
import java.io.File

@Composable fun SmartlinkSchoolsApp(viewModel: SchoolsViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    when {
        state.session == null -> SchoolLoginScreen(state.isLoading, state.error) { id, pass, student -> viewModel.signIn(id, pass, student) }
        state.session!!.isStudent -> StudentWorkspace(state, viewModel)
        else -> StaffWorkspace(state, viewModel)
    }
}

@Composable private fun StudentWorkspace(state: SchoolsUiState, viewModel: SchoolsViewModel) {
    val context = LocalContext.current
    var route by rememberSaveable { mutableStateOf(StudentRoute.Home) }
    Scaffold(bottomBar = { NavigationBar { StudentRoute.entries.forEach { item -> NavigationBarItem(route == item, { route = item; if (item == StudentRoute.Drills) viewModel.loadDrill() }, icon = { Icon(icon(item), item.label) }, label = { Text(item.label) }) } } }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) { when { state.isLoading && state.studentPortal == null -> SmartLinkLoadingState(); state.error != null && state.studentPortal == null -> SmartLinkErrorState(state.error, viewModel::refresh); state.studentPortal != null -> when(route) { StudentRoute.Home -> StudentHomeScreen(state.studentPortal!!, viewModel::refresh); StudentRoute.Results -> StudentResultsScreen(state.studentPortal!!) { viewModel.downloadReport(it, context) }; StudentRoute.Drills -> StudentDrillScreen(state.drill, state.isLoading, viewModel::loadDrill, viewModel::saveDrillAnswer, viewModel::submitDrill); StudentRoute.Notices -> StudentNoticesScreen(state.studentPortal!!, viewModel::reactToAnnouncement); StudentRoute.Profile -> StudentProfileScreen(state.studentPortal!!, viewModel::signOut) }; else -> SmartLinkEmptyState("Your school information will appear here.") }; state.successMessage?.let { Snackbar(Modifier.padding(16.dp)) { Text(it) } } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun StaffWorkspace(state: SchoolsUiState, viewModel: SchoolsViewModel) = Scaffold(topBar = { TopAppBar(title = { Text("SmartLink Schools", fontWeight = FontWeight.Medium) }, actions = { IconButton(viewModel::refresh) { Icon(Icons.Default.Refresh, "Refresh") } }) }) { padding -> Box(Modifier.fillMaxSize().padding(padding)) { when { state.isLoading && state.dashboard == null -> SmartLinkLoadingState(); state.error != null && state.dashboard == null -> SmartLinkErrorState(state.error, viewModel::refresh); state.dashboard != null -> StaffDashboard(state, viewModel::signOut); else -> SmartLinkEmptyState("Your school dashboard will appear here.") } } }
@Composable private fun StaffDashboard(state: SchoolsUiState, signOut: () -> Unit) { val d = state.dashboard!!; Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { SmartLinkSectionHeader("School command centre", state.session!!.schoolName); Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { SmartLinkStatCard("Students", d.students, Icons.Default.Groups, Modifier.weight(1f)); SmartLinkStatCard("Attendance", d.attendance, Icons.Default.FactCheck, Modifier.weight(1f)) }; Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { SmartLinkStatCard("Fee balance", d.balances, Icons.Default.ReceiptLong, Modifier.weight(1f)); SmartLinkStatCard("Notices", d.notices, Icons.Default.Notifications, Modifier.weight(1f)) }; SmartLinkDashboardCard("School operations", "Students, fees, attendance, homework and assessment insight are managed in this workspace.") { Text("Role-aware modules can be expanded from the API as permissions are added.", style = MaterialTheme.typography.bodySmall) }; OutlinedButton(signOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") } } }
private fun icon(route: StudentRoute) = when(route) { StudentRoute.Home -> Icons.Default.Home; StudentRoute.Results -> Icons.Default.BarChart; StudentRoute.Drills -> Icons.Default.Psychology; StudentRoute.Notices -> Icons.Default.Notifications; StudentRoute.Profile -> Icons.Default.Person }
