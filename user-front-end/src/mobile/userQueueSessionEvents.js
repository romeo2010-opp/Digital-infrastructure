const USER_QUEUE_SESSION_SYNC_EVENT = 'smartlink:user-queue-session-sync'

function canUseWindow() {
  return typeof window !== 'undefined'
}

function normalizeQueueJoinId(queueJoinId) {
  return String(queueJoinId || '').trim()
}

function findQueueJoinIdFromCards(cards) {
  if (!Array.isArray(cards)) return ''

  const queueCard = cards.find((card) => {
    return (
      card &&
      typeof card === 'object' &&
      String(card.kind || '').trim().toLowerCase() === 'active_booking' &&
      String(card.bookingType || '').trim().toLowerCase() === 'queue' &&
      normalizeQueueJoinId(card.queueJoinId)
    )
  })

  return normalizeQueueJoinId(queueCard?.queueJoinId)
}

export function emitUserQueueSessionSync({ queueJoinId = '', known = false } = {}) {
  if (!canUseWindow()) return

  window.dispatchEvent(
    new window.CustomEvent(USER_QUEUE_SESSION_SYNC_EVENT, {
      detail: {
        queueJoinId: normalizeQueueJoinId(queueJoinId),
        known: Boolean(known),
      },
    })
  )
}

export function emitUserQueueSessionSyncFromAssistantResponse(response) {
  if (!response || typeof response !== 'object') return

  const data = response.data && typeof response.data === 'object' ? response.data : null
  if (data && Object.prototype.hasOwnProperty.call(data, 'queueJoinId')) {
    emitUserQueueSessionSync({
      queueJoinId: data.queueJoinId,
      known: true,
    })
    return
  }

  const queueJoinId = findQueueJoinIdFromCards(response.cards)
  if (!queueJoinId) return

  emitUserQueueSessionSync({
    queueJoinId,
    known: true,
  })
}

export function subscribeUserQueueSessionSync(listener) {
  if (!canUseWindow() || typeof listener !== 'function') {
    return () => {}
  }

  const handleEvent = (event) => {
    const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {}
    listener({
      queueJoinId: normalizeQueueJoinId(detail.queueJoinId),
      known: Boolean(detail.known),
    })
  }

  window.addEventListener(USER_QUEUE_SESSION_SYNC_EVENT, handleEvent)
  return () => {
    window.removeEventListener(USER_QUEUE_SESSION_SYNC_EVENT, handleEvent)
  }
}
