import { useEffect, useMemo, useState } from "react"
import Navbar from "../components/Navbar"
import { promotionsApi } from "../api/promotionsApi"
import { transactionsApi } from "../api/transactionsApi"
import { formatDateTime } from "../utils/dateTime"
import { useStationChangeWatcher } from "../hooks/useStationChangeWatcher"
import "../features/settings/settings.css"
import "./transactions.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

function toNumberSafe(value) {
  if (value === null || value === undefined || value === "") return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === "object") {
    if (Array.isArray(value.d) && value.d.length) {
      const parsed = Number(value.d[0])
      if (Number.isFinite(parsed)) return parsed
    }
    if (typeof value.toString === "function") {
      const parsed = Number(value.toString())
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
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

export default function TransactionsTestPage() {
  const [pumps, setPumps] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [receiptLoading, setReceiptLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [downloadingId, setDownloadingId] = useState("")
  const [viewingReceiptId, setViewingReceiptId] = useState("")
  const [form, setForm] = useState({
    pumpPublicId: "",
    nozzlePublicId: "",
    totalVolume: "40",
    paymentMethod: "CASH",
    userPublicId: "",
    cashbackDestination: "WALLET",
    paymentReference: "",
    note: "",
  })

  async function refresh() {
    try {
      setLoading(true)
      setError("")
      const [pumpRows, recentRows] = await Promise.all([
        transactionsApi.getPumps(),
        transactionsApi.listRecent(),
      ])
      setPumps(pumpRows || [])
      setRows(recentRows || [])
      if (!form.pumpPublicId && pumpRows?.length) {
        const firstPump = pumpRows[0]
        const firstNozzle = firstPump?.nozzles?.[0]
        setForm((prev) => ({
          ...prev,
          pumpPublicId: firstPump.public_id,
          nozzlePublicId: firstNozzle?.public_id || "",
        }))
      }
    } catch (refreshError) {
      setError(refreshError?.message || "Failed to load transaction data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useStationChangeWatcher({
    onChange: async () => {
      await refresh()
    },
  })

  const selectedPump = useMemo(
    () => pumps.find((pump) => pump.public_id === form.pumpPublicId),
    [form.pumpPublicId, pumps]
  )
  const selectedNozzles = selectedPump?.nozzles || []
  const selectedNozzle = useMemo(
    () => selectedNozzles.find((nozzle) => nozzle.public_id === form.nozzlePublicId) || null,
    [form.nozzlePublicId, selectedNozzles]
  )
  const selectedFuelCode = String(
    selectedNozzle?.fuel_code || selectedNozzle?.fuel_type_code || selectedPump?.fuel_code || ""
  )
    .trim()
    .toUpperCase()

  useEffect(() => {
    let cancelled = false

    async function loadPreview() {
      if (!selectedFuelCode || Number(form.totalVolume) <= 0) {
        setPreview(null)
        return
      }

      try {
        setPreviewLoading(true)
        const result = await promotionsApi.preview({
          fuelTypeCode: selectedFuelCode,
          litres: Number(form.totalVolume),
          paymentMethod: form.paymentMethod,
          cashbackDestination: form.cashbackDestination,
        })
        if (!cancelled) {
          setPreview(result)
        }
      } catch (previewError) {
        if (!cancelled) {
          setPreview(null)
          setError(previewError?.message || "Unable to load pricing preview")
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false)
        }
      }
    }

    loadPreview()
    return () => {
      cancelled = true
    }
  }, [form.cashbackDestination, form.paymentMethod, form.totalVolume, selectedFuelCode])

  async function viewReceipt(transactionPublicId) {
    try {
      setReceiptLoading(true)
      setViewingReceiptId(transactionPublicId)
      setError("")
      const payload = await transactionsApi.getReceipt(transactionPublicId)
      setReceipt(payload)
    } catch (receiptError) {
      setError(receiptError?.message || "Unable to load receipt preview")
    } finally {
      setReceiptLoading(false)
      setViewingReceiptId("")
    }
  }

  async function downloadReceipt(transactionPublicId) {
    try {
      setDownloadingId(transactionPublicId)
      setError("")
      const result = await transactionsApi.downloadReceipt(transactionPublicId)
      const url = window.URL.createObjectURL(result.blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = result.filename || `smartlink-${transactionPublicId}-receipt.pdf`
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

  async function submit(event) {
    event.preventDefault()
    try {
      setSubmitting(true)
      setError("")
      setReceipt(null)
      if (!selectedNozzle?.public_id || !selectedFuelCode) {
        throw new Error("Select a pump and nozzle before recording a transaction")
      }

      const finalPayable = Number(preview?.pricing?.finalPayable || 0)
      if (!(finalPayable > 0)) {
        throw new Error("Pricing preview is unavailable for this transaction")
      }

      const result = await transactionsApi.create({
        pumpPublicId: form.pumpPublicId,
        nozzlePublicId: form.nozzlePublicId || undefined,
        totalVolume: Number(form.totalVolume),
        amount: finalPayable,
        paymentMethod: form.paymentMethod,
        userPublicId: form.userPublicId || undefined,
        cashbackDestination: form.cashbackDestination,
        paymentReference: form.paymentReference || undefined,
        note: form.note || undefined,
        requestedLitres: Number(form.totalVolume),
      })

      if (result?.queued) {
        setRows((prev) => [result.optimisticRow, ...prev].slice(0, 50))
        setMessage("Transaction saved offline and queued for sync")
      } else {
        setMessage("Transaction recorded successfully")
        if (result?.data?.public_id) {
          await viewReceipt(result.data.public_id)
        }
        await refresh()
      }

      setForm((prev) => ({
        ...prev,
        totalVolume: "40",
        userPublicId: "",
        paymentReference: "",
        note: "",
      }))
      window.setTimeout(() => setMessage(""), 2200)
    } catch (submitError) {
      setError(submitError?.message || "Failed to create transaction")
    } finally {
      setSubmitting(false)
    }
  }

  const previewPricing = preview?.pricing || null

  return (
    <div className="settings-page transactions-page">
      <Navbar pagetitle="Transactions & Receipts" image={avatar} count={0} />
      <section className="settings-shell">
        <article className="settings-hero transactions-hero">
          <div>
            <h2>Record fuel sales with live promotional pricing</h2>
            <p>Checkout uses the pricing engine in real time, separates station and SmartLink funding, and opens the receipt immediately after settlement for download or dispute review.</p>
          </div>
          <div className="settings-hero-badges">
            <article>
              <span>Recent transactions</span>
              <strong>{rows.length}</strong>
            </article>
            <article>
              <span>Selected fuel</span>
              <strong>{selectedFuelCode || "-"}</strong>
            </article>
            <article>
              <span>Direct discount</span>
              <strong>{formatMoney(previewPricing?.totalDirectDiscount || 0)}</strong>
            </article>
            <article>
              <span>Cashback</span>
              <strong>{formatMoney(previewPricing?.cashback || 0)}</strong>
            </article>
          </div>
        </article>

        <div className="transactions-grid">
          <article className="settings-card transactions-card">
            <h3>Checkout</h3>
            {message ? <p className="settings-message">{message}</p> : null}
            {error ? <p className="settings-error">{error}</p> : null}
            <form className="settings-grid transactions-form" onSubmit={submit}>
              <label>
                Pump / dispenser
                <select
                  value={form.pumpPublicId}
                  onChange={(event) => {
                    const pumpPublicId = event.target.value
                    const pump = pumps.find((item) => item.public_id === pumpPublicId)
                    const firstNozzle = pump?.nozzles?.[0]
                    setForm((prev) => ({
                      ...prev,
                      pumpPublicId,
                      nozzlePublicId: firstNozzle?.public_id || "",
                    }))
                  }}
                  required
                >
                  <option value="" disabled>
                    Select pump
                  </option>
                  {pumps.map((pump) => (
                    <option key={pump.public_id} value={pump.public_id}>
                      Pump {pump.pump_number} ({(pump.fuel_codes || []).join("/") || "UNMAPPED"}) - {pump.status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Nozzle
                <select
                  value={form.nozzlePublicId}
                  onChange={(event) => setForm((prev) => ({ ...prev, nozzlePublicId: event.target.value }))}
                  required
                >
                  {!selectedNozzles.length ? <option value="">No nozzle configured</option> : null}
                  {selectedNozzles.map((nozzle) => (
                    <option key={nozzle.public_id} value={nozzle.public_id}>
                      #{nozzle.nozzle_number} {nozzle.side ? `(${nozzle.side})` : ""} - {nozzle.fuel_code || "UNKNOWN"} - {nozzle.status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Litres
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={form.totalVolume}
                  onChange={(event) => setForm((prev) => ({ ...prev, totalVolume: event.target.value }))}
                  required
                />
              </label>
              <label>
                Payment method
                <select
                  value={form.paymentMethod}
                  onChange={(event) => setForm((prev) => ({ ...prev, paymentMethod: event.target.value }))}
                >
                  <option value="CASH">CASH</option>
                  <option value="MOBILE_MONEY">MOBILE_MONEY</option>
                  <option value="CARD">CARD</option>
                  <option value="OTHER">OTHER</option>
                  <option value="SMARTPAY">SMARTPAY</option>
                </select>
              </label>
              <label>
                User public ID
                <input
                  value={form.userPublicId}
                  placeholder="Optional for cashback credit"
                  onChange={(event) => setForm((prev) => ({ ...prev, userPublicId: event.target.value }))}
                />
              </label>
              <label>
                Cashback destination
                <select
                  value={form.cashbackDestination}
                  onChange={(event) => setForm((prev) => ({ ...prev, cashbackDestination: event.target.value }))}
                >
                  <option value="WALLET">Wallet</option>
                  <option value="LOYALTY">Loyalty</option>
                  <option value="NONE">None</option>
                </select>
              </label>
              <label>
                Payment reference
                <input
                  value={form.paymentReference}
                  placeholder="MM / card / forecourt reference"
                  onChange={(event) => setForm((prev) => ({ ...prev, paymentReference: event.target.value }))}
                />
              </label>
              <label className="transactions-form-wide">
                Note
                <textarea
                  value={form.note}
                  placeholder="Optional operational note"
                  onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                />
              </label>
              <div className="transactions-form-actions transactions-form-wide">
                <button type="submit" disabled={submitting || previewLoading || !previewPricing}>
                  {submitting ? "Recording..." : "Record transaction"}
                </button>
              </div>
            </form>
          </article>

          <article className="settings-card transactions-card">
            <h3>Pricing breakdown</h3>
            {previewLoading ? <p className="transactions-empty-copy">Calculating live pricing…</p> : null}
            {!previewLoading && !previewPricing ? (
              <p className="transactions-empty-copy">Choose a pump, nozzle, and litres to preview the payable amount.</p>
            ) : null}
            {previewPricing ? (
              <>
                <div className="transactions-summary-grid">
                  <article>
                    <span>Official pump price</span>
                    <strong>{formatMoney(preview.basePricePerLitre)}</strong>
                  </article>
                  <article>
                    <span>Total payable</span>
                    <strong>{formatMoney(previewPricing.finalPayable)}</strong>
                  </article>
                  <article>
                    <span>Cashback earned</span>
                    <strong>{formatMoney(previewPricing.cashback)}</strong>
                  </article>
                  <article>
                    <span>Effective net price / litre</span>
                    <strong>{formatMoney(previewPricing.effectivePricePerLitre)}</strong>
                  </article>
                </div>
                <div className="transactions-breakdown-list">
                  <div>
                    <span>Litres</span>
                    <strong>{formatVolume(previewPricing.litres)}</strong>
                  </div>
                  <div>
                    <span>Base subtotal</span>
                    <strong>{formatMoney(previewPricing.subtotal)}</strong>
                  </div>
                  <div>
                    <span>Station discount</span>
                    <strong>{formatMoney(previewPricing.stationDiscount)}</strong>
                  </div>
                  <div>
                    <span>SmartLink discount</span>
                    <strong>{formatMoney(previewPricing.smartlinkDiscount)}</strong>
                  </div>
                  <div>
                    <span>Total direct discount</span>
                    <strong>{formatMoney(previewPricing.totalDirectDiscount)}</strong>
                  </div>
                  <div>
                    <span>Cashback</span>
                    <strong>{formatMoney(previewPricing.cashback)}</strong>
                  </div>
                </div>
                <div className="transactions-chip-row">
                  {(previewPricing.promoLabelsApplied || []).length ? (
                    previewPricing.promoLabelsApplied.map((label) => (
                      <span key={label} className="transactions-chip">
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="transactions-chip">No active promotion for this checkout</span>
                  )}
                </div>
              </>
            ) : null}
          </article>
        </div>

        <div className="transactions-grid">
          <article className="settings-card transactions-card">
            <h3>Receipt preview</h3>
            {receiptLoading ? <p className="transactions-empty-copy">Loading receipt…</p> : null}
            {!receiptLoading && !receipt ? (
              <p className="transactions-empty-copy">Record a sale or open a recent transaction receipt to preview the thermal receipt fields before downloading the PDF.</p>
            ) : null}
            {receipt ? (
              <div className="transactions-receipt">
                <div className="transactions-receipt-head">
                  <strong>{receipt.systemName || "SmartLink"}</strong>
                  <span>{receipt.stationName}</span>
                  <small>{receipt.stationLocation}</small>
                </div>
                <div className="transactions-receipt-section">
                  <div><span>Transaction</span><strong>{receipt.transactionId}</strong></div>
                  <div><span>Date</span><strong>{formatDateTime(receipt.occurredAt)}</strong></div>
                  <div><span>Pump</span><strong>{receipt.pumpNumber ? `Pump ${receipt.pumpNumber}` : "-"}</strong></div>
                  <div><span>Nozzle</span><strong>{normalizeLabel(receipt.nozzleLabel)}</strong></div>
                  <div><span>Fuel</span><strong>{normalizeLabel(receipt.fuelType)}</strong></div>
                  <div><span>Litres</span><strong>{formatVolume(receipt.litres)}</strong></div>
                </div>
                <div className="transactions-receipt-section">
                  <div><span>Base subtotal</span><strong>{formatMoney(receipt.baseSubtotal)}</strong></div>
                  <div><span>Direct discount</span><strong>{formatMoney(receipt.totalDirectDiscount)}</strong></div>
                  <div><span>Cashback</span><strong>{formatMoney(receipt.cashbackTotal)}</strong></div>
                  <div><span>Final paid</span><strong>{formatMoney(receipt.finalAmountPaid)}</strong></div>
                </div>
                {(receipt.discountLines || []).length ? (
                  <div className="transactions-receipt-lines">
                    {(receipt.discountLines || []).map((line, index) => (
                      <div key={`${line.label}-${index}`}>
                        <span>{normalizeLabel(line.label)}</span>
                        <strong>- {formatMoney(line.amount)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
                {(receipt.cashbackLines || []).length ? (
                  <div className="transactions-receipt-lines">
                    {(receipt.cashbackLines || []).map((line, index) => (
                      <div key={`${line.label}-${index}`}>
                        <span>{normalizeLabel(line.label)}</span>
                        <strong>{formatMoney(line.amount)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="transactions-chip-row">
                  {(receipt.promoLabelsApplied || []).length ? (
                    receipt.promoLabelsApplied.map((label) => (
                      <span key={label} className="transactions-chip">
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="transactions-chip">Standard pump pricing</span>
                  )}
                </div>
                <div className="transactions-receipt-meta">
                  <span>Verification ref: {normalizeLabel(receipt.verificationReference)}</span>
                  <span>Payment: {normalizeLabel(receipt.paymentMethod)}</span>
                </div>
              </div>
            ) : null}
          </article>

          <article className="settings-card transactions-card">
            <h3>Recent transactions</h3>
            {loading ? <p className="transactions-empty-copy">Loading recent transaction history…</p> : null}
            {!loading && !rows.length ? <p className="transactions-empty-copy">No transactions recorded yet.</p> : null}
            {!loading && rows.length ? (
              <div className="transactions-table-wrap">
                <table className="transactions-table">
                  <thead>
                    <tr>
                      <th>Tx ID</th>
                      <th>Fuel</th>
                      <th>Litres</th>
                      <th>Subtotal</th>
                      <th>Discount</th>
                      <th>Cashback</th>
                      <th>Paid</th>
                      <th>Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.public_id}>
                        <td>
                          <strong>{row.public_id}</strong>
                          <div className="transactions-table-meta">{formatDateTime(row.occurred_at)}</div>
                        </td>
                        <td>
                          <strong>{normalizeLabel(row.fuel_code)}</strong>
                          <div className="transactions-table-meta">{row.pump_number ? `Pump ${row.pump_number}` : "-"}</div>
                        </td>
                        <td>{formatVolume(row.litres)}</td>
                        <td>{formatMoney(row.subtotal || row.total_amount)}</td>
                        <td>{formatMoney(row.total_direct_discount || 0)}</td>
                        <td>{formatMoney(row.cashback_total || 0)}</td>
                        <td>{formatMoney(row.final_amount_paid || row.total_amount)}</td>
                        <td>
                          <div className="transactions-row-actions">
                            <button type="button" onClick={() => viewReceipt(row.public_id)} disabled={viewingReceiptId === row.public_id}>
                              {viewingReceiptId === row.public_id ? "Opening..." : "Preview"}
                            </button>
                            <button type="button" onClick={() => downloadReceipt(row.public_id)} disabled={downloadingId === row.public_id}>
                              {downloadingId === row.public_id ? "Preparing..." : "PDF"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </div>
  )
}
