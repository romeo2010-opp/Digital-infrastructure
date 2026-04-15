import { prisma } from "../db/prisma.js"
import { getStationChangeToken } from "./stationChangeToken.js"
import { publishStationChange } from "./stationChangesHub.js"

const DEFAULT_INTERVAL_MS = Number(process.env.STATION_CHANGE_WATCH_INTERVAL_MS || 2000)

export function startStationChangeWatcher() {
  const tokenByStationId = new Map()
  let running = false
  let stopped = false

  async function tick() {
    if (running || stopped) return
    running = true
    try {
      const stations = await prisma.$queryRaw`
        SELECT id
        FROM stations
        WHERE is_active = 1
      `

      const seenStationIds = new Set()

      for (const station of stations || []) {
        const stationId = Number(station?.id)
        if (!Number.isFinite(stationId) || stationId <= 0) continue
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

