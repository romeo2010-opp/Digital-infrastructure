import { useEffect, useRef, useState } from "react"
import { AUTH_EXPIRED_EVENT } from "../api/httpClient"
import { getAccessToken, getStationPublicId } from "../auth/authSession"

const RETRY_BACKOFF_MS = [2000, 5000, 10000, 15000]
const DEFAULT_CONNECT_TIMEOUT_MS = 5000
const DEFAULT_FALLBACK_INTERVAL_MS = 5000
const FALLBACK_RECONNECT_INTERVAL_MS = 10000
const HEARTBEAT_INTERVAL_MS = 25000

export type KioskRealtimeMode = "disabled" | "connecting" | "websocket" | "polling"

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
  fallbackIntervalMs = DEFAULT_FALLBACK_INTERVAL_MS,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
}: {
  enabled?: boolean
  onChange?: (message?: Record<string, unknown>) => void | Promise<void>
  fallbackIntervalMs?: number
  connectTimeoutMs?: number
}) {
  const onChangeRef = useRef(onChange)
  const [mode, setMode] = useState<KioskRealtimeMode>(enabled ? "connecting" : "disabled")

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled) {
      setMode("disabled")
      return undefined
    }

    const stationPublicId = getStationPublicId()
    if (!stationPublicId) {
      setMode("disabled")
      return undefined
    }

    let active = true
    let ws: WebSocket | null = null
    let reconnectTimerId = 0
    let fallbackTimerId = 0
    let fallbackReconnectTimerId = 0
    let connectTimeoutId = 0
    let heartbeatTimerId = 0
    let retryIndex = 0
    const normalizedFallbackIntervalMs = Math.max(1000, Number(fallbackIntervalMs || DEFAULT_FALLBACK_INTERVAL_MS))
    const normalizedConnectTimeoutMs = Math.max(1000, Number(connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS))

    function clearReconnectTimer() {
      if (reconnectTimerId) {
        window.clearTimeout(reconnectTimerId)
        reconnectTimerId = 0
      }
    }

    function clearConnectTimeout() {
      if (connectTimeoutId) {
        window.clearTimeout(connectTimeoutId)
        connectTimeoutId = 0
      }
    }

    function clearFallbackTimer() {
      if (fallbackTimerId) {
        window.clearInterval(fallbackTimerId)
        fallbackTimerId = 0
      }
    }

    function clearFallbackReconnectTimer() {
      if (fallbackReconnectTimerId) {
        window.clearInterval(fallbackReconnectTimerId)
        fallbackReconnectTimerId = 0
      }
    }

    function clearHeartbeatTimer() {
      if (heartbeatTimerId) {
        window.clearInterval(heartbeatTimerId)
        heartbeatTimerId = 0
      }
    }

    function notifyChange(message: Record<string, unknown>) {
      Promise.resolve(onChangeRef.current?.(message)).catch(() => {})
    }

    function startFallbackReconnectLoop() {
      if (fallbackReconnectTimerId) return
      fallbackReconnectTimerId = window.setInterval(() => {
        if (!active) return
        if (typeof window.WebSocket !== "function") {
          if (!reconnectTimerId) scheduleReconnect()
          return
        }
        const socket = ws
        if (
          socket
          && (
            socket.readyState === window.WebSocket.CONNECTING
            || socket.readyState === window.WebSocket.OPEN
          )
        ) {
          return
        }
        if (reconnectTimerId) return
        connectWebSocket()
      }, FALLBACK_RECONNECT_INTERVAL_MS)
    }

    function startFallbackPolling(reason = "socket_unavailable") {
      if (!active) return
      setMode("polling")
      startFallbackReconnectLoop()
      if (fallbackTimerId) return
      notifyChange({ type: "station_change_fallback_started", reason })
      fallbackTimerId = window.setInterval(() => {
        notifyChange({ type: "station_change_fallback_tick", reason })
      }, normalizedFallbackIntervalMs)
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

    function startHeartbeat() {
      clearHeartbeatTimer()
      heartbeatTimerId = window.setInterval(() => {
        const socket = ws
        if (!socket || socket.readyState !== window.WebSocket.OPEN) return
        try {
          socket.send(JSON.stringify({ type: "ping", at: new Date().toISOString() }))
        } catch {
          startFallbackPolling("heartbeat_failed")
          stopWebSocket()
          scheduleReconnect()
        }
      }, HEARTBEAT_INTERVAL_MS)
    }

    function scheduleReconnect() {
      clearReconnectTimer()
      if (!active) return
      const waitMs = RETRY_BACKOFF_MS[Math.min(retryIndex, RETRY_BACKOFF_MS.length - 1)]
      retryIndex += 1
      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = 0
        connectWebSocket()
      }, waitMs)
    }

    async function handleUnauthorizedClose() {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
      }
    }

    function connectWebSocket() {
      if (!active) return
      const wsUrl = getStationChangesWsUrl()
      if (!wsUrl || typeof window.WebSocket !== "function") {
        startFallbackPolling("websocket_unavailable")
        scheduleReconnect()
        return
      }

      stopWebSocket()
      clearConnectTimeout()
      clearHeartbeatTimer()
      if (!fallbackTimerId) {
        setMode("connecting")
      }

      try {
        ws = new window.WebSocket(wsUrl)
      } catch {
        startFallbackPolling("websocket_create_failed")
        scheduleReconnect()
        return
      }

      let opened = false
      connectTimeoutId = window.setTimeout(() => {
        if (!active || opened) return
        startFallbackPolling("websocket_connect_timeout")
        stopWebSocket()
        scheduleReconnect()
      }, normalizedConnectTimeoutMs)

      ws.onopen = () => {
        opened = true
        retryIndex = 0
        clearConnectTimeout()
        clearFallbackTimer()
        clearFallbackReconnectTimer()
        setMode("websocket")
        startHeartbeat()
        notifyChange({ type: "station_change_connected" })
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
        clearConnectTimeout()
        clearHeartbeatTimer()
        const reason = String(event.reason || "").toLowerCase()
        if (event.code === 4401 || reason.includes("session revoked") || reason.includes("expired")) {
          setMode("disabled")
          void handleUnauthorizedClose()
          return
        }
        startFallbackPolling(opened ? "websocket_closed" : "websocket_failed_to_open")
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
      clearConnectTimeout()
      clearFallbackTimer()
      clearFallbackReconnectTimer()
      clearHeartbeatTimer()
      stopWebSocket()
    }
  }, [connectTimeoutMs, enabled, fallbackIntervalMs])

  return {
    mode,
    isWebSocketPrimary: mode === "websocket",
    isPollingFallback: mode === "polling",
  }
}
