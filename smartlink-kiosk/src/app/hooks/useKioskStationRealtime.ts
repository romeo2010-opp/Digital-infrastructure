import { useEffect, useRef } from "react"
import { AUTH_EXPIRED_EVENT } from "../api/httpClient"
import { authApi } from "../api/authApi"
import { getAccessToken, getStationPublicId, setAccessToken } from "../auth/authSession"

const RETRY_BACKOFF_MS = [2000, 5000, 10000, 15000]

function hasProtocol(value: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(String(value || ""))
}

function resolveWsBaseUrl() {
  const wsBase = import.meta.env.VITE_WS_BASE_URL
  if (wsBase) return new URL(wsBase, window.location.origin)

  const apiBase = import.meta.env.VITE_API_BASE_URL
  if (apiBase) {
    const apiUrl = new URL(apiBase, window.location.origin)
    const apiBaseIsRelative = !hasProtocol(apiBase)
    if (import.meta.env.DEV && apiBaseIsRelative) {
      const devTarget = import.meta.env.VITE_DEV_API_TARGET || "http://localhost:4000"
      return new URL(devTarget, window.location.origin)
    }
    return apiUrl
  }

  if (import.meta.env.DEV) {
    const devTarget = import.meta.env.VITE_DEV_API_TARGET || "http://localhost:4000"
    return new URL(devTarget, window.location.origin)
  }

  return new URL(window.location.origin)
}

function getStationChangesWsUrl() {
  const token = getAccessToken()
  const stationPublicId = getStationPublicId()
  if (!token || !stationPublicId) return null

  const base = resolveWsBaseUrl()
  const wsProtocol = base.protocol === "https:" ? "wss:" : "ws:"
  const wsUrl = new URL(`${wsProtocol}//${base.host}/ws/station-changes`)
  wsUrl.searchParams.set("accessToken", token)
  return wsUrl.toString()
}

export function useKioskStationRealtime({
  enabled = true,
  onChange,
}: {
  enabled?: boolean
  onChange?: (message?: Record<string, unknown>) => void | Promise<void>
}) {
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled) return undefined

    const stationPublicId = getStationPublicId()
    if (!stationPublicId) return undefined

    let active = true
    let ws: WebSocket | null = null
    let reconnectTimerId = 0
    let fallbackTimerId = 0
    let retryIndex = 0
    let refreshInFlight = false

    function clearReconnectTimer() {
      if (reconnectTimerId) {
        window.clearTimeout(reconnectTimerId)
        reconnectTimerId = 0
      }
    }

    function clearFallbackTimer() {
      if (fallbackTimerId) {
        window.clearInterval(fallbackTimerId)
        fallbackTimerId = 0
      }
    }

    function startFallbackPolling() {
      if (fallbackTimerId) return
      fallbackTimerId = window.setInterval(() => {
        Promise.resolve(onChangeRef.current?.({ type: "station_change_fallback_tick" })).catch(() => {})
      }, 60000)
    }

    function stopWebSocket() {
      if (!ws) return
      const socket = ws
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      try {
        socket.close()
      } catch {
        // noop
      }
      ws = null
    }

    function scheduleReconnect() {
      clearReconnectTimer()
      if (!active) return
      const waitMs = RETRY_BACKOFF_MS[Math.min(retryIndex, RETRY_BACKOFF_MS.length - 1)]
      retryIndex += 1
      reconnectTimerId = window.setTimeout(() => {
        connectWebSocket()
      }, waitMs)
    }

    async function handleUnauthorizedClose() {
      if (refreshInFlight) return
      refreshInFlight = true
      try {
        const refreshed = await authApi.refresh()
        setAccessToken(refreshed.accessToken)
        refreshInFlight = false
        connectWebSocket()
      } catch {
        refreshInFlight = false
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
        }
      }
    }

    function connectWebSocket() {
      if (!active) return
      const wsUrl = getStationChangesWsUrl()
      if (!wsUrl || typeof window.WebSocket !== "function") {
        startFallbackPolling()
        return
      }

      stopWebSocket()

      try {
        ws = new window.WebSocket(wsUrl)
      } catch {
        startFallbackPolling()
        scheduleReconnect()
        return
      }

      let opened = false

      ws.onopen = () => {
        opened = true
        retryIndex = 0
        clearFallbackTimer()
        Promise.resolve(onChangeRef.current?.({ type: "station_change_connected" })).catch(() => {})
      }

      ws.onmessage = async (event) => {
        if (!active) return
        try {
          const parsed = JSON.parse(event.data || "{}")
          if (parsed?.type === "station_change" || parsed?.type === "station_change_ready") {
            await onChangeRef.current?.(parsed)
          }
        } catch {
          // Ignore malformed messages.
        }
      }

      ws.onerror = () => {
        // close event handles reconnect
      }

      ws.onclose = (event) => {
        if (!active) return
        const reason = String(event.reason || "").toLowerCase()
        if (event.code === 4401 || reason.includes("session revoked") || reason.includes("expired")) {
          void handleUnauthorizedClose()
          return
        }
        startFallbackPolling()
        if (!opened) {
          scheduleReconnect()
          return
        }
        scheduleReconnect()
      }
    }

    connectWebSocket()

    return () => {
      active = false
      clearReconnectTimer()
      clearFallbackTimer()
      stopWebSocket()
    }
  }, [enabled])
}
