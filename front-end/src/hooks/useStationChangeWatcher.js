import { useEffect, useRef } from "react"
import { stationChangesApi } from "../api/stationChangesApi"
import { getAccessToken, getStationPublicId } from "../auth/authSession"
import { isBrowserOnline } from "../offline/network"

const RETRY_BACKOFF_MS = [2000, 5000, 10000, 15000]
const isApiMode = (import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase() === "api"

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function hasProtocol(value) {
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
    let fallbackStarted = false

    function getWsUrl() {
      const token = getAccessToken()
      if (!token) return null

      const base = resolveWsBaseUrl()
      const wsProtocol = base.protocol === "https:" ? "wss:" : "ws:"
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

    function stopWebSocket() {
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
