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
  const apiOrigin = resolveApiOrigin()

  try {
    const parsed = new URL(raw, apiOrigin)
    if (parsed.pathname.startsWith('/uploads/mera/')) {
      return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, apiOrigin).toString()
    }
    if (/^https?:\/\//i.test(raw)) return raw
    return parsed.toString()
  } catch {
    return new URL(raw.startsWith('/') ? raw : `/${raw}`, apiOrigin).toString()
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

  getPacket(token: string, key: string, params: Record<string, any> = {}, signal?: AbortSignal) {
    return request(`/api/mera/packets/${encodeURIComponent(key)}${queryString(params)}`, { token, signal })
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

  getNationalConsumption(token: string, range = '7d', signal?: AbortSignal) {
    return request(`/api/mera/national-consumption${queryString({ range })}`, { token, signal })
  },

  quickSearch(token: string, query: string, limit = 10, signal?: AbortSignal) {
    return request(`/api/mera/search${queryString({ q: query, limit })}`, { token, signal })
  },

  fullSearch(token: string, filters: Record<string, any> = {}, signal?: AbortSignal) {
    return request(`/api/mera/search/full${queryString(filters)}`, { token, signal })
  },

  searchSuggestions(token: string, query: string, limit = 8, signal?: AbortSignal) {
    return request(`/api/mera/search/suggestions${queryString({ q: query, limit })}`, { token, signal })
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

  getRiskSummary(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/risk/summary${queryString(filters)}`, { token })
  },

  listRiskStations(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/risk/stations${queryString(filters)}`, { token })
  },

  getRiskStation(token: string, stationId: string) {
    return request(`/api/mera/risk/stations/${encodeURIComponent(stationId)}`, { token })
  },

  recalculateRisk(token: string) {
    return request('/api/mera/risk/recalculate', { method: 'POST', token })
  },

  getRiskWatchlist(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/risk/watchlist${queryString(filters)}`, { token })
  },

  listAlerts(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/alerts${queryString(filters)}`, { token })
  },

  acknowledgeAlert(token: string, id: string) {
    return request(`/api/mera/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'POST', token })
  },

  dismissAlert(token: string, id: string, payload: any) {
    return request(`/api/mera/alerts/${encodeURIComponent(id)}/dismiss`, { method: 'POST', token, body: payload })
  },

  openCaseFromAlert(token: string, id: string) {
    return request(`/api/mera/alerts/${encodeURIComponent(id)}/open-case`, { method: 'POST', token })
  },

  assignInspectionFromAlert(token: string, id: string, payload: any = {}) {
    return request(`/api/mera/alerts/${encodeURIComponent(id)}/assign-inspection`, { method: 'POST', token, body: payload })
  },

  listFuelDeliveryLogs(token: string) {
    return request('/api/mera/fuel-delivery-logs', { token })
  },

  listFuelSupplyDeliveries(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/fuel-supply/deliveries${queryString(filters)}`, { token })
  },

  createFuelSupplyDelivery(token: string, payload: any) {
    return request('/api/mera/fuel-supply/deliveries', { method: 'POST', token, body: payload })
  },

  updateFuelSupplyDelivery(token: string, id: string, payload: any) {
    return request(`/api/mera/fuel-supply/deliveries/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: payload })
  },

  getFuelSupplyTimeline(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/fuel-supply/timeline${queryString(filters)}`, { token })
  },

  getStationFuelSupply(token: string, stationId: string) {
    return request(`/api/mera/fuel-supply/stations/${encodeURIComponent(stationId)}`, { token })
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

  listComplaintClusters(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/complaints/clusters${queryString(filters)}`, { token })
  },

  getComplaintTrends(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/complaints/trends${queryString(filters)}`, { token })
  },

  linkComplaintToCase(token: string, complaintPublicId: string, caseId: string) {
    return request(`/api/mera/complaints/${encodeURIComponent(complaintPublicId)}/link-case`, {
      method: 'POST',
      token,
      body: { caseId },
    })
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

  listCases(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/cases${queryString(filters)}`, { token })
  },

  createCase(token: string, payload: any) {
    return request('/api/mera/cases', { method: 'POST', token, body: payload })
  },

  updateCase(token: string, caseId: string, payload: any) {
    return request(`/api/mera/cases/${encodeURIComponent(caseId)}`, { method: 'PATCH', token, body: payload })
  },

  addCaseNote(token: string, caseId: string, payload: any) {
    return request(`/api/mera/cases/${encodeURIComponent(caseId)}/notes`, { method: 'POST', token, body: payload })
  },

  addCaseEvidence(token: string, caseId: string, payload: any) {
    return request(`/api/mera/cases/${encodeURIComponent(caseId)}/evidence`, { method: 'POST', token, body: payload })
  },

  escalateCase(token: string, caseId: string, payload: any = {}) {
    return request(`/api/mera/cases/${encodeURIComponent(caseId)}/escalate`, { method: 'POST', token, body: payload })
  },

  closeCase(token: string, caseId: string, payload: any = {}) {
    return request(`/api/mera/cases/${encodeURIComponent(caseId)}/close`, { method: 'POST', token, body: payload })
  },

  exportCaseEvidencePack(token: string, caseId: string) {
    return request(`/api/mera/cases/${encodeURIComponent(caseId)}/evidence-pack`, { token })
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

  getInspection(token: string, id: string) {
    return request(`/api/mera/inspections/${encodeURIComponent(id)}`, { token })
  },

  updateInspection(token: string, id: string, payload: any) {
    return request(`/api/mera/inspections/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: payload })
  },

  completeInspection(token: string, id: string, payload: any) {
    return request(`/api/mera/inspections/${encodeURIComponent(id)}/complete`, { method: 'POST', token, body: payload })
  },

  getRecommendedInspections(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/inspections/recommended${queryString(filters)}`, { token })
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

  listOfficialPrices(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/prices/official${queryString(filters)}`, { token })
  },

  createOfficialPrice(token: string, payload: any) {
    return request('/api/mera/prices/official', { method: 'POST', token, body: payload })
  },

  listPriceCompliance(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/prices/compliance${queryString(filters)}`, { token })
  },

  listPriceViolations(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/prices/violations${queryString(filters)}`, { token })
  },

  getReportTypes(token: string) {
    return request('/api/mera/reports/types', { token })
  },

  generateReport(token: string, payload: any) {
    return request('/api/mera/reports/generate', { method: 'POST', token, body: payload })
  },

  listGeneratedReports(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/reports${queryString(filters)}`, { token })
  },

  getGeneratedReport(token: string, id: string) {
    return request(`/api/mera/reports/${encodeURIComponent(id)}`, { token })
  },

  downloadGeneratedReport(token: string, id: string) {
    return request(`/api/mera/reports/${encodeURIComponent(id)}/download`, { token })
  },

  listPublicNotices(token: string, filters: Record<string, any> = {}) {
    return request(`/api/mera/public-notices${queryString(filters)}`, { token })
  },

  createPublicNotice(token: string, payload: any) {
    return request('/api/mera/public-notices', { method: 'POST', token, body: payload })
  },

  updatePublicNotice(token: string, id: string, payload: any) {
    return request(`/api/mera/public-notices/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: payload })
  },

  submitPublicNotice(token: string, id: string) {
    return request(`/api/mera/public-notices/${encodeURIComponent(id)}/submit`, { method: 'POST', token })
  },

  approvePublicNotice(token: string, id: string, payload: any = {}) {
    return request(`/api/mera/public-notices/${encodeURIComponent(id)}/approve`, { method: 'POST', token, body: payload })
  },

  rejectPublicNotice(token: string, id: string, payload: any = {}) {
    return request(`/api/mera/public-notices/${encodeURIComponent(id)}/reject`, { method: 'POST', token, body: payload })
  },

  publishPublicNotice(token: string, id: string) {
    return request(`/api/mera/public-notices/${encodeURIComponent(id)}/publish`, { method: 'POST', token })
  },

  getPublicNoticeHistory(token: string, id: string) {
    return request(`/api/mera/public-notices/${encodeURIComponent(id)}/history`, { token })
  },

  getFuelStressAnalytics(token: string) {
    return request('/api/mera/analytics/fuel-stress', { token })
  },

  getDistrictAnalytics(token: string) {
    return request('/api/mera/analytics/districts', { token })
  },

  getStationAnalytics(token: string) {
    return request('/api/mera/analytics/stations', { token })
  },

  getTrendAnalytics(token: string) {
    return request('/api/mera/analytics/trends', { token })
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

  updateUserPermissions(token: string, publicId: string, payload: any) {
    return request(`/api/mera/users/${encodeURIComponent(publicId)}/permissions`, {
      method: 'PATCH',
      token,
      body: payload,
    })
  },

  revokeUserSessions(token: string, publicId: string) {
    return request(`/api/mera/users/${encodeURIComponent(publicId)}/sessions/revoke`, {
      method: 'POST',
      token,
    })
  },

  getUserDetail(token: string, publicId: string, signal?: AbortSignal) {
    return request(`/api/mera/users/${encodeURIComponent(publicId)}`, { token, signal })
  },

  listAuditLogs(token: string) {
    return request('/api/mera/audit-logs', { token })
  },
}
