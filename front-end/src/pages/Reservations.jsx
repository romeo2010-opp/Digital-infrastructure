import { useCallback, useEffect, useMemo, useState } from "react"
import Navbar from "../components/Navbar"
import { reservationsApi } from "../api/reservationsApi"
import { useStationChangeWatcher } from "../hooks/useStationChangeWatcher"
import { getAppTimeZone, zonedLocalDateTimeStringToUtcIso } from "../utils/dateTime"
import "../assets/reservations.css"

const avatar =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='40' fill='%23dbe8ff'/%3E%3Ccircle cx='40' cy='30' r='14' fill='%2357779f'/%3E%3Cpath d='M14 73c4-14 16-22 26-22s22 8 26 22' fill='%2357779f'/%3E%3C/svg%3E"

const seedReservations = [
  { id: "RSV-SLT-20260308082000-K4M9P2", customer: "John Carter", phone: "+265 999 870 121", plate: "BT7077", product: "Unleaded", volume: 45, slot: "08:20 AM", status: "Pending", notified: false, notes: "Priority customer" },
  { id: "RSV-SLT-20260308090000-B7R3N1", customer: "Emma Joshua", phone: "+265 999 220 311", plate: "MC892C", product: "Diesel", volume: 72, slot: "09:00 AM", status: "Confirmed", notified: true, notes: "Fleet account" },
  { id: "RSV-PRE-20260308101000-X2W8Q5", customer: "Patrick Wilson", phone: "+265 999 111 902", plate: "ZR4421", product: "Premium", volume: 32, slot: "10:10 AM", status: "Pending", notified: false, notes: "" },
]

function formatId(typeCode = "SLT") {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14)
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let suffix = ""
  for (let index = 0; index < 6; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  if (!/[A-Z]/.test(suffix)) suffix = `A${suffix.slice(1)}`
  return `RSV-${typeCode}-${timestamp}-${suffix}`
}

function normalizeStatusCode(value) {
  const text = String(value || "").trim().toUpperCase()
  if (!text) return "PENDING"
  if (text === "COMPLETED") return "FULFILLED"
  return text
}

function statusBadgeClass(statusCode) {
  if (statusCode === "FULFILLED") return "status-fulfilled"
  if (statusCode === "CONFIRMED") return "status-confirmed"
  if (statusCode === "CANCELLED") return "status-cancelled"
  if (statusCode === "EXPIRED") return "status-expired"
  return "status-pending"
}

function toPositiveNumberOrNull(value) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) return null
  return normalized
}

function normalizeCompletionPaymentMethod(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_")
  if (!normalized) return ""
  if (["CASH", "MOBILE_MONEY", "CARD", "OTHER"].includes(normalized)) {
    return normalized
  }
  return ""
}

function collectCompletionPayload(reservation) {
  const defaultLitres = toPositiveNumberOrNull(reservation?.volume)
  const litresInput = window.prompt(
    "Enter the final served litres before completing this reservation.",
    defaultLitres !== null ? String(defaultLitres) : "",
  )
  if (litresInput === null) return null

  const litres = toPositiveNumberOrNull(litresInput)
  if (litres === null) {
    throw new Error("Enter a valid served litres value before completing the reservation.")
  }

  const amountInput = window.prompt(
    "Enter the final amount in MWK. Leave this blank if SmartPay or wallet settlement should determine it automatically.",
    "",
  )
  if (amountInput === null) return null

  const normalizedAmountInput = String(amountInput || "").trim()
  const amount = normalizedAmountInput ? toPositiveNumberOrNull(normalizedAmountInput) : null
  if (normalizedAmountInput && amount === null) {
    throw new Error("Enter a valid amount in MWK, or leave it blank.")
  }

  const paymentInput = window.prompt(
    "Enter payment method: CASH, MOBILE_MONEY, CARD, or OTHER. Leave blank to use automatic settlement.",
    amount !== null ? "CASH" : "",
  )
  if (paymentInput === null) return null

  const paymentMethod = normalizeCompletionPaymentMethod(paymentInput)
  if (String(paymentInput || "").trim() && !paymentMethod) {
    throw new Error("Payment method must be CASH, MOBILE_MONEY, CARD, or OTHER.")
  }

  return {
    litres,
    amount: amount ?? undefined,
    paymentMethod: paymentMethod || undefined,
  }
}

export default function Reservations() {
  const isApiMode = (import.meta.env.VITE_DATA_SOURCE || "api").toLowerCase() === "api"
  const [reservations, setReservations] = useState(seedReservations)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [selectedId, setSelectedId] = useState(seedReservations[0]?.id ?? "")
  const [flashMessage, setFlashMessage] = useState("")
  const [flashError, setFlashError] = useState("")
  const [loading, setLoading] = useState(isApiMode)
  const [loadError, setLoadError] = useState("")
  const [actionState, setActionState] = useState({ type: "", id: "" })
  const [lookupState, setLookupState] = useState({ loading: false, matchedUser: null, error: "" })
  const [stats, setStats] = useState({
    total: seedReservations.length,
    pending: seedReservations.filter((item) => item.status === "Pending").length,
    notified: seedReservations.filter((item) => item.notified).length,
  })
  const [form, setForm] = useState({
    userPublicId: "",
    customer: "",
    phone: "",
    plate: "",
    product: "Unleaded",
    volume: "",
    slot: "",
    status: "Pending",
    notes: "",
  })

  function toReservationSlotIso(value) {
    const text = String(value || "").trim()
    if (!text) return undefined
    return zonedLocalDateTimeStringToUtcIso(text, getAppTimeZone()) || undefined
  }

  const filteredReservations = useMemo(() => {
    const query = search.trim().toLowerCase()
    return reservations.filter((item) => {
      const matchStatus = statusFilter === "All" || item.status === statusFilter
      const matchText =
        !query ||
        item.customer.toLowerCase().includes(query) ||
        item.plate.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query)
      return matchStatus && matchText
    })
  }, [reservations, search, statusFilter])

  const selectedReservation = filteredReservations.find((item) => item.id === selectedId) ?? filteredReservations[0] ?? null
  const displayStats = useMemo(() => {
    if (isApiMode) return stats
    return {
      total: reservations.length,
      pending: reservations.filter((item) => item.status === "Pending").length,
      notified: reservations.filter((item) => item.notified).length,
    }
  }, [isApiMode, reservations, stats])

  const loadReservations = useCallback(async ({ showLoader = true } = {}) => {
    if (!isApiMode) {
      const fallbackStats = {
        total: seedReservations.length,
        pending: seedReservations.filter((item) => item.status === "Pending").length,
        notified: seedReservations.filter((item) => item.notified).length,
      }
      setReservations(seedReservations)
      setStats(fallbackStats)
      setSelectedId((prev) => prev || seedReservations[0]?.id || "")
      setLoading(false)
      setLoadError("")
      return
    }

    try {
      if (showLoader) setLoading(true)
      setLoadError("")
      const payload = await reservationsApi.getList()
      const nextRows = payload?.items || []
      setReservations(nextRows)
      setStats(payload?.stats || { total: 0, pending: 0, notified: 0 })
      setSelectedId((prev) => {
        if (nextRows.some((item) => item.id === prev)) return prev
        return nextRows[0]?.id || ""
      })
    } catch (error) {
      setLoadError(error?.message || "Unable to load reservations.")
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [isApiMode])

  useEffect(() => {
    loadReservations()
  }, [loadReservations])

  useStationChangeWatcher({
    onChange: async () => {
      if (!isApiMode) return
      await loadReservations({ showLoader: false })
    },
  })

  function showFlash(message) {
    setFlashError("")
    setFlashMessage(message)
    window.clearTimeout(showFlash.timeoutId)
    showFlash.timeoutId = window.setTimeout(() => setFlashMessage(""), 1800)
  }
  showFlash.timeoutId = showFlash.timeoutId ?? 0

  function showError(message) {
    setFlashMessage("")
    setFlashError(message)
    window.clearTimeout(showError.timeoutId)
    showError.timeoutId = window.setTimeout(() => setFlashError(""), 2600)
  }
  showError.timeoutId = showError.timeoutId ?? 0

  function handleFormChange(event) {
    const { name, value } = event.target
    if (name === "userPublicId") {
      setLookupState({ loading: false, matchedUser: null, error: "" })
    }
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleLookupUser() {
    const scopedUserPublicId = String(form.userPublicId || "").trim().toUpperCase()
    if (!scopedUserPublicId) {
      setLookupState({ loading: false, matchedUser: null, error: "Enter a user ID first." })
      return
    }

    if (!isApiMode) {
      const fallbackUser = {
        publicId: scopedUserPublicId,
        fullName: "Matched SmartLink User",
        phone: "+265 999 000 000",
      }
      setForm((prev) => ({
        ...prev,
        userPublicId: scopedUserPublicId,
        customer: fallbackUser.fullName,
        phone: fallbackUser.phone || prev.phone,
      }))
      setLookupState({ loading: false, matchedUser: fallbackUser, error: "" })
      return
    }

    try {
      setLookupState({ loading: true, matchedUser: null, error: "" })
      const user = await reservationsApi.lookupUser(scopedUserPublicId)
      setForm((prev) => ({
        ...prev,
        userPublicId: scopedUserPublicId,
        customer: user?.fullName || prev.customer,
        phone: user?.phone || prev.phone,
      }))
      setLookupState({ loading: false, matchedUser: user, error: "" })
    } catch (error) {
      setLookupState({
        loading: false,
        matchedUser: null,
        error: error?.message || "Unable to find that user.",
      })
    }
  }

  function handleAddReservation(event) {
    event.preventDefault()
    if (!form.userPublicId || !form.customer || !form.phone || !form.plate || !form.slot || !form.volume) {
      showFlash("Fill all required fields before saving.")
      return
    }
    if (isApiMode && !lookupState.matchedUser) {
      showFlash("Confirm the user ID before saving the reservation.")
      return
    }
    ;(async () => {
      if (isApiMode) {
        const slotStart = toReservationSlotIso(form.slot)
        if (!slotStart) {
          throw new Error("Select a valid reservation date and time.")
        }
        await reservationsApi.create({
          userPublicId: String(form.userPublicId || "").trim().toUpperCase(),
          customerName: form.customer,
          phone: form.phone,
          identifier: form.plate.toUpperCase(),
          fuelType: form.product === "Diesel" ? "DIESEL" : "PETROL",
          requestedLitres: Number(form.volume),
          slotStart,
          status: form.status,
          notes: form.notes,
        })
        await loadReservations({ showLoader: false })
        showFlash("Reservation added.")
      } else {
        const newReservation = {
          id: formatId(form.product === "Premium" ? "PRE" : "SLT"),
          customer: form.customer,
          phone: form.phone,
          plate: form.plate.toUpperCase(),
          product: form.product,
          volume: Number(form.volume),
          slot: form.slot,
          status: form.status,
          notified: false,
          notes: form.notes,
        }
        setReservations((prev) => [newReservation, ...prev])
        setSelectedId(newReservation.id)
        showFlash(`Reservation ${newReservation.id} added.`)
      }

      setForm({
        userPublicId: "",
        customer: "",
        phone: "",
        plate: "",
        product: "Unleaded",
        volume: "",
        slot: "",
        status: "Pending",
        notes: "",
      })
      setLookupState({ loading: false, matchedUser: null, error: "" })
    })().catch((error) => {
      showError(error?.message || "Failed to add reservation.")
    })
  }

  function handleNotify(id) {
    if (!id || actionState.id) return
    ;(async () => {
      setActionState({ type: "notify", id })
      if (isApiMode) {
        setReservations((prev) =>
          prev.map((item) => {
            const itemId = item.publicId || item.id
            if (itemId !== id) return item
            return {
              ...item,
              notified: true,
              statusCode: item.statusCode === "PENDING" ? "CONFIRMED" : item.statusCode,
              status: item.statusCode === "PENDING" ? "Confirmed" : item.status,
            }
          })
        )
        await reservationsApi.notify(id)
        await loadReservations({ showLoader: false })
      } else {
        setReservations((prev) =>
          prev.map((item) => {
            if (item.id !== id) return item
            return { ...item, notified: true, status: "Confirmed", statusCode: "CONFIRMED" }
          }),
        )
      }
      showFlash(`Customer for ${id} has been notified.`)
    })().catch((error) => {
      showError(error?.message || "Failed to notify reservation.")
    }).finally(() => {
      setActionState({ type: "", id: "" })
    })
  }

  function handleDelete(id) {
    if (!id || actionState.id) return
    const confirmed = window.confirm("Delete this reservation? This action marks it as cancelled.")
    if (!confirmed) return
    ;(async () => {
      setActionState({ type: "delete", id })
      if (isApiMode) {
        await reservationsApi.cancel(id)
        setReservations((prev) =>
          prev.map((item) => {
            const itemId = item.publicId || item.id
            if (itemId !== id) return item
            return {
              ...item,
              statusCode: "CANCELLED",
              status: "Cancelled",
              notified: false,
            }
          })
        )
        await loadReservations({ showLoader: false })
      } else {
        setReservations((prev) => prev.filter((item) => item.id !== id))
        if (selectedId === id) {
          setSelectedId("")
        }
      }
      showFlash(`Reservation ${id} deleted.`)
    })().catch((error) => {
      showError(error?.message || "Failed to delete reservation.")
    }).finally(() => {
      setActionState({ type: "", id: "" })
    })
  }

  function handleComplete(id) {
    if (!id || actionState.id) return
    const reservation =
      reservations.find((item) => (item.publicId || item.id) === id || item.id === id)
      || selectedReservation
      || null

    let completionPayload = {}
    if (isApiMode) {
      try {
        const collectedPayload = collectCompletionPayload(reservation)
        if (!collectedPayload) return
        completionPayload = collectedPayload
      } catch (error) {
        showError(error?.message || "Failed to collect completion details.")
        return
      }
    }

    ;(async () => {
      setActionState({ type: "complete", id })
      if (isApiMode) {
        await reservationsApi.complete(id, completionPayload)
        setReservations((prev) =>
          prev.map((item) => {
            const itemId = item.publicId || item.id
            if (itemId !== id) return item
            return {
              ...item,
              statusCode: "FULFILLED",
              status: "Completed",
              notified: true,
            }
          })
        )
        await loadReservations({ showLoader: false })
      } else {
        setReservations((prev) =>
          prev.map((item) => {
            if (item.id !== id) return item
            return { ...item, status: "Completed", statusCode: "FULFILLED", notified: true }
          }),
        )
      }
      showFlash(`Reservation ${id} completed.`)
    })().catch((error) => {
      showError(error?.message || "Failed to complete reservation.")
    }).finally(() => {
      setActionState({ type: "", id: "" })
    })
  }

  return (
    <div className="reservations-page">
      <Navbar pagetitle="Reservations" image={avatar} count={displayStats.pending} />

      <section className="reservations-shell">
        <header className="reservations-hero">
          <div className="reservations-hero-copy">
            <h2>Reservations</h2>
            <p>Track pending customers, notify arrivals, and cancel invalid bookings.</p>
          </div>
          <div className="reservations-hero-badges">
            <article>
              <span>Total Reservations</span>
              <strong>{displayStats.total}</strong>
            </article>
            <article>
              <span>Pending</span>
              <strong>{displayStats.pending}</strong>
            </article>
            <article>
              <span>Customers Notified</span>
              <strong>{displayStats.notified}</strong>
            </article>
          </div>
        </header>

        <section className="reservation-toolbar panel-lite">
          <div className="toolbar-right">
            <label>
              Search
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find by customer, plate, or ID"
              />
            </label>
            <label>
              Status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option>All</option>
                <option>Pending</option>
                <option>Confirmed</option>
              </select>
            </label>
          </div>
        </section>

        {flashMessage ? <p className="flash-message">{flashMessage}</p> : null}
        {flashError ? <p className="flash-message flash-message-error">{flashError}</p> : null}
        {loadError ? <p className="flash-message">{loadError}</p> : null}
        {loading ? <p className="empty-note">Loading reservations...</p> : null}

        <div className="reservation-grid">
          <section className="panel-lite reservation-list">
            <header>
              <h3>Reservation Queue</h3>
            </header>

            {filteredReservations.length ? (
              <ul>
                {filteredReservations.map((item) => (
                  <li key={item.id} className={selectedReservation?.id === item.id ? "active" : ""}>
                    <button type="button" className="view-btn" onClick={() => setSelectedId(item.id)}>
                      <div>
                        <strong>{item.customer}</strong>
                        <small>{item.id} · {item.plate}</small>
                      </div>
                      <div className="row-status-wrap">
                        <span className={`reservation-status-badge ${statusBadgeClass(normalizeStatusCode(item.statusCode || item.status))}`}>
                          {item.status}
                        </span>
                        <span>{item.slot}</span>
                      </div>
                    </button>

                    <div className="row-actions">
                      <button type="button" onClick={() => setSelectedId(item.id)}>View</button>
                      <button
                        type="button"
                        onClick={() => handleNotify(item.publicId || item.id)}
                        disabled={
                          actionState.id === (item.publicId || item.id) ||
                          item.notified ||
                          ["CANCELLED", "EXPIRED", "FULFILLED"].includes(normalizeStatusCode(item.statusCode || item.status))
                        }
                      >
                        {actionState.type === "notify" && actionState.id === (item.publicId || item.id)
                          ? "Notifying..."
                          : item.notified
                            ? "Notified"
                            : "Notify"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleComplete(item.publicId || item.id)}
                        disabled={
                          actionState.id === (item.publicId || item.id) ||
                          ["CANCELLED", "EXPIRED", "FULFILLED"].includes(normalizeStatusCode(item.statusCode || item.status))
                        }
                      >
                        {actionState.type === "complete" && actionState.id === (item.publicId || item.id)
                          ? "Completing..."
                          : "Complete"}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleDelete(item.publicId || item.id)}
                        disabled={
                          actionState.id === (item.publicId || item.id) ||
                          ["CANCELLED", "EXPIRED", "FULFILLED"].includes(normalizeStatusCode(item.statusCode || item.status))
                        }
                      >
                        {actionState.type === "delete" && actionState.id === (item.publicId || item.id)
                          ? "Deleting..."
                          : "Delete"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-note">No reservations at the moment.</p>
            )}
          </section>

          <section className="panel-lite reservation-detail">
            <header>
              <h3>Reservation Details</h3>
            </header>
            {selectedReservation ? (
              <dl>
                <div><dt>ID</dt><dd>{selectedReservation.id}</dd></div>
                <div><dt>Customer</dt><dd>{selectedReservation.customer}</dd></div>
                <div><dt>Phone</dt><dd>{selectedReservation.phone}</dd></div>
                <div><dt>Vehicle</dt><dd>{selectedReservation.plate}</dd></div>
                <div><dt>Product</dt><dd>{selectedReservation.product}</dd></div>
                <div><dt>Volume</dt><dd>{selectedReservation.volume} L</dd></div>
                <div><dt>Time Slot</dt><dd>{selectedReservation.slot}</dd></div>
                <div><dt>Status</dt><dd>{selectedReservation.status}</dd></div>
                <div><dt>Notified</dt><dd>{selectedReservation.notified ? "Yes" : "No"}</dd></div>
                <div><dt>Notes</dt><dd>{selectedReservation.notes || "No notes."}</dd></div>
              </dl>
            ) : (
              <p className="empty-note">Select a reservation to view details.</p>
            )}
          </section>
        </div>

        <section className="panel-lite reservation-form-wrap">
          <header>
            <h3>Add Reservation</h3>
          </header>
          <form className="reservation-form" onSubmit={handleAddReservation}>
            <label>
              SmartLink User ID
              <div className="reservation-user-lookup">
                <input
                  name="userPublicId"
                  value={form.userPublicId}
                  onChange={handleFormChange}
                  placeholder="SLU-A3K9P2"
                />
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => handleLookupUser()}
                  disabled={lookupState.loading}
                >
                  {lookupState.loading ? "Checking..." : "Confirm User"}
                </button>
              </div>
            </label>
            {lookupState.matchedUser ? (
              <p className="reservation-user-confirmation">
                Matched user: <strong>{lookupState.matchedUser.fullName}</strong>
                {lookupState.matchedUser.phone ? ` · ${lookupState.matchedUser.phone}` : ""}
              </p>
            ) : null}
            {lookupState.error ? (
              <p className="reservation-user-error">{lookupState.error}</p>
            ) : null}
            <label>Customer Name<input name="customer" value={form.customer} onChange={handleFormChange} /></label>
            <label>Phone<input name="phone" value={form.phone} onChange={handleFormChange} /></label>
            <label>Vehicle Plate<input name="plate" value={form.plate} onChange={handleFormChange} /></label>
            <label>Fuel Type
              <select name="product" value={form.product} onChange={handleFormChange}>
                <option>Unleaded</option>
                <option>Diesel</option>
                <option>Premium</option>
              </select>
            </label>
            <label>Volume (L)<input name="volume" type="number" min="1" value={form.volume} onChange={handleFormChange} /></label>
            <label>
              Time Slot {getAppTimeZone()}
              <input
                name="slot"
                type="datetime-local"
                step="900"
                value={form.slot}
                onChange={handleFormChange}
              />
            </label>
            <label>Status
              <select name="status" value={form.status} onChange={handleFormChange}>
                <option>Pending</option>
                <option>Confirmed</option>
                <option>Completed</option>
                <option>Cancelled</option>
              </select>
            </label>
            <label className="notes">Notes<textarea name="notes" value={form.notes} onChange={handleFormChange} rows="3" /></label>
            <p className="reservation-form-timezone-note">
              Reservation times are processed using system timezone: {getAppTimeZone()}.
            </p>
            <button type="submit">Add Reservation</button>
          </form>
        </section>
      </section>
    </div>
  )
}
