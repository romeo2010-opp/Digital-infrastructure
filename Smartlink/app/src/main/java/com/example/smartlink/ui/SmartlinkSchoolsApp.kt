package com.example.smartlink.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Wallet
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.smartlink.navigation.StaffRoute
import com.example.smartlink.navigation.StudentRoute
import com.example.smartlink.ui.components.SmartLinkEmptyState
import com.example.smartlink.ui.components.SmartLinkErrorState
import com.example.smartlink.ui.components.SmartLinkLoadingState
import com.example.smartlink.ui.screens.SchoolLoginScreen
import com.example.smartlink.ui.screens.StaffPortalScreen
import com.example.smartlink.ui.screens.StudentAttendanceScreen
import com.example.smartlink.ui.screens.StudentDrillScreen
import com.example.smartlink.ui.screens.StudentFeesScreen
import com.example.smartlink.ui.screens.StudentHomeScreen
import com.example.smartlink.ui.screens.StudentHomeworkScreen
import com.example.smartlink.ui.screens.StudentNoticesScreen
import com.example.smartlink.ui.screens.StudentProfileScreen
import com.example.smartlink.ui.screens.StudentResultsScreen
import com.example.smartlink.ui.screens.StudentTimetableScreen
import com.example.smartlink.ui.state.SchoolsUiState
import com.example.smartlink.ui.theme.SmartLinkTone
import com.example.smartlink.ui.viewmodel.SchoolsViewModel

@Composable
fun SmartlinkSchoolsApp(viewModel: SchoolsViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()
    when {
        state.session == null -> SchoolLoginScreen(state.isLoading, state.error) { id, pass, student -> viewModel.signIn(id, pass, student) }
        state.session?.isStudent == true -> StudentWorkspace(state, viewModel)
        else -> StaffWorkspace(state, viewModel)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StudentWorkspace(state: SchoolsUiState, viewModel: SchoolsViewModel) {
    val context = LocalContext.current
    var route by rememberSaveable { mutableStateOf(StudentRoute.Home) }
    Scaffold(
        containerColor = SmartLinkTone.AppBg,
        topBar = {
            SmartLinkTopBar(
                title = "Student portal",
                subtitle = state.session?.schoolName.orEmpty(),
                onRefresh = viewModel::refresh,
                onSignOut = viewModel::signOut,
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.isLoading && state.studentPortal == null -> SmartLinkLoadingState()
                state.error != null && state.studentPortal == null -> SmartLinkErrorState(state.error, viewModel::refresh)
                state.studentPortal != null -> {
                    val portal = state.studentPortal
                    androidx.compose.foundation.layout.Column(Modifier.fillMaxSize()) {
                        StudentRouteTabs(route) {
                            route = it
                            if (it == StudentRoute.Drills) viewModel.loadDrill()
                        }
                        Box(Modifier.weight(1f)) {
                            when (route) {
                                StudentRoute.Home -> StudentHomeScreen(portal, viewModel::refresh)
                                StudentRoute.Results -> StudentResultsScreen(portal) { viewModel.downloadReport(it, context) }
                                StudentRoute.Fees -> StudentFeesScreen(portal)
                                StudentRoute.Homework -> StudentHomeworkScreen(portal)
                                StudentRoute.Attendance -> StudentAttendanceScreen(portal)
                                StudentRoute.Timetable -> StudentTimetableScreen(portal)
                                StudentRoute.Drills -> StudentDrillScreen(state.drill, state.isLoading, viewModel::loadDrill, viewModel::saveDrillAnswer, viewModel::submitDrill)
                                StudentRoute.Notices -> StudentNoticesScreen(portal, viewModel::reactToAnnouncement)
                                StudentRoute.Profile -> StudentProfileScreen(portal, viewModel::signOut)
                            }
                        }
                    }
                }
                else -> SmartLinkEmptyState("Your school information will appear here.")
            }
            state.successMessage?.let { Snackbar(Modifier.padding(16.dp)) { Text(it) } }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StaffWorkspace(state: SchoolsUiState, viewModel: SchoolsViewModel) {
    var route by rememberSaveable(state.session?.role) { mutableStateOf(if (state.session?.isBursar == true) StaffRoute.Finance else StaffRoute.Command) }
    Scaffold(
        containerColor = SmartLinkTone.AppBg,
        topBar = {
            SmartLinkTopBar(
                title = "SmartLink Schools",
                subtitle = state.session?.schoolName.orEmpty(),
                onRefresh = viewModel::refresh,
                onSignOut = viewModel::signOut,
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.isLoading && state.staffWorkspace == null -> SmartLinkLoadingState()
                state.error != null && state.staffWorkspace == null -> SmartLinkErrorState(state.error, viewModel::refresh)
                state.staffWorkspace != null && state.session != null -> {
                    val session = state.session
                    val workspace = state.staffWorkspace
                    StaffPortalScreen(
                        session = session,
                        workspace = workspace,
                        route = route,
                        onRouteChange = { route = it },
                        onRefresh = viewModel::refresh,
                        onSignOut = viewModel::signOut,
                    )
                }
                else -> SmartLinkEmptyState("Your school dashboard will appear here.")
            }
            state.successMessage?.let { Snackbar(Modifier.padding(16.dp)) { Text(it) } }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SmartLinkTopBar(title: String, subtitle: String, onRefresh: () -> Unit, onSignOut: () -> Unit) {
    TopAppBar(
        title = {
            androidx.compose.foundation.layout.Column {
                Text(title, fontWeight = FontWeight.SemiBold, color = SmartLinkTone.Ink, style = MaterialTheme.typography.titleMedium)
                if (subtitle.isNotBlank()) Text(subtitle, color = SmartLinkTone.Muted, style = MaterialTheme.typography.labelMedium)
            }
        },
        actions = {
            IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "Refresh", tint = SmartLinkTone.Muted) }
            IconButton(onClick = onSignOut) { Icon(Icons.Default.Logout, "Sign out", tint = SmartLinkTone.Muted) }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White),
    )
}

@Composable
private fun StudentRouteTabs(route: StudentRoute, onRouteChange: (StudentRoute) -> Unit) {
    LazyRow(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
        items(StudentRoute.entries) { item ->
            FilterChip(
                selected = route == item,
                onClick = { onRouteChange(item) },
                label = { Text(item.label) },
                leadingIcon = { Icon(studentIcon(item), null) },
                modifier = Modifier.padding(end = 8.dp),
            )
        }
    }
}

private fun studentIcon(route: StudentRoute): ImageVector = when (route) {
    StudentRoute.Home -> Icons.Default.Home
    StudentRoute.Results -> Icons.Default.BarChart
    StudentRoute.Fees -> Icons.Default.Wallet
    StudentRoute.Homework -> Icons.Default.MenuBook
    StudentRoute.Attendance -> Icons.Default.FactCheck
    StudentRoute.Timetable -> Icons.Default.Schedule
    StudentRoute.Drills -> Icons.Default.Psychology
    StudentRoute.Notices -> Icons.Default.Notifications
    StudentRoute.Profile -> Icons.Default.Person
}
