import jwt from "jsonwebtoken"
import { prisma } from "../db/prisma.js"
import { subscribeStationChanges } from "./stationChangesHub.js"
import { buildUserQueueStatusSnapshot, toQueueRealtimeEvents } from "../modules/userQueue/service.js"

const WS_PATH = "/ws/user-queue"

async function getActiveSession({ sessionPublicId, userId, stationId }) {
  if (!sessionPublicId) return null
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM auth_sessions
    WHERE public_id = ${sessionPublicId}
      AND user_id = ${userId}
      AND station_id <=> ${stationId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
    LIMIT 1
  `
  return rows?.[0] || null
}

async function getQueueScope(queueJoinId) {
  const rows = await prisma.$queryRaw`
    SELECT station_id, user_id
    FROM queue_entries
    WHERE public_id = ${queueJoinId}
    LIMIT 1
  `
  return rows?.[0] || null
}

function parseRequestUrl(req) {
  try {
    return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
  } catch {
    return null
  }
}

function safeSend(ws, payload) {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  } catch {
    // Ignore send errors; close handlers clean up subscriptions.
  }
}

function closeUnauthorized(ws, reason = "Unauthorized") {
  try {
    ws.close(4401, reason)
  } catch {
    // noop
  }
}

function emitStatusPayloads(ws, snapshot, trigger = "update") {
  const at = new Date().toISOString()
  safeSend(ws, {
    type: "queue:snapshot",
    trigger,
    data: snapshot,
    at,
  })
  for (const event of toQueueRealtimeEvents(snapshot)) {
    safeSend(ws, {
      ...event,
      at,
    })
  }
}

export async function attachUserQueueWebSocket(server) {
  let wsRuntime = null
  try {
    wsRuntime = await import("ws")
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[realtime] ws dependency not installed. User queue websocket disabled.")
    return { enabled: false, path: WS_PATH }
  }

  const { WebSocketServer } = wsRuntime
  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = parseRequestUrl(req)
    if (!requestUrl || requestUrl.pathname !== WS_PATH) return

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req)
    })
  })

  wss.on("connection", async (ws, req) => {
    let unsubscribe = () => {}
    let active = true
    let refreshChain = Promise.resolve()

    try {
      const requestUrl = parseRequestUrl(req)
      if (!requestUrl) {
        closeUnauthorized(ws, "Invalid request URL")
        return
      }

      const accessToken = requestUrl.searchParams.get("accessToken")
      const queueJoinId = String(requestUrl.searchParams.get("queueJoinId") || "").trim()
      const secret = process.env.JWT_ACCESS_SECRET
      if (!secret || !accessToken || !queueJoinId) {
        closeUnauthorized(ws, "Missing access token or queueJoinId")
        return
      }

      let tokenPayload
      try {
        tokenPayload = jwt.verify(accessToken, secret)
      } catch {
        closeUnauthorized(ws, "Invalid token")
        return
      }

      const sessionPublicId = typeof tokenPayload?.sid === "string" ? tokenPayload.sid : null
      const userId = Number(tokenPayload?.uid || 0)
      const rawStationId = tokenPayload?.stationId
      const hasStationScope = rawStationId !== null && rawStationId !== undefined && rawStationId !== ""
      const stationId = hasStationScope ? Number(rawStationId) : null

      if (!sessionPublicId || !Number.isFinite(userId) || userId <= 0) {
        closeUnauthorized(ws, "Invalid session scope")
        return
      }
      if (hasStationScope && (!Number.isFinite(stationId) || stationId <= 0)) {
        closeUnauthorized(ws, "Invalid session scope")
        return
      }

      const activeSession = await getActiveSession({ sessionPublicId, userId, stationId })
      if (!activeSession) {
        closeUnauthorized(ws, "Session revoked or expired")
        return
      }

      const queueScope = await getQueueScope(queueJoinId)
      if (!queueScope) {
        closeUnauthorized(ws, "Queue entry not found")
        return
      }
      const queueStationId = Number(queueScope.station_id || 0)
      if (!Number.isFinite(queueStationId) || queueStationId <= 0) {
        closeUnauthorized(ws, "Queue scope mismatch")
        return
      }

      if (hasStationScope && queueStationId !== stationId) {
        closeUnauthorized(ws, "Queue scope mismatch")
        return
      }

      const queueUserId = Number(queueScope.user_id || 0)
      if (queueUserId > 0 && queueUserId !== userId) {
        closeUnauthorized(ws, "Queue scope mismatch")
        return
      }

      const auth = {
        bypass: false,
        userId,
        userPublicId: tokenPayload?.sub || null,
        stationId: hasStationScope ? stationId : null,
        stationPublicId: hasStationScope ? tokenPayload?.stationPublicId || null : null,
        role: tokenPayload?.role || null,
        sessionPublicId,
      }

      const refreshSnapshot = (trigger) => {
        refreshChain = refreshChain
          .then(async () => {
            if (!active) return
            const snapshot = await buildUserQueueStatusSnapshot({
              queueJoinId,
              auth,
            })
            emitStatusPayloads(ws, snapshot, trigger)
          })
          .catch((error) => {
            if (!active) return
            safeSend(ws, {
              type: "queue:error",
              error: error?.message || "Failed to refresh queue status",
              at: new Date().toISOString(),
            })
          })
      }

      unsubscribe = subscribeStationChanges(queueStationId, () => {
        refreshSnapshot("station_change")
      })

      safeSend(ws, {
        type: "queue:ready",
        queueJoinId,
        at: new Date().toISOString(),
      })
      refreshSnapshot("initial")

      ws.on("message", (raw) => {
        try {
          const text = typeof raw === "string" ? raw : raw?.toString?.("utf8")
          const message = text ? JSON.parse(text) : null
          if (message?.type === "ping") {
            safeSend(ws, { type: "pong", at: new Date().toISOString() })
            return
          }
          if (message?.type === "queue:refresh") {
            refreshSnapshot("manual_refresh")
          }
        } catch {
          // Ignore malformed client messages.
        }
      })

      ws.on("close", () => {
        active = false
        unsubscribe()
      })
      ws.on("error", () => {
        active = false
        unsubscribe()
      })
    } catch {
      active = false
      unsubscribe()
      try {
        ws.close(1011, "Server error")
      } catch {
        // noop
      }
    }
  })

  return { enabled: true, path: WS_PATH }
}
