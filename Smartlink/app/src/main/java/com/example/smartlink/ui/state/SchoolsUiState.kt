package com.example.smartlink.ui.state

import com.example.smartlink.domain.model.SchoolDashboard
import com.example.smartlink.domain.model.SchoolSession
import com.example.smartlink.domain.model.StudentPortal
import com.example.smartlink.domain.model.DailyDrill

data class SchoolsUiState(
    val session: SchoolSession? = null,
    val studentPortal: StudentPortal? = null,
    val dashboard: SchoolDashboard? = null,
    val drill: DailyDrill? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val successMessage: String? = null,
) { val isEmpty get() = !isLoading && studentPortal == null && dashboard == null && error == null }
