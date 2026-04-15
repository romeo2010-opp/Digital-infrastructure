import { useCallback, useEffect, useMemo, useState } from 'react'
import { SearchIcon } from '../icons'
import { userQueueApi } from '../api/userQueueApi'
import { queueMockService } from '../queueMockService'
import { maskPublicId } from '../../utils/masking'
import { formatDate, formatTime } from '../dateTime'
import { playSmartlinkCue, SMARTLINK_AUDIO_CUES } from '../../utils/smartlinkAudio'

function reservationStatusClass(status) {
  if (status === 'Checked In') return 'is-confirmed'
  if (status === 'Completed') return 'is-completed'
  if (status === 'Expired') return 'is-cancelled'
  if (status === 'Cancelled') return 'is-cancelled'
  if (status === 'Pending') return 'is-pending'
  return 'is-confirmed'
}

function formatDateLabel(isoValue) {
  return formatDate(isoValue, undefined, 'Date unavailable')
}

function formatTimeSlot(startIso, endIso) {
  if (!startIso) return 'Time slot unavailable'
  const start = formatTime(startIso, undefined, '')
  const end = formatTime(endIso, undefined, '')
  if (!start) return 'Time slot unavailable'
  if (!end) return start
  return `${start} - ${end}`
}

function isAbortError(error) {
  if (!error) return false
  if (error?.name === 'AbortError') return true
  const message = String(error?.message || '').toLowerCase()
  return message.includes('aborted') || message.includes('aborterror')
}

function normalizeReservationRow(row, index) {
  const stationName = String(row?.station?.name || row?.stationName || 'Unknown station').trim()
  const fuelTypeRaw = String(row?.fuelType || '').toUpperCase()
  const fuelType = fuelTypeRaw === 'DIESEL' ? 'Diesel' : 'Petrol'
  const litresRaw = Number(row?.litersReserved ?? row?.litres ?? row?.litresReserved)
  const litres = Number.isFinite(litresRaw) && litresRaw > 0 ? Number(litresRaw.toFixed(1)) : null
  const status = String(row?.status || '').trim() || 'Pending'
  const reservationStatus = String(row?.reservationStatus || '').trim().toUpperCase()
  const joinedAt = row?.joinedAt || row?.joined_at || null
  const slotStart = row?.slotStart || row?.slot_start || joinedAt || null
  const slotEnd = row?.slotEnd || row?.slot_end || null
  const slotDateLabel = String(row?.slotDateLabel || row?.slot_date_label || '').trim()
  const slotLabel = String(row?.slotLabel || row?.slot_label || '').trim()
  const expiresTimeLabel = String(row?.expiresTimeLabel || row?.expires_time_label || '').trim()
  const depositRaw = Number(row?.depositAmount ?? row?.deposit_amount)
  const reference = String(row?.reference || row?.id || row?.queueJoinId || `RSV-${index + 1}`).trim()

  return {
    id: String(row?.id || row?.queueJoinId || reference || `reservation-${index}`).trim() || `reservation-${index}`,
    stationName,
    litres,
    fuelType,
    dateLabel: slotDateLabel || formatDateLabel(slotStart || joinedAt),
    timeSlot: slotLabel || formatTimeSlot(slotStart, slotEnd),
    status,
    reservationStatus: reservationStatus || status.toUpperCase(),
    slotStart,
    slotEnd,
    expiresAt: row?.expiresAt || row?.expires_at || null,
    expiresTimeLabel,
    checkInTime: row?.checkInTime || row?.check_in_time || null,
    depositAmount: Number.isFinite(depositRaw) && depositRaw > 0 ? Number(depositRaw.toFixed(2)) : null,
    reference: maskPublicId(reference, { prefix: 4, suffix: 4 }),
  }
}

export function ReservationsScreen() {
  const queueData = useMemo(
    () => (userQueueApi.isApiMode() ? userQueueApi : queueMockService),
    [],
  )
  const [query, setQuery] = useState('')
  const [reservations, setReservations] = useState(() => [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [busyReservationId, setBusyReservationId] = useState('')

  const loadReservations = useCallback(async ({ signal } = {}) => {
    setLoading(true)
    setError('')
    try {
      if (typeof queueData.getReservations !== 'function') {
        setReservations([])
        return
      }
      const payload = await queueData.getReservations({ signal })
      const rows = Array.isArray(payload) ? payload : []
      setReservations(rows.map(normalizeReservationRow))
    } catch (requestError) {
      if (signal?.aborted || isAbortError(requestError)) {
        return
      }
      setReservations([])
      setError(requestError?.message || 'Unable to load reservations.')
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [queueData])

  useEffect(() => {
    const controller = new AbortController()
    loadReservations({ signal: controller.signal })
    return () => {
      controller.abort()
    }
  }, [loadReservations])

  const runReservationAction = useCallback(async (reservationId, action) => {
    if (!reservationId) return
    setBusyReservationId(reservationId)
    setActionError('')
    setActionMessage('')
    try {
      await action()
      await loadReservations({})
    } catch (requestError) {
      setActionError(requestError?.message || 'Reservation action failed.')
    } finally {
      setBusyReservationId('')
    }
  }, [loadReservations])

  const handleCancelReservation = useCallback((reservationId) => {
    runReservationAction(reservationId, async () => {
      if (typeof queueData.cancelReservation !== 'function') {
        throw new Error('Cancellation is unavailable in current mode.')
      }
      const response = await queueData.cancelReservation(reservationId, { reason: 'user_cancel' })
      const refund = Number(response?.refundAmount || 0)
      const refundPct = Number(response?.refundPct || 0)
      if (refund > 0) {
        setActionMessage(`Reservation cancelled. Refund: MWK ${refund.toLocaleString()} (${refundPct}%).`)
      } else {
        setActionMessage('Reservation cancelled.')
      }
    })
  }, [queueData, runReservationAction])

  const handleCheckInReservation = useCallback((reservationId) => {
    runReservationAction(reservationId, async () => {
      if (typeof queueData.checkInReservation !== 'function') {
        throw new Error('Check-in is unavailable in current mode.')
      }
      const position = await new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve(null)
          return
        }
        navigator.geolocation.getCurrentPosition(
          (next) =>
            resolve({
              lat: next.coords.latitude,
              lng: next.coords.longitude,
            }),
          () => resolve(null),
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 7000 },
        )
      })

      const payload = position
        ? { method: 'GPS', userLat: position.lat, userLng: position.lng }
        : { method: 'GPS' }
      const response = await queueData.checkInReservation(reservationId, payload)
      playSmartlinkCue(SMARTLINK_AUDIO_CUES.RESERVATION_CHECK_IN_SUCCESS)
      setActionMessage(response?.message || 'Checked in successfully.')
    })
  }, [queueData, runReservationAction])

  const filteredReservations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return reservations

    return reservations.filter((item) => {
      const inStation = item.stationName.toLowerCase().includes(normalizedQuery)
      const inFuelType = item.fuelType.toLowerCase().includes(normalizedQuery)
      const inReference = item.reference.toLowerCase().includes(normalizedQuery)
      const inDate = item.dateLabel.toLowerCase().includes(normalizedQuery)
      const inTimeSlot = item.timeSlot.toLowerCase().includes(normalizedQuery)
      const inStatus = item.status.toLowerCase().includes(normalizedQuery)
      const inVolume = String(item.litres || '').toLowerCase().includes(normalizedQuery)
      return inStation || inFuelType || inReference || inDate || inTimeSlot || inStatus || inVolume
    })
  }, [query, reservations])

  return (
    <section className='reservations-screen'>
      <header className='screen-header'>
        <h2>Reservations</h2>
        <p>{loading ? 'Loading…' : `${filteredReservations.length} reservations`}</p>
      </header>

      <label className='reservations-search' aria-label='Search reservations'>
        <SearchIcon size={15} />
        <input
          type='search'
          value={query}
          placeholder='Search reservation'
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {error ? (
        <section className='station-card coming-soon'>
          <h3>Unable to load reservations</h3>
          <p>{error}</p>
        </section>
      ) : null}

      {loading ? (
        <section className='station-card coming-soon'>
          <h3>Loading reservations</h3>
          <p>Fetching your latest reservation activity.</p>
        </section>
      ) : null}

      {actionError ? (
        <section className='station-card coming-soon'>
          <p>{actionError}</p>
        </section>
      ) : null}

      {actionMessage ? (
        <section className='station-card coming-soon'>
          <p>{actionMessage}</p>
        </section>
      ) : null}

      {!loading && !error && filteredReservations.length ? (
        <div className='reservations-list'>
          {filteredReservations.map((reservation) => {
            const canMutateReservation =
              reservation.reservationStatus === 'PENDING' ||
              reservation.reservationStatus === 'CONFIRMED'
            return (
              <article key={reservation.id} className='reservation-card'>
                <div className='reservation-card-top'>
                  <h3>{reservation.stationName}</h3>
                  <span className={`reservation-status ${reservationStatusClass(reservation.status)}`}>{reservation.status}</span>
                </div>

                <p className='reservation-volume'>
                  {reservation.litres !== null ? `${reservation.litres} L` : 'Litres not set'} {reservation.fuelType}
                </p>

                <div className='reservation-meta-row'>
                  <span>Time Slot</span>
                  <strong>{reservation.timeSlot}</strong>
                </div>
                <div className='reservation-meta-row'>
                  <span>Date</span>
                  <strong>{reservation.dateLabel}</strong>
                </div>
                <div className='reservation-meta-row'>
                  <span>Reference</span>
                  <strong>{reservation.reference}</strong>
                </div>
                <div className='reservation-meta-row'>
                  <span>Deposit</span>
                  <strong>
                    {reservation.depositAmount !== null
                      ? `MWK ${reservation.depositAmount.toLocaleString()}`
                      : '—'}
                  </strong>
                </div>

                {reservation.expiresAt ? (
                  <div className='reservation-meta-row'>
                    <span>Expires</span>
                    <strong>
                      {reservation.expiresTimeLabel || formatTimeSlot(reservation.expiresAt, null).split(' - ')[0]}
                    </strong>
                  </div>
                ) : null}

                <div className='reservation-action-row'>
                  {canMutateReservation ? (
                    <button
                      type='button'
                      className='details-action-button is-secondary'
                      onClick={() => handleCancelReservation(reservation.id)}
                      disabled={Boolean(busyReservationId)}
                    >
                      {busyReservationId === reservation.id ? 'Please wait…' : 'Cancel'}
                    </button>
                  ) : null}

                  {canMutateReservation ? (
                    <button
                      type='button'
                      className='details-action-button is-primary'
                      onClick={() => handleCheckInReservation(reservation.id)}
                      disabled={Boolean(busyReservationId)}
                    >
                      {busyReservationId === reservation.id ? 'Checking…' : 'Check-In'}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      ) : null}

      {!loading && !error && !filteredReservations.length ? (
        <section className='station-card coming-soon'>
          <h3>No reservations</h3>
          <p>There are no reservations at the moment.</p>
        </section>
      ) : null}
    </section>
  )
}
