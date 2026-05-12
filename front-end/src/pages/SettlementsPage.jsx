import { useCallback, useEffect, useMemo, useState } from "react"
import Navbar from "../components/Navbar"
import { reportsData } from "../config/dataSource"
import { formatDateTime, shiftUtcISODate, utcTodayISO } from "../utils/dateTime"
import { useStationChangeWatcher } from "../hooks/useStationChangeWatcher"
import { useTopLoading } from "../layout/TopLoadingContext"
import "../features/settings/settings.css"
import "./transactions.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23eef1ee'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2343a646'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2343a646'/%3E%3C/svg%3E"

function formatMoney(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "MWK -"
  return `MWK ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: Math.abs(numeric % 1) < 0.001 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function monthValueForOffset(offset = 0) {
  const base = new Date(`${utcTodayISO()}T00:00:00.000Z`)
  base.setUTCDate(1)
  base.setUTCMonth(base.getUTCMonth() + offset)
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`
}

function getMonthBounds(monthValue, { capToday = false } = {}) {
  const [year, month] = String(monthValue || monthValueForOffset(0)).split("-").map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  const today = utcTodayISO()
  const to = end.toISOString().slice(0, 10)
  return {
    from: start.toISOString().slice(0, 10),
    to: capToday && to > today ? today : to,
  }
}

function createInitialFilters() {
  return {
    preset: "THIS_MONTH",
    ...getMonthBounds(monthValueForOffset(0), { capToday: true }),
    status: "ALL",
  }
}

function applyDatePreset(filters, preset) {
  const today = utcTodayISO()
  if (preset === "TODAY") return { ...filters, preset, from: today, to: today }
  if (preset === "LAST_7_DAYS") return { ...filters, preset, from: shiftUtcISODate(today, -6), to: today }
  if (preset === "THIS_MONTH") {
    return { ...filters, preset, ...getMonthBounds(monthValueForOffset(0), { capToday: true }) }
  }
  if (preset === "LAST_MONTH") return { ...filters, preset, ...getMonthBounds(monthValueForOffset(-1)) }
  return { ...filters, preset: "CUSTOM" }
}

function normalizeLabel(value, fallback = "-") {
  const text = String(value || "").trim()
  return text || fallback
}

function settlementStatusClass(value) {
  const normalized = String(value || "").toLowerCase()
  if (normalized.includes("paid") || normalized.includes("settled")) return "settlements-status settlements-status--success"
  if (normalized.includes("fail") || normalized.includes("cancel") || normalized.includes("rejected")) {
    return "settlements-status settlements-status--danger"
  }
  if (normalized.includes("pending") || normalized.includes("process")) return "settlements-status settlements-status--warning"
  return "settlements-status"
}

export default function SettlementsPage() {
  const { setTopLoading } = useTopLoading()
  const [draftFilters, setDraftFilters] = useState(() => createInitialFilters())
  const [appliedFilters, setAppliedFilters] = useState(() => createInitialFilters())
  const [settlements, setSettlements] = useState({ summary: {}, items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    setTopLoading("settlements", loading)
  }, [loading, setTopLoading])

  const refresh = useCallback(async ({ showLoader = true } = {}) => {
    try {
      if (showLoader) setLoading(true)
      setError("")
      const snapshot = await reportsData.getReportSnapshot({
        preset: "CUSTOM",
        fromDate: appliedFilters.from,
        toDate: appliedFilters.to,
        shift: "ALL",
        fuelType: "ALL",
        pumpId: "ALL",
      })
      setSettlements(snapshot?.settlements || { summary: {}, items: [] })
    } catch (refreshError) {
      setError(refreshError?.message || "Failed to load settlement status")
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [appliedFilters.from, appliedFilters.to])

  useEffect(() => {
    refresh()
  }, [refresh])

  useStationChangeWatcher({
    onChange: async () => {
      await refresh({ showLoader: false })
    },
  })

  const summary = settlements?.summary || {}
  const items = useMemo(() => {
    const rows = Array.isArray(settlements?.items) ? settlements.items : []
    if (appliedFilters.status === "ALL") return rows
    return rows.filter((row) => String(row.status || "").toUpperCase() === appliedFilters.status)
  }, [settlements?.items, appliedFilters.status])

  function applyFilters(event) {
    event.preventDefault()
    setAppliedFilters(draftFilters)
  }

  function resetFilters() {
    const next = createInitialFilters()
    setDraftFilters(next)
    setAppliedFilters(next)
  }

  return (
    <div className="settings-page settlements-page">
      <Navbar pagetitle="Settlements" image={avatar} count={0} />
      <section className="settings-shell settlements-shell">
        <article className="settings-hero settlements-hero">
          <div>
            <span className="transactions-eyebrow">Station settlement status</span>
            <h2>Settlements</h2>
            <p>Track paid, pending, and failed settlement batches for the selected operating window.</p>
          </div>
          <div className="settlements-summary">
            <article>
              <span>Batches</span>
              <strong>{Number(summary.settlementCount || 0).toLocaleString()}</strong>
            </article>
            <article>
              <span>Total value</span>
              <strong>{formatMoney(summary.settlementValue)}</strong>
            </article>
            <article>
              <span>Pending</span>
              <strong>{Number(summary.pendingCount || 0).toLocaleString()}</strong>
            </article>
            <article>
              <span>Paid</span>
              <strong>{Number(summary.paidCount || 0).toLocaleString()}</strong>
            </article>
          </div>
        </article>

        <form className="settlements-toolbar transactions-card" onSubmit={applyFilters}>
          <label>
            Date
            <select
              value={draftFilters.preset}
              onChange={(event) => setDraftFilters((current) => applyDatePreset(current, event.target.value))}
            >
              <option value="TODAY">Today</option>
              <option value="LAST_7_DAYS">Last 7 days</option>
              <option value="THIS_MONTH">This month</option>
              <option value="LAST_MONTH">Last month</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={draftFilters.from}
              max={utcTodayISO()}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, from: event.target.value, preset: "CUSTOM" }))
              }
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={draftFilters.to}
              max={utcTodayISO()}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, to: event.target.value, preset: "CUSTOM" }))
              }
            />
          </label>
          <label>
            Status
            <select
              value={draftFilters.status}
              onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="ALL">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="PAID">Paid</option>
              <option value="FAILED">Failed</option>
            </select>
          </label>
          <div className="settlements-toolbar-actions">
            <button type="submit">Apply</button>
            <button type="button" onClick={resetFilters}>Reset</button>
          </div>
        </form>

        {error ? <p className="settings-error">{error}</p> : null}

        <article className="transactions-card settlements-table-card">
          <header className="settlements-card-head">
            <div>
              <h3>Settlement batches</h3>
              <p>{loading ? "Loading settlements..." : `${items.length.toLocaleString()} visible batches`}</p>
            </div>
          </header>

          <div className="settlements-table-wrap">
            <table className="settlements-table">
              <thead>
                <tr>
                  <th>Batch / reference</th>
                  <th>Status</th>
                  <th className="settlements-cell-number">Net amount</th>
                  <th>Batch date</th>
                  <th>User</th>
                  <th>Reservation / queue</th>
                  <th>Forecourt transaction</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="settlements-table-empty" colSpan={8}>Loading settlement status...</td>
                  </tr>
                ) : null}
                {!loading && !items.length ? (
                  <tr>
                    <td className="settlements-table-empty" colSpan={8}>No settlements found for this selection.</td>
                  </tr>
                ) : null}
                {!loading && items.map((item) => (
                  <tr key={item.publicId}>
                    <td>
                      <strong>{normalizeLabel(item.publicId)}</strong>
                      <div className="settlements-table-meta">{normalizeLabel(item.sourceReference, "No source reference")}</div>
                    </td>
                    <td>
                      <span className={settlementStatusClass(item.status)}>{normalizeLabel(item.status)}</span>
                    </td>
                    <td className="settlements-cell-number">
                      <strong>{formatMoney(item.netAmount)}</strong>
                      <div className="settlements-table-meta">Gross {formatMoney(item.grossAmount)}</div>
                    </td>
                    <td>{normalizeLabel(item.batchDate)}</td>
                    <td>
                      <strong>{normalizeLabel(item.userName, "Unknown user")}</strong>
                      <div className="settlements-table-meta">
                        {normalizeLabel(item.userPublicId || item.userPhone, "No user metadata")}
                      </div>
                    </td>
                    <td>
                      <strong>{normalizeLabel(item.reservationPublicId || item.queueEntryPublicId || item.relatedEntityId)}</strong>
                      <div className="settlements-table-meta">
                        {normalizeLabel(item.fuelCode || item.relatedEntityType)}
                        {item.requestedLitres ? ` / ${Number(item.requestedLitres).toLocaleString()} L` : ""}
                      </div>
                    </td>
                    <td>
                      <strong>{normalizeLabel(item.forecourtTransactionPublicId, "Pending")}</strong>
                      <div className="settlements-table-meta">{normalizeLabel(item.forecourtPaymentMethod)}</div>
                    </td>
                    <td>{formatDateTime(item.createdAt || item.forecourtOccurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  )
}
