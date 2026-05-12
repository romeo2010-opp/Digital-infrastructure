import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Navbar from "../components/Navbar"
import { transactionsApi } from "../api/transactionsApi"
import { formatDateTime, shiftUtcISODate, utcTodayISO } from "../utils/dateTime"
import { useStationChangeWatcher } from "../hooks/useStationChangeWatcher"
import { useTopLoading } from "../layout/TopLoadingContext"
import "../features/settings/settings.css"
import "./transactions.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23eef1ee'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2343a646'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2343a646'/%3E%3C/svg%3E"

const PAGE_SIZE = 10
const PAYMENT_METHODS = ["ALL", "CASH", "MOBILE_MONEY", "CARD", "SMARTPAY", "OTHER"]

function toNumberSafe(value) {
  if (value === null || value === undefined || value === "") return 0
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatMoney(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "MWK -"
  const whole = Math.abs(numeric % 1) < 0.001
  return `MWK ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function formatVolume(value) {
  return `${toNumberSafe(value).toFixed(3)} L`
}

function normalizeLabel(value, fallback = "-") {
  const text = String(value || "").trim()
  return text || fallback
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
  const today = utcTodayISO()
  return {
    search: "",
    preset: "TODAY",
    from: today,
    to: today,
    paymentMethod: "ALL",
  }
}

function applyDatePreset(filters, preset) {
  const today = utcTodayISO()
  if (preset === "TODAY") return { ...filters, preset, from: today, to: today }
  if (preset === "YESTERDAY") {
    const yesterday = shiftUtcISODate(today, -1)
    return { ...filters, preset, from: yesterday, to: yesterday }
  }
  if (preset === "LAST_7_DAYS") {
    return { ...filters, preset, from: shiftUtcISODate(today, -6), to: today }
  }
  if (preset === "THIS_MONTH") {
    return { ...filters, preset, ...getMonthBounds(monthValueForOffset(0), { capToday: true }) }
  }
  return { ...filters, preset: "CUSTOM" }
}

function statusClassName(value) {
  const normalized = String(value || "").toLowerCase()
  if (normalized.includes("paid") || normalized.includes("recorded") || normalized.includes("settled")) {
    return "transactions-status transactions-status--success"
  }
  if (normalized.includes("pending") || normalized.includes("review") || normalized.includes("unchanged")) {
    return "transactions-status transactions-status--warning"
  }
  if (normalized.includes("cancel") || normalized.includes("fail") || normalized.includes("void")) {
    return "transactions-status transactions-status--danger"
  }
  return "transactions-status"
}

function ArrowIcon({ direction }) {
  const path = direction === "next" ? "m9 6 6 6-6 6" : "m15 18-6-6 6-6"
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function TransactionsTestPage() {
  const { setTopLoading } = useTopLoading()
  const [draftFilters, setDraftFilters] = useState(() => createInitialFilters())
  const [appliedFilters, setAppliedFilters] = useState(() => createInitialFilters())
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [downloadingId, setDownloadingId] = useState("")
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState("")
  const [selectedMonth, setSelectedMonth] = useState(() => monthValueForOffset(0))
  const messageTimerRef = useRef(0)
  const maxMonth = useMemo(() => monthValueForOffset(0), [])

  useEffect(() => {
    setTopLoading("transactions", loading || Boolean(downloadingId) || Boolean(exporting))
  }, [loading, downloadingId, exporting, setTopLoading])

  useEffect(() => () => window.clearTimeout(messageTimerRef.current), [])

  const refresh = useCallback(async ({ showLoader = true } = {}) => {
    try {
      if (showLoader) setLoading(true)
      setError("")
      const payload = await transactionsApi.list({
        ...appliedFilters,
        page,
        pageSize: PAGE_SIZE,
      })
      setResult(payload)
      if (payload.page !== page) setPage(payload.page)
    } catch (refreshError) {
      setError(refreshError?.message || "Failed to load transactions")
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [appliedFilters, page])

  useEffect(() => {
    refresh()
  }, [refresh])

  useStationChangeWatcher({
    onChange: async () => {
      setPage(1)
      await refresh({ showLoader: false })
    },
  })

  function showMessage(nextMessage) {
    setMessage(nextMessage)
    window.clearTimeout(messageTimerRef.current)
    messageTimerRef.current = window.setTimeout(() => setMessage(""), 2600)
  }

  function applyFilters(event) {
    event.preventDefault()
    setAppliedFilters(draftFilters)
    setPage(1)
  }

  function resetFilters() {
    const next = createInitialFilters()
    setDraftFilters(next)
    setAppliedFilters(next)
    setPage(1)
  }

  async function downloadReceipt(transactionPublicId) {
    try {
      setDownloadingId(transactionPublicId)
      setError("")
      const receipt = await transactionsApi.downloadReceipt(transactionPublicId)
      const url = window.URL.createObjectURL(receipt.blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = receipt.filename || `smartlink-${transactionPublicId}-receipt.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch (downloadError) {
      setError(downloadError?.message || "Unable to download receipt")
    } finally {
      setDownloadingId("")
    }
  }

  async function exportTransactions(label, filters) {
    try {
      setExporting(label)
      setError("")
      const filename = await transactionsApi.exportCsv(filters)
      setExportOpen(false)
      showMessage(`CSV download started: ${filename}`)
    } catch (exportError) {
      setError(exportError?.message || "Unable to export transactions")
    } finally {
      setExporting("")
    }
  }

  function exportCurrentPage() {
    return exportTransactions("current-page", {
      ...appliedFilters,
      page: result.page || page,
      pageSize: result.pageSize || PAGE_SIZE,
      scope: "page",
    })
  }

  function exportMonth(monthValue, label, capToday = false) {
    const bounds = getMonthBounds(monthValue, { capToday })
    return exportTransactions(label, {
      search: appliedFilters.search,
      paymentMethod: appliedFilters.paymentMethod,
      from: bounds.from,
      to: bounds.to,
      scope: "range",
    })
  }

  const rows = Array.isArray(result.items) ? result.items : []
  const canGoPrevious = !loading && (result.page || page) > 1
  const canGoNext = !loading && (result.page || page) < (result.totalPages || 1)
  const visibleRangeStart = result.total ? ((result.page || page) - 1) * (result.pageSize || PAGE_SIZE) + 1 : 0
  const visibleRangeEnd = result.total
    ? Math.min((result.page || page) * (result.pageSize || PAGE_SIZE), result.total)
    : 0

  return (
    <div className="settings-page transactions-page">
      <Navbar pagetitle="Transactions" image={avatar} count={0} />
      <section className="settings-shell transactions-shell">
        <article className="settings-hero transactions-hero">
          <div>
            <span className="transactions-eyebrow">Station ledger</span>
            <h2>Transactions</h2>
            <p>Search, filter, download receipts, and export authoritative backend CSV snapshots.</p>
          </div>
          <div className="transactions-hero-metrics">
            <article>
              <span>Total rows</span>
              <strong>{Number(result.total || 0).toLocaleString()}</strong>
            </article>
            <article>
              <span>Showing</span>
              <strong>{visibleRangeStart}-{visibleRangeEnd}</strong>
            </article>
            <article>
              <span>Payment</span>
              <strong>{appliedFilters.paymentMethod === "ALL" ? "All" : appliedFilters.paymentMethod}</strong>
            </article>
          </div>
        </article>

        <form className="transactions-toolbar transactions-card" onSubmit={applyFilters}>
          <label className="transactions-search-field">
            Search
            <input
              type="search"
              value={draftFilters.search}
              placeholder="Transaction, receipt, pump, fuel..."
              onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </label>
          <label>
            Date
            <select
              value={draftFilters.preset}
              onChange={(event) => setDraftFilters((current) => applyDatePreset(current, event.target.value))}
            >
              <option value="TODAY">Today</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="LAST_7_DAYS">Last 7 days</option>
              <option value="THIS_MONTH">This month</option>
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
            Payment
            <select
              value={draftFilters.paymentMethod}
              onChange={(event) => setDraftFilters((current) => ({ ...current, paymentMethod: event.target.value }))}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method === "ALL" ? "All methods" : method}
                </option>
              ))}
            </select>
          </label>
          <div className="transactions-toolbar-actions">
            <button type="submit" className="transactions-black-btn">Apply</button>
            <button type="button" className="transactions-muted-btn" onClick={resetFilters}>Reset</button>
            <button type="button" className="transactions-black-btn" onClick={() => setExportOpen(true)}>
              Export
            </button>
          </div>
        </form>

        {message ? <p className="settings-message">{message}</p> : null}
        {error ? <p className="settings-error">{error}</p> : null}

        <article className="transactions-card transactions-table-card">
          <header className="transactions-card-head">
            <div>
              <h3>Transaction history</h3>
              <p>{loading ? "Loading transactions..." : `${Number(result.total || 0).toLocaleString()} matching rows`}</p>
            </div>
          </header>

          <div className="transactions-table-wrap">
            <table className="transactions-table">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Fuel / pump</th>
                  <th>Litres</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Settlement</th>
                  <th className="transactions-cell-number">Paid</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="transactions-table-empty" colSpan={8}>Loading transaction history...</td>
                  </tr>
                ) : null}
                {!loading && !rows.length ? (
                  <tr>
                    <td className="transactions-table-empty" colSpan={8}>No transactions match the selected filters.</td>
                  </tr>
                ) : null}
                {!loading && rows.map((row) => (
                  <tr key={row.public_id}>
                    <td>
                      <strong>{row.public_id}</strong>
                      <div className="transactions-table-meta">{formatDateTime(row.occurred_at)}</div>
                      {row.receipt_verification_ref ? (
                        <div className="transactions-table-meta">Ref {row.receipt_verification_ref}</div>
                      ) : null}
                    </td>
                    <td>
                      <strong>{normalizeLabel(row.fuel_code)}</strong>
                      <div className="transactions-table-meta">
                        {row.pump_number ? `Pump ${row.pump_number}` : "Pump -"}
                        {row.nozzle_number ? ` / Nozzle ${row.nozzle_number}` : ""}
                      </div>
                    </td>
                    <td>{formatVolume(row.litres)}</td>
                    <td>{normalizeLabel(row.payment_method)}</td>
                    <td>
                      <span className={statusClassName(row.status)}>{normalizeLabel(row.status)}</span>
                    </td>
                    <td>
                      <span className={statusClassName(row.settlement_impact_status)}>
                        {normalizeLabel(row.settlement_impact_status)}
                      </span>
                    </td>
                    <td className="transactions-cell-number">{formatMoney(row.final_amount_paid || row.total_amount)}</td>
                    <td>
                      <button
                        type="button"
                        className="transactions-row-btn"
                        onClick={() => downloadReceipt(row.public_id)}
                        disabled={downloadingId === row.public_id}
                      >
                        {downloadingId === row.public_id ? "Preparing..." : "PDF"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="transactions-pagination">
            <span>
              Page {result.page || page} of {result.totalPages || 1}
            </span>
            <div className="transactions-pagination-buttons">
              <button
                type="button"
                className="transactions-page-arrow transactions-page-arrow--prev"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={!canGoPrevious}
                aria-label="Previous transactions page"
              >
                <ArrowIcon direction="prev" />
              </button>
              <button
                type="button"
                className="transactions-page-arrow transactions-page-arrow--next"
                onClick={() => setPage((current) => current + 1)}
                disabled={!canGoNext}
                aria-label="Next transactions page"
              >
                <ArrowIcon direction="next" />
              </button>
            </div>
          </footer>
        </article>
      </section>

      {exportOpen ? (
        <div className="transactions-export-backdrop" role="dialog" aria-modal="true" aria-label="Export transactions">
          <div className="transactions-export-modal">
            <header>
              <div>
                <span className="transactions-eyebrow">CSV export</span>
                <h3>Export transactions</h3>
              </div>
              <button type="button" className="transactions-export-close" onClick={() => setExportOpen(false)} aria-label="Close export dialog">
                Close
              </button>
            </header>
            <div className="transactions-export-options">
              <button type="button" onClick={exportCurrentPage} disabled={Boolean(exporting)}>
                <strong>Current table page</strong>
                <span>Exports the visible page with active filters.</span>
              </button>
              <button type="button" onClick={() => exportMonth(monthValueForOffset(0), "this-month", true)} disabled={Boolean(exporting)}>
                <strong>This month</strong>
                <span>Exports this month with current search and payment filters.</span>
              </button>
              <button type="button" onClick={() => exportMonth(monthValueForOffset(-1), "last-month")} disabled={Boolean(exporting)}>
                <strong>Last month</strong>
                <span>Exports last month with current search and payment filters.</span>
              </button>
            </div>
            <div className="transactions-export-month">
              <label>
                Selected month
                <input
                  type="month"
                  value={selectedMonth}
                  max={maxMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="transactions-black-btn"
                onClick={() => exportMonth(selectedMonth, "selected-month", selectedMonth === maxMonth)}
                disabled={Boolean(exporting)}
              >
                {exporting === "selected-month" ? "Exporting..." : "Export month"}
              </button>
            </div>
            {exporting ? <p className="transactions-empty-copy">Preparing CSV export...</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
