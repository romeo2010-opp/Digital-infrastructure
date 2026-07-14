package com.example.smartlink.ui.viewmodel

import android.app.Application
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.smartlink.data.repository.RemoteSchoolsRepository
import com.example.smartlink.data.repository.SchoolsRepository
import com.example.smartlink.domain.model.SchoolSession
import com.example.smartlink.ui.state.SchoolsUiState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File

class SchoolsViewModel(application: Application) : AndroidViewModel(application) {
    private val repository: SchoolsRepository = RemoteSchoolsRepository(application)
    private val mutableState = MutableStateFlow(SchoolsUiState(isLoading = true))
    val state: StateFlow<SchoolsUiState> = mutableState.asStateFlow()

    init { viewModelScope.launch { val saved = repository.restoreSession(); if (saved != null) loadWorkspace(saved) else mutableState.value = SchoolsUiState() } }
    fun signIn(identifier: String, password: String, studentLogin: Boolean) = viewModelScope.launch {
        mutableState.value = SchoolsUiState(isLoading = true)
        try { loadWorkspace(repository.signIn(identifier, password, studentLogin)) } catch (error: Throwable) { mutableState.value = SchoolsUiState(error = error.message ?: "Sign in was unsuccessful.") }
    }
    fun refresh() { mutableState.value.session?.let { viewModelScope.launch { loadWorkspace(it, refreshing = true) } } }
    fun dismissMessage() { mutableState.value = mutableState.value.copy(error = null, successMessage = null) }
    fun signOut() { repository.signOut(); mutableState.value = SchoolsUiState(successMessage = "Signed out successfully.") }
    fun loadDrill() { val session = mutableState.value.session ?: return; viewModelScope.launch { mutableState.value = mutableState.value.copy(isLoading = true, error = null); runCatching { repository.todayDrill(session.token) }.onSuccess { mutableState.value = mutableState.value.copy(drill = it, isLoading = false) }.onFailure { mutableState.value = mutableState.value.copy(isLoading = false, error = it.message ?: "Unable to load today's drill.") } } }
    fun saveDrillAnswer(questionId: String, answer: String) { val session = mutableState.value.session ?: return; val drill = mutableState.value.drill ?: return; viewModelScope.launch { mutableState.value = mutableState.value.copy(isLoading = true); runCatching { repository.saveDrillAnswer(session.token, drill.id, questionId, answer) }.onSuccess { loadDrill() }.onFailure { mutableState.value = mutableState.value.copy(isLoading = false, error = it.message ?: "Unable to save answer.") } } }
    fun submitDrill() { val session = mutableState.value.session ?: return; val drill = mutableState.value.drill ?: return; viewModelScope.launch { mutableState.value = mutableState.value.copy(isLoading = true); runCatching { repository.submitDrill(session.token, drill.id) }.onSuccess { mutableState.value = mutableState.value.copy(drill = it, isLoading = false, successMessage = "Daily drill submitted.") }.onFailure { mutableState.value = mutableState.value.copy(isLoading = false, error = it.message ?: "Unable to submit drill.") } } }
    fun reactToAnnouncement(id: String, reaction: String) { val session = mutableState.value.session ?: return; viewModelScope.launch { runCatching { repository.reactToAnnouncement(session.token, id, reaction) }.onSuccess { mutableState.value = mutableState.value.copy(successMessage = "Reaction saved.") }.onFailure { mutableState.value = mutableState.value.copy(error = it.message ?: "Unable to save reaction.") } } }
    fun downloadReport(reportId: String, context: Context) { val session = mutableState.value.session ?: return; viewModelScope.launch { mutableState.value = mutableState.value.copy(isLoading = true); runCatching { repository.reportPdf(session.token, reportId) }.onSuccess { bytes -> val file = File(context.cacheDir, "report-card-$reportId.pdf").apply { writeBytes(bytes) }; val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file); context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); mutableState.value = mutableState.value.copy(isLoading = false, successMessage = "Report PDF is ready.") }.onFailure { mutableState.value = mutableState.value.copy(isLoading = false, error = it.message ?: "Unable to download report PDF.") } } }
    private suspend fun loadWorkspace(session: SchoolSession, refreshing: Boolean = false) {
        mutableState.value = mutableState.value.copy(session = session, isLoading = true, error = null)
        runCatching {
            if (session.isStudent) {
                Triple(repository.studentPortal(session.token), null, null)
            } else {
                val workspace = repository.staffWorkspace(session.token)
                Triple(null, workspace.dashboard, workspace)
            }
        }
            .onSuccess { (portal, dashboard, staffWorkspace) ->
                mutableState.value = SchoolsUiState(
                    session = session,
                    studentPortal = portal,
                    dashboard = dashboard,
                    staffWorkspace = staffWorkspace,
                    successMessage = if (refreshing) "School information is up to date." else null,
                )
            }
            .onFailure { mutableState.value = SchoolsUiState(session = session, error = it.message ?: "Could not load the school workspace.") }
    }
}
