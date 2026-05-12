import { useEffect, useRef } from "react"
import { stationChangesApi } from "../api/stationChangesApi"
import { getAccessToken, getStationPublicId } from "../auth/authSession"
import { isBrowserOnline } from "../offline/network"

const RETRY_BACKOFF_MS = [2000, 5000, 10000, 15000]
const HEARTBEAT_INTERVAL_MS = 30000
const isApiMode = (import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase() === "api"

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function hasProtocol(value) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(String(value || ""))
}

function isLocalHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  )
}

function isPrivateIpv4(hostname) {
  const parts = String(hostname || "")
    .trim()
    .split(".")
    .map((part) => Number(part))

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [first, second] = parts
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  )
}

function isPublicUrl(url) {
  const protocol = String(url?.protocol || "").toLowerCase()
  if (!["http:", "https:", "ws:", "wss:"].includes(protocol)) return false
  return !isLocalHostname(url.hostname) && !isPrivateIpv4(url.hostname)
}

function resolveWsBaseUrl() {
  const wsBase = import.meta.env.VITE_WS_BASE_URL
  if (wsBase) return new URL(wsBase, window.location.origin)

  const apiBase = import.meta.env.VITE_API_BASE_URL
  if (apiBase && hasProtocol(apiBase)) {
    const apiUrl = new URL(apiBase, window.location.origin)
    if (isPublicUrl(apiUrl)) return apiUrl
  }

  return new URL(window.location.origin)
}

function wsProtocolForPage() {
  return window.location.protocol === "https:" ? "wss:" : "ws:"
}

export function useStationChangeWatcher({ enabled = true, timeoutMs = 25000, onChange }) {
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled || !isApiMode) return undefined

    const stationPublicId = getStationPublicId()
    if (!stationPublicId) return undefined

    let active = true
    let retryIndex = 0
    let sinceToken = null
    let fallbackController = new AbortController()
    let ws = null
    let reconnectTimerId = 0
    let heartbeatTimerId = 0
    let fallbackStarted = false

    function getWsUrl() {
      const token = getAccessToken()
      if (!token) return null

      const base = resolveWsBaseUrl()
      const wsProtocol = wsProtocolForPage()
      const wsUrl = new URL(`${wsProtocol}//${base.host}/ws/station-changes`)
      wsUrl.searchParams.set("accessToken", token)
      return wsUrl.toString()
    }

    function clearReconnectTimer() {
      if (reconnectTimerId) {
        window.clearTimeout(reconnectTimerId)
        reconnectTimerId = 0
      }
    }

    function clearHeartbeatTimer() {
      if (heartbeatTimerId) {
        window.clearInterval(heartbeatTimerId)
        heartbeatTimerId = 0
      }
    }

    function sendHeartbeat() {
      if (!ws || ws.readyState !== window.WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ type: "ping" }))
      } catch {
        // Close/reconnect handling will take over if the socket is no longer usable.
      }
    }

    function startHeartbeat() {
      clearHeartbeatTimer()
      sendHeartbeat()
      heartbeatTimerId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)
    }

    function stopWebSocket() {
      clearHeartbeatTimer()
      if (!ws) return
      const socket = ws
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      if (socket.readyState === window.WebSocket.CONNECTING) {
        socket.onopen = () => {
          try {
            socket.close()
          } catch {
            // noop
          }
        }
        ws = null
        return
      }
      try {
        socket.close()
      } catch {
        // noop
      }
      ws = null
    }

    function cleanup() {
      clearReconnectTimer()
      clearHeartbeatTimer()
      stopWebSocket()
      fallbackController.abort()
    }

    async function runLongPollFallback() {
      while (active) {
        try {
          if (!isBrowserOnline()) {
            await sleep(1500)
            continue
          }

          const result = await stationChangesApi.waitForChange({
            stationPublicId,
            since: sinceToken,
            timeoutMs,
            signal: fallbackController.signal,
          })

          if (!active) return
          if (result?.token !== undefined && result?.token !== null) {
            sinceToken = String(result.token)
          }
          if (result?.changed) {
            await onChangeRef.current?.(result)
          }
          retryIndex = 0
          fallbackController = new AbortController()
        } catch (error) {
          if (!active) return
          if (error?.name === "AbortError") return

          const waitMs = RETRY_BACKOFF_MS[Math.min(retryIndex, RETRY_BACKOFF_MS.length - 1)]
          retryIndex += 1
          await sleep(waitMs)
          fallbackController = new AbortController()
        }
      }
    }

    function startFallback() {
      if (fallbackStarted) return
      fallbackStarted = true
      runLongPollFallback()
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

    function connectWebSocket() {
      if (!active) return
      if (!isBrowserOnline()) {
        scheduleReconnect()
        return
      }

      const wsUrl = getWsUrl()
      if (!wsUrl || typeof window.WebSocket !== "function") {
        startFallback()
        return
      }

      stopWebSocket()
      try {
        ws = new window.WebSocket(wsUrl)
      } catch {
        startFallback()
        return
      }

      let opened = false

      ws.onopen = () => {
        opened = true
        retryIndex = 0
        startHeartbeat()
        // Pull a fresh snapshot on connect/reconnect to cover missed events while disconnected.
        Promise.resolve(onChangeRef.current?.({ type: "station_change_connected" })).catch(() => {})
      }

      ws.onmessage = async (event) => {
        if (!active) return
        try {
          const parsed = JSON.parse(event.data || "{}")
          if (parsed?.type === "station_change") {
            await onChangeRef.current?.(parsed)
          }
        } catch {
          // Ignore malformed messages.
        }
      }

      ws.onerror = () => {
        // WebSocket will also emit close; no-op here.
      }

      ws.onclose = () => {
        clearHeartbeatTimer()
        if (!active) return
        if (!opened) {
          startFallback()
          return
        }
        scheduleReconnect()
      }
    }

    connectWebSocket()

    return () => {
      active = false
      cleanup()
    }
  }, [enabled, timeoutMs])
}
