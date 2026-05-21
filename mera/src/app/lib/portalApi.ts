const storageKey = 'mera.portal.session'
const apiBaseUrl =
  import.meta.env.VITE_MERA_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  ''

function resolveApiOrigin() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin).origin
  }
  if (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
    return 'http://localhost:4000'
  }
  return window.location.origin
}

export function resolvePortalAssetUrl(assetPath: string) {
  const raw = String(assetPath || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return new URL(raw.startsWith('/') ? raw : `/${raw}`, resolveApiOrigin()).toString()
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
    throw new Error(payload?.error || `Request failed (${response.status})`)
  }
  return payload?.data
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
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  })

  const payload = await response.json().catch(() => ({}))
  return parseResponse(response, payload)
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
  login(credentials: { email: string; password: string }) {
    return request('/api/mera/auth/login', { method: 'POST', body: credentials })
  },

  verifyLoginCode(payload: { challengeId: string; code: string; trustDevice?: boolean }) {
    return request('/api/mera/auth/login/verify', { method: 'POST', body: payload })
  },

  resendLoginCode(payload: { challengeId: string }) {
    return request('/api/mera/auth/login/resend', { method: 'POST', body: payload })
  },

  me(token: string) {
    return request('/api/mera/auth/me', { token })
  },

  updateMe(token: string, payload: any) {
    return request('/api/mera/auth/me', { method: 'PATCH', token, body: payload })
  },

  changePassword(token: string, payload: any) {
    return request('/api/mera/auth/password', { method: 'PATCH', token, body: payload })
  },

  logout(token: string) {
    return request('/api/mera/auth/logout', { method: 'POST', token })
  },

  getSnapshot(token: string) {
    return request('/api/mera/snapshot', { token })
  },

  getMyPreferences(token: string) {
    return request('/api/mera/auth/preferences', { token })
  },

  updateMyPreferences(token: string, payload: any) {
    return request('/api/mera/auth/preferences', { method: 'PATCH', token, body: payload })
  },

  listSessions(token: string) {
    return request('/api/mera/auth/sessions', { token })
  },

  revokeOtherSessions(token: string) {
    return request('/api/mera/auth/sessions/revoke-others', { method: 'POST', token })
  },

  revokeSession(token: string, publicId: string) {
    return request(`/api/mera/auth/sessions/${encodeURIComponent(publicId)}/revoke`, { method: 'POST', token })
  },

  getDashboardOverview(token: string) {
    return request('/api/mera/dashboard/overview', { token })
  },

  getFlaggedStations(token: string) {
    return request('/api/mera/dashboard/flagged-stations', { token })
  },

  getShortageHeatmap(token: string) {
    return request('/api/mera/dashboard/shortage-heatmap', { token })
  },

  getComplaintMetrics(token: string) {
    return request('/api/mera/dashboard/complaint-metrics', { token })
  },

  getInspectionMetrics(token: string) {
    return request('/api/mera/dashboard/inspection-metrics', { token })
  },

  getSidebarStats(token: string, signal?: AbortSignal) {
    return request('/api/mera/dashboard/sidebar-stats', { token, signal })
  },

  getDemandForecastSummary(token: string) {
    return request('/api/mera/dashboard/demand-forecast', { token })
  },

  getOpsPredictions(token: string, filters: Record<string, any> = {}, signal?: AbortSignal) {
    return request(`/api/mera/dashboard/ops-predictions${queryString(filters)}`, { token, signal })
  },

  getNationalOperationsDashboard(token: string, availabilityInterval?: string, signal?: AbortSignal) {
    const params = new URLSearchParams()
    if (availabilityInterval) params.set('availabilityInterval', availabilityInterval)
    const query = params.toString()
    return request(`/api/mera/dashboard/national-operations${query ? `?${query}` : ''}`, { token, signal })
  },

  quickSearch(token: string, query: string, limit = 10, signal?: AbortSignal) {
    return request(`/api/mera/search${queryString({ q: query, limit })}`, { token, signal })
  },

  fullSearch(token: string, filters: Record<string, any> = {}, signal?: AbortSignal) {
    return request(`/api/mera/search/full${queryString(filters)}`, { token, signal })
  },

  listTasks(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/tasks${queryString(filters)}`, { token })
  },

  listMyTasks(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/tasks/my${queryString(filters)}`, { token })
  },

  getTask(token: string, taskNumber: string) {
    return request(`/api/mera/tasks/${encodeURIComponent(taskNumber)}`, { token })
  },

  createTask(token: string, payload: any) {
    return request('/api/mera/tasks', { method: 'POST', token, body: payload })
  },

  updateTask(token: string, taskNumber: string, payload: any) {
    return request(`/api/mera/tasks/${encodeURIComponent(taskNumber)}`, { method: 'PATCH', token, body: payload })
  },

  changeTaskStatus(token: string, taskNumber: string, status: string, reason?: string) {
    return request(`/api/mera/tasks/${encodeURIComponent(taskNumber)}/status`, {
      method: 'PATCH',
      token,
      body: { status, ...(reason ? { reason } : {}) },
    })
  },

  addTaskNote(token: string, taskNumber: string, payload: any) {
    return request(`/api/mera/tasks/${encodeURIComponent(taskNumber)}/notes`, { method: 'POST', token, body: payload })
  },

  addTaskEvidence(token: string, taskNumber: string, payload: any) {
    const hasFile = typeof File !== 'undefined' && payload?.file instanceof File
    if (hasFile) {
      const formData = new FormData()
      formData.set('evidence', payload.file)
      Object.entries(payload || {}).forEach(([key, value]) => {
        if (key === 'file' || value === undefined || value === null || value === '') return
        formData.set(key, value as any)
      })
      return request(`/api/mera/tasks/${encodeURIComponent(taskNumber)}/evidence`, {
        method: 'POST',
        token,
        body: formData,
        isForm: true,
      })
    }
    return request(`/api/mera/tasks/${encodeURIComponent(taskNumber)}/evidence`, { method: 'POST', token, body: payload })
  },

  escalateTask(token: string, taskNumber: string, payload: any) {
    return request(`/api/mera/tasks/${encodeURIComponent(taskNumber)}/escalate`, { method: 'POST', token, body: payload })
  },

  completeTask(token: string, taskNumber: string, completionNotes: string) {
    return request(`/api/mera/tasks/${encodeURIComponent(taskNumber)}/complete`, {
      method: 'POST',
      token,
      body: { completionNotes },
    })
  },

  getTaskStatsOverview(token: string) {
    return request('/api/mera/tasks/stats/overview', { token })
  },

  listAssignableUsers(token: string) {
    return request('/api/mera/users/assignable', { token })
  },

  listNotifications(token: string, limit = 20) {
    return request(`/api/mera/notifications${queryString({ limit })}`, { token })
  },

  markNotificationRead(token: string, publicId: string) {
    return request(`/api/mera/notifications/${encodeURIComponent(publicId)}/read`, { method: 'PATCH', token })
  },

  getHoardingWatchlist(token: string) {
    return request('/api/mera/hoarding-watchlist', { token })
  },

  getHoardingWatchlistDetail(token: string, stationPublicId: string) {
    return request(`/api/mera/hoarding-watchlist/${stationPublicId}`, { token })
  },

  listFuelDeliveryLogs(token: string) {
    return request('/api/mera/fuel-delivery-logs', { token })
  },

  createFuelDeliveryLog(token: string, payload: any) {
    return request('/api/mera/fuel-delivery-logs', { method: 'POST', token, body: payload })
  },

  listAvailabilityReports(token: string) {
    return request('/api/mera/availability-reports', { token })
  },

  createAvailabilityReport(token: string, payload: any) {
    return request('/api/mera/availability-reports', { method: 'POST', token, body: payload })
  },

  listComplaints(token: string) {
    return request('/api/mera/complaints', { token })
  },

  createComplaint(payload: any) {
    const formData = new FormData()
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      formData.set(key, value as any)
    })
    return request('/api/mera/complaints', { method: 'POST', body: formData, isForm: true })
  },

  assignComplaint(token: string, complaintPublicId: string, officerPublicId: string) {
    return request(`/api/mera/complaints/${complaintPublicId}/assign`, {
      method: 'PATCH',
      token,
      body: { officerPublicId },
    })
  },

  updateComplaintStatus(token: string, complaintPublicId: string, complaintStatus: string) {
    return request(`/api/mera/complaints/${complaintPublicId}/status`, {
      method: 'PATCH',
      token,
      body: { complaintStatus },
    })
  },

  listFlags(token: string) {
    return request('/api/mera/flags', { token })
  },

  createFlag(token: string, payload: any) {
    return request('/api/mera/flags', { method: 'POST', token, body: payload })
  },

  resolveFlag(token: string, publicId: string, resolvedStatus: string) {
    return request(`/api/mera/flags/${publicId}/resolve`, {
      method: 'PATCH',
      token,
      body: { resolvedStatus },
    })
  },

  listInspections(token: string) {
    return request('/api/mera/inspections', { token })
  },

  createInspection(token: string, payload: any) {
    return request('/api/mera/inspections', { method: 'POST', token, body: payload })
  },

  listEnforcementActions(token: string) {
    return request('/api/mera/enforcement-actions', { token })
  },

  createEnforcementAction(token: string, payload: any) {
    return request('/api/mera/enforcement-actions', { method: 'POST', token, body: payload })
  },

  getStationEnforcementHistory(token: string, stationPublicId: string) {
    return request(`/api/mera/stations/${stationPublicId}/enforcement-actions`, { token })
  },

  listLicenseRegistry(token: string) {
    return request('/api/mera/licenses', { token })
  },

  attachLicense(token: string, payload: any) {
    return request('/api/mera/licenses', { method: 'POST', token, body: payload })
  },

  updateLicense(token: string, licenseId: number, payload: any) {
    return request(`/api/mera/licenses/${licenseId}`, { method: 'PATCH', token, body: payload })
  },

  getLicenseDetail(token: string, licenseId: string, options: Record<string, any> = {}, signal?: AbortSignal) {
    return request(`/api/mera/licenses/${encodeURIComponent(licenseId)}${queryString(options)}`, { token, signal })
  },

  getExpiryAlerts(token: string) {
    return request('/api/mera/licenses/expiry-alerts', { token })
  },

  getTopComplaintStations(token: string) {
    return request('/api/mera/analytics/top-complaint-stations', { token })
  },

  getDistrictShortageSummaries(token: string) {
    return request('/api/mera/analytics/district-shortage-summaries', { token })
  },

  getRepeatedOffenders(token: string) {
    return request('/api/mera/analytics/repeated-offenders', { token })
  },

  getMonthlyReports(token: string) {
    return request('/api/mera/analytics/monthly-reports', { token })
  },

  listProfiles(token: string) {
    return request('/api/mera/stations/regulatory-profiles', { token })
  },

  getProfile(token: string, stationPublicId: string) {
    return request(`/api/mera/stations/${stationPublicId}/regulatory-profile`, { token })
  },

  getStationDetail(token: string, stationPublicId: string, signal?: AbortSignal) {
    return request(`/api/mera/stations/${encodeURIComponent(stationPublicId)}`, { token, signal })
  },

  getStationManagerDetail(token: string, userPublicId: string, signal?: AbortSignal) {
    return request(`/api/mera/station-managers/${encodeURIComponent(userPublicId)}`, { token, signal })
  },

  getComplaintDetail(token: string, complaintPublicId: string, signal?: AbortSignal) {
    return request(`/api/mera/complaints/${encodeURIComponent(complaintPublicId)}`, { token, signal })
  },

  getCaseDetail(token: string, caseId: string, signal?: AbortSignal) {
    return request(`/api/mera/cases/${encodeURIComponent(caseId)}`, { token, signal })
  },

  getTaskEvidenceDetail(token: string, evidenceId: string, signal?: AbortSignal) {
    return request(`/api/mera/documents/task-evidence/${encodeURIComponent(evidenceId)}`, { token, signal })
  },

  getComplaintMediaDetail(token: string, complaintPublicId: string, signal?: AbortSignal) {
    return request(`/api/mera/documents/complaint-media/${encodeURIComponent(complaintPublicId)}`, { token, signal })
  },

  listUsers(token: string) {
    return request('/api/mera/users', { token })
  },

  createUser(token: string, payload: any) {
    return request('/api/mera/users', { method: 'POST', token, body: payload })
  },

  updateUserStatus(token: string, publicId: string, accountStatus: string) {
    return request(`/api/mera/users/${publicId}/status`, {
      method: 'PATCH',
      token,
      body: { accountStatus },
    })
  },

  getUserDetail(token: string, publicId: string, signal?: AbortSignal) {
    return request(`/api/mera/users/${encodeURIComponent(publicId)}`, { token, signal })
  },

  listAuditLogs(token: string) {
    return request('/api/mera/audit-logs', { token })
  },
}
