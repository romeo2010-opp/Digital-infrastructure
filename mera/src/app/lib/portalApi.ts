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

async function request(pathname: string, { method = 'GET', body, token, isForm = false }: any = {}) {
  const response = await fetch(`${resolveApiOrigin()}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  })

  const payload = await response.json().catch(() => ({}))
  return parseResponse(response, payload)
}

export const portalApi = {
  login(credentials: { email: string; password: string }) {
    return request('/api/mera/auth/login', { method: 'POST', body: credentials })
  },

  me(token: string) {
    return request('/api/mera/auth/me', { token })
  },

  logout(token: string) {
    return request('/api/mera/auth/logout', { method: 'POST', token })
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

  listAuditLogs(token: string) {
    return request('/api/mera/audit-logs', { token })
  },
}
