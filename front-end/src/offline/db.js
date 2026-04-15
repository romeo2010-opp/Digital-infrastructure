const DB_NAME = "smartlink_offline"
const DB_VERSION = 1
const OUTBOX_STORE = "outbox_events"
const META_STORE = "meta"
const SNAPSHOTS_STORE = "snapshots"
const DEVICE_ID_META_KEY = "deviceId"

let dbPromise = null

function isBrowser() {
  return typeof window !== "undefined"
}

function hasIndexedDb() {
  return isBrowser() && typeof window.indexedDB !== "undefined"
}

function toIsoNow() {
  return new Date().toISOString()
}

function randomId() {
  if (isBrowser() && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }
  return `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"))
  })
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"))
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"))
  })
}

function ensureStore(db, storeName, options) {
  if (!db.objectStoreNames.contains(storeName)) {
    return db.createObjectStore(storeName, options)
  }
  return null
}

async function getDb() {
  if (!hasIndexedDb()) {
    throw new Error("IndexedDB is not available in this environment")
  }
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      const outboxStore = ensureStore(db, OUTBOX_STORE, { keyPath: "eventId" })
      const metaStore = ensureStore(db, META_STORE, { keyPath: "key" })
      const snapshotsStore = ensureStore(db, SNAPSHOTS_STORE, { keyPath: "key" })

      const outbox = outboxStore || request.transaction.objectStore(OUTBOX_STORE)
      if (!outbox.indexNames.contains("status_createdAtLocal")) {
        outbox.createIndex("status_createdAtLocal", ["status", "createdAtLocal"], { unique: false })
      }
      if (!outbox.indexNames.contains("status_nextRetryAt_createdAtLocal")) {
        outbox.createIndex(
          "status_nextRetryAt_createdAtLocal",
          ["status", "nextRetryAt", "createdAtLocal"],
          { unique: false }
        )
      }

      if (!metaStore && !request.transaction.objectStore(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" })
      }
      if (!snapshotsStore && !request.transaction.objectStore(SNAPSHOTS_STORE)) {
        db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "key" })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"))
  })

  return dbPromise
}

export async function putOutboxEvent(event) {
  const db = await getDb()
  const tx = db.transaction(OUTBOX_STORE, "readwrite")
  const store = tx.objectStore(OUTBOX_STORE)
  const payload = {
    status: "PENDING",
    attempts: 0,
    nextRetryAt: toIsoNow(),
    lastError: null,
    ...event,
  }
  store.put(payload)
  await txDone(tx)
  return payload
}

export async function patchOutboxEvent(eventId, patch) {
  const db = await getDb()
  const tx = db.transaction(OUTBOX_STORE, "readwrite")
  const store = tx.objectStore(OUTBOX_STORE)
  const current = await requestToPromise(store.get(eventId))
  if (current) {
    store.put({ ...current, ...patch })
  }
  await txDone(tx)
}

export async function markOutboxEventsAcked(eventIds = []) {
  if (!eventIds.length) return
  const db = await getDb()
  const tx = db.transaction(OUTBOX_STORE, "readwrite")
  const store = tx.objectStore(OUTBOX_STORE)
  const ackedAtLocal = toIsoNow()

  for (const eventId of eventIds) {
    const current = await requestToPromise(store.get(eventId))
    if (!current) continue
    store.put({
      ...current,
      status: "ACKED",
      ackedAtLocal,
      nextRetryAt: null,
      lastError: null,
    })
  }

  await txDone(tx)
}

export async function getPendingEvents(limit = 50) {
  const db = await getDb()
  const tx = db.transaction(OUTBOX_STORE, "readonly")
  const store = tx.objectStore(OUTBOX_STORE)
  const index = store.index("status_nextRetryAt_createdAtLocal")
  const nowIso = toIsoNow()
  const range = IDBKeyRange.bound(["PENDING", "", ""], ["PENDING", nowIso, "\uffff"])
  const request = index.openCursor(range, "next")
  const rows = []

  await new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error || new Error("Failed to read pending events"))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || rows.length >= limit) {
        resolve()
        return
      }
      rows.push(cursor.value)
      cursor.continue()
    }
  })

  await txDone(tx)
  return rows
}

export async function schedulePendingEventsNow(limit = 50) {
  const db = await getDb()
  const tx = db.transaction(OUTBOX_STORE, "readwrite")
  const store = tx.objectStore(OUTBOX_STORE)
  const index = store.index("status_createdAtLocal")
  const range = IDBKeyRange.bound(["PENDING", ""], ["PENDING", "\uffff"])
  const request = index.openCursor(range, "next")
  const nowIso = toIsoNow()
  let scheduled = 0

  await new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error || new Error("Failed to reschedule pending events"))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor || scheduled >= limit) {
        resolve()
        return
      }
      const current = cursor.value || {}
      cursor.update({
        ...current,
        nextRetryAt: nowIso,
      })
      scheduled += 1
      cursor.continue()
    }
  })

  await txDone(tx)
  return scheduled
}

export async function getPendingCount() {
  const db = await getDb()
  const tx = db.transaction(OUTBOX_STORE, "readonly")
  const store = tx.objectStore(OUTBOX_STORE)
  const index = store.index("status_createdAtLocal")
  const range = IDBKeyRange.bound(["PENDING", ""], ["PENDING", "\uffff"])
  const count = await requestToPromise(index.count(range))
  await txDone(tx)
  return Number(count || 0)
}

export async function getMeta(key) {
  const db = await getDb()
  const tx = db.transaction(META_STORE, "readonly")
  const row = await requestToPromise(tx.objectStore(META_STORE).get(key))
  await txDone(tx)
  return row?.value
}

export async function setMeta(key, value) {
  const db = await getDb()
  const tx = db.transaction(META_STORE, "readwrite")
  tx.objectStore(META_STORE).put({ key, value })
  await txDone(tx)
  return value
}

export async function getSnapshot(key) {
  const db = await getDb()
  const tx = db.transaction(SNAPSHOTS_STORE, "readonly")
  const row = await requestToPromise(tx.objectStore(SNAPSHOTS_STORE).get(key))
  await txDone(tx)
  return row?.value
}

export async function setSnapshot(key, value) {
  const db = await getDb()
  const tx = db.transaction(SNAPSHOTS_STORE, "readwrite")
  tx.objectStore(SNAPSHOTS_STORE).put({ key, value })
  await txDone(tx)
  return value
}

export async function getOrCreateDeviceId() {
  const existing = await getMeta(DEVICE_ID_META_KEY)
  if (existing) return String(existing)
  const deviceId = randomId()
  await setMeta(DEVICE_ID_META_KEY, deviceId)
  return deviceId
}

export const offlineDbConfig = {
  name: DB_NAME,
  stores: {
    outboxEvents: OUTBOX_STORE,
    meta: META_STORE,
    snapshots: SNAPSHOTS_STORE,
  },
}
