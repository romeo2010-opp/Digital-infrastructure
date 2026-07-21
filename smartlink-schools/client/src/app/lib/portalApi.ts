const storageKey = 'smartlink.schools.session'
let activeRequestCount = 0
const requestActivityListeners = new Set<(count: number) => void>()
const inFlightGetRequests = new Map<string, Promise<any>>()

function updateRequestActivity(delta: number) {
  activeRequestCount = Math.max(0, activeRequestCount + delta)
  requestActivityListeners.forEach((listener) => listener(activeRequestCount))
}

export function subscribePortalRequestActivity(listener: (count: number) => void) {
  requestActivityListeners.add(listener)
  listener(activeRequestCount)
  return () => {
    requestActivityListeners.delete(listener)
  }
}
function configuredApiBaseUrl() {
  const runtimeConfig = typeof window !== 'undefined' ? (window as any).__SMARTLINK_CONFIG__ : null
  return runtimeConfig?.apiBaseUrl || import.meta.env.VITE_SCHOOLS_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || ''
}

function resolveApiOrigin() {
  const apiBaseUrl = configuredApiBaseUrl()
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin).origin
  }
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

export function resolvePortalAssetUrl(assetPath: string) {
  const raw = String(assetPath || '').trim()
  if (!raw) return ''
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw
  try {
    return new URL(raw.startsWith('/') ? raw : `/${raw}`, resolveApiOrigin()).toString()
  } catch {
    return raw
  }
}

export function resolvePortalWebSocketUrl(pathname: string, params: Record<string, string> = {}) {
  const url = new URL(pathname.startsWith('/') ? pathname : `/${pathname}`, resolveApiOrigin())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value)
  })
  return url.toString()
}

function parseResponse(response: Response, payload: any) {
  if (!response.ok || payload?.ok === false) {
    const baseMessage = payload?.error || payload?.message || `Request failed (${response.status})`
    throw new Error(payload?.reason ? `${baseMessage}: ${payload.reason}` : baseMessage)
  }
  return payload?.data ?? payload
}

export function readStoredSession() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function storeSession(session: any) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(storageKey, JSON.stringify(session))
}

export function clearSession() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(storageKey)
}

async function request(pathname: string, { method = 'GET', body, token, isForm = false, signal }: any = {}) {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  const dedupeKey = normalizedMethod === 'GET' && !body && !signal
    ? `${String(token || 'anonymous')}::${pathname}`
    : ''
  if (dedupeKey && inFlightGetRequests.has(dedupeKey)) {
    return inFlightGetRequests.get(dedupeKey)
  }
  const operation = (async () => {
    updateRequestActivity(1)
    try {
      const response = await fetch(`${resolveApiOrigin()}${pathname}`, {
        method: normalizedMethod,
        signal,
        credentials: 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      })

      const payload = await response.json().catch(() => ({}))
      return parseResponse(response, payload)
    } finally {
      updateRequestActivity(-1)
    }
  })()
  if (dedupeKey) inFlightGetRequests.set(dedupeKey, operation)
  try {
    return await operation
  } finally {
    if (dedupeKey && inFlightGetRequests.get(dedupeKey) === operation) {
      inFlightGetRequests.delete(dedupeKey)
    }
  }
}

async function requestBlob(pathname: string, { method = 'GET', body, token, isForm = false, signal }: any = {}) {
  updateRequestActivity(1)
  try {
    const response = await fetch(`${resolveApiOrigin()}${pathname}`, {
      method,
      signal,
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`)
    }
    return response.blob()
  } finally {
    updateRequestActivity(-1)
  }
}

function queryString(filters: Record<string, any> = {}) {
  const params = new URLSearchParams()
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const portalApi = {
  getLoginAppearance() {
    return request('/api/auth/login-appearance')
  },

  lookupLoginAppearance(payload: { email?: string; studentCode?: string; student_code?: string; loginType?: string; login_type?: string }) {
    return request('/api/auth/login-appearance/lookup', { method: 'POST', body: payload })
  },

  login(credentials: { email?: string; schoolCode?: string; school_code?: string; studentCode?: string; student_code?: string; password: string; role?: string; loginType?: string; login_type?: string }) {
    return request('/api/auth/login', { method: 'POST', body: credentials }).then((payload: any) => ({
      accessToken: payload?.token || payload?.accessToken,
      user: payload?.user,
    }))
  },

  verifyLoginCode() {
    return Promise.reject(new Error('SmartLink Schools login does not use email codes.'))
  },

  resendLoginCode() {
    return Promise.reject(new Error('SmartLink Schools login does not use email codes.'))
  },

  me(token: string) {
    return request('/api/auth/me', { token })
  },

  updateMe(_token: string, payload: any) {
    return Promise.resolve(payload)
  },

  changePassword(token: string, payload: any) {
    return request('/api/auth/change-password', { method: 'POST', token, body: payload }).then((response: any) => ({
      accessToken: response?.token || response?.accessToken,
      user: response?.user,
    }))
  },

  logout(_token: string) {
    return Promise.resolve({ ok: true })
  },

  getSnapshot(token: string) {
    return request('/api/dashboard', { token })
  },

  async getPacket(token: string, key?: string, params: Record<string, any> = {}) {
    if (key === 'schoolDashboard') {
      const safe = async (loader: () => Promise<any>, fallback: any) => {
        try {
          return await loader()
        } catch {
          return fallback
        }
      }
      const [dashboard, students, fees, attendance, homework, insights, results, forecasts, today] = await Promise.all([
        safe(() => portalApi.getSchoolDashboard(token), {}),
        safe(() => portalApi.listStudents(token, params?.students || {}), { students: [] }),
        safe(() => portalApi.listFeeAccounts(token), { feeAccounts: [] }),
        safe(() => portalApi.listAttendance(token, params?.attendance || {}), { attendance: [] }),
        safe(() => portalApi.listHomework(token), { homework: [] }),
        safe(() => portalApi.listAssessmentInsights(token), { topics: [] }),
        safe(() => portalApi.listResults(token), { results: [] }),
        safe(() => portalApi.listForecasts(token), { forecasts: [] }),
        safe(() => portalApi.getSchoolToday(token), { today: {} }),
      ])
      return { dashboard, students, fees, attendance, homework, insights, results, forecasts, today }
    }
    if (key === 'studentPortal') {
      const response = await portalApi.getStudentPortal(token)
      return response?.student_portal || response
    }
    return Promise.resolve({})
  },

  getMyPreferences(token: string) {
    return request('/api/preferences/me', { token })
  },

  updateMyPreferences(token: string, payload: any) {
    return request('/api/preferences/me', { method: 'PATCH', token, body: payload })
  },

  listSessions() {
    return Promise.resolve({ items: [] })
  },

  revokeOtherSessions() {
    return Promise.resolve({ ok: true })
  },

  revokeSession() {
    return Promise.resolve({ ok: true })
  },

  getSchoolDashboard(token: string) {
    return request('/api/dashboard', { token })
  },

  getStudentPortal(token: string, studentRef?: string) {
    return request(`/api/student-portal${queryString(studentRef ? { student_ref: studentRef } : {})}`, { token })
  },

  listTimetables(token: string, filters: Record<string, any> = {}) {
    return request(`/api/timetables${queryString(filters)}`, { token })
  },

  getTimetableSetupOptions(token: string) {
    return request('/api/timetables/setup-options', { token })
  },

  createTimetable(token: string, payload: any) {
    return request('/api/timetables', { method: 'POST', token, body: payload })
  },

  getTimetable(token: string, id: any) {
    return request(`/api/timetables/${id}`, { token })
  },

  updateTimetableSetup(token: string, id: any, payload: any) {
    return request(`/api/timetables/${id}/setup`, { method: 'PATCH', token, body: payload })
  },

  archiveTimetable(token: string, id: any) {
    return request(`/api/timetables/${id}/archive`, { method: 'POST', token })
  },

  listTimetableVersions(token: string, id: any) {
    return request(`/api/timetables/${id}/versions`, { token })
  },

  createTimetableVersion(token: string, id: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions`, { method: 'POST', token, body: payload })
  },

  getTimetableVersion(token: string, id: any, versionId: any) {
    return request(`/api/timetables/${id}/versions/${versionId}`, { token })
  },

  cloneTimetableVersion(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/clone`, { method: 'POST', token, body: payload })
  },

  getTimetableReadiness(token: string, id: any, versionId: any) {
    return request(`/api/timetables/${id}/versions/${versionId}/readiness`, { token })
  },

  getTimetableFocusReport(token: string, id: any, versionId: any) {
    return request(`/api/timetables/${id}/versions/${versionId}/focus-report`, { token })
  },

  getTimetableStreamRuleReport(token: string, id: any, versionId: any) {
    return request(`/api/timetables/${id}/versions/${versionId}/stream-rule-report`, { token })
  },

  listTimetableConflicts(token: string, id: any, versionId: any) {
    return request(`/api/timetables/${id}/versions/${versionId}/conflicts`, { token })
  },

  validateTimetableEntry(token: string, id: any, versionId: any, payload: any) {
    return request(`/api/timetables/${id}/versions/${versionId}/validate-entry`, { method: 'POST', token, body: payload })
  },

  createTimetableEntry(token: string, id: any, versionId: any, payload: any) {
    return request(`/api/timetables/${id}/versions/${versionId}/entries`, { method: 'POST', token, body: payload })
  },

  submitTimetableReview(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/submit-review`, { method: 'POST', token, body: payload })
  },

  requestTimetableChanges(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/request-changes`, { method: 'POST', token, body: payload })
  },

  approveTimetableVersion(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/approve`, { method: 'POST', token, body: payload })
  },

  publishTimetableVersion(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/publish`, { method: 'POST', token, body: payload })
  },

  startTimetableGeneration(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/generate`, { method: 'POST', token, body: payload })
  },

  completeTimetableWithSolver(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/complete-with-solver`, { method: 'POST', token, body: payload })
  },

  findTimetableAlternatives(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/find-alternatives`, { method: 'POST', token, body: payload })
  },

  startExamTimetableGeneration(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/exam-timetables/${id}/versions/${versionId}/generate-for-scope`, { method: 'POST', token, body: payload })
  },

  cancelTimetableGenerationJob(token: string, jobId: any) {
    return request(`/api/timetables/generation-jobs/${jobId}/cancel`, { method: 'POST', token })
  },

  getTimetableGenerationJob(token: string, jobId: any) {
    return request(`/api/timetables/generation-jobs/${jobId}`, { token })
  },

  getTimetableSolverHealth(token: string) {
    return request('/api/system/timetable-solver/health', { token })
  },

  getSchoolToday(token: string, filters: Record<string, any> = {}) {
    return request(`/api/school/today${queryString(filters)}`, { token })
  },

  listTimetableAudit(token: string, id: any) {
    return request(`/api/timetables/${id}/audit`, { token })
  },

  applyWeeklyActivitiesToTimetableVersion(token: string, id: any, versionId: any, payload: any = {}) {
    return request(`/api/timetables/${id}/versions/${versionId}/apply-weekly-activities`, { method: 'POST', token, body: payload })
  },

  listBellSchedules(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/bell-schedules${queryString(filters)}`, { token })
  },

  listBellSlotTags(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/bell-slot-tags${queryString(filters)}`, { token })
  },

  setBellScheduleSlotTags(token: string, id: any, payload: any) {
    return request(`/api/scheduling/bell-schedules/${id}/slot-tags`, { method: 'PUT', token, body: payload })
  },

  listTimetableDayTemplates(token: string, timetableId: any) {
    return request(`/api/scheduling/timetables/${timetableId}/day-templates`, { token })
  },

  setTimetableDayTemplate(token: string, timetableId: any, cycleDayId: any, payload: any) {
    return request(`/api/scheduling/timetables/${timetableId}/day-templates/${cycleDayId}`, { method: 'PATCH', token, body: payload })
  },

  createBellSchedule(token: string, payload: any) {
    return request('/api/scheduling/bell-schedules', { method: 'POST', token, body: payload })
  },

  updateBellSchedule(token: string, id: any, payload: any) {
    return request(`/api/scheduling/bell-schedules/${id}`, { method: 'PATCH', token, body: payload })
  },

  archiveBellSchedule(token: string, id: any) {
    return request(`/api/scheduling/bell-schedules/${id}/archive`, { method: 'POST', token })
  },

  createBellScheduleSlot(token: string, id: any, payload: any) {
    return request(`/api/scheduling/bell-schedules/${id}/slots`, { method: 'POST', token, body: payload })
  },

  updateBellScheduleSlot(token: string, slotId: any, payload: any) {
    return request(`/api/scheduling/bell-schedule-slots/${slotId}`, { method: 'PATCH', token, body: payload })
  },

  deleteBellScheduleSlot(token: string, slotId: any) {
    return request(`/api/scheduling/bell-schedule-slots/${slotId}`, { method: 'DELETE', token })
  },

  listSchedulingFacilities(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/facilities${queryString(filters)}`, { token })
  },

  createSchedulingFacility(token: string, payload: any) {
    return request('/api/scheduling/facilities', { method: 'POST', token, body: payload })
  },

  getSchedulingFacility(token: string, id: any) {
    return request(`/api/scheduling/facilities/${id}`, { token })
  },

  updateSchedulingFacility(token: string, id: any, payload: any) {
    return request(`/api/scheduling/facilities/${id}`, { method: 'PATCH', token, body: payload })
  },

  archiveSchedulingFacility(token: string, id: any) {
    return request(`/api/scheduling/facilities/${id}/archive`, { method: 'POST', token })
  },

  duplicateSchedulingFacility(token: string, id: any, payload: any = {}) {
    return request(`/api/scheduling/facilities/${id}/duplicate`, { method: 'POST', token, body: payload })
  },

  assignFacilityEquipment(token: string, id: any, payload: any) {
    return request(`/api/scheduling/facilities/${id}/equipment`, { method: 'POST', token, body: payload })
  },

  setFacilitySubjectEligibility(token: string, id: any, payload: any) {
    return request(`/api/scheduling/facilities/${id}/subjects`, { method: 'POST', token, body: payload })
  },

  setFacilityAvailability(token: string, id: any, payload: any) {
    return request(`/api/scheduling/facilities/${id}/availability`, { method: 'POST', token, body: payload })
  },

  validateFacilityUse(token: string, payload: any) {
    return request('/api/scheduling/facilities/validate-use', { method: 'POST', token, body: payload })
  },

  listFacilityEquipment(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/equipment${queryString(filters)}`, { token })
  },

  createFacilityEquipment(token: string, payload: any) {
    return request('/api/scheduling/equipment', { method: 'POST', token, body: payload })
  },

  listWeeklyActivities(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/weekly-activities${queryString(filters)}`, { token })
  },

  createWeeklyActivity(token: string, payload: any) {
    return request('/api/scheduling/weekly-activities', { method: 'POST', token, body: payload })
  },

  getWeeklyActivity(token: string, id: any) {
    return request(`/api/scheduling/weekly-activities/${id}`, { token })
  },

  updateWeeklyActivity(token: string, id: any, payload: any) {
    return request(`/api/scheduling/weekly-activities/${id}`, { method: 'PATCH', token, body: payload })
  },

  archiveWeeklyActivity(token: string, id: any) {
    return request(`/api/scheduling/weekly-activities/${id}/archive`, { method: 'POST', token })
  },

  duplicateWeeklyActivity(token: string, id: any, payload: any = {}) {
    return request(`/api/scheduling/weekly-activities/${id}/duplicate`, { method: 'POST', token, body: payload })
  },

  validateWeeklyActivity(token: string, payload: any) {
    return request('/api/scheduling/weekly-activities/validate', { method: 'POST', token, body: payload })
  },

  listSchedulingOccupancy(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/occupancy${queryString(filters)}`, { token })
  },

  getExamAvailabilityWindows(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/exam-availability-windows${queryString(filters)}`, { token })
  },

  listCurriculumRequirements(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/curriculum-requirements${queryString(filters)}`, { token })
  },

  createCurriculumRequirement(token: string, payload: any) {
    return request('/api/scheduling/curriculum-requirements', { method: 'POST', token, body: payload })
  },

  updateCurriculumRequirement(token: string, id: any, payload: any) {
    return request(`/api/scheduling/curriculum-requirements/${id}`, { method: 'PATCH', token, body: payload })
  },

  archiveCurriculumRequirement(token: string, id: any) {
    return request(`/api/scheduling/curriculum-requirements/${id}/archive`, { method: 'POST', token })
  },

  listSubjectFocusCategories(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/subject-focus-categories${queryString(filters)}`, { token })
  },

  createSubjectFocusCategory(token: string, payload: any) {
    return request('/api/scheduling/subject-focus-categories', { method: 'POST', token, body: payload })
  },

  updateSubjectFocusCategory(token: string, id: any, payload: any) {
    return request(`/api/scheduling/subject-focus-categories/${id}`, { method: 'PATCH', token, body: payload })
  },

  archiveSubjectFocusCategory(token: string, id: any) {
    return request(`/api/scheduling/subject-focus-categories/${id}/archive`, { method: 'POST', token })
  },

  listSubjectFocusAssignments(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/subject-focus-assignments${queryString(filters)}`, { token })
  },

  createSubjectFocusAssignment(token: string, payload: any) {
    return request('/api/scheduling/subject-focus-assignments', { method: 'POST', token, body: payload })
  },

  updateSubjectFocusAssignment(token: string, id: any, payload: any) {
    return request(`/api/scheduling/subject-focus-assignments/${id}`, { method: 'PATCH', token, body: payload })
  },

  archiveSubjectFocusAssignment(token: string, id: any) {
    return request(`/api/scheduling/subject-focus-assignments/${id}/archive`, { method: 'POST', token })
  },

  listSubjectFocusRules(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/subject-focus-rules${queryString(filters)}`, { token })
  },

  createSubjectFocusRule(token: string, payload: any) {
    return request('/api/scheduling/subject-focus-rules', { method: 'POST', token, body: payload })
  },

  updateSubjectFocusRule(token: string, id: any, payload: any) {
    return request(`/api/scheduling/subject-focus-rules/${id}`, { method: 'PATCH', token, body: payload })
  },

  archiveSubjectFocusRule(token: string, id: any) {
    return request(`/api/scheduling/subject-focus-rules/${id}/archive`, { method: 'POST', token })
  },

  listStreamSchedulingRules(token: string, filters: Record<string, any> = {}) {
    return request(`/api/scheduling/stream-scheduling-rules${queryString(filters)}`, { token })
  },

  createStreamSchedulingRule(token: string, payload: any) {
    return request('/api/scheduling/stream-scheduling-rules', { method: 'POST', token, body: payload })
  },

  updateStreamSchedulingRule(token: string, id: any, payload: any) {
    return request(`/api/scheduling/stream-scheduling-rules/${id}`, { method: 'PATCH', token, body: payload })
  },

  archiveStreamSchedulingRule(token: string, id: any) {
    return request(`/api/scheduling/stream-scheduling-rules/${id}/archive`, { method: 'POST', token })
  },

  reactToAnnouncement(token: string, id: any, payload: any) {
    return request(`/api/student-portal/announcements/${id}/reaction`, { method: 'POST', token, body: payload })
  },

  voteAnnouncementPoll(token: string, id: any, payload: any) {
    return request(`/api/student-portal/announcements/${id}/vote`, { method: 'POST', token, body: payload })
  },

  listStudents(token: string, filters: Record<string, any> = {}) {
    return request(`/api/students${queryString(filters)}`, { token })
  },

  getStudent(token: string, id: any) {
    return request(`/api/students/${id}`, { token })
  },

  createStudent(token: string, payload: any) {
    return request('/api/students', { method: 'POST', token, body: payload })
  },

  updateStudent(token: string, id: any, payload: any) {
    return request(`/api/students/${id}`, { method: 'PATCH', token, body: payload })
  },

  uploadStudentPhoto(token: string, payload: any) {
    return request('/api/students/photo', { method: 'POST', token, body: payload })
  },

  createStudentWithdrawal(token: string, studentId: any, payload: any) {
    return request(`/api/students/${studentId}/withdrawals`, { method: 'POST', token, body: payload })
  },

  listStudentWithdrawals(token: string, studentId: any) {
    return request(`/api/students/${studentId}/withdrawals`, { token })
  },

  cancelStudentWithdrawal(token: string, studentId: any, withdrawalId: any, payload: any = {}) {
    return request(`/api/students/${studentId}/withdrawals/${withdrawalId}/cancel`, { method: 'PATCH', token, body: payload })
  },

  getStudentWithdrawalStatus(token: string, studentId: any, filters: Record<string, any> = {}) {
    return request(`/api/students/${studentId}/withdrawal-status${queryString(filters)}`, { token })
  },

  getDirectorOverview(token: string) {
    return request('/api/director/overview', { token })
  },

  getDirectorPage(token: string, section: string, filters: Record<string, any> = {}) {
    return request(`/api/director/pages/${section}${queryString(filters)}`, { token })
  },

  updateDirectorSettings(token: string, payload: any) {
    return request('/api/director/settings', { method: 'PATCH', token, body: payload })
  },

  listDirectorTasks(token: string, filters: Record<string, any> = {}) {
    return request(`/api/director/tasks${queryString(filters)}`, { token })
  },

  getDirectorTask(token: string, taskId: any) {
    return request(`/api/director/tasks/${taskId}`, { token })
  },

  createDirectorTask(token: string, payload: any) {
    return request('/api/director/tasks', { method: 'POST', token, body: payload })
  },

  updateDirectorTask(token: string, taskId: any, payload: any) {
    return request(`/api/director/tasks/${taskId}`, { method: 'PATCH', token, body: payload })
  },

  completeDirectorTask(token: string, taskId: any, payload: any = {}) {
    return request(`/api/director/tasks/${taskId}/complete`, { method: 'PATCH', token, body: payload })
  },

  cancelDirectorTask(token: string, taskId: any) {
    return request(`/api/director/tasks/${taskId}/cancel`, { method: 'PATCH', token })
  },
  deleteDirectorTask(token: string, taskId: any) { return request(`/api/director/tasks/${taskId}`, { method: 'DELETE', token }) },

  getDirectorDailyClosure(token: string, date?: string) {
    return request(`/api/director/daily-closure${queryString(date ? { date } : {})}`, { token })
  },

  reviewDirectorDailyClosure(token: string, payload: any) {
    return request('/api/director/daily-closure', { method: 'PATCH', token, body: payload })
  },

  listDirectorWithdrawals(token: string, filters: Record<string, any> = {}) {
    return request(`/api/director/withdrawals${queryString(filters)}`, { token })
  },

  getBursarDashboard(token: string, filters: Record<string, any> = {}) {
    return request(`/api/fees/dashboard${queryString(filters)}`, { token })
  },

  listFeeAccounts(token: string, filters: Record<string, any> = {}) {
    return request(`/api/fees/accounts${queryString(filters)}`, { token })
  },

  getFeeAccount(token: string, id: any) {
    return request(`/api/fees/accounts/${id}`, { token })
  },

  syncFeeAccounts(token: string) {
    return request('/api/fees/accounts/sync', { method: 'POST', token })
  },

  listFeeStructures(token: string) {
    return request('/api/fees/structures', { token })
  },

  createFeeStructure(token: string, payload: any) {
    return request('/api/fees/structures', { method: 'POST', token, body: payload })
  },

  applyFeeStructure(token: string, id: any, payload: any = {}) {
    return request(`/api/fees/structures/${id}/apply`, { method: 'POST', token, body: payload })
  },

  listFinanceInvoices(token: string, filters: Record<string, any> = {}) {
    return request(`/api/fees/invoices${queryString(filters)}`, { token })
  },

  generateFinanceInvoices(token: string, payload: any) {
    return request('/api/fees/invoices/generate', { method: 'POST', token, body: payload })
  },

  listFinancePayments(token: string, filters: Record<string, any> = {}) {
    return request(`/api/fees/payments${queryString(filters)}`, { token })
  },

  recordPayment(token: string, payload: any) {
    return request('/api/fees/payments', { method: 'POST', token, body: payload })
  },

  reverseFinancePayment(token: string, id: any, payload: any) {
    return request(`/api/fees/payments/${id}/reverse`, { method: 'POST', token, body: payload })
  },

  downloadPaymentReceiptPdf(token: string, id: any) {
    return requestBlob(`/api/fees/payments/${id}/receipt.pdf`, { token })
  },

  getPaymentReceipt(token: string, id: any) {
    return request(`/api/fees/payments/${id}/receipt`, { token })
  },

  listFinanceArrears(token: string, filters: Record<string, any> = {}) {
    return request(`/api/fees/arrears${queryString(filters)}`, { token })
  },

  listPaymentPlans(token: string) {
    return request('/api/fees/payment-plans', { token })
  },

  createPaymentPlan(token: string, payload: any) {
    return request('/api/fees/payment-plans', { method: 'POST', token, body: payload })
  },

  listFinanceDiscounts(token: string) {
    return request('/api/fees/discounts', { token })
  },

  createFinanceDiscount(token: string, payload: any) {
    return request('/api/fees/discounts', { method: 'POST', token, body: payload })
  },

  transitionFinanceDiscount(token: string, id: any, action: 'approve' | 'reject') {
    return request(`/api/fees/discounts/${id}/${action}`, { method: 'POST', token })
  },

  listFinanceExpenses(token: string) {
    return request('/api/fees/expenses', { token })
  },

  createFinanceExpense(token: string, payload: any) {
    return request('/api/fees/expenses', { method: 'POST', token, body: payload })
  },

  transitionFinanceExpense(token: string, id: any, action: 'approve' | 'reject' | 'pay') {
    return request(`/api/fees/expenses/${id}/${action}`, { method: 'POST', token })
  },

  getFinanceReports(token: string, filters: Record<string, any> = {}) {
    return request(`/api/fees/reports${queryString(filters)}`, { token })
  },

  downloadFinanceReportCsv(token: string, filters: Record<string, any> = {}) {
    return requestBlob(`/api/fees/reports${queryString({ ...filters, format: 'csv' })}`, { token })
  },

  listFinanceAuditLogs(token: string) {
    return request('/api/fees/audit', { token })
  },

  getFinanceReconciliation(token: string) {
    return request('/api/fees/reconciliation', { token })
  },

  importBankTransactions(token: string, payload: any) {
    return request('/api/fees/reconciliation/import', { method: 'POST', token, body: payload })
  },

  matchBankTransaction(token: string, id: any, payload: any) {
    return request(`/api/fees/reconciliation/${id}/match`, { method: 'POST', token, body: payload })
  },

  transitionBankTransaction(token: string, id: any, action: 'unmatch' | 'ignore', payload: any) {
    return request(`/api/fees/reconciliation/${id}/${action}`, { method: 'POST', token, body: payload })
  },

  listAttendance(token: string, filters: Record<string, any> = {}) {
    return request(`/api/attendance${queryString(filters)}`, { token })
  },

  markAttendance(token: string, payload: any) {
    return request('/api/attendance', { method: 'POST', token, body: payload })
  },

  listHomework(token: string) {
    return request('/api/homework', { token })
  },

  createHomework(token: string, payload: any) {
    return request('/api/homework', { method: 'POST', token, body: payload })
  },

  listMessages(token: string) {
    return request('/api/messages', { token })
  },

  createMessage(token: string, payload: any) {
    return request('/api/messages', { method: 'POST', token, body: payload })
  },

  uploadMessageImage(token: string, payload: any) {
    return request('/api/messages/image', { method: 'POST', token, body: payload })
  },

  createAssessment(token: string, payload: any) {
    return request('/api/assessments', { method: 'POST', token, body: payload })
  },

  getAssessmentBuilderSetup(token: string) {
    return request('/api/assessments/setup', { token })
  },

  listAssessments(token: string, filters: Record<string, any> = {}) {
    return request(`/api/assessments${queryString(filters)}`, { token })
  },

  getAssessment(token: string, id: any) {
    return request(`/api/assessments/${id}`, { token })
  },

  saveAssessmentDraft(token: string, id: any, payload: any) {
    return id
      ? request(`/api/assessments/${id}`, { method: 'PUT', token, body: payload })
      : request('/api/assessments', { method: 'POST', token, body: payload })
  },

  updateAssessmentStatus(token: string, id: any, payload: any) {
    return request(`/api/assessments/${id}/status`, { method: 'POST', token, body: payload })
  },

  deleteAssessment(token: string, id: any) {
    return request(`/api/assessments/${id}`, { method: 'DELETE', token })
  },

  uploadAssessmentMedia(token: string, id: any, payload: any) {
    return request(`/api/assessments/${id}/media`, { method: 'POST', token, body: payload })
  },

  exportAssessmentPdf(token: string, id: any, variant: 'student' | 'scheme' = 'student') {
    return requestBlob(`/api/assessments/${id}/export/pdf${queryString({ variant })}`, { token })
  },

  listAssessmentInsights(token: string) {
    return request('/api/assessment-insights', { token })
  },

  listDrills(token: string) {
    return request('/api/daily-drills', { token })
  },

  getAiStatus(token: string) {
    return request('/api/ai/status', { token })
  },

  testAi(token: string) {
    return request('/api/ai/test', { method: 'POST', token })
  },

  getAiUsageSummary(token: string) {
    return request('/api/ai/usage-summary', { token })
  },

  updateAiSettings(token: string, payload: any) {
    return request('/api/ai/settings', { method: 'PATCH', token, body: payload })
  },

  getSchoolFeatures(token: string) {
    return request('/api/school/features', { token })
  },

  updateSchoolFeatures(token: string, payload: any) {
    return request('/api/school/features', { method: 'PATCH', token, body: payload })
  },

  getReportSettings(token: string) {
    return request('/api/school/report-settings', { token })
  },

  updateReportSettings(token: string, payload: any) {
    return request('/api/school/report-settings', { method: 'PATCH', token, body: payload })
  },

  getSyllabusSetup(token: string) {
    return request('/api/syllabus/setup', { token })
  },

  listSyllabusUploads(token: string) {
    return request('/api/syllabus/uploads', { token })
  },

  uploadSyllabus(token: string, payload: any) {
    return request('/api/syllabus/uploads', { method: 'POST', token, body: payload })
  },

  deleteSyllabusUpload(token: string, id: any) {
    return request(`/api/syllabus/uploads/${id}`, { method: 'DELETE', token })
  },

  processSyllabusUpload(token: string, id: any) {
    return request(`/api/syllabus/uploads/${id}/process`, { method: 'POST', token })
  },

  getSyllabusReview(token: string, id: any) {
    return request(`/api/syllabus/uploads/${id}/review`, { token })
  },

  updateExtractedSyllabusItem(token: string, id: any, payload: any) {
    return request(`/api/syllabus/extracted-items/${id}`, { method: 'PATCH', token, body: payload })
  },

  approveExtractedSyllabusItem(token: string, id: any) {
    return request(`/api/syllabus/extracted-items/${id}/approve`, { method: 'POST', token })
  },

  approveExtractedSyllabusItems(token: string, itemIds: any[]) {
    return request('/api/syllabus/extracted-items/approve-bulk', { method: 'POST', token, body: { item_ids: itemIds } })
  },

  rejectExtractedSyllabusItem(token: string, id: any) {
    return request(`/api/syllabus/extracted-items/${id}/reject`, { method: 'POST', token })
  },

  mergeExtractedSyllabusItem(token: string, id: any, payload: any) {
    return request(`/api/syllabus/extracted-items/${id}/merge`, { method: 'POST', token, body: payload })
  },

  listManualSyllabusEntries(token: string, filters: Record<string, any> = {}) {
    return request(`/api/syllabus/manual-entries${queryString(filters)}`, { token })
  },

  getManualSyllabusEntry(token: string, id: any) {
    return request(`/api/syllabus/manual-entries/${id}`, { token })
  },

  createManualSyllabusEntry(token: string, payload: any) {
    return request('/api/syllabus/manual-entries', { method: 'POST', token, body: payload })
  },

  updateManualSyllabusEntry(token: string, id: any, payload: any) {
    return request(`/api/syllabus/manual-entries/${id}`, { method: 'PATCH', token, body: payload })
  },

  deleteManualSyllabusEntry(token: string, id: any) {
    return request(`/api/syllabus/manual-entries/${id}`, { method: 'DELETE', token })
  },

  approveManualSyllabusEntry(token: string, id: any, payload: any = {}) {
    return request(`/api/syllabus/manual-entries/${id}/approve`, { method: 'POST', token, body: payload })
  },

  rejectManualSyllabusEntry(token: string, id: any, payload: any = {}) {
    return request(`/api/syllabus/manual-entries/${id}/reject`, { method: 'POST', token, body: payload })
  },

  listSyllabusTopics(token: string, filters: Record<string, any> = {}) {
    return request(`/api/syllabus/topics${queryString(filters)}`, { token })
  },

  createSyllabusTopic(token: string, payload: any) {
    return request('/api/syllabus/topics', { method: 'POST', token, body: payload })
  },

  updateSyllabusTopic(token: string, id: any, payload: any) {
    return request(`/api/syllabus/topics/${id}`, { method: 'PATCH', token, body: payload })
  },

  listQuestionBank(token: string, filters: Record<string, any> = {}) {
    return request(`/api/questions${queryString(filters)}`, { token })
  },

  createQuestion(token: string, payload: any) {
    return request('/api/questions', { method: 'POST', token, body: payload })
  },

  sourceAssessmentQuestions(token: string, payload: any = {}) {
    return request('/api/questions/source-assessments', { method: 'POST', token, body: payload })
  },

  generateDraftQuestions(token: string, payload: any) {
    return request('/api/questions/generate-draft', { method: 'POST', token, body: payload })
  },

  getQuestionBatchReview(token: string, id: any) {
    return request(`/api/questions/batches/${id}/review`, { token })
  },

  updateQuestion(token: string, id: any, payload: any) {
    return request(`/api/questions/${id}`, { method: 'PATCH', token, body: payload })
  },

  approveQuestion(token: string, id: any) {
    return request(`/api/questions/${id}/approve`, { method: 'POST', token })
  },

  rejectQuestion(token: string, id: any) {
    return request(`/api/questions/${id}/reject`, { method: 'POST', token })
  },

  getTeacherToday(token: string) {
    return request('/api/teacher/today', { token })
  },

  listLessonLogs(token: string, filters: Record<string, any> = {}) {
    return request(`/api/lesson-logs${queryString(filters)}`, { token })
  },

  getLessonLog(token: string, id: any) {
    return request(`/api/lesson-logs/${id}`, { token })
  },

  getLessonLogSuggestions(token: string, filters: Record<string, any> = {}) {
    return request(`/api/lesson-logs/suggestions${queryString(filters)}`, { token })
  },

  createLessonLog(token: string, payload: any) {
    return request('/api/lesson-logs', { method: 'POST', token, body: payload })
  },

  updateLessonLog(token: string, id: any, payload: any) {
    return request(`/api/lesson-logs/${id}`, { method: 'PATCH', token, body: payload })
  },

  finalizeLessonLog(token: string, id: any) {
    return request(`/api/lesson-logs/${id}/finalize`, { method: 'POST', token })
  },

  reopenLessonLog(token: string, id: any, payload: any = {}) {
    return request(`/api/lesson-logs/${id}/reopen`, { method: 'POST', token, body: payload })
  },

  cancelLessonLog(token: string, id: any, payload: any = {}) {
    return request(`/api/lesson-logs/${id}/cancel`, { method: 'POST', token, body: payload })
  },

  getClassLessonHistory(token: string, classId: any, subjectId: any, filters: Record<string, any> = {}) {
    return request(`/api/classes/${classId}/subjects/${subjectId}/lesson-history${queryString(filters)}`, { token })
  },

  getClassSubjectCoverage(token: string, classId: any, subjectId: any) {
    return request(`/api/classes/${classId}/subjects/${subjectId}/coverage`, { token })
  },

  generateDrill(token: string, studentId: any, payload: any = {}) {
    return request(`/api/drills/generate/${studentId}`, { method: 'POST', token, body: payload })
  },

  generateClassDrills(token: string, classId: any, payload: any = {}) {
    return request(`/api/drills/generate/class/${classId}`, { method: 'POST', token, body: payload })
  },

  getTodayDrill(token: string, studentId?: any) {
    return request(`/api/drills/today${studentId ? `/${studentId}` : ''}`, { token })
  },

  getDrill(token: string, sessionId: any) {
    return request(`/api/drills/${sessionId}`, { token })
  },

  answerDrillQuestion(token: string, sessionId: any, payload: any) {
    return request(`/api/drills/${sessionId}/answer`, { method: 'POST', token, body: payload })
  },

  submitDrill(token: string, sessionId: any) {
    return request(`/api/drills/${sessionId}/submit`, { method: 'POST', token })
  },

  getDrillHistory(token: string, studentId?: any) {
    return request(`/api/drills/history${studentId ? `/${studentId}` : ''}`, { token })
  },

  adaptQuestionExplanation(token: string, questionId: any, payload: any) {
    return request(`/api/explanations/question/${questionId}/adapt`, { method: 'POST', token, body: payload })
  },

  synthesizeExplanationSpeech(token: string, payload: any) {
    return request('/api/explanations/speech', { method: 'POST', token, body: payload })
  },

  flagQuestionExplanation(token: string, questionId: any, payload: any) {
    return request(`/api/explanations/question/${questionId}/flag`, { method: 'POST', token, body: payload })
  },

  getTeacherDrillInsights(token: string, classId: any) {
    return request(`/api/teacher/classes/${classId}/drill-insights`, { token })
  },

  getGuardianDrillSummary(token: string, studentId: any) {
    return request(`/api/guardian/students/${studentId}/drill-summary`, { token })
  },

  listForecasts(token: string) {
    return request('/api/exam-forecast', { token })
  },

  listClasses(token: string) {
    return request('/api/classes', { token })
  },

  getClass(token: string, id: any) {
    return request(`/api/classes/${id}`, { token })
  },

  createClass(token: string, payload: any) {
    return request('/api/classes', { method: 'POST', token, body: payload })
  },

  getAcademicSession(token: string) {
    return request('/api/academic-sessions', { token })
  },

  getCurrentAcademicSession(token: string) {
    return request('/api/academic-session/current', { token })
  },

  getSchoolCalendar(token: string, filters: Record<string, any> = {}) {
    return request(`/api/calendar${queryString(filters)}`, { token })
  },

  createSchoolCalendarEvent(token: string, payload: any) {
    return request('/api/calendar/events', { method: 'POST', token, body: payload })
  },

  updateSchoolCalendarEvent(token: string, id: any, payload: any) {
    return request(`/api/calendar/events/${id}`, { method: 'PATCH', token, body: payload })
  },

  updateTermTimeline(token: string, payload: any) {
    return request('/api/calendar/term-timeline', { method: 'PATCH', token, body: payload })
  },

  createRecurringAssessmentTemplate(token: string, payload: any) {
    return request('/api/calendar/recurring-assessments', { method: 'POST', token, body: payload })
  },

  generateRecurringAssessmentInstances(token: string, id: any) {
    return request(`/api/calendar/recurring-assessments/${id}/generate`, { method: 'POST', token })
  },

  getAssessmentInstance(token: string, id: any) {
    return request(`/api/calendar/assessment-instances/${id}`, { token })
  },

  saveAssessmentInstanceResults(token: string, id: any, payload: any) {
    return request(`/api/calendar/assessment-instances/${id}/results`, { method: 'POST', token, body: payload })
  },

  createAcademicYear(token: string, payload: any) {
    return request('/api/academic-years', { method: 'POST', token, body: payload })
  },

  openTerm(token: string, payload: any) {
    return request('/api/terms/open', { method: 'POST', token, body: payload })
  },

  getAcademicTerm(token: string, id: any) {
    return request(`/api/terms/${id}`, { token })
  },

  getTermResults(token: string, id: any, filters: Record<string, any> = {}) {
    return request(`/api/terms/${id}/results${queryString(filters)}`, { token })
  },

  getTermCloseChecks(token: string, id: any) {
    return request(`/api/terms/${id}/close-checks`, { token })
  },

  getTermProgressionPreview(token: string, id: any, filters: Record<string, any> = {}) {
    return request(`/api/terms/${id}/progression-preview${queryString(filters)}`, { token })
  },

  approveTermProgressionClass(token: string, termId: any, classId: any, payload: any = {}) {
    return request(`/api/terms/${termId}/progression/classes/${classId}/approve`, { method: 'POST', token, body: payload })
  },

  moveTermToMarking(token: string, id: any) {
    return request(`/api/terms/${id}/marking`, { method: 'POST', token })
  },

  closeTerm(token: string, id: any, payload: any) {
    return request(`/api/terms/${id}/close`, { method: 'POST', token, body: payload })
  },

  reopenTerm(token: string, id: any, payload: any) {
    return request(`/api/terms/${id}/reopen`, { method: 'POST', token, body: payload })
  },

  archiveTerm(token: string, id: any) {
    return request(`/api/terms/${id}/archive`, { method: 'POST', token })
  },

  listClassProgressionRules(token: string) {
    return request('/api/class-progression-rules', { token })
  },

  saveClassProgressionRule(token: string, payload: any) {
    return request('/api/class-progression-rules', { method: 'POST', token, body: payload })
  },

  getProgressionPolicy(token: string) {
    return request('/api/progression-policy', { token })
  },

  saveProgressionPolicy(token: string, payload: any) {
    return request('/api/progression-policy', { method: 'PATCH', token, body: payload })
  },

  getProgressionPreview(token: string, fromAcademicYearId: any, filters: Record<string, any> = {}) {
    return request(`/api/academic-years/${fromAcademicYearId}/progression-preview${queryString(filters)}`, { token })
  },

  progressAcademicYear(token: string, fromAcademicYearId: any, payload: any) {
    return request(`/api/academic-years/${fromAcademicYearId}/progress`, { method: 'POST', token, body: payload })
  },

  startPromotion(token: string, payload: any) {
    return request('/api/promotions/start', { method: 'POST', token, body: payload })
  },

  listExamSessions(token: string, filters: Record<string, any> = {}) {
    return request(`/api/exam-sessions${queryString(filters)}`, { token })
  },

  createExamSession(token: string, payload: any) {
    return request('/api/exam-sessions', { method: 'POST', token, body: payload })
  },

  getExamSession(token: string, id: any) {
    return request(`/api/exam-sessions/${id}`, { token })
  },

  updateExamSession(token: string, id: any, payload: any) {
    return request(`/api/exam-sessions/${id}`, { method: 'PATCH', token, body: payload })
  },

  updateExamSessionStatus(token: string, id: any, status: string) {
    return request(`/api/exam-sessions/${id}/status`, { method: 'POST', token, body: { status } })
  },

  createExamPaper(token: string, examSessionId: any, payload: any) {
    return request(`/api/exam-sessions/${examSessionId}/papers`, { method: 'POST', token, body: payload })
  },

  createBulkExamPapers(token: string, examSessionId: any, payload: any) {
    return request(`/api/exam-sessions/${examSessionId}/papers/bulk`, { method: 'POST', token, body: payload })
  },

  updateExamPaperStatus(token: string, examSessionId: any, paperId: any, status: string) {
    return request(`/api/exam-sessions/${examSessionId}/papers/${paperId}/status`, { method: 'POST', token, body: { status } })
  },

  createExamTimetableEntry(token: string, examSessionId: any, payload: any) {
    return request(`/api/exam-sessions/${examSessionId}/timetable`, { method: 'POST', token, body: payload })
  },

  deleteExamTimetableEntry(token: string, examSessionId: any, entryId: any) {
    return request(`/api/exam-sessions/${examSessionId}/timetable/${entryId}`, { method: 'DELETE', token })
  },

  getReportCard(token: string, id: any) {
    return request(`/api/report-cards/${id}`, { token })
  },

  getReportCardPdf(token: string, id: any) {
    return requestBlob(`/api/report-cards/${id}/pdf`, { token })
  },

  listTeacherAssignments(token: string) {
    return request('/api/teacher-assignments', { token })
  },

  createTeacherAssignment(token: string, payload: any) {
    return request('/api/teacher-assignments', { method: 'POST', token, body: payload })
  },

  updateTeacherAssignment(token: string, id: any, payload: any) {
    return request(`/api/teacher-assignments/${id}`, { method: 'PATCH', token, body: payload })
  },

  deactivateTeacherAssignment(token: string, id: any) {
    return request(`/api/teacher-assignments/${id}`, { method: 'DELETE', token })
  },

  listSubjects(token: string) {
    return request('/api/subjects', { token })
  },

  createSubject(token: string, payload: any) {
    return request('/api/subjects', { method: 'POST', token, body: payload })
  },

  updateSubject(token: string, id: any, payload: any) {
    return request(`/api/subjects/${id}`, { method: 'PATCH', token, body: payload })
  },

  deleteSubject(token: string, id: any) {
    return request(`/api/subjects/${id}`, { method: 'DELETE', token })
  },

  listTeachers(token: string, filters: Record<string, any> = {}) {
    return request(`/api/teachers${queryString(filters)}`, { token })
  },

  createTeacher(token: string, payload: any) {
    return request('/api/teachers', { method: 'POST', token, body: payload })
  },

  getTeacher(token: string, id: any) {
    return request(`/api/teachers/${id}`, { token })
  },

  listResultsSetup(token: string) {
    return request('/api/results/setup', { token })
  },

  listResultBatches(token: string) {
    return request('/api/results/batches', { token })
  },

  getResultSheet(token: string, filters: Record<string, any>) {
    return request(`/api/results/sheet${queryString(filters)}`, { token })
  },

  getClassResultSheet(token: string, filters: Record<string, any>) {
    return request(`/api/results/class-sheet${queryString(filters)}`, { token })
  },

  saveResultDraft(token: string, payload: any) {
    return request('/api/results/draft', { method: 'POST', token, body: payload })
  },

  submitResults(token: string, payload: any) {
    return request('/api/results/submit', { method: 'POST', token, body: payload })
  },

  approveResultBatch(token: string, id: any) {
    return request(`/api/results/batches/${id}/approve`, { method: 'POST', token })
  },

  returnResultBatch(token: string, id: any, payload: any) {
    return request(`/api/results/batches/${id}/return`, { method: 'POST', token, body: payload })
  },

  listParents(token: string) {
    return request('/api/parents', { token })
  },

  listResults(token: string) {
    return request('/api/results', { token })
  },

  listReports(token: string) {
    return request('/api/reports', { token })
  },

  listUsers(token: string) {
    return request('/api/users', { token })
  },

  createSchoolUser(token: string, payload: any) {
    return request('/api/users', { method: 'POST', token, body: payload })
  },

  linkParentGuardian(token: string, userRef: string, payload: any) {
    return request(`/api/users/${encodeURIComponent(userRef)}/guardian-links`, { method: 'POST', token, body: payload })
  },

  getUserPermissions(token: string, userRef: string) {
    return request(`/api/users/${encodeURIComponent(userRef)}/permissions`, { token })
  },

  updateUserPermissions(token: string, userRef: string, permissions: any[]) {
    return request(`/api/users/${encodeURIComponent(userRef)}/permissions`, { method: 'PUT', token, body: { permissions } })
  },

  getPayrollDashboard(token: string) {
    return request('/api/director/finance/payroll', { token })
  },

  getPayrollRun(token: string, runRef: string) {
    return request(`/api/director/finance/payroll/runs/${encodeURIComponent(runRef)}`, { token })
  },

  createPayrollRun(token: string, payload: any) {
    return request('/api/director/finance/payroll/runs', { method: 'POST', token, body: payload })
  },

  generatePayrollItems(token: string, runRef: string) {
    return request(`/api/director/finance/payroll/runs/${encodeURIComponent(runRef)}/generate-items`, { method: 'POST', token })
  },

  transitionPayrollRun(token: string, runRef: string, action: 'submit' | 'approve' | 'pay' | 'cancel') {
    return request(`/api/director/finance/payroll/runs/${encodeURIComponent(runRef)}/${action}`, { method: 'POST', token })
  },

  saveSalaryProfile(token: string, payload: any, profileRef?: string) {
    return request(`/api/director/finance/payroll/salary-profiles${profileRef ? `/${encodeURIComponent(profileRef)}` : ''}`, { method: profileRef ? 'PATCH' : 'POST', token, body: payload })
  },

  updatePayrollItem(token: string, itemRef: string, payload: any) {
    return request(`/api/director/finance/payroll/items/${encodeURIComponent(itemRef)}`, { method: 'PATCH', token, body: payload })
  },

  getLeaveDashboard(token: string, filters: Record<string, any> = {}) {
    return request(`/api/director/staff/leave${queryString(filters)}`, { token })
  },

  getMyLeaveDashboard(token: string) {
    return request('/api/staff/leave/me', { token })
  },

  createMyLeaveRequest(token: string, payload: any) {
    return request('/api/staff/leave/me', { method: 'POST', token, body: payload })
  },

  cancelMyLeaveRequest(token: string, leaveRef: string) {
    return request(`/api/staff/leave/me/${encodeURIComponent(leaveRef)}/cancel`, { method: 'POST', token })
  },

  getLeaveRequest(token: string, leaveRef: string) {
    return request(`/api/director/staff/leave/${encodeURIComponent(leaveRef)}`, { token })
  },

  createLeaveRequest(token: string, payload: any) {
    return request('/api/director/staff/leave', { method: 'POST', token, body: payload })
  },

  updateLeaveRequest(token: string, leaveRef: string, payload: any) {
    return request(`/api/director/staff/leave/${encodeURIComponent(leaveRef)}`, { method: 'PATCH', token, body: payload })
  },

  transitionLeave(token: string, leaveRef: string, action: 'approve' | 'reject' | 'cancel' | 'complete', payload: any = {}) {
    return request(`/api/director/staff/leave/${encodeURIComponent(leaveRef)}/${action}`, { method: 'POST', token, body: payload })
  },

  getHrSettings(token: string) {
    return request('/api/director/hr-settings', { token })
  },

  updateHrSettings(token: string, payload: any) {
    return request('/api/director/hr-settings', { method: 'PATCH', token, body: payload })
  },

  quickSearch(token: string, query: string, limit = 10, signal?: AbortSignal) {
    return request(`/api/search${queryString({ q: query, limit })}`, { token, signal })
  },

  fullSearch(token: string, filters: Record<string, any> = {}, signal?: AbortSignal) {
    return request(`/api/search${queryString(filters)}`, { token, signal })
  },

  createAssessmentImport(token: string, payload: any) {
    return request('/api/assessment-imports', { method: 'POST', token, body: payload })
  },

  listAssessmentImports(token: string) {
    return request('/api/assessment-imports', { token })
  },

  startAssessmentImport(token: string, importRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/start`, { method: 'POST', token })
  },

  getAssessmentImportReview(token: string, importRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/review`, { token })
  },

  updateAssessmentImportQuestion(token: string, importRef: string, questionRef: string, payload: any) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/questions/${encodeURIComponent(questionRef)}`, { method: 'PATCH', token, body: payload })
  },

  updateAssessmentImportMarking(token: string, importRef: string, markingRef: string, payload: any) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/marking-items/${encodeURIComponent(markingRef)}`, { method: 'PATCH', token, body: payload })
  },

  linkAssessmentImportAnswer(token: string, importRef: string, payload: any) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/link-answer`, { method: 'POST', token, body: payload })
  },

  approveAssessmentImport(token: string, importRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/approve`, { method: 'POST', token })
  },

  cancelAssessmentImport(token: string, importRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/cancel`, { method: 'POST', token })
  },

  getAssessmentImportPreview(token: string, importRef: string, documentType: string, pageNumber: number) {
    return requestBlob(`/api/assessment-imports/${encodeURIComponent(importRef)}/pages/${encodeURIComponent(documentType)}/${pageNumber}/preview`, { token })
  },

  getAssessmentImportAssetPreview(token: string, importRef: string, assetRef: string) {
    return requestBlob(`/api/assessment-imports/${encodeURIComponent(importRef)}/assets/${encodeURIComponent(assetRef)}/preview`, { token })
  },

  listAssessmentImportImages(token: string, importRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/images`, { token })
  },

  extractAssessmentImportImages(token: string, importRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/extract-images`, { method: 'POST', token })
  },

  updateAssessmentImportImage(token: string, importRef: string, assetRef: string, body: Record<string, any>) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/images/${encodeURIComponent(assetRef)}`, { method: 'PATCH', token, body })
  },

  deleteAssessmentImportImage(token: string, importRef: string, assetRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/images/${encodeURIComponent(assetRef)}`, { method: 'DELETE', token })
  },

  listAssessmentTemplates(token: string, filters: Record<string, any> = {}) {
    return request(`/api/assessment-templates${queryString(filters)}`, { token })
  },

  getAssessmentTemplate(token: string, templateRef: string) {
    return request(`/api/assessment-templates/${encodeURIComponent(templateRef)}`, { token })
  },

  getAssessmentTemplatePreview(token: string, templateRef: string) {
    return requestBlob(`/api/assessment-templates/${encodeURIComponent(templateRef)}/preview`, { token })
  },

  createAssessmentTemplate(token: string, payload: any) {
    return request('/api/assessment-templates', { method: 'POST', token, body: payload })
  },

  updateAssessmentTemplate(token: string, templateRef: string, payload: any) {
    return request(`/api/assessment-templates/${encodeURIComponent(templateRef)}`, { method: 'PATCH', token, body: payload })
  },

  approveAssessmentTemplate(token: string, templateRef: string) {
    return request(`/api/assessment-templates/${encodeURIComponent(templateRef)}/approve`, { method: 'POST', token })
  },

  archiveAssessmentTemplate(token: string, templateRef: string) {
    return request(`/api/assessment-templates/${encodeURIComponent(templateRef)}/archive`, { method: 'POST', token })
  },

  duplicateAssessmentTemplate(token: string, templateRef: string, payload: any = {}) {
    return request(`/api/assessment-templates/${encodeURIComponent(templateRef)}/duplicate`, { method: 'POST', token, body: payload })
  },

  applyAssessmentTemplate(token: string, templateRef: string, assessmentId: any) {
    return request(`/api/assessment-templates/${encodeURIComponent(templateRef)}/apply-to-assessment`, { method: 'POST', token, body: { assessment_id: assessmentId } })
  },

  setDefaultAssessmentTemplate(token: string, templateRef: string, category: string) {
    return request(`/api/assessment-templates/${encodeURIComponent(templateRef)}/set-default`, { method: 'POST', token, body: { category } })
  },

  extractAssessmentImportCoverTemplate(token: string, importRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/extract-cover-template`, { method: 'POST', token })
  },

  matchAssessmentImportCoverTemplate(token: string, importRef: string) {
    return request(`/api/assessment-imports/${encodeURIComponent(importRef)}/match-cover-template`, { method: 'POST', token })
  },

  getAssessmentTemplateSettings(token: string) {
    return request('/api/assessment-template-settings', { token })
  },

  updateAssessmentTemplateSettings(token: string, payload: any) {
    return request('/api/assessment-template-settings', { method: 'PATCH', token, body: payload })
  },

  getExamLabDashboard(token: string, filters: Record<string, any> = {}) {
    return request(`/api/internal/exam-lab/dashboard${queryString(filters)}`, { token })
  },

  getExamLabCoverage(token: string, filters: Record<string, any> = {}) {
    return request(`/api/internal/exam-lab/coverage${queryString(filters)}`, { token })
  },

  updateExamLabCoverageNote(token: string, payload: any) {
    return request('/api/internal/exam-lab/coverage', { method: 'PATCH', token, body: payload })
  },

  uploadExamLabPaper(token: string, payload: any) {
    return request('/api/internal/exam-lab/papers', { method: 'POST', token, body: payload })
  },

  startExamLabExtraction(token: string, paperId: any, payload: any = {}) {
    return request(`/api/internal/exam-lab/papers/${paperId}/extract`, { method: 'POST', token, body: payload })
  },

  getExamLabPaperReview(token: string, paperId: any) {
    return request(`/api/internal/exam-lab/papers/${paperId}/review`, { token })
  },

  updateExamLabCandidate(token: string, candidateId: any, payload: any) {
    return request(`/api/internal/exam-lab/candidates/${candidateId}`, { method: 'PATCH', token, body: payload })
  },

  acceptExamLabCandidate(token: string, candidateId: any, payload: any = {}) {
    return request(`/api/internal/exam-lab/candidates/${candidateId}/accept`, { method: 'POST', token, body: payload })
  },

  listExamLabQuestions(token: string, filters: Record<string, any> = {}) {
    return request(`/api/internal/exam-lab/questions${queryString(filters)}`, { token })
  },

  createExamLabQuestion(token: string, payload: any) {
    return request('/api/internal/exam-lab/questions', { method: 'POST', token, body: payload })
  },

  updateExamLabQuestion(token: string, questionId: any, payload: any) {
    return request(`/api/internal/exam-lab/questions/${questionId}`, { method: 'PATCH', token, body: payload })
  },

  archiveExamLabQuestion(token: string, questionId: any) {
    return request(`/api/internal/exam-lab/questions/${questionId}/archive`, { method: 'POST', token })
  },

  getExamLabTopicMap(token: string, filters: Record<string, any> = {}) {
    return request(`/api/internal/exam-lab/topic-map${queryString(filters)}`, { token })
  },

  saveExamLabTopic(token: string, payload: any) {
    return request(payload?.id ? `/api/internal/exam-lab/topics/${payload.id}` : '/api/internal/exam-lab/topics', { method: payload?.id ? 'PATCH' : 'POST', token, body: payload })
  },

  saveExamLabSubtopic(token: string, payload: any) {
    return request(payload?.id ? `/api/internal/exam-lab/subtopics/${payload.id}` : '/api/internal/exam-lab/subtopics', { method: payload?.id ? 'PATCH' : 'POST', token, body: payload })
  },

  saveExamLabSkill(token: string, payload: any) {
    return request(payload?.id ? `/api/internal/exam-lab/skills/${payload.id}` : '/api/internal/exam-lab/skills', { method: payload?.id ? 'PATCH' : 'POST', token, body: payload })
  },

  archiveExamLabTopicEntity(token: string, entityType: string, id: any) {
    return request(`/api/internal/exam-lab/topic-map/${entityType}/${id}/archive`, { method: 'POST', token })
  },

  createExamLabMarkScheme(token: string, payload: any) {
    return request('/api/internal/exam-lab/mark-schemes', { method: 'POST', token, body: payload })
  },

  listExamLabBacktests(token: string, filters: Record<string, any> = {}) {
    return request(`/api/internal/exam-lab/backtests${queryString(filters)}`, { token })
  },

  runExamLabBacktest(token: string, payload: any) {
    return request('/api/internal/exam-lab/backtests', { method: 'POST', token, body: payload })
  },

  listExamLabPredictionReports(token: string, filters: Record<string, any> = {}) {
    return request(`/api/internal/exam-lab/reports${queryString(filters)}`, { token })
  },

  generateExamLabPredictionReport(token: string, payload: any) {
    return request('/api/internal/exam-lab/reports', { method: 'POST', token, body: payload })
  },

  suggestExamLabQuestionTags(token: string, payload: any) {
    return request('/api/internal/exam-lab/ai/suggest-tags', { method: 'POST', token, body: payload })
  },

  getAcademicCommandCentre(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/command-centre${queryString(filters)}`, { token }) },
  getAcademicOverview(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/overview${queryString(filters)}`, { token }) },
  getAcademicClasses(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/classes${queryString(filters)}`, { token }) },
  getAcademicClass(token: string, classRef: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/classes/${encodeURIComponent(classRef)}${queryString(filters)}`, { token }) },
  getAcademicSubjects(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/subjects${queryString(filters)}`, { token }) },
  getAcademicSubject(token: string, subjectRef: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/subjects/${encodeURIComponent(subjectRef)}${queryString(filters)}`, { token }) },
  getAcademicTopic(token: string, topicRef: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/topics/${encodeURIComponent(topicRef)}${queryString(filters)}`, { token }) },
  getAcademicEvidence(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/evidence${queryString(filters)}`, { token }) },
  getAcademicRisks(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/risks${queryString(filters)}`, { token }) },
  getAcademicInsights(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/insights${queryString(filters)}`, { token }) },
  getAcademicPositiveSignals(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/positive-signals${queryString(filters)}`, { token }) },
  getAcademicMeaningfulChanges(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/meaningful-changes${queryString(filters)}`, { token }) },
  getAcademicEvidenceGaps(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/evidence-gaps${queryString(filters)}`, { token }) },
  getAcademicReadiness(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/readiness${queryString(filters)}`, { token }) },
  getAcademicHistory(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/history${queryString(filters)}`, { token }) },
  getAcademicExplanation(token: string, findingId: string) { return request(`/api/academic-intelligence/explanations/${encodeURIComponent(findingId)}`, { token }) },
  queueAcademicRecalculation(token: string, payload: any = {}) { return request('/api/academic-intelligence/recalculate', { method: 'POST', token, body: payload }) },
  explainAcademicFindings(token: string, payload: any) { return request('/api/academic-intelligence/ai/explain', { method: 'POST', token, body: payload }) },
  getAcademicAuthoringSetup(token: string) { return request('/api/academic-intelligence/authoring-setup', { token }) },
  getStudentAcademicIntelligence(token: string, studentRef: string) { return request(`/api/academic-intelligence/students/${encodeURIComponent(studentRef)}`, { token }) },
  getAcademicDependencies(token: string) { return request('/api/academic-intelligence/dependencies', { token }) },
  getAcademicEngineConfig(token: string) { return request('/api/academic-intelligence/config', { token }) },
  updateAcademicEngineConfig(token: string, payload: any) { return request('/api/academic-intelligence/config', { method: 'PATCH', token, body: payload }) },
  updateCurriculumLifecycle(token: string, recordRef: string, payload: any) { return request(`/api/academic-intelligence/curriculum/${encodeURIComponent(recordRef)}`, { method: 'PATCH', token, body: payload }) },
  createAcademicIntervention(token: string, payload: any) { return request('/api/academic-intelligence/interventions', { method: 'POST', token, body: payload }) },
  createParentAcademicInsight(token: string, payload: any) { return request('/api/academic-intelligence/parent-insights', { method: 'POST', token, body: payload }) },
  updateParentAcademicInsight(token: string, insightRef: string, payload: any) { return request(`/api/academic-intelligence/parent-insights/${encodeURIComponent(insightRef)}`, { method: 'PATCH', token, body: payload }) },
  getParentAcademicInsights(token: string, filters: Record<string, any> = {}) { return request(`/api/parent-portal/academic-insights${queryString(filters)}`, { token }) },
  updateAcademicIntervention(token: string, interventionRef: string, payload: any) { return request(`/api/academic-intelligence/interventions/${encodeURIComponent(interventionRef)}`, { method: 'PATCH', token, body: payload }) },
  listAssessmentBlueprints(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/assessment-blueprints${queryString(filters)}`, { token }) },
  createAssessmentBlueprint(token: string, payload: any) { return request('/api/academic-intelligence/assessment-blueprints', { method: 'POST', token, body: payload }) },
  listRemediationPacks(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/remediation-packs${queryString(filters)}`, { token }) },
  createRemediationPack(token: string, payload: any) { return request('/api/academic-intelligence/remediation-packs', { method: 'POST', token, body: payload }) },
  updateRemediationPack(token: string, packRef: string, payload: any) { return request(`/api/academic-intelligence/remediation-packs/${encodeURIComponent(packRef)}`, { method: 'PATCH', token, body: payload }) },
  listAcademicAuthoringTopics(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/authoring-topics${queryString(filters)}`, { token }) },
  saveAssessmentQuestionMappings(token: string, assessmentId: number | string, questionId: number | string, payload: any) { return request(`/api/assessments/${assessmentId}/questions/${questionId}/mappings`, { method: 'PUT', token, body: payload }) },
  getAssessmentOperationalIntelligence(token: string, assessmentId: number | string) { return request(`/api/assessments/${assessmentId}/operational-intelligence`, { token }) },
  getAcademicMarkSheet(token: string, assessmentId: number | string, mode: 'question' | 'topic' | 'overall' = 'question') { return request(`/api/assessments/${assessmentId}/academic-mark-sheet${queryString({ mode })}`, { token }) },
  saveAcademicMarkSheetDraft(token: string, assessmentId: number | string, payload: any) { return request(`/api/assessments/${assessmentId}/academic-mark-sheet/draft`, { method: 'POST', token, body: payload }) },
  publishAcademicMarkSheet(token: string, assessmentId: number | string, payload: any) { return request(`/api/assessments/${assessmentId}/academic-mark-sheet/publish`, { method: 'POST', token, body: payload }) },
  reopenAcademicMarkSheet(token: string, assessmentId: number | string, payload: any) { return request(`/api/assessments/${assessmentId}/academic-mark-sheet/reopen`, { method: 'POST', token, body: payload }) },
  updateQuestionSourcePermission(token: string, questionRef: string, payload: any) { return request(`/api/question-library/${encodeURIComponent(questionRef)}/source-permission`, { method: 'PATCH', token, body: payload }) },
  listTargetedAssessments(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-intelligence/targeted-assessments${queryString(filters)}`, { token }) },
  createTargetedAssessment(token: string, payload: any) { return request('/api/academic-intelligence/targeted-assessments', { method: 'POST', token, body: payload }) },
  getTargetedAssessment(token: string, generatedRef: string) { return request(`/api/academic-intelligence/targeted-assessments/${encodeURIComponent(generatedRef)}`, { token }) },
  generateTargetedAssessment(token: string, generatedRef: string, payload: any = {}) { return request(`/api/academic-intelligence/targeted-assessments/${encodeURIComponent(generatedRef)}/generate`, { method: 'POST', token, body: payload }) },
  saveTargetedAssessmentReview(token: string, generatedRef: string, payload: any) { return request(`/api/academic-intelligence/targeted-assessments/${encodeURIComponent(generatedRef)}/review`, { method: 'PUT', token, body: payload }) },
  replaceTargetedAssessmentQuestion(token: string, generatedRef: string, payload: any) { return request(`/api/academic-intelligence/targeted-assessments/${encodeURIComponent(generatedRef)}/replace-question`, { method: 'POST', token, body: payload }) },
  confirmTargetedAssessmentLearners(token: string, generatedRef: string, payload: any) { return request(`/api/academic-intelligence/targeted-assessments/${encodeURIComponent(generatedRef)}/confirm-learners`, { method: 'POST', token, body: payload }) },
  validateTargetedAssessment(token: string, generatedRef: string) { return request(`/api/academic-intelligence/targeted-assessments/${encodeURIComponent(generatedRef)}/validate`, { method: 'POST', token }) },
  approveTargetedAssessment(token: string, generatedRef: string) { return request(`/api/academic-intelligence/targeted-assessments/${encodeURIComponent(generatedRef)}/approve`, { method: 'POST', token }) },
  publishTargetedAssessment(token: string, generatedRef: string) { return request(`/api/academic-intelligence/targeted-assessments/${encodeURIComponent(generatedRef)}/publish`, { method: 'POST', token }) },
  listSupportCases(token: string, filters: Record<string, any> = {}) { return request(`/api/academic-support/cases${queryString(filters)}`, { token }) },
  getTeacherSupportSummary(token: string) { return request('/api/academic-support/summary', { token }) },
  getSupportCase(token: string, caseRef: string) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}`, { token }) },
  getLearnerSupport(token: string, learnerRef: string) { return request(`/api/academic-support/learners/${encodeURIComponent(learnerRef)}`, { token }) },
  getSupportTimeline(token: string, caseRef: string, filters: Record<string, any> = {}) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/timeline${queryString(filters)}`, { token }) },
  getSupportEvidence(token: string, caseRef: string) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/evidence`, { token }) },
  getSupportInterventions(token: string, caseRef: string) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/interventions`, { token }) },
  getEscalationPolicy(token: string) { return request('/api/academic-support/escalation-policy', { token }) },
  assignSupportCase(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/assign`, { method: 'POST', token, body: payload }) },
  acknowledgeSupportCase(token: string, caseRef: string, payload: any = {}) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/acknowledge`, { method: 'POST', token, body: payload }) },
  completeSupportAssignment(token: string, caseRef: string, payload: any = {}) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/complete-assignment`, { method: 'POST', token, body: payload }) },
  acceptSupportOwnership(token: string, caseRef: string, payload: any = {}) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/accept-ownership`, { method: 'POST', token, body: payload }) },
  requestSupportReassignment(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/request-reassignment`, { method: 'POST', token, body: payload }) },
  addSupportNote(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/add-note`, { method: 'POST', token, body: payload }) },
  createCaseTargetedAssessment(token: string, caseRef: string, payload: any = {}) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/create-targeted-assessment`, { method: 'POST', token, body: payload }) },
  createSupportIntervention(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/create-intervention`, { method: 'POST', token, body: payload }) },
  recordSupportSession(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/record-session`, { method: 'POST', token, body: payload }) },
  scheduleSupportReassessment(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/schedule-reassessment`, { method: 'POST', token, body: payload }) },
  reviewSupportOutcome(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/review-outcome`, { method: 'POST', token, body: payload }) },
  escalateSupportCase(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/escalate`, { method: 'POST', token, body: payload }) },
  resolveSupportCase(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/resolve`, { method: 'POST', token, body: payload }) },
  carryForwardSupportCase(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/carry-forward`, { method: 'POST', token, body: payload }) },
  requestAcademicSupportReview(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/request-academic-review`, { method: 'POST', token, body: payload }) },
  recommendSupportEscalation(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/recommend-escalation`, { method: 'POST', token, body: payload }) },
  draftGuardianSupportSummary(token: string, caseRef: string, payload: any) { return request(`/api/academic-support/cases/${encodeURIComponent(caseRef)}/draft-guardian-summary`, { method: 'POST', token, body: payload }) },
  getLibrarianDashboard(token: string) { return request('/api/library/dashboard', { token }) },
  listLibraryResources(token: string, filters: Record<string, any> = {}) { return request(`/api/library/catalogue${queryString(filters)}`, { token }) },
  createLibraryResource(token: string, payload: any) { return request('/api/library/catalogue', { method: 'POST', token, body: payload }) },
  listLibraryLoans(token: string, filters: Record<string, any> = {}) { return request(`/api/library/loans${queryString(filters)}`, { token }) },
  issueLibraryLoan(token: string, payload: any) { return request('/api/library/loans', { method: 'POST', token, body: payload }) },
  returnLibraryLoan(token: string, loanRef: string, payload: any) { return request(`/api/library/loans/${encodeURIComponent(loanRef)}/return`, { method: 'POST', token, body: payload }) },
  listLibraryComputers(token: string) { return request('/api/library/computers', { token }) },
  createLibraryComputer(token: string, payload: any) { return request('/api/library/computers', { method: 'POST', token, body: payload }) },
  updateLibraryComputer(token: string, computerRef: string, payload: any) { return request(`/api/library/computers/${encodeURIComponent(computerRef)}`, { method: 'PATCH', token, body: payload }) },
  listTeachingResources(token: string, filters: Record<string, any> = {}) { return request(`/api/teaching-resources${queryString(filters)}`, { token }) },
  getTeachingResource(token: string, resourceRef: string) { return request(`/api/teaching-resources/${encodeURIComponent(resourceRef)}`, { token }) },
  createTeachingResource(token: string, payload: any) { return request('/api/teaching-resources', { method: 'POST', token, body: payload }) },
  createTeachingResourceVersion(token: string, resourceRef: string, payload: any) { return request(`/api/teaching-resources/${encodeURIComponent(resourceRef)}/versions`, { method: 'POST', token, body: payload }) },
  listTeachingResourceRequests(token: string, filters: Record<string, any> = {}) { return request(`/api/teaching-resource-requests${queryString(filters)}`, { token }) },
  createTeachingResourceRequest(token: string, payload: any) { return request('/api/teaching-resource-requests', { method: 'POST', token, body: payload }) },
  updateTeachingResourceRequest(token: string, requestRef: string, payload: any) { return request(`/api/teaching-resource-requests/${encodeURIComponent(requestRef)}`, { method: 'PATCH', token, body: payload }) },
  transitionTeachingResource(token: string, resourceRef: string, payload: any) { return request(`/api/teaching-resources/${encodeURIComponent(resourceRef)}/status`, { method: 'PATCH', token, body: payload }) },
  reviewTeachingResource(token: string, resourceRef: string, payload: any) { return request(`/api/teaching-resources/${encodeURIComponent(resourceRef)}/reviews`, { method: 'POST', token, body: payload }) },
  downloadTeachingResource(token: string, resourceRef: string, versionRef?: string) { return requestBlob(`/api/teaching-resources/${encodeURIComponent(resourceRef)}/download${queryString(versionRef ? { version_ref: versionRef } : {})}`, { token }) },
  listPrintRequests(token: string, filters: Record<string, any> = {}) { return request(`/api/print-requests${queryString(filters)}`, { token }) },
  createPrintRequest(token: string, payload: any) { return request('/api/print-requests', { method: 'POST', token, body: payload }) },
  transitionPrintRequest(token: string, requestRef: string, payload: any) { return request(`/api/print-requests/${encodeURIComponent(requestRef)}`, { method: 'PATCH', token, body: payload }) },
  browseInstitutionalArchive(token: string, filters: Record<string, any> = {}) { return request(`/api/institutional-archive${queryString(filters)}`, { token }) },
  getClassroomSetup(token: string) { return request('/api/classroom-mode/setup', { token }) },
  listClassroomHistory(token: string, filters: Record<string, any> = {}) { return request(`/api/classroom-mode/history${queryString(filters)}`, { token }) },
  startClassroomSession(token: string, payload: any) { return request('/api/classroom-mode/sessions', { method: 'POST', token, body: payload }) },
  getClassroomSession(token: string, sessionRef: string) { return request(`/api/classroom-mode/sessions/${encodeURIComponent(sessionRef)}`, { token }) },
  saveClassroomSession(token: string, sessionRef: string, payload: any) { return request(`/api/classroom-mode/sessions/${encodeURIComponent(sessionRef)}`, { method: 'PATCH', token, body: payload }) },
  saveClassroomAttendance(token: string, sessionRef: string, payload: any) { return request(`/api/classroom-mode/sessions/${encodeURIComponent(sessionRef)}/attendance`, { method: 'POST', token, body: payload }) },
  attachClassroomResource(token: string, sessionRef: string, payload: any) { return request(`/api/classroom-mode/sessions/${encodeURIComponent(sessionRef)}/resources`, { method: 'POST', token, body: payload }) },
  completeClassroomSession(token: string, sessionRef: string, payload: any) { return request(`/api/classroom-mode/sessions/${encodeURIComponent(sessionRef)}/complete`, { method: 'POST', token, body: payload }) },

  searchSuggestions() {
    return Promise.resolve({ suggestions: [] })
  },

  listNotifications(token: string) {
    return request('/api/notifications', { token })
  },

  markNotificationRead(token: string, notificationId: any) {
    return request(`/api/notifications/${notificationId}/read`, { method: 'PATCH', token })
  },

  dismissNotification(token: string, notificationId: any) {
    return request(`/api/notifications/${notificationId}/dismiss`, { method: 'PATCH', token })
  },

  sendOperationalReminder(token: string, payload: any) { return request('/api/director/reminders', { method: 'POST', token, body: payload }) },
  escalateToHeadteacher(token: string, payload: any) { return request('/api/director/escalations', { method: 'POST', token, body: payload }) },
  getStaffAttendanceToday(token: string, date?: string) { return request(`/api/staff/attendance/today${queryString(date ? { date } : {})}`, { token }) },
  recordStaffAttendance(token: string, payload: any) { return request('/api/staff/attendance', { method: 'POST', token, body: payload }) },
  selfCheckInStaffAttendance(token: string) { return request('/api/staff/attendance/self-check-in', { method: 'POST', token }) },
  sendFeeReminder(token: string, payload: any) { return request('/api/director/finance/fee-reminders', { method: 'POST', token, body: payload }) },
  createPaymentPromise(token: string, payload: any) { return request('/api/director/finance/payment-promises', { method: 'POST', token, body: payload }) },
  updatePaymentPromise(token: string, id: any, payload: any) { return request(`/api/director/finance/payment-promises/${id}`, { method: 'PATCH', token, body: payload }) },
  getWhatsAppSettings(token: string) { return request('/api/director/settings/whatsapp', { token }) },
  updateWhatsAppSettings(token: string, payload: any) { return request('/api/director/settings/whatsapp', { method: 'PATCH', token, body: payload }) },
  runReminderEngine(token: string) { return request('/api/system/run-reminder-engine', { method: 'POST', token }) },

  getProfile() {
    return Promise.resolve(null)
  },

  getStationEnforcementHistory() {
    return Promise.resolve({ items: [] })
  },

  getHoardingWatchlistDetail() {
    return Promise.resolve(null)
  },
}
