import { getStoredAccessToken, setStoredAccessToken } from '../authSession'
import { assertUserAppAccessToken } from '../userSessionGuard'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''

function resolveApiOrigin() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin).origin
  }
  return window.location.origin
}

function isAuthFailure(response, payload) {
  if (response.status === 401) return true
  const message = String(payload?.error || '').toLowerCase()
  return (
    message.includes('invalid or expired token') ||
    message.includes('missing access token') ||
    message.includes('missing bearer token') ||
    message.includes('session revoked or expired')
  )
}

async function refreshAccessToken() {
  const response = await fetch(`${resolveApiOrigin()}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Refresh failed (${response.status})`)
  }
  const token = String(payload?.data?.accessToken || '').trim()
  if (!token) throw new Error('Refresh did not return access token')
  assertUserAppAccessToken(token)
  setStoredAccessToken(token)
  return token
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let token = String(getStoredAccessToken() || '').trim()
  if (!token) {
    token = await refreshAccessToken()
  }
  assertUserAppAccessToken(token)

  const execute = (accessToken) =>
    fetch(`${resolveApiOrigin()}${path}`, {
      method,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })

  let response = await execute(token)
  let payload = await response.json().catch(() => ({}))

  if (isAuthFailure(response, payload)) {
    token = await refreshAccessToken()
    response = await execute(token)
    payload = await response.json().catch(() => ({}))
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed (${response.status})`)
  }

  return payload.data
}

async function requestBlob(path, { method = 'GET', body, signal } = {}) {
  let token = String(getStoredAccessToken() || '').trim()
  if (!token) {
    token = await refreshAccessToken()
  }
  assertUserAppAccessToken(token)

  const execute = (accessToken) =>
    fetch(`${resolveApiOrigin()}${path}`, {
      method,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })

  let response = await execute(token)

  if (response.status === 401) {
    token = await refreshAccessToken()
    response = await execute(token)
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || `Request failed (${response.status})`)
  }

  return response.blob()
}

function queryString(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, String(value))
  })
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const fleetApi = {
  memberships() {
    return request('/api/fleet/memberships/me')
  },
  requestAccess(payload) {
    return request('/api/fleet/access-requests', { method: 'POST', body: payload })
  },
  acceptInvitation(invitationId) {
    return request('/api/fleet/invitations/accept', { method: 'POST', body: { invitationId } })
  },
  createAccount(payload) {
    return request('/api/fleet/accounts', { method: 'POST', body: payload })
  },
  account(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}`)
  },
  updateAccount(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}`, { method: 'PATCH', body: payload })
  },
  dashboard(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/dashboard`)
  },
  financialOps(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/financial-ops${queryString(params)}`)
  },
  departments(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/departments`)
  },
  saveDepartment(fleetId, payload, departmentId = '') {
    const path = departmentId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/departments/${encodeURIComponent(departmentId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/departments`
    return request(path, { method: departmentId ? 'PATCH' : 'POST', body: payload })
  },
  archiveDepartment(fleetId, departmentId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/departments/${encodeURIComponent(departmentId)}/archive`, {
      method: 'POST',
      body: {},
    })
  },
  allocations(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/allocations`)
  },
  saveAllocation(fleetId, payload, allocationId = '') {
    const path = allocationId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/allocations/${encodeURIComponent(allocationId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/allocations`
    return request(path, { method: allocationId ? 'PATCH' : 'POST', body: payload })
  },
  adjustAllocation(fleetId, allocationId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/allocations/${encodeURIComponent(allocationId)}/adjustments`, {
      method: 'POST',
      body: payload,
    })
  },
  allocationRolloverPreview(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/allocations/rollover-preview`, { method: 'POST', body: payload })
  },
  allocationRolloverExecute(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/allocations/rollover-execute`, { method: 'POST', body: payload })
  },
  allocationUsageSummary(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/allocations/usage-summary`)
  },
  fuelCardProviders(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-card-providers`)
  },
  saveFuelCardProvider(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-card-providers`, { method: 'POST', body: payload })
  },
  fuelCards(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-cards`)
  },
  saveFuelCard(fleetId, payload, fuelCardId = '') {
    const path = fuelCardId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-cards/${encodeURIComponent(fuelCardId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-cards`
    return request(path, { method: fuelCardId ? 'PATCH' : 'POST', body: payload })
  },
  createFuelCardImport(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-card-imports`, { method: 'POST', body: payload })
  },
  fuelCardReconciliation(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-card-reconciliation`)
  },
  matchFuelCardReconciliation(fleetId, matchId, payload = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-card-reconciliation/${encodeURIComponent(matchId)}/match`, {
      method: 'POST',
      body: payload,
    })
  },
  flagFuelCardReconciliation(fleetId, matchId, payload = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-card-reconciliation/${encodeURIComponent(matchId)}/flag`, {
      method: 'POST',
      body: payload,
    })
  },
  members(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/members`)
  },
  memberDetails(fleetId, memberId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/members/${encodeURIComponent(memberId)}`)
  },
  inviteMember(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/members/invite`, { method: 'POST', body: payload })
  },
  invitations(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/invitations${queryString(params)}`)
  },
  resendInvitation(fleetId, invitationId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/invitations/${encodeURIComponent(invitationId)}/resend`, {
      method: 'POST',
      body: {},
    })
  },
  cancelInvitation(fleetId, invitationId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/invitations/${encodeURIComponent(invitationId)}/cancel`, {
      method: 'POST',
      body: {},
    })
  },
  updateMemberRole(fleetId, memberId, role) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/members/${encodeURIComponent(memberId)}/role`, {
      method: 'PATCH',
      body: { role },
    })
  },
  suspendMember(fleetId, memberId, reason = '') {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/members/${encodeURIComponent(memberId)}/suspend`, {
      method: 'POST',
      body: { reason },
    })
  },
  removeMember(fleetId, memberId, reason = '') {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/members/${encodeURIComponent(memberId)}/remove`, {
      method: 'POST',
      body: { reason },
    })
  },
  vehicles(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/vehicles`)
  },
  addVehicle(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/vehicles`, { method: 'POST', body: payload })
  },
  updateVehicle(fleetId, vehicleId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: 'PATCH',
      body: payload,
    })
  },
  assignDriver(fleetId, vehicleId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/vehicles/${encodeURIComponent(vehicleId)}/assignments`, {
      method: 'POST',
      body: payload,
    })
  },
  wallet(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/wallet`)
  },
  walletTransactions(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/wallet/transactions${queryString(params)}`)
  },
  topup(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/wallet/topups`, { method: 'POST', body: payload })
  },
  fuelRequests(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-requests${queryString(params)}`)
  },
  allocateFunds(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-allocations`, { method: 'POST', body: payload })
  },
  approveRequest(fleetId, requestId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-requests/${encodeURIComponent(requestId)}/approve`, {
      method: 'POST',
      body: {},
    })
  },
  rejectRequest(fleetId, requestId, reason) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      body: { reason },
    })
  },
  transactions(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/transactions${queryString(params)}`)
  },
  exportTransactionsCsv(fleetId, params = {}) {
    return requestBlob(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/transactions/export.csv${queryString(params)}`)
  },
  createTransaction(fleetId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/transactions`, { method: 'POST', body: payload })
  },
  policies(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/policies`)
  },
  savePolicy(fleetId, payload, policyId = '') {
    const path = policyId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/policies/${encodeURIComponent(policyId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/policies`
    return request(path, { method: policyId ? 'PATCH' : 'POST', body: payload })
  },
  alerts(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/alerts`)
  },
  markAlertRead(fleetId, alertId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/alerts/${encodeURIComponent(alertId)}/read`, {
      method: 'POST',
      body: {},
    })
  },
  report(fleetId, reportType, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/reports/${encodeURIComponent(reportType)}${queryString(params)}`)
  },
  auditLogs(fleetId) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/audit-logs`)
  },
  budgets(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/budgets${queryString(params)}`)
  },
  saveBudget(fleetId, payload, recordId = '') {
    const path = recordId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/budgets/${encodeURIComponent(recordId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/budgets`
    return request(path, { method: recordId ? 'PATCH' : 'POST', body: payload })
  },
  invoices(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/invoices${queryString(params)}`)
  },
  saveInvoice(fleetId, payload, recordId = '') {
    const path = recordId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/invoices/${encodeURIComponent(recordId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/invoices`
    return request(path, { method: recordId ? 'PATCH' : 'POST', body: payload })
  },
  maintenance(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/maintenance${queryString(params)}`)
  },
  saveMaintenance(fleetId, payload, recordId = '') {
    const path = recordId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/maintenance/${encodeURIComponent(recordId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/maintenance`
    return request(path, { method: recordId ? 'PATCH' : 'POST', body: payload })
  },
  routeActivity(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/route-activity${queryString(params)}`)
  },
  saveRouteActivity(fleetId, payload, recordId = '') {
    const path = recordId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/route-activity/${encodeURIComponent(recordId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/route-activity`
    return request(path, { method: recordId ? 'PATCH' : 'POST', body: payload })
  },
  vehicleLiveStates(fleetId, params = {}) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/vehicle-live-states${queryString(params)}`)
  },
  saveVehicleLiveState(fleetId, payload, recordId = '') {
    const path = recordId
      ? `/api/fleet/accounts/${encodeURIComponent(fleetId)}/vehicle-live-states/${encodeURIComponent(recordId)}`
      : `/api/fleet/accounts/${encodeURIComponent(fleetId)}/vehicle-live-states`
    return request(path, { method: recordId ? 'PATCH' : 'POST', body: payload })
  },
  driverSummary() {
    return request('/api/fleet/driver/summary')
  },
  validateFuelNow(payload) {
    return request('/api/fleet/driver/fuel-now/validate', { method: 'POST', body: payload })
  },
  createFuelNowSession(payload) {
    return request('/api/fleet/driver/fuel-now/sessions', { method: 'POST', body: payload })
  },
  completeFuelNowSession(fleetId, sessionId, payload) {
    return request(`/api/fleet/accounts/${encodeURIComponent(fleetId)}/fuel-now/sessions/${encodeURIComponent(sessionId)}/complete`, {
      method: 'POST',
      body: payload,
    })
  },
  createDriverFuelRequest(payload) {
    return request('/api/fleet/driver/fuel-requests', { method: 'POST', body: payload })
  },
  cancelDriverFuelRequest(fleetId, requestId, reason = '') {
    return request(`/api/fleet/driver/fuel-requests/${encodeURIComponent(fleetId)}/${encodeURIComponent(requestId)}/cancel`, {
      method: 'POST',
      body: { reason },
    })
  },
  driverHistory() {
    return request('/api/fleet/driver/history')
  },
}
