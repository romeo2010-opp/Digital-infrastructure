import { prisma } from "../../../db/prisma.js"
import { publishMeraDashboardUpdate } from "../../../realtime/meraDashboardHub.js"
import { syncInventoryDerivedStationStatusLogs } from "./portal.service.js"

const DEFAULT_INTERVAL_MS = Number(process.env.MERA_STATUS_WATCH_INTERVAL_MS || 300000)
const DEFAULT_INITIAL_DELAY_MS = Number(process.env.MERA_STATUS_INITIAL_DELAY_MS || 15000)
const DEFAULT_HEARTBEAT_MINUTES = Number(process.env.MERA_STATUS_HEARTBEAT_MINUTES || 60)
const DEFAULT_RETENTION_DAYS = Number(process.env.MERA_STATUS_RAW_RETENTION_DAYS || 90)
const DEFAULT_TRANSACTION_MAX_WAIT_MS = Number(process.env.MERA_STATUS_TRANSACTION_MAX_WAIT_MS || 10000)
const DEFAULT_TRANSACTION_TIMEOUT_MS = Number(process.env.MERA_STATUS_TRANSACTION_TIMEOUT_MS || 60000)
const LOCK_NAME = "smartlink:mera_status_logger"

function isWatcherEnabled() {
  return String(process.env.MERA_STATUS_WATCHER_ENABLED || "true").trim().toLowerCase() !== "false"
}

function resolveInitialDelayMs() {
  return Number.isFinite(DEFAULT_INITIAL_DELAY_MS) && DEFAULT_INITIAL_DELAY_MS > 0 ? DEFAULT_INITIAL_DELAY_MS : 0
}

export async function runMeraStationStatusLoggerTick({
  heartbeatMinutes = DEFAULT_HEARTBEAT_MINUTES,
  retentionDays = DEFAULT_RETENTION_DAYS,
} = {}) {
  const result = await prisma.$transaction(
    async (tx) => {
      let lockAcquired = false

      try {
        const lockRows = await tx.$queryRaw`
          SELECT GET_LOCK(${LOCK_NAME}, 0) AS lock_acquired
        `
        lockAcquired = Number(lockRows?.[0]?.lock_acquired || 0) === 1
        if (!lockAcquired) return { skipped: true, reason: "lock_busy" }

        const result = await syncInventoryDerivedStationStatusLogs({ heartbeatMinutes, retentionDays, db: tx })
        return { skipped: false, ...result }
      } finally {
        if (lockAcquired) {
          await tx.$queryRaw`
            SELECT RELEASE_LOCK(${LOCK_NAME}) AS lock_released
          `.catch(() => null)
        }
      }
    },
    {
      maxWait: Number.isFinite(DEFAULT_TRANSACTION_MAX_WAIT_MS) ? DEFAULT_TRANSACTION_MAX_WAIT_MS : 10000,
      timeout: Number.isFinite(DEFAULT_TRANSACTION_TIMEOUT_MS) ? DEFAULT_TRANSACTION_TIMEOUT_MS : 60000,
    }
  )

  if (!result?.skipped) {
    publishMeraDashboardUpdate({
      source: "station_status_logger",
      result: {
        inserted: result?.inserted || 0,
        scanned: result?.scanned || 0,
        currentStatuses: result?.currentStatuses || 0,
        rollups: result?.rollups || 0,
      },
    })
  }

  return result
}

export function startMeraStationStatusLogger() {
  if (!isWatcherEnabled()) {
    // eslint-disable-next-line no-console
    console.info("[mera-status] watcher disabled")
    return () => {}
  }

  let running = false
  let stopped = false
  let hasLoggedStartup = false

  async function tick() {
    if (running || stopped) return
    running = true
    try {
      const result = await runMeraStationStatusLoggerTick()
      if (!hasLoggedStartup) {
        hasLoggedStartup = true
        // eslint-disable-next-line no-console
        console.info("[mera-status] watcher started", {
          intervalMs: Math.max(60000, DEFAULT_INTERVAL_MS),
          heartbeatMinutes: DEFAULT_HEARTBEAT_MINUTES,
          retentionDays: DEFAULT_RETENTION_DAYS,
        })
      }
      if (result?.skipped && result.reason !== "lock_busy") {
        // eslint-disable-next-line no-console
        console.info("[mera-status] tick skipped", result)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[mera-status] watcher tick failed", error?.message || error)
    } finally {
      running = false
    }
  }

  const intervalId = setInterval(tick, Math.max(60000, DEFAULT_INTERVAL_MS))
  const initialDelayMs = resolveInitialDelayMs()
  const initialTimeoutId = initialDelayMs > 0 ? setTimeout(tick, initialDelayMs) : null
  if (!initialTimeoutId) tick()

  return () => {
    stopped = true
    clearInterval(intervalId)
    if (initialTimeoutId) clearTimeout(initialTimeoutId)
  }
}
