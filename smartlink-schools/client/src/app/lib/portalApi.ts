const storageKey = 'smartlink.schools.session'
const apiBaseUrl =
  import.meta.env.VITE_SCHOOLS_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ''

function resolveApiOrigin() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin).origin
  }
  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location
    const isLocalHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(hostname)
    const isLanAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':')
    if (isLocalHost || isLanAddress) {
      return `${protocol}//${hostname}:4307`
    }
  }
  return window.location.origin
}

export function resolvePortalAssetUrl(assetPath: string) {
  const raw = String(assetPath || '').trim()
  if (!raw) return ''
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
    throw new Error(payload?.error || payload?.message || `Request failed (${response.status})`)
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
  const response = await fetch(`${resolveApiOrigin()}${pathname}`, {
    method,
    signal,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  })

  const payload = await response.json().catch(() => ({}))
  return parseResponse(response, payload)
}

async function requestBlob(pathname: string, { method = 'GET', body, token, isForm = false, signal }: any = {}) {
  const response = await fetch(`${resolveApiOrigin()}${pathname}`, {
    method,
    signal,
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

const localPreferencesKey = 'smartlink.schools.preferences'

function readLocalPreferences() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(localPreferencesKey) || '{}')
  } catch {
    return {}
  }
}

function writeLocalPreferences(patch: any) {
  if (typeof window === 'undefined') return patch || {}
  const next = { ...readLocalPreferences(), ...(patch || {}) }
  window.localStorage.setItem(localPreferencesKey, JSON.stringify(next))
  return next
}

export const portalApi = {
  login(credentials: { email?: string; studentCode?: string; student_code?: string; password: string; role?: string; loginType?: string; login_type?: string }) {
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

  getPacket(_token: string) {
    return Promise.resolve({})
  },

  getMyPreferences(_token: string) {
    return Promise.resolve(readLocalPreferences())
  },

  updateMyPreferences(_token: string, payload: any) {
    return Promise.resolve(writeLocalPreferences(payload))
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

  getStudentPortal(token: string) {
    return request('/api/student-portal', { token })
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

  uploadStudentPhoto(token: string, payload: any) {
    return request('/api/students/photo', { method: 'POST', token, body: payload })
  },

  listFeeAccounts(token: string) {
    return request('/api/fees', { token })
  },

  recordPayment(token: string, payload: any) {
    return request('/api/fees/payments', { method: 'POST', token, body: payload })
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

  uploadAssessmentMedia(token: string, id: any, payload: any) {
    return request(`/api/assessments/${id}/media`, { method: 'POST', token, body: payload })
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

  getSyllabusSetup(token: string) {
    return request('/api/syllabus/setup', { token })
  },

  listSyllabusUploads(token: string) {
    return request('/api/syllabus/uploads', { token })
  },

  uploadSyllabus(token: string, payload: any) {
    return request('/api/syllabus/uploads', { method: 'POST', token, body: payload })
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

  generateDrill(token: string, studentId: any, payload: any = {}) {
    return request(`/api/drills/generate/${studentId}`, { method: 'POST', token, body: payload })
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

  quickSearch(token: string, query: string, limit = 10, signal?: AbortSignal) {
    return request(`/api/search${queryString({ q: query, limit })}`, { token, signal })
  },

  fullSearch(token: string, filters: Record<string, any> = {}, signal?: AbortSignal) {
    return request(`/api/search${queryString(filters)}`, { token, signal })
  },

  searchSuggestions() {
    return Promise.resolve({ suggestions: [] })
  },

  markNotificationRead() {
    return Promise.resolve({ ok: true })
  },

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
