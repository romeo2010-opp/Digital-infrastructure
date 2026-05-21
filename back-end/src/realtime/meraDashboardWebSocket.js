import jwt from "jsonwebtoken"
import { hasMeraPermission, MERA_PERMISSIONS } from "../modules/mera/permissions.js"
import { getMeraJwtSecretForMiddleware, getMeraUserAccessById } from "../modules/mera/services/auth.service.js"
import { prisma } from "../db/prisma.js"
import { subscribeMeraDashboard } from "./meraDashboardHub.js"

const WS_PATH = "/ws/mera-dashboard"

async function getActiveMeraSession(sessionPublicId, meraUserId) {
  if (!sessionPublicId) return null
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM mera_auth_sessions
    WHERE public_id = ${sessionPublicId}
      AND mera_user_id = ${meraUserId}
      AND revoked_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP(3)
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

function buildMeraAuth(payload, sessionPublicId, access) {
  return {
    userId: Number(payload.uid),
    userPublicId: String(payload.sub || "").trim() || access.publicId || null,
    sessionPublicId,
    fullName: access.fullName,
    email: access.email,
    role: access.role?.code,
    roleDisplayName: access.role?.displayName,
    permissions: access.permissions,
    districtScope: access.districtScope,
    regionScope: access.regionScope,
    accountStatus: access.accountStatus,
  }
}

export async function attachMeraDashboardWebSocket(server) {
  let wsRuntime = null
  try {
    wsRuntime = await import("ws")
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[realtime] ws dependency not installed. MERA dashboard websocket disabled.")
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

    try {
      const requestUrl = parseRequestUrl(req)
      if (!requestUrl) {
        closeUnauthorized(ws, "Invalid request URL")
        return
      }

      const accessToken = requestUrl.searchParams.get("accessToken")
      const secret = getMeraJwtSecretForMiddleware()
      if (!secret || !accessToken) {
        closeUnauthorized(ws, "Missing access token")
        return
      }

      let tokenPayload
      try {
        tokenPayload = jwt.verify(accessToken, secret)
      } catch {
        closeUnauthorized(ws, "Invalid token")
        return
      }

      if (tokenPayload?.scope !== "mera") {
        closeUnauthorized(ws, "Invalid session scope")
        return
      }

      const sessionPublicId = typeof tokenPayload?.sid === "string" ? tokenPayload.sid : null
      const userId = Number(tokenPayload?.uid || 0)
      if (!sessionPublicId || !Number.isFinite(userId) || userId <= 0) {
        closeUnauthorized(ws, "Invalid session context")
        return
      }

      const activeSession = await getActiveMeraSession(sessionPublicId, userId)
      if (!activeSession?.public_id) {
        closeUnauthorized(ws, "Session revoked or expired")
        return
      }

      const access = await getMeraUserAccessById(userId)
      if (!access?.id || String(access.accountStatus || "").trim().toUpperCase() !== "ACTIVE") {
        closeUnauthorized(ws, "MERA account is not active")
        return
      }

      const auth = buildMeraAuth(tokenPayload, activeSession.public_id, access)
      const canViewDashboard =
        hasMeraPermission(auth, MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL) ||
        hasMeraPermission(auth, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT)

      if (!canViewDashboard) {
        closeUnauthorized(ws, "Forbidden")
        return
      }

      unsubscribe = subscribeMeraDashboard((message) => {
        safeSend(ws, message)
      })

      safeSend(ws, {
        type: "mera_dashboard_ready",
        at: new Date().toISOString(),
        districtScope: auth.districtScope || null,
      })

      ws.on("message", (raw) => {
        try {
          const text = typeof raw === "string" ? raw : raw?.toString?.("utf8")
          const message = text ? JSON.parse(text) : null
          if (message?.type === "ping") {
            safeSend(ws, { type: "pong", at: new Date().toISOString() })
          }
        } catch {
          // Ignore malformed client messages.
        }
      })

      ws.on("close", () => {
        unsubscribe()
      })
      ws.on("error", () => {
        unsubscribe()
      })
    } catch {
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
