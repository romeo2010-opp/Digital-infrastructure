const ACCESS_TOKEN_KEY = 'smartlink_user_access_token'
const SESSION_META_KEY = 'smartlink_user_session_meta'
const ACTIVE_QUEUE_JOIN_ID_KEY = 'smartlink_user_active_queue_join_id'
const ACTIVE_MANUAL_FUEL_ORDER_ID_KEY = 'smartlink_user_active_manual_fuel_order_id'
const NOTIFICATIONS_ENABLED_KEY = 'smartlink_user_notifications_enabled'
const FAVORITE_STATION_IDS_KEY = 'smartlink_user_favorite_station_ids'
const QUEUE_HISTORY_KEY = 'smartlink_user_queue_history'
const THEME_PREFERENCE_KEY = 'smartlink_user_theme'
const MAX_QUEUE_HISTORY_ITEMS = 40

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function safeJsonParse(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  return values.reduce((result, value) => {
    const normalized = String(value || '').trim()
    if (!normalized || seen.has(normalized)) return result
    seen.add(normalized)
    result.push(normalized)
    return result
  }, [])
}

function normalizeQueueHistoryItems(items) {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  const result = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const queueJoinId = String(item.queueJoinId || item.id || '').trim()
    if (!queueJoinId || seen.has(queueJoinId)) continue
    seen.add(queueJoinId)
    result.push({
      queueJoinId,
      stationPublicId: String(item.stationPublicId || '').trim() || null,
      stationName: String(item.stationName || '').trim() || 'Unknown station',
      fuelType: String(item.fuelType || '').trim().toUpperCase() || 'PETROL',
      requestedLiters: Number.isFinite(Number(item.requestedLiters)) && Number(item.requestedLiters) > 0
        ? Number(item.requestedLiters)
        : null,
      paymentMode: String(item.paymentMode || '').trim().toUpperCase() || null,
      queueStatus: String(item.queueStatus || item.status || '').trim().toUpperCase() || 'JOINED',
      joinedAt: String(item.joinedAt || '').trim() || new Date().toISOString(),
      updatedAt: String(item.updatedAt || item.joinedAt || '').trim() || new Date().toISOString(),
      leftAt: String(item.leftAt || '').trim() || null,
    })
  }

  return result
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.joinedAt || 0).getTime()
      const rightTime = new Date(right.updatedAt || right.joinedAt || 0).getTime()
      return rightTime - leftTime
    })
    .slice(0, MAX_QUEUE_HISTORY_ITEMS)
}

export function getStoredAccessToken() {
  if (!canUseStorage()) return ''
  return window.localStorage.getItem(ACCESS_TOKEN_KEY) || ''
}

export function setStoredAccessToken(token) {
  if (!canUseStorage()) return
  const normalized = String(token || '').trim()
  if (!normalized) {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY)
    return
  }
  window.localStorage.setItem(ACCESS_TOKEN_KEY, normalized)
}

export function getStoredSessionMeta() {
  if (!canUseStorage()) return null
  return safeJsonParse(window.localStorage.getItem(SESSION_META_KEY))
}

export function setStoredSessionMeta(meta) {
  if (!canUseStorage()) return
  if (!meta || typeof meta !== 'object') {
    window.localStorage.removeItem(SESSION_META_KEY)
    return
  }
  window.localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta))
}

export function clearStoredAuthSession() {
  if (!canUseStorage()) return
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(SESSION_META_KEY)
  window.localStorage.removeItem(ACTIVE_QUEUE_JOIN_ID_KEY)
  window.localStorage.removeItem(ACTIVE_MANUAL_FUEL_ORDER_ID_KEY)
  window.localStorage.removeItem(FAVORITE_STATION_IDS_KEY)
  window.localStorage.removeItem(QUEUE_HISTORY_KEY)
}

export function getStoredNotificationsEnabled() {
  if (!canUseStorage()) return false
  return window.localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) === 'true'
}

export function getStoredNotificationsPreference() {
  if (!canUseStorage()) return null
  const raw = window.localStorage.getItem(NOTIFICATIONS_ENABLED_KEY)
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

export function setStoredNotificationsEnabled(value) {
  if (!canUseStorage()) return
  if (value) {
    window.localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'true')
    return
  }
  window.localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false')
}

export function getStoredActiveQueueJoinId() {
  if (!canUseStorage()) return ''
  return String(window.localStorage.getItem(ACTIVE_QUEUE_JOIN_ID_KEY) || '').trim()
}

export function setStoredActiveQueueJoinId(queueJoinId) {
  if (!canUseStorage()) return
  const normalized = String(queueJoinId || '').trim()
  if (!normalized) {
    window.localStorage.removeItem(ACTIVE_QUEUE_JOIN_ID_KEY)
    return
  }
  window.localStorage.setItem(ACTIVE_QUEUE_JOIN_ID_KEY, normalized)
}

export function clearStoredActiveQueueJoinId() {
  if (!canUseStorage()) return
  window.localStorage.removeItem(ACTIVE_QUEUE_JOIN_ID_KEY)
}

export function getStoredActiveManualFuelOrderId() {
  if (!canUseStorage()) return ''
  return String(window.localStorage.getItem(ACTIVE_MANUAL_FUEL_ORDER_ID_KEY) || '').trim()
}

export function setStoredActiveManualFuelOrderId(fuelOrderId) {
  if (!canUseStorage()) return
  const normalized = String(fuelOrderId || '').trim()
  if (!normalized) {
    window.localStorage.removeItem(ACTIVE_MANUAL_FUEL_ORDER_ID_KEY)
    return
  }
  window.localStorage.setItem(ACTIVE_MANUAL_FUEL_ORDER_ID_KEY, normalized)
}

export function clearStoredActiveManualFuelOrderId() {
  if (!canUseStorage()) return
  window.localStorage.removeItem(ACTIVE_MANUAL_FUEL_ORDER_ID_KEY)
}

export function getStoredFavoriteStationIds() {
  if (!canUseStorage()) return []
  return normalizeStringArray(safeJsonParse(window.localStorage.getItem(FAVORITE_STATION_IDS_KEY)))
}

export function setStoredFavoriteStationIds(stationIds) {
  if (!canUseStorage()) return
  const normalized = normalizeStringArray(stationIds)
  if (!normalized.length) {
    window.localStorage.removeItem(FAVORITE_STATION_IDS_KEY)
    return
  }
  window.localStorage.setItem(FAVORITE_STATION_IDS_KEY, JSON.stringify(normalized))
}

export function getStoredQueueHistory() {
  if (!canUseStorage()) return []
  return normalizeQueueHistoryItems(safeJsonParse(window.localStorage.getItem(QUEUE_HISTORY_KEY)))
}

export function setStoredQueueHistory(items) {
  if (!canUseStorage()) return
  const normalized = normalizeQueueHistoryItems(items)
  if (!normalized.length) {
    window.localStorage.removeItem(QUEUE_HISTORY_KEY)
    return
  }
  window.localStorage.setItem(QUEUE_HISTORY_KEY, JSON.stringify(normalized))
}

export function upsertStoredQueueHistoryItem(item) {
  if (!canUseStorage() || !item || typeof item !== 'object') return
  const queueJoinId = String(item.queueJoinId || item.id || '').trim()
  if (!queueJoinId) return

  const current = getStoredQueueHistory()
  const next = normalizeQueueHistoryItems([
    {
      ...current.find((entry) => entry.queueJoinId === queueJoinId),
      ...item,
      queueJoinId,
      updatedAt: String(item.updatedAt || '').trim() || new Date().toISOString(),
    },
    ...current.filter((entry) => entry.queueJoinId !== queueJoinId),
  ])
  setStoredQueueHistory(next)
}

export function getStoredThemePreference() {
  if (!canUseStorage()) return 'light'
  return window.localStorage.getItem(THEME_PREFERENCE_KEY) === 'dark' ? 'dark' : 'light'
}

export function setStoredThemePreference(value) {
  if (!canUseStorage()) return
  const normalized = value === 'dark' ? 'dark' : 'light'
  window.localStorage.setItem(THEME_PREFERENCE_KEY, normalized)
}
