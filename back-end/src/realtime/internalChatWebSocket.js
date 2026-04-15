import jwt from "jsonwebtoken"
import { prisma } from "../db/prisma.js"
import { subscribeInternalChat } from "./internalChatHub.js"

const WS_PATH = "/ws/internal-chat"

async function getActiveInternalSession({ sessionPublicId, userId }) {
  if (!sessionPublicId) return null
  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM internal_auth_sessions
    WHERE public_id = ${sessionPublicId}
      AND user_id = ${userId}
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
    // Ignore send failures; close handler will clean up the listener.
  }
}

function closeUnauthorized(ws, reason = "Unauthorized") {
  try {
    ws.close(4401, reason)
  } catch {
    // noop
  }
}

export async function attachInternalChatWebSocket(server) {
  let wsRuntime = null
  try {
    wsRuntime = await import("ws")
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[realtime] ws dependency not installed. Internal chat websocket disabled.")
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
      const secret = process.env.JWT_ACCESS_SECRET
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

      const sessionPublicId = typeof tokenPayload?.sid === "string" ? tokenPayload.sid : null
      const userId = Number(tokenPayload?.uid || 0)
      if (
        tokenPayload?.scope !== "internal" ||
        !sessionPublicId ||
        !Number.isFinite(userId) ||
        userId <= 0
      ) {
        closeUnauthorized(ws, "Invalid session scope")
        return
      }

      const activeSession = await getActiveInternalSession({ sessionPublicId, userId })
      if (!activeSession) {
        closeUnauthorized(ws, "Session revoked or expired")
        return
      }

      unsubscribe = subscribeInternalChat(userId, (message) => {
        safeSend(ws, message)
      })

      safeSend(ws, {
        type: "internal_chat:ready",
        data: {
          userId,
        },
        at: new Date().toISOString(),
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
