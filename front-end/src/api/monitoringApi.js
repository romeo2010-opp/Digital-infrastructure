import { httpClient } from "./httpClient"
import { getAccessToken } from "../auth/authSession"

function resolveWsUrl() {
  const accessToken = getAccessToken()
  if (!accessToken) throw new Error("Missing access token")

  const rawBase = import.meta.env.VITE_API_BASE_URL || window.location.origin
  const base = new URL(rawBase, window.location.origin)
  const wsProtocol = base.protocol === "https:" ? "wss:" : "ws:"
  const wsUrl = new URL(`${wsProtocol}//${base.host}/ws/monitoring`)
  wsUrl.searchParams.set("accessToken", accessToken)
  return wsUrl.toString()
}

export const monitoringApi = {
  async getPumpSnapshot(pumpId) {
    const scopedPumpId = encodeURIComponent(String(pumpId || "").trim())
    return httpClient.get(`/api/monitoring/pumps/${scopedPumpId}`)
  },

  connectPumpSocket({ pumpId, onMessage, onOpen, onClose, onError }) {
    if (typeof window.WebSocket !== "function") {
      throw new Error("WebSocket is not supported by this browser")
    }

    const socket = new window.WebSocket(resolveWsUrl())

    socket.onopen = () => {
      onOpen?.()
      try {
        socket.send(
          JSON.stringify({
            type: "monitoring:subscribe",
            pumpId,
          })
        )
      } catch (error) {
        onError?.(error)
      }
    }

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data || "{}")
        onMessage?.(parsed)
      } catch {
        // Ignore malformed messages.
      }
    }

    socket.onerror = (event) => {
      onError?.(event)
    }

    socket.onclose = (event) => {
      onClose?.(event)
    }

    return () => {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      try {
        socket.close()
      } catch {
        // noop
      }
    }
  },
}
