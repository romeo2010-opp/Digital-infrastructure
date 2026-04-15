import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import Navbar from "../../components/Navbar"
import { monitoringApi } from "../../api/monitoringApi"
import { formatDateTime } from "../../utils/dateTime"
import "./liveMonitoring.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

const RETRY_BACKOFF_MS = [1500, 3000, 5000, 8000, 12000]

function toConnectionClass(connection) {
  if (connection === "Live") return "lm-connection-live"
  if (connection === "Reconnecting...") return "lm-connection-reconnecting"
  return "lm-connection-offline"
}

function mapSnapshotPayload(payload) {
  return {
    pumpId: payload?.pumpId || "",
    pumpLabel: payload?.pumpLabel || "Pump",
    pumpNumber: Number(payload?.pumpNumber || 0),
    status: payload?.status || "IDLE",
    lastUpdateAt: payload?.lastUpdateAt || null,
    nozzles: Array.isArray(payload?.nozzles)
      ? payload.nozzles.map((nozzle) => ({
          nozzleId: nozzle.nozzleId,
          nozzleLabel: nozzle.nozzleLabel || "-",
          product: nozzle.product || null,
          status: nozzle.status || "IDLE",
          litres: nozzle.litres ?? null,
          updatedAt: nozzle.updatedAt || null,
        }))
      : [],
  }
}

function applyMonitoringUpdate(snapshot, update) {
  const previous = snapshot || {
    pumpId: update?.pumpId || "",
    pumpLabel: "Pump",
    pumpNumber: 0,
    status: update?.pumpStatus || "IDLE",
    lastUpdateAt: update?.updatedAt || null,
    nozzles: [],
  }

  const nextNozzle = {
    nozzleId: update.nozzleId,
    nozzleLabel: update.nozzleLabel || "-",
    product: update.product || null,
    status: update.status || "IDLE",
    litres: update.litres ?? null,
    updatedAt: update.updatedAt || null,
  }

  const nextNozzles = [...previous.nozzles]
  const index = nextNozzles.findIndex((item) => item.nozzleId === nextNozzle.nozzleId)
  if (index >= 0) {
    nextNozzles[index] = {
      ...nextNozzles[index],
      ...nextNozzle,
    }
  } else {
    nextNozzles.push(nextNozzle)
  }

  nextNozzles.sort((a, b) =>
    String(a.nozzleLabel || "").localeCompare(String(b.nozzleLabel || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  )

  return {
    ...previous,
    pumpId: update.pumpId || previous.pumpId,
    status: update.pumpStatus || previous.status,
    lastUpdateAt: update.lastUpdateAt || update.updatedAt || previous.lastUpdateAt,
    nozzles: nextNozzles,
  }
}

export default function LivePumpMonitoringPage() {
  const { pumpId: routePumpId } = useParams()
  const pumpId = useMemo(() => decodeURIComponent(String(routePumpId || "")).trim(), [routePumpId])

  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [connection, setConnection] = useState("Offline")

  const retryIndexRef = useRef(0)
  const reconnectTimerRef = useRef(0)
  const cleanupSocketRef = useRef(() => {})

  const loadSnapshot = useCallback(
    async ({ showLoader = false } = {}) => {
      if (!pumpId) return
      try {
        if (showLoader) setLoading(true)
        const next = await monitoringApi.getPumpSnapshot(pumpId)
        setSnapshot(mapSnapshotPayload(next))
        setError("")
      } catch (loadError) {
        setError(loadError?.message || "Failed to load pump monitoring snapshot")
      } finally {
        if (showLoader) setLoading(false)
      }
    },
    [pumpId]
  )

  useEffect(() => {
    setLoading(true)
    setSnapshot(null)
    setError("")
    setConnection("Offline")
    loadSnapshot({ showLoader: true })
  }, [loadSnapshot])

  useEffect(() => {
    if (!pumpId) return undefined

    let active = true

    function clearReconnectTimer() {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = 0
      }
    }

    function stopSocket() {
      cleanupSocketRef.current?.()
      cleanupSocketRef.current = () => {}
    }

    function scheduleReconnect() {
      clearReconnectTimer()
      if (!active) return

      const waitMs = RETRY_BACKOFF_MS[Math.min(retryIndexRef.current, RETRY_BACKOFF_MS.length - 1)]
      retryIndexRef.current += 1
      setConnection(window.navigator.onLine ? "Reconnecting..." : "Offline")

      reconnectTimerRef.current = window.setTimeout(() => {
        connect()
      }, waitMs)
    }

    function connect() {
      if (!active) return
      stopSocket()
      setConnection(window.navigator.onLine ? "Reconnecting..." : "Offline")

      try {
        cleanupSocketRef.current = monitoringApi.connectPumpSocket({
          pumpId,
          onOpen: () => {
            if (!active) return
            setConnection("Reconnecting...")
          },
          onMessage: (message) => {
            if (!active) return
            if (!message?.type) return

            if (message.type === "monitoring:subscribed") {
              retryIndexRef.current = 0
              setConnection("Live")
              loadSnapshot({ showLoader: false })
              return
            }

            if (message.type === "monitoring:snapshot") {
              setSnapshot(mapSnapshotPayload(message))
              setError("")
              return
            }

            if (message.type === "monitoring:update") {
              setSnapshot((current) => applyMonitoringUpdate(current, message))
              return
            }

            if (message.type === "monitoring:error") {
              setError(message.error || "Monitoring subscription error")
            }
          },
          onClose: () => {
            if (!active) return
            scheduleReconnect()
          },
          onError: () => {
            if (!active) return
            setConnection(window.navigator.onLine ? "Reconnecting..." : "Offline")
          },
        })
      } catch (connectError) {
        setError(connectError?.message || "Failed to connect to live monitoring stream")
        scheduleReconnect()
      }
    }

    connect()

    const onOnline = () => {
      if (!active) return
      connect()
    }
    const onOffline = () => {
      if (!active) return
      setConnection("Offline")
    }

    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)

    return () => {
      active = false
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      clearReconnectTimer()
      stopSocket()
    }
  }, [loadSnapshot, pumpId])

  if (!pumpId) {
    return (
      <div className="lm-page">
        <Navbar pagetitle="Live Monitoring" image={avatar} count={0} />
        <section className="lm-shell">
          <p className="lm-empty">Pump id is required.</p>
        </section>
      </div>
    )
  }

  return (
    <div className="lm-page">
      <Navbar pagetitle="Live Monitoring" image={avatar} count={0} />

      <section className="lm-shell">
        <header className="lm-header">
          <div>
            <h2>{snapshot?.pumpLabel || `Pump ${pumpId}`}</h2>
            <p>
              Pump Status: <strong>{snapshot?.status || "-"}</strong>
            </p>
            <p>Last Updated: {formatDateTime(snapshot?.lastUpdateAt)}</p>
          </div>

          <div className="lm-header-actions">
            <span className={`lm-connection-pill ${toConnectionClass(connection)}`}>{connection}</span>
            <Link className="lm-back-link" to="/digitalQueue">
              Back to Queue
            </Link>
          </div>
        </header>

        {loading ? <p className="lm-empty">Loading live monitoring...</p> : null}
        {error ? <p className="lm-error">{error}</p> : null}

        <div className="lm-table-wrap">
          <table className="lm-table">
            <thead>
              <tr>
                <th>Nozzle</th>
                <th>Product</th>
                <th>Status</th>
                <th>Live Litres</th>
                <th>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot?.nozzles || []).map((nozzle) => (
                <tr key={nozzle.nozzleId}>
                  <td>{nozzle.nozzleLabel}</td>
                  <td>{nozzle.product || "-"}</td>
                  <td>{nozzle.status}</td>
                  <td>
                    {nozzle.status === "DISPENSING" && nozzle.litres !== null && nozzle.litres !== undefined
                      ? Number(nozzle.litres).toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 3,
                        })
                      : "-"}
                  </td>
                  <td>{formatDateTime(nozzle.updatedAt)}</td>
                </tr>
              ))}
              {!loading && (snapshot?.nozzles || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="lm-empty-row">
                    No nozzles available for this pump.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
