import { getStationChangeToken } from "./stationChangeToken.js"
import { listStationChangeListenerStationIds, publishStationChange } from "./stationChangesHub.js"

const DEFAULT_INTERVAL_MS = Number(process.env.STATION_CHANGE_WATCH_INTERVAL_MS || 2000)

function isWatcherEnabled() {
  return String(process.env.STATION_CHANGE_WATCHER_ENABLED || "true").trim().toLowerCase() !== "false"
}

export function startStationChangeWatcher() {
  if (!isWatcherEnabled()) {
    // eslint-disable-next-line no-console
    console.info("[realtime] station change watcher disabled")
    return () => {}
  }

  const tokenByStationId = new Map()
  let running = false
  let stopped = false

  async function tick() {
    if (running || stopped) return
    running = true
    try {
      const subscribedStationIds = listStationChangeListenerStationIds()
      const seenStationIds = new Set()

      for (const stationId of subscribedStationIds) {
        seenStationIds.add(stationId)

        const nextToken = await getStationChangeToken(stationId)
        const previousToken = tokenByStationId.get(stationId)
        tokenByStationId.set(stationId, nextToken)

        // Prime cache on first observation; only publish on actual change.
        if (previousToken === undefined) continue
        if (previousToken === nextToken) continue

        publishStationChange({
          stationId,
          actionType: "DB_CHANGE",
          payload: {
            source: "station_change_watcher",
            token: nextToken,
          },
        })
      }

      for (const stationId of [...tokenByStationId.keys()]) {
        if (!seenStationIds.has(stationId)) {
          tokenByStationId.delete(stationId)
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[realtime] station change watcher tick failed", error?.message || error)
    } finally {
      running = false
    }
  }

  const intervalId = setInterval(tick, Math.max(1000, DEFAULT_INTERVAL_MS))
  tick()

  return () => {
    stopped = true
    clearInterval(intervalId)
  }
}
