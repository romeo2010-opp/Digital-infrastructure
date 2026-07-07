const loginAppearanceStorageKey = 'smartlink.schools.lastLoginAppearance'

const allowedAppearance = new Set(['light', 'dark', 'black-white'])
const allowedBackgroundModes = new Set(['cover', 'contain', 'custom'])
const allowedAccentTones = new Set(['smartlink', 'navy', 'emerald', 'graphite', 'copper'])

function boundedNumber(value: any, fallback: number, min: number, max: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

function safeString(value: any, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

export function loginAppearanceFromPreferences(preferences: any, user?: any) {
  if (!preferences || typeof preferences !== 'object') return null

  const appearance = safeString(preferences.appearance, 'light')
  const backgroundImage = safeString(preferences.dashboardBackgroundImage)
  const backgroundMode = safeString(preferences.dashboardBackgroundMode, 'cover')
  const accentTone = safeString(preferences.accentTone, 'smartlink')

  return {
    appearance: allowedAppearance.has(appearance) ? appearance : 'light',
    dashboardBackgroundEnabled: Boolean(backgroundImage && preferences.dashboardBackgroundEnabled !== false),
    dashboardBackgroundImage: backgroundImage,
    dashboardBackgroundName: safeString(preferences.dashboardBackgroundName),
    dashboardBackgroundMode: allowedBackgroundModes.has(backgroundMode) ? backgroundMode : 'cover',
    dashboardBackgroundX: boundedNumber(preferences.dashboardBackgroundX, 50, 0, 100),
    dashboardBackgroundY: boundedNumber(preferences.dashboardBackgroundY, 50, 0, 100),
    dashboardBackgroundScale: boundedNumber(preferences.dashboardBackgroundScale, 100, 20, 300),
    dashboardBackgroundDim: boundedNumber(preferences.dashboardBackgroundDim, 74, 0, 92),
    transparentSectionsEnabled: Boolean(preferences.transparentSectionsEnabled),
    sectionTransparency: boundedNumber(preferences.sectionTransparency, 0, 0, 75),
    sectionBlur: boundedNumber(preferences.sectionBlur, 10, 0, 28),
    accentTone: allowedAccentTones.has(accentTone) ? accentTone : 'smartlink',
    cachedAt: new Date().toISOString(),
    userId: user?.id ?? null,
    schoolId: user?.schoolId ?? null,
    role: user?.role || null,
  }
}

export function readLastLoginAppearance() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(loginAppearanceStorageKey)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function writeLastLoginAppearance(preferences: any, user?: any) {
  if (typeof window === 'undefined') return null
  const appearance = loginAppearanceFromPreferences(preferences, user)
  if (!appearance) return null

  try {
    window.localStorage.setItem(loginAppearanceStorageKey, JSON.stringify(appearance))
    return appearance
  } catch {
    return null
  }
}
