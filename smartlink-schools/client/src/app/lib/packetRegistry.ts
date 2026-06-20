export const MERA_PACKET_KEYS = [
  'schoolSnapshot',
  'schoolNotifications',
  'schoolUsers',
  'schoolAudit',
] as const

export type MeraPacketKey = (typeof MERA_PACKET_KEYS)[number]
export type MeraPacketStatus = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden'
export type MeraRealtimeMode = 'connecting' | 'websocket' | 'polling' | 'disabled'

const allPacketKeys = new Set<string>(MERA_PACKET_KEYS)

export function normalizePacketKeys(keys?: readonly string[] | string | null): MeraPacketKey[] {
  const raw = Array.isArray(keys) ? keys : String(keys || '').split(',')
  return [...new Set(raw.map((key) => String(key || '').trim()).filter((key): key is MeraPacketKey => allPacketKeys.has(key)))]
}

export function filterPacketKeysForUser(keys: readonly MeraPacketKey[]): MeraPacketKey[] {
  void keys
  return []
}

export function routePacketKeys(): MeraPacketKey[] {
  return []
}

export function routeSyncPacketKeys(): MeraPacketKey[] {
  return []
}
