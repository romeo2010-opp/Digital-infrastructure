const listenersByUser = new Map()

function toUserKey(userId) {
  const normalized = Number(userId || 0)
  if (!Number.isFinite(normalized) || normalized <= 0) return null
  return String(normalized)
}

export function subscribeInternalChat(userId, listener) {
  const key = toUserKey(userId)
  if (!key || typeof listener !== "function") return () => {}

  let listeners = listenersByUser.get(key)
  if (!listeners) {
    listeners = new Set()
    listenersByUser.set(key, listeners)
  }

  listeners.add(listener)

  return () => {
    const current = listenersByUser.get(key)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listenersByUser.delete(key)
  }
}

export function publishInternalChatEvent({ userId, eventType, data = {} }) {
  const key = toUserKey(userId)
  if (!key) return

  const listeners = listenersByUser.get(key)
  if (!listeners?.size) return

  const payload = {
    type: eventType || "internal_chat:event",
    data: data || {},
    at: new Date().toISOString(),
  }

  for (const listener of [...listeners]) {
    try {
      listener(payload)
    } catch {
      // Ignore individual listener failures during fan-out.
    }
  }
}
