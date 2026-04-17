import { getStoredAccessToken, setStoredAccessToken } from '../authSession'
import { assertUserAppAccessToken } from '../userSessionGuard'

const dataSourceMode = (import.meta.env.VITE_DATA_SOURCE || 'api').toLowerCase()
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const devApiTarget = import.meta.env.VITE_DEV_API_TARGET || ''
const envAccessToken = import.meta.env.VITE_USER_ACCESS_TOKEN || ''
const allowEnvTokenFallback =
  String(import.meta.env.VITE_ALLOW_ENV_USER_TOKEN_FALLBACK || 'false').toLowerCase() === 'true'

function hasProtocol(value) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(String(value || ''))
}

function resolveApiBase() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin)
  }
  return new URL(window.location.origin)
}

function resolveRealtimeBaseCandidates() {
  const candidates = []
  const seen = new Set()

  const pushCandidate = (value) => {
    if (!value) return
    try {
      const url = new URL(value, window.location.origin)
      const origin = url.origin
      if (!origin || seen.has(origin)) return
      seen.add(origin)
      candidates.push(url)
    } catch {
      // Ignore malformed realtime targets.
    }
  }

  if (apiBaseUrl) {
    pushCandidate(apiBaseUrl)
  } else {
    pushCandidate(devApiTarget)
    pushCandidate(window.location.origin)
  }

  if (!candidates.length) {
    pushCandidate(window.location.origin)
  }

  return candidates
}

function getAccessToken() {
  const runtimeToken = getStoredAccessToken()
  if (runtimeToken) {
    assertUserAppAccessToken(runtimeToken)
    return runtimeToken
  }

  if (allowEnvTokenFallback && envAccessToken) {
    assertUserAppAccessToken(envAccessToken)
    return envAccessToken
  }

  return ''
}

function ensureApiMode() {
  if (dataSourceMode !== 'api') {
    throw new Error('User queue API is disabled because VITE_DATA_SOURCE is not "api".')
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  ensureApiMode()
  let token = getAccessToken()
  if (!token) {
    token = await refreshAccessToken().catch(() => '')
  }
  if (!token) {
    throw new Error('Session expired. Please sign in again.')
  }

  const base = resolveApiBase()
  const executeRequest = (accessToken) =>
    fetch(`${base.origin}${path}`, {
      method,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })

  let response = await executeRequest(token)
  let payload = await response.json().catch(() => ({}))
  if (isAuthFailure(response, payload)) {
    const refreshed = await refreshAccessToken().catch(() => '')
    if (!refreshed) {
      throw new Error('Session expired. Please sign in again.')
    }
    response = await executeRequest(refreshed)
    payload = await response.json().catch(() => ({}))
  }

  if (!response.ok || payload.ok === false) {
    const responseError =
      String(payload?.error || '').trim() ||
      String(payload?.message || '').trim() ||
      String(payload?.data?.error || '').trim() ||
      String(payload?.data?.message || '').trim()
    throw new Error(responseError || response.statusText || `Request failed (${response.status})`)
  }

  return payload.data
}

async function requestBlob(path, { method = 'GET', body, signal } = {}) {
  ensureApiMode()
  let token = getAccessToken()
  if (!token) {
    token = await refreshAccessToken().catch(() => '')
  }
  if (!token) {
    throw new Error('Session expired. Please sign in again.')
  }

  const base = resolveApiBase()
  const executeRequest = (accessToken) =>
    fetch(`${base.origin}${path}`, {
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

  let response = await executeRequest(token)
  if (response.status === 401) {
    const refreshed = await refreshAccessToken().catch(() => '')
    if (!refreshed) {
      throw new Error('Session expired. Please sign in again.')
    }
    response = await executeRequest(refreshed)
  }

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}))
    const responseError =
      String(errorPayload?.error || '').trim() ||
      String(errorPayload?.message || '').trim()
    throw new Error(responseError || response.statusText || `Request failed (${response.status})`)
  }

  return {
    blob: await response.blob(),
    filename: parseDownloadFilename(response.headers.get('content-disposition')),
  }
}

function parseDownloadFilename(contentDisposition) {
  const raw = String(contentDisposition || '').trim()
  if (!raw) return 'smartpay-receipt.pdf'

  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]).trim() || 'smartpay-receipt.pdf'
  }

  const asciiMatch = raw.match(/filename="?([^";]+)"?/i)
  return String(asciiMatch?.[1] || 'smartpay-receipt.pdf').trim() || 'smartpay-receipt.pdf'
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
  const base = resolveApiBase()
  const response = await fetch(`${base.origin}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Refresh failed (${response.status})`)
  }

  const refreshedToken = String(payload?.data?.accessToken || '').trim()
  if (!refreshedToken) throw new Error('Refresh did not return access token')
  assertUserAppAccessToken(refreshedToken)
  setStoredAccessToken(refreshedToken)
  return refreshedToken
}

async function ensureRealtimeAccessToken() {
  let accessToken = getAccessToken()
  if (accessToken) return accessToken
  accessToken = await refreshAccessToken()
  return accessToken
}

function buildRealtimeWsUrls(pathname, buildParams) {
  const baseCandidates = resolveRealtimeBaseCandidates()
  return baseCandidates.map((base) => {
    const wsProtocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = new URL(`${wsProtocol}//${base.host}${pathname}`)
    const params = typeof buildParams === 'function' ? buildParams() : null
    if (params instanceof URLSearchParams) {
      params.forEach((value, key) => {
        wsUrl.searchParams.set(key, value)
      })
    }
    return wsUrl.toString()
  })
}

function createSyntheticCloseEvent(code, reason) {
  return {
    code: Number(code || 1006) || 1006,
    reason: String(reason || '').trim(),
    wasClean: false,
  }
}

function connectRealtimeSocket({
  urls,
  onMessage,
  onOpen,
  onClose,
  onError,
}) {
  if (typeof window.WebSocket !== 'function') {
    throw new Error('WebSocket is not supported by this browser')
  }

  const candidateUrls = Array.isArray(urls)
    ? urls.map((value) => String(value || '').trim()).filter(Boolean)
    : []

  if (!candidateUrls.length) {
    throw new Error('Realtime connection URL is unavailable')
  }

  let disposed = false
  let socket = null
  let hasOpened = false

  const connectCandidate = (index) => {
    if (disposed || index >= candidateUrls.length) {
      onClose?.(createSyntheticCloseEvent(1006, 'Realtime connection unavailable'))
      return
    }

    const candidateUrl = candidateUrls[index]
    let openedForCandidate = false
    socket = new window.WebSocket(candidateUrl)

    socket.onopen = () => {
      if (disposed) {
        try {
          socket.close(1000, 'client_disconnect')
        } catch {
          // noop
        }
        return
      }
      hasOpened = true
      openedForCandidate = true
      onOpen?.()
    }

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data || '{}')
        onMessage?.(parsed)
      } catch {
        // Ignore malformed payloads.
      }
    }

    socket.onerror = (event) => {
      if (disposed) return
      if (openedForCandidate || index === candidateUrls.length - 1) {
        onError?.(event)
      }
    }

    socket.onclose = (event) => {
      if (disposed) return
      const isAuthFailure = Number(event?.code || 0) === 4401
      if (!openedForCandidate && !hasOpened && !isAuthFailure && index < candidateUrls.length - 1) {
        connectCandidate(index + 1)
        return
      }
      onClose?.(event)
    }
  }

  connectCandidate(0)

  return () => {
    disposed = true
    if (!socket) return
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    try {
      if (
        socket.readyState === window.WebSocket.OPEN ||
        socket.readyState === window.WebSocket.CONNECTING
      ) {
        socket.close(1000, 'client_disconnect')
      }
    } catch {
      // noop
    }
  }
}

function resolveQueueWsUrls(queueJoinId, accessToken) {
  ensureApiMode()
  if (!accessToken) throw new Error('Missing access token for realtime queue updates')

  return buildRealtimeWsUrls('/ws/user-queue', () => {
    const params = new URLSearchParams()
    params.set('accessToken', accessToken)
    params.set('queueJoinId', String(queueJoinId || '').trim())
    return params
  })
}

function resolveStationChangesWsUrls(stationPublicId, accessToken) {
  ensureApiMode()
  if (!accessToken) throw new Error('Missing access token for realtime station updates')

  const scopedStationId = String(stationPublicId || '').trim()
  if (!scopedStationId) throw new Error('stationPublicId is required for realtime station updates')

  return buildRealtimeWsUrls('/ws/user-station-changes', () => {
    const params = new URLSearchParams()
    params.set('accessToken', accessToken)
    params.set('stationPublicId', scopedStationId)
    return params
  })
}

function resolveUserAlertsWsUrls(accessToken) {
  ensureApiMode()
  if (!accessToken) throw new Error('Missing access token for realtime alerts')

  return buildRealtimeWsUrls('/ws/user-alerts', () => {
    const params = new URLSearchParams()
    params.set('accessToken', accessToken)
    return params
  })
}

export const userQueueApi = {
  isApiMode() {
    return dataSourceMode === 'api'
  },

  getMode() {
    return dataSourceMode
  },

  async getActiveQueue(options = {}) {
    return request('/api/user/queue/active', {
      method: 'GET',
      signal: options.signal,
    })
  },

  async getReservations(options = {}) {
    return request('/api/user/reservations', {
      method: 'GET',
      signal: options.signal,
    })
  },

  async getHistory(options = {}) {
    const params = new URLSearchParams()
    const from = String(options?.from || '').trim()
    const to = String(options?.to || '').trim()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const query = params.toString() ? `?${params.toString()}` : ''

    return request(`/api/user/history${query}`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async downloadReceiptPdf({ receiptType, reference, signal } = {}) {
    const normalizedType = String(receiptType || '').trim().toLowerCase()
    const normalizedReference = String(reference || '').trim()
    if (!['queue', 'reservation'].includes(normalizedType)) {
      throw new Error('receiptType must be queue or reservation')
    }
    if (!normalizedReference) {
      throw new Error('Receipt reference is required')
    }

    return requestBlob(
      `/api/user/receipts/${encodeURIComponent(normalizedType)}/${encodeURIComponent(normalizedReference)}/download`,
      {
        method: 'GET',
        signal,
      },
    )
  },

  async getAlerts(options = {}) {
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    const query = params.toString() ? `?${params.toString()}` : ''
    return request(`/api/user/alerts${query}`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async getArchivedAlerts(options = {}) {
    const params = new URLSearchParams()
    if (options?.limit) params.set('limit', String(options.limit))
    const query = params.toString() ? `?${params.toString()}` : ''
    return request(`/api/user/alerts/archived${query}`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async getWalletSummary(options = {}) {
    return request('/api/user/wallet/me', {
      method: 'GET',
      signal: options.signal,
    })
  },

  async createManualWalletFuelOrder(payload = {}) {
    return request('/api/fuel-orders/manual-wallet', {
      method: 'POST',
      body: {
        stationPublicId: payload.stationPublicId,
        fuelType: payload.fuelType,
        requestedAmountMwk: payload.requestedAmountMwk,
        requestedLitres: payload.requestedLitres,
      },
      signal: payload.signal,
    })
  },

  async getFuelOrder(fuelOrderId, options = {}) {
    const scopedFuelOrderId = String(fuelOrderId || '').trim()
    if (!scopedFuelOrderId) throw new Error('fuelOrderId is required')
    return request(`/api/fuel-orders/${encodeURIComponent(scopedFuelOrderId)}`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async cancelFuelOrder(fuelOrderId, options = {}) {
    const scopedFuelOrderId = String(fuelOrderId || '').trim()
    if (!scopedFuelOrderId) throw new Error('fuelOrderId is required')
    return request(`/api/fuel-orders/${encodeURIComponent(scopedFuelOrderId)}/cancel`, {
      method: 'POST',
      body: {
        reason: String(options.reason || '').trim() || undefined,
      },
      signal: options.signal,
    })
  },

  async getWalletTransactions(options = {}) {
    const params = new URLSearchParams()
    if (options?.page) params.set('page', String(options.page))
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.type) params.set('type', String(options.type).toUpperCase())
    if (options?.status) params.set('status', String(options.status).toUpperCase())
    const query = params.toString() ? `?${params.toString()}` : ''
    return request(`/api/user/wallet/me/transactions${query}`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async getWalletHolds(options = {}) {
    const params = new URLSearchParams()
    if (options?.status) params.set('status', String(options.status).toUpperCase())
    if (options?.limit) params.set('limit', String(options.limit))
    const query = params.toString() ? `?${params.toString()}` : ''
    return request(`/api/user/wallet/me/holds${query}`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async getWalletTransferRecipientQr(options = {}) {
    return request('/api/user/wallet/me/transfers/recipient-qr', {
      method: 'GET',
      signal: options.signal,
    })
  },

  async previewWalletTransfer(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Wallet transfer preview payload is required')
    }
    return request('/api/user/wallet/me/transfers/preview', {
      method: 'POST',
      body: {
        recipientUserId: payload.recipientUserId,
        recipientQrPayload: payload.recipientQrPayload,
        amountMwk: payload.amountMwk,
        transferMode: payload.transferMode,
        stationPublicId: payload.stationPublicId,
        stationId: payload.stationId,
      },
    })
  },

  async createWalletTransfer(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Wallet transfer payload is required')
    }
    return request('/api/user/wallet/me/transfers', {
      method: 'POST',
      body: {
        recipientUserId: payload.recipientUserId,
        recipientQrPayload: payload.recipientQrPayload,
        amountMwk: payload.amountMwk,
        transferMode: payload.transferMode,
        stationPublicId: payload.stationPublicId,
        stationId: payload.stationId,
        note: payload.note,
        idempotencyKey: payload.idempotencyKey,
      },
    })
  },

  async getWalletTransferHistory(options = {}) {
    const params = new URLSearchParams()
    if (options?.page) params.set('page', String(options.page))
    if (options?.limit) params.set('limit', String(options.limit))
    const query = params.toString() ? `?${params.toString()}` : ''
    return request(`/api/user/wallet/me/transfers/history${query}`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async getWalletStationLockedBalances(options = {}) {
    return request('/api/user/wallet/me/station-locked-balances', {
      method: 'GET',
      signal: options.signal,
    })
  },

  async createWalletTopup(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Top-up payload is required')
    }
    return request('/api/user/wallet/me/topups', {
      method: 'POST',
      body: {
        amount: payload.amount,
        note: payload.note,
      },
    })
  },

  async getWalletRefunds(options = {}) {
    return request('/api/user/wallet/me/refunds', {
      method: 'GET',
      signal: options.signal,
    })
  },

  async createWalletRefund(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Refund payload is required')
    }
    return request('/api/user/wallet/me/refunds', {
      method: 'POST',
      body: {
        transactionPublicId: payload.transactionPublicId,
        amount: payload.amount,
        reason: payload.reason,
      },
    })
  },

  async getSupportConfig(options = {}) {
    return request('/api/support/config', {
      method: 'GET',
      signal: options.signal,
    })
  },

  async getSupportTickets(options = {}) {
    return request('/api/support/tickets', {
      method: 'GET',
      signal: options.signal,
    })
  },

  async markAlertRead(alertPublicId) {
    const scopedAlertId = String(alertPublicId || '').trim()
    if (!scopedAlertId) throw new Error('alertPublicId is required')
    return request(`/api/user/alerts/${encodeURIComponent(scopedAlertId)}/read`, {
      method: 'POST',
      body: {},
    })
  },

  async archiveAlert(alertPublicId) {
    const scopedAlertId = String(alertPublicId || '').trim()
    if (!scopedAlertId) throw new Error('alertPublicId is required')
    return request(`/api/user/alerts/${encodeURIComponent(scopedAlertId)}/archive`, {
      method: 'POST',
      body: {},
    })
  },

  async getPushPublicKey() {
    return request('/api/user/push/public-key', {
      method: 'GET',
    })
  },

  async subscribePush(subscription) {
    if (!subscription || typeof subscription !== 'object') {
      throw new Error('Push subscription payload is required')
    }
    return request('/api/user/push/subscribe', {
      method: 'POST',
      body: {
        subscription,
      },
    })
  },

  async unsubscribePush(endpoint) {
    return request('/api/user/push/unsubscribe', {
      method: 'POST',
      body: endpoint ? { endpoint } : {},
    })
  },

  async getReservationSlots(stationPublicId, options = {}) {
    const scopedStationId = String(stationPublicId || '').trim()
    if (!scopedStationId) throw new Error('stationPublicId is required')
    const params = new URLSearchParams()
    if (options?.fuelType) params.set('fuelType', String(options.fuelType).toUpperCase())
    if (options?.lookAhead) params.set('lookAhead', String(options.lookAhead))
    params.set('_ts', String(Date.now()))
    const query = params.toString() ? `?${params.toString()}` : ''
    return request(`/api/user/stations/${encodeURIComponent(scopedStationId)}/reservations/slots${query}`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async createReservation({ stationPublicId, fuelType = 'PETROL', expectedLiters, slotStart, slotEnd, identifier, depositAmount, userLat, userLng } = {}) {
    const scopedStationId = String(stationPublicId || '').trim()
    if (!scopedStationId) throw new Error('stationPublicId is required')
    return request(`/api/user/stations/${encodeURIComponent(scopedStationId)}/reservations`, {
      method: 'POST',
      body: {
        fuelType: String(fuelType || 'PETROL').trim().toUpperCase(),
        expectedLiters: Number(expectedLiters),
        slotStart,
        slotEnd,
        identifier,
        depositAmount: Number(depositAmount),
        ...(Number.isFinite(Number(userLat)) ? { userLat: Number(userLat) } : {}),
        ...(Number.isFinite(Number(userLng)) ? { userLng: Number(userLng) } : {}),
      },
    })
  },

  async cancelReservation(reservationPublicId, { reason } = {}) {
    const scopedReservationId = String(reservationPublicId || '').trim()
    if (!scopedReservationId) throw new Error('reservationPublicId is required')
    return request(`/api/user/reservations/${encodeURIComponent(scopedReservationId)}/cancel`, {
      method: 'POST',
      body: { reason },
    })
  },

  async checkInReservation(reservationPublicId, { method = 'GPS', qrToken, userLat, userLng } = {}) {
    const scopedReservationId = String(reservationPublicId || '').trim()
    if (!scopedReservationId) throw new Error('reservationPublicId is required')
    return request(`/api/user/reservations/${encodeURIComponent(scopedReservationId)}/check-in`, {
      method: 'POST',
      body: {
        method: String(method || 'GPS').toUpperCase(),
        ...(qrToken ? { qrToken } : {}),
        ...(Number.isFinite(Number(userLat)) ? { userLat: Number(userLat) } : {}),
        ...(Number.isFinite(Number(userLng)) ? { userLng: Number(userLng) } : {}),
      },
    })
  },

  async joinQueue({ stationPublicId, fuelType = 'PETROL', maskedPlate, requestedLiters, prepay } = {}) {
    const scopedStationId = String(stationPublicId || '').trim()
    if (!scopedStationId) throw new Error('stationPublicId is required to join queue')
    const scopedFuelType = String(fuelType || 'PETROL').trim().toUpperCase() || 'PETROL'
    const parsedRequestedLiters = Number(requestedLiters)
    const hasRequestedLiters = Number.isFinite(parsedRequestedLiters) && parsedRequestedLiters > 0
    return request(`/api/user/stations/${encodeURIComponent(scopedStationId)}/queue/join`, {
      method: 'POST',
      body: {
        fuelType: scopedFuelType,
        maskedPlate,
        ...(hasRequestedLiters ? { requestedLiters: parsedRequestedLiters } : {}),
        ...(typeof prepay === 'boolean' ? { prepay } : {}),
      },
    })
  },

  async getStatus(queueJoinId, options = {}) {
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    if (!scopedQueueJoinId) throw new Error('queueJoinId is required')
    return request(`/api/user/queue/${encodeURIComponent(scopedQueueJoinId)}/status`, {
      method: 'GET',
      signal: options.signal,
    })
  },

  async scanPumpQr(queueJoinId, { qrToken } = {}) {
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    const scopedQrToken = String(qrToken || '').trim()
    if (!scopedQueueJoinId) throw new Error('queueJoinId is required')
    if (!scopedQrToken) throw new Error('qrToken is required')
    return request(`/api/user/queue/${encodeURIComponent(scopedQueueJoinId)}/pump-scan`, {
      method: 'POST',
      body: {
        qrToken: scopedQrToken,
      },
    })
  },

  async submitDispenseRequest(queueJoinId, { liters, prepay } = {}) {
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    const parsedLiters = Number(liters)
    if (!scopedQueueJoinId) throw new Error('queueJoinId is required')
    if (!Number.isFinite(parsedLiters) || parsedLiters <= 0) {
      throw new Error('liters is required')
    }
    return request(`/api/user/queue/${encodeURIComponent(scopedQueueJoinId)}/dispense-request`, {
      method: 'POST',
      body: {
        liters: parsedLiters,
        ...(typeof prepay === 'boolean' ? { prepay } : {}),
      },
    })
  },

  async leaveQueue(queueJoinId, body = {}) {
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    if (!scopedQueueJoinId) throw new Error('queueJoinId is required')
    return request(`/api/user/queue/${encodeURIComponent(scopedQueueJoinId)}/leave`, {
      method: 'POST',
      body,
    })
  },

  async reportIssue(queueJoinId, payload = {}) {
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    if (!scopedQueueJoinId) throw new Error('queueJoinId is required')
    return request(`/api/user/queue/${encodeURIComponent(scopedQueueJoinId)}/report-issue`, {
      method: 'POST',
      body: payload,
    })
  },

  connectQueueSocket({ queueJoinId, onMessage, onOpen, onClose, onError }) {
    let disconnect = () => {}
    let disposed = false

    void ensureRealtimeAccessToken()
      .then((accessToken) => {
        if (disposed) return
        disconnect = connectRealtimeSocket({
          urls: resolveQueueWsUrls(queueJoinId, accessToken),
          onMessage,
          onOpen,
          onClose,
          onError,
        })
      })
      .catch((error) => {
        if (disposed) return
        onClose?.(createSyntheticCloseEvent(4401, error?.message || 'Session expired'))
      })

    return () => {
      disposed = true
      disconnect()
    }
  },

  connectStationChangesSocket({ stationPublicId, onMessage, onOpen, onClose, onError }) {
    let disconnect = () => {}
    let disposed = false

    void ensureRealtimeAccessToken()
      .then((accessToken) => {
        if (disposed) return
        disconnect = connectRealtimeSocket({
          urls: resolveStationChangesWsUrls(stationPublicId, accessToken),
          onMessage,
          onOpen,
          onClose,
          onError,
        })
      })
      .catch((error) => {
        if (disposed) return
        onClose?.(createSyntheticCloseEvent(4401, error?.message || 'Session expired'))
      })

    return () => {
      disposed = true
      disconnect()
    }
  },

  connectUserAlertsSocket({ onMessage, onOpen, onClose, onError }) {
    let disconnect = () => {}
    let disposed = false

    void ensureRealtimeAccessToken()
      .then((accessToken) => {
        if (disposed) return
        disconnect = connectRealtimeSocket({
          urls: resolveUserAlertsWsUrls(accessToken),
          onMessage,
          onOpen,
          onClose,
          onError,
        })
      })
      .catch((error) => {
        if (disposed) return
        onClose?.(createSyntheticCloseEvent(4401, error?.message || 'Session expired'))
      })

    return () => {
      disposed = true
      disconnect()
    }
  },
}

export function userQueueApiSupportsRelativeBase() {
  return !hasProtocol(apiBaseUrl)
}
