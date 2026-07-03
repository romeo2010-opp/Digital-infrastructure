export const MERA_PACKET_KEYS = [
  'schoolDashboard',
  'studentPortal',
] as const

export type MeraPacketKey = (typeof MERA_PACKET_KEYS)[number]
export type MeraPacketStatus = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden'
export type MeraRealtimeMode = 'connecting' | 'websocket' | 'polling' | 'disabled'

const allPacketKeys = new Set<string>(MERA_PACKET_KEYS)
const schoolDashboardRoles = new Set(['school_owner', 'headteacher', 'teacher', 'bursar', 'super_admin'])

export function normalizePacketKeys(keys?: readonly string[] | string | null): MeraPacketKey[] {
  const raw = Array.isArray(keys) ? keys : String(keys || '').split(',')
  return [...new Set(raw.map((key) => String(key || '').trim()).filter((key): key is MeraPacketKey => allPacketKeys.has(key)))]
}

export function filterPacketKeysForUser(keys: readonly MeraPacketKey[], user?: any): MeraPacketKey[] {
  const role = String(user?.role || '').toLowerCase()
  return normalizePacketKeys(keys).filter((key) => {
    if (key === 'studentPortal') return role === 'student'
    if (key === 'schoolDashboard') return schoolDashboardRoles.has(role)
    return false
  })
}

export function routePacketKeys(pathname = ''): MeraPacketKey[] {
  if (pathname === '/student-portal' || pathname.startsWith('/student-portal/')) return ['studentPortal']
  if (pathname === '/dashboard' || pathname === '/' || pathname.startsWith('/dashboard/')) return ['schoolDashboard']
  return []
}

export function routeSyncPacketKeys(pathname = ''): MeraPacketKey[] {
  return routePacketKeys(pathname)
}
