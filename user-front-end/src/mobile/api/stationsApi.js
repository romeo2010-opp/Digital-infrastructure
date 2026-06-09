import { getStoredAccessToken, setStoredAccessToken } from '../authSession'
import { stations as mockStations } from '../mockStations'
import { assertUserAppAccessToken } from '../userSessionGuard'
import { userAuthApi } from './userAuthApi'

const dataSourceMode = (import.meta.env.VITE_DATA_SOURCE || 'api').toLowerCase()
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const envAccessToken = import.meta.env.VITE_USER_ACCESS_TOKEN || ''
const DEFAULT_MAP_CENTER = { lat: -15.7861, lng: 35.0058 }

const defaultPrices = [
  { label: 'Petrol', value: 'MK 2,680/L' },
  { label: 'Diesel', value: 'MK 2,590/L' },
  { label: 'Premium', value: 'MK 2,760/L' },
  { label: 'Petrol 2', value: 'MK 2,700/L' },
  { label: 'Diesel 2', value: 'MK 2,610/L' },
  { label: 'Premium 2', value: 'MK 2,780/L' },
]

function toNumberOrNull(value) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) return null
  return normalized
}

function parseArray(value) {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function toBooleanOrDefault(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function haversineKm(origin, destination) {
  const radiusKm = 6371
  const deltaLat = toRadians(destination.lat - origin.lat)
  const deltaLng = toRadians(destination.lng - origin.lng)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(origin.lat)) * Math.cos(toRadians(destination.lat)) * Math.sin(deltaLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return radiusKm * c
}

function hasProtocol(value) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(String(value || ''))
}

function resolveApiBase() {
  if (apiBaseUrl) {
    return new URL(apiBaseUrl, window.location.origin)
  }
  return new URL(window.location.origin)
}

function getAccessToken() {
  const runtimeToken = getStoredAccessToken()
  if (runtimeToken) {
    assertUserAppAccessToken(runtimeToken)
    return runtimeToken
  }
  if (envAccessToken) {
    assertUserAppAccessToken(envAccessToken)
    return envAccessToken
  }
  return ''
}

function isAuthFailure(response, payload) {
  if (response.status === 401) return true
  const message = String(payload?.error || '').toLowerCase()
  return message.includes('invalid or expired token') || message.includes('missing access token')
}

async function requestWithAuth(pathname, { method = 'GET', signal } = {}) {
  let token = getAccessToken()
  if (!token) {
    try {
      token = await userAuthApi.refresh()
      setStoredAccessToken(token)
      assertUserAppAccessToken(token)
    } catch {
      throw new Error('Session expired. Please sign in again.')
    }
  }

  const base = resolveApiBase()
  const executeRequest = async (accessToken) =>
    fetch(`${base.origin}${pathname}`, {
      method,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
    })

  let response = await executeRequest(token)
  let payload = await response.json().catch(() => ({}))

  if (isAuthFailure(response, payload)) {
    try {
      token = await userAuthApi.refresh()
      setStoredAccessToken(token)
      assertUserAppAccessToken(token)
    } catch {
      throw new Error('Session expired. Please sign in again.')
    }
    response = await executeRequest(token)
    payload = await response.json().catch(() => ({}))
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Failed request (${response.status})`)
  }

  return payload.data
}

function buildPin(lat, lng) {
  const minLat = -15.85
  const maxLat = -15.74
  const minLng = 34.95
  const maxLng = 35.08
  const x = ((lng - minLng) / (maxLng - minLng)) * 100
  const y = ((maxLat - lat) / (maxLat - minLat)) * 100

  return {
    x: Math.max(12, Math.min(88, Math.round(x))),
    y: Math.max(12, Math.min(82, Math.round(y))),
  }
}

function normalizePrices(rawPrices) {
  const values = parseArray(rawPrices)
  if (!values.length) return defaultPrices
  return values.slice(0, 6).map((item, index) => ({
    label: item?.label || defaultPrices[index]?.label || `Fuel ${index + 1}`,
    value: item?.value || defaultPrices[index]?.value || 'MK 0/L',
  }))
}

function normalizeStation(row) {
  const id = String(row?.id || row?.publicId || row?.public_id || '').trim()
  if (!id) return null

  const lat = toNumberOrNull(row?.lat ?? row?.latitude)
  const lng = toNumberOrNull(row?.lng ?? row?.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const statusValue = String(row?.status || '').trim().toLowerCase()
  const status = statusValue === 'in use' ? 'In Use' : 'Available'

  const fuelLevelValue = String(row?.fuelLevel || row?.fuel_level || '').trim().toLowerCase()
  const fuelLevel =
    fuelLevelValue === 'low' || fuelLevelValue === 'medium' || fuelLevelValue === 'high'
      ? fuelLevelValue
      : status === 'In Use'
        ? 'medium'
        : 'high'

  const distanceKm = toNumberOrNull(row?.distanceKm ?? row?.distance_km)
  const resolvedDistanceKm = distanceKm ?? Number(haversineKm(DEFAULT_MAP_CENTER, { lat, lng }).toFixed(1))
  const etaMin = toNumberOrNull(row?.etaMin ?? row?.eta_min)
  const resolvedEtaMin = etaMin ?? Math.max(4, Math.round((resolvedDistanceKm / 28) * 60))

  const reviewsCount = toNumberOrNull(row?.reviewsCount ?? row?.reviews_count) ?? 0
  const rating = toNumberOrNull(row?.rating) ?? 4.2
  const hoursLabel = String(row?.hoursLabel || row?.hours_label || '').trim() || 'Open 24h'
  const openingTime = String(row?.openingTime || row?.opening_time || '').trim()
  const closingTime = String(row?.closingTime || row?.closing_time || '').trim()
  const workingHours = String(row?.workingHours || row?.working_hours || '').trim()
  const name = String(row?.name || '').trim()
  const queuePlanEnabledRaw = row?.queuePlanEnabled ?? row?.queue_plan_enabled
  const reservationPlanEnabledRaw = row?.reservationPlanEnabled ?? row?.reservation_plan_enabled
  const subscriptionPlanCode = String(
    row?.subscriptionPlanCode || row?.subscription_plan_code || '',
  ).trim().toUpperCase()

  return {
    id,
    publicId: String(row?.publicId || row?.public_id || id).trim(),
    name,
    chipLabel: String(row?.chipLabel || row?.chip_label || name).trim() || name,
    address: String(row?.address || '').trim() || name,
    lat,
    lng,
    distanceKm: Number(resolvedDistanceKm.toFixed(1)),
    etaMin: Math.max(1, Math.round(resolvedEtaMin)),
    rating: Number(rating.toFixed(1)),
    reviewsCount: Math.max(0, Math.round(reviewsCount)),
    reviews: Math.max(0, Math.round(reviewsCount)),
    status,
    fuelLevel,
    hoursLabel,
    openingTime: openingTime || (hoursLabel.toLowerCase().includes('24h') ? '00:00' : ''),
    closingTime: closingTime || (hoursLabel.toLowerCase().includes('24h') ? '23:59' : ''),
    workingHours: workingHours || (hoursLabel.toLowerCase().includes('24h') ? 'Mon - Sun 00:00 - 23:59' : ''),
    facilities: parseArray(row?.facilities).length ? parseArray(row?.facilities) : ['Car', 'Car Repair'],
    prices: normalizePrices(row?.prices),
    phone: String(row?.phone || row?.phoneE164 || row?.phone_e164 || '').trim() || '+265 1 000 000',
    heroImage: String(row?.heroImage || row?.hero_image_url || '').trim(),
    pin: buildPin(lat, lng),
    subscriptionPlanCode: subscriptionPlanCode || null,
    queuePlanEnabled: toBooleanOrDefault(queuePlanEnabledRaw, false),
    reservationPlanEnabled: toBooleanOrDefault(reservationPlanEnabledRaw, false),
  }
}

export const stationsApi = {
  isApiMode() {
    return dataSourceMode === 'api'
  },

  getMode() {
    return dataSourceMode
  },

  async listStations({ signal } = {}) {
    if (dataSourceMode !== 'api') {
      return mockStations
    }

    const data = await requestWithAuth('/api/user/stations', { signal })
    const rows = Array.isArray(data) ? data : []
    return rows.map(normalizeStation).filter(Boolean)
  },

  async getStationFuelStatus(stationPublicId, { signal } = {}) {
    const scopedStationPublicId = String(stationPublicId || '').trim()
    if (!scopedStationPublicId) throw new Error('stationPublicId is required')

    if (dataSourceMode !== 'api') {
      const station = mockStations.find((item) => String(item.publicId || item.id) === scopedStationPublicId)
      if (!station) {
        return {
          stationPublicId: scopedStationPublicId,
          statuses: [],
          updatedAt: new Date().toISOString(),
        }
      }
      return {
        stationPublicId: scopedStationPublicId,
        statuses: [
          { code: 'PETROL', label: 'Petrol', status: station.fuelLevel === 'low' ? 'low' : 'available' },
          { code: 'DIESEL', label: 'Diesel', status: station.fuelLevel === 'low' ? 'low' : 'available' },
        ],
        updatedAt: new Date().toISOString(),
      }
    }

    return requestWithAuth(`/api/user/stations/${encodeURIComponent(scopedStationPublicId)}/fuel-status`, { signal })
  },

  async getStationPromotionPreview(stationPublicId, { fuelTypeCode, litres = 20, paymentMethod = 'CASH', signal } = {}) {
    const scopedStationPublicId = String(stationPublicId || '').trim()
    if (!scopedStationPublicId) throw new Error('stationPublicId is required')

    const normalizedFuelType = String(fuelTypeCode || '').trim().toUpperCase()
    if (!normalizedFuelType) throw new Error('fuelTypeCode is required')

    if (dataSourceMode !== 'api') {
      return {
        station: { publicId: scopedStationPublicId },
        fuelTypeCode: normalizedFuelType,
        basePricePerLitre: null,
        pricing: null,
        offers: [],
      }
    }

    const params = new URLSearchParams()
    params.set('fuelTypeCode', normalizedFuelType)
    params.set('litres', String(litres))
    params.set('paymentMethod', String(paymentMethod || 'CASH').trim().toUpperCase())
    return requestWithAuth(
      `/api/user/stations/${encodeURIComponent(scopedStationPublicId)}/promotions/preview?${params.toString()}`,
      { signal }
    )
  },
}

export function stationsApiSupportsRelativeBase() {
  return !hasProtocol(apiBaseUrl)
}
