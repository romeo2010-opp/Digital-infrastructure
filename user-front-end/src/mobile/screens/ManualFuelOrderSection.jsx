import { useCallback, useEffect, useMemo, useState } from 'react'
import { userQueueApi } from '../api/userQueueApi'
import { stationsApi } from '../api/stationsApi'
import { formatDateTime } from '../dateTime'
import {
  clearStoredActiveManualFuelOrderId,
  getStoredActiveManualFuelOrderId,
  setStoredActiveManualFuelOrderId,
} from '../authSession'

function isAbortError(error) {
  if (!error) return false
  if (error?.name === 'AbortError') return true
  const message = String(error?.message || '').toLowerCase()
  return message.includes('aborted') || message.includes('aborterror') || message.includes('signal is aborted')
}

function formatMoney(amount, currencyCode = 'MWK') {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return null
  try {
    return new Intl.NumberFormat('en-MW', {
      style: 'currency',
      currency: String(currencyCode || 'MWK').trim() || 'MWK',
      maximumFractionDigits: 2,
    }).format(numeric)
  } catch {
    return `${currencyCode} ${numeric.toFixed(2)}`
  }
}

function requestedLabel(order) {
  if (Number.isFinite(Number(order?.requestedAmountMwk)) && Number(order.requestedAmountMwk) > 0) {
    return formatMoney(order.requestedAmountMwk, 'MWK')
  }
  if (Number.isFinite(Number(order?.requestedLitres)) && Number(order.requestedLitres) > 0) {
    return `${Number(order.requestedLitres).toFixed(Number(order.requestedLitres) % 1 === 0 ? 0 : 2)} L`
  }
  return 'Not set'
}

function presenceLabel(order) {
  return String(order?.latestPresence?.presenceBadge || 'Awaiting station').trim() || 'Awaiting station'
}

function statusClass(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'completed') return 'is-success'
  if (normalized === 'failed' || normalized === 'cancelled' || normalized === 'expired') return 'is-danger'
  if (normalized === 'dispensing' || normalized === 'attached_to_session') return 'is-info'
  return 'is-muted'
}

function canCancelOrder(order) {
  return ['created', 'awaiting_station', 'at_station', 'near_pump'].includes(
    String(order?.status || '').trim().toLowerCase(),
  )
}

function canCreateAnother(order) {
  return !order || ['completed', 'cancelled', 'expired', 'failed'].includes(String(order.status || '').trim().toLowerCase())
}

export function ManualFuelOrderSection() {
  const walletApi = useMemo(() => (userQueueApi.isApiMode() ? userQueueApi : null), [])
  const [stations, setStations] = useState([])
  const [stationsLoading, setStationsLoading] = useState(false)
  const [stationsError, setStationsError] = useState('')
  const [activeOrder, setActiveOrder] = useState(null)
  const [activeOrderLoading, setActiveOrderLoading] = useState(Boolean(walletApi))
  const [activeOrderError, setActiveOrderError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [requestMode, setRequestMode] = useState('amount')
  const [stationPublicId, setStationPublicId] = useState('')
  const [fuelType, setFuelType] = useState('PETROL')
  const [requestedAmountMwk, setRequestedAmountMwk] = useState('')
  const [requestedLitres, setRequestedLitres] = useState('')

  const loadStations = useCallback(async ({ signal } = {}) => {
    setStationsLoading(true)
    setStationsError('')
    try {
      const rows = await stationsApi.listStations({ signal })
      const normalizedRows = Array.isArray(rows) ? rows : []
      if (signal?.aborted) return
      setStations(normalizedRows)
      setStationPublicId((current) => current || String(normalizedRows[0]?.publicId || normalizedRows[0]?.id || '').trim())
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return
      setStations([])
      setStationsError(error?.message || 'Unable to load stations for manual fuel orders.')
    } finally {
      if (!signal?.aborted) {
        setStationsLoading(false)
      }
    }
  }, [])

  const loadActiveOrder = useCallback(async ({ signal, fuelOrderId = '' } = {}) => {
    if (!walletApi) {
      setActiveOrderLoading(false)
      setActiveOrder(null)
      setActiveOrderError('Manual fuel orders are available only when the wallet is connected to the API.')
      return
    }

    const scopedFuelOrderId = String(fuelOrderId || getStoredActiveManualFuelOrderId() || '').trim()
    if (!scopedFuelOrderId) {
      setActiveOrder(null)
      setActiveOrderError('')
      setActiveOrderLoading(false)
      return
    }

    setActiveOrderLoading(true)
    setActiveOrderError('')
    try {
      const payload = await walletApi.getFuelOrder(scopedFuelOrderId, { signal })
      if (signal?.aborted) return
      setActiveOrder(payload || null)
      if (payload?.publicId) {
        setStoredActiveManualFuelOrderId(payload.publicId)
      } else {
        clearStoredActiveManualFuelOrderId()
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return
      setActiveOrder(null)
      setActiveOrderError(error?.message || 'Unable to load your manual fuel order.')
      clearStoredActiveManualFuelOrderId()
    } finally {
      if (!signal?.aborted) {
        setActiveOrderLoading(false)
      }
    }
  }, [walletApi])

  useEffect(() => {
    const controller = new AbortController()
    loadStations({ signal: controller.signal })
    loadActiveOrder({ signal: controller.signal })
    return () => controller.abort()
  }, [loadActiveOrder, loadStations])

  useEffect(() => {
    const activeStatus = String(activeOrder?.status || '').trim().toLowerCase()
    if (!walletApi || !activeOrder?.publicId || ['completed', 'cancelled', 'expired', 'failed'].includes(activeStatus)) return undefined
    const timer = window.setInterval(() => {
      loadActiveOrder({ fuelOrderId: activeOrder.publicId }).catch(() => {})
    }, 15000)
    return () => window.clearInterval(timer)
  }, [activeOrder?.publicId, activeOrder?.status, loadActiveOrder, walletApi])

  const handleCreateOrder = useCallback(async (event) => {
    event.preventDefault()
    if (!walletApi) {
      setSubmitError('Manual fuel orders are available only in API mode.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      const payload = await walletApi.createManualWalletFuelOrder({
        stationPublicId,
        fuelType,
        requestedAmountMwk: requestMode === 'amount' ? Number(requestedAmountMwk || 0) || undefined : undefined,
        requestedLitres: requestMode === 'litres' ? Number(requestedLitres || 0) || undefined : undefined,
      })
      setActiveOrder(payload || null)
      if (payload?.publicId) {
        setStoredActiveManualFuelOrderId(payload.publicId)
      }
      setModalOpen(false)
      setRequestedAmountMwk('')
      setRequestedLitres('')
    } catch (error) {
      setSubmitError(error?.message || 'Unable to create your manual fuel order.')
    } finally {
      setSubmitting(false)
    }
  }, [fuelType, requestMode, requestedAmountMwk, requestedLitres, stationPublicId, walletApi])

  const handleCancelOrder = useCallback(async () => {
    if (!walletApi || !activeOrder?.publicId) return
    setCancelLoading(true)
    setActiveOrderError('')
    try {
      const payload = await walletApi.cancelFuelOrder(activeOrder.publicId, {})
      setActiveOrder(payload || null)
      if (payload?.publicId) {
        setStoredActiveManualFuelOrderId(payload.publicId)
      } else {
        clearStoredActiveManualFuelOrderId()
      }
    } catch (error) {
      setActiveOrderError(error?.message || 'Unable to cancel this manual fuel order.')
    } finally {
      setCancelLoading(false)
    }
  }, [activeOrder?.publicId, walletApi])

  const selectedStation = stations.find((item) => String(item.publicId || item.id) === stationPublicId) || null

  return (
    <>
      <section className='wallet-section'>
        <div className='wallet-section-head'>
          <div>
            <h3>Manual fuel order</h3>
            <p>Reserve wallet payment first, then attach the order when you physically reach the pump.</p>
          </div>
        </div>

        {!walletApi ? (
          <section className='station-card coming-soon'>
            <h3>API connection required</h3>
            <p>Manual wallet fuel orders appear here when the user app is connected to the SmartLink API.</p>
          </section>
        ) : null}

        {stationsError ? (
          <section className='station-card coming-soon'>
            <h3>Unable to load stations</h3>
            <p>{stationsError}</p>
            <div className='wallet-inline-actions'>
              <button type='button' className='details-action-button is-secondary' onClick={() => loadStations({})}>
                Retry
              </button>
            </div>
          </section>
        ) : null}

        {activeOrderError ? (
          <section className='station-card coming-soon'>
            <h3>Manual order update unavailable</h3>
            <p>{activeOrderError}</p>
            <div className='wallet-inline-actions'>
              <button type='button' className='details-action-button is-secondary' onClick={() => loadActiveOrder({})}>
                Refresh
              </button>
            </div>
          </section>
        ) : null}

        {activeOrderLoading && !activeOrder ? (
          <article className='wallet-summary-card is-loading'>
            <div className='wallet-summary-head'>
              <div>
                <span className='wallet-summary-eyebrow'>Manual Fuel Order</span>
                <h3>Refreshing status</h3>
              </div>
              <span className='wallet-status-pill is-active'>Loading</span>
            </div>
            <p className='wallet-summary-amount'>Status pending…</p>
          </article>
        ) : null}

        {activeOrder ? (
          <article className='wallet-summary-card manual-fuel-order-card'>
            <div className='wallet-summary-head'>
              <div>
                <span className='wallet-summary-eyebrow'>Manual Fuel Order</span>
                <h3>{activeOrder.displayCode || activeOrder.publicId}</h3>
              </div>
              <span className={`wallet-status-pill ${statusClass(activeOrder.status)}`}>
                {activeOrder.statusLabel || activeOrder.status}
              </span>
            </div>

            <p className='wallet-summary-caption'>{activeOrder.stationName || 'Selected station'}</p>
            <p className='wallet-summary-amount'>{requestedLabel(activeOrder)}</p>

            <div className='wallet-metric-grid'>
              <div className='wallet-metric-card'>
                <span>Fuel</span>
                <strong>{String(activeOrder.fuelType || 'PETROL').trim().toUpperCase()}</strong>
              </div>
              <div className='wallet-metric-card'>
                <span>Payment</span>
                <strong>Wallet</strong>
              </div>
              <div className='wallet-metric-card'>
                <span>Presence</span>
                <strong>{presenceLabel(activeOrder)}</strong>
              </div>
              <div className='wallet-metric-card'>
                <span>Hold</span>
                <strong>{formatMoney(activeOrder?.paymentIntent?.holdAmountMwk || 0, 'MWK')}</strong>
              </div>
              <div className='wallet-metric-card'>
                <span>Updated</span>
                <strong>{formatDateTime(activeOrder.updatedAt, undefined, 'Just now')}</strong>
              </div>
            </div>

            {activeOrder?.transaction?.receiptVerificationRef ? (
              <div className='wallet-summary-meta'>
                <span>Receipt ref: {activeOrder.transaction.receiptVerificationRef}</span>
                <span>Payment ref: {activeOrder.transaction.paymentReference || 'Pending capture'}</span>
              </div>
            ) : null}

            <div className='wallet-inline-actions stacked'>
              {canCancelOrder(activeOrder) ? (
                <button
                  type='button'
                  className='details-action-button is-secondary'
                  onClick={handleCancelOrder}
                  disabled={cancelLoading}
                >
                  {cancelLoading ? 'Cancelling…' : 'Cancel order'}
                </button>
              ) : null}
              <button
                type='button'
                className='details-action-button is-secondary'
                onClick={() => loadActiveOrder({ fuelOrderId: activeOrder.publicId })}
                disabled={activeOrderLoading}
              >
                Refresh status
              </button>
              {canCreateAnother(activeOrder) ? (
                <button
                  type='button'
                  className='details-action-button is-primary'
                  onClick={() => setModalOpen(true)}
                  disabled={stationsLoading}
                >
                  Create another manual order
                </button>
              ) : null}
            </div>
          </article>
        ) : null}

        {!activeOrder ? (
          <div className='wallet-action-grid'>
            <button
              type='button'
              className='details-action-button is-primary'
              onClick={() => setModalOpen(true)}
              disabled={!walletApi || stationsLoading || Boolean(stationsError)}
            >
              Create manual fuel order
            </button>
          </div>
        ) : null}
      </section>

      {modalOpen ? (
        <div className='queue-modal-backdrop' role='presentation' onClick={() => setModalOpen(false)}>
          <div className='queue-modal wallet-topup-modal' role='dialog' aria-modal='true' onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>Create manual fuel order</h3>
                <p>Wallet holds the estimated amount now, then SmartLink captures the actual dispensed total after the pump session completes.</p>
              </div>
              <button type='button' onClick={() => setModalOpen(false)} aria-label='Close manual fuel order dialog'>
                Close
              </button>
            </header>

            <form className='queue-modal-actions-stacked' onSubmit={handleCreateOrder}>
              <label className='queue-modal-input'>
                <span>Station</span>
                <select value={stationPublicId} onChange={(event) => setStationPublicId(event.target.value)} required>
                  {stations.map((station) => (
                    <option key={station.publicId || station.id} value={station.publicId || station.id}>
                      {station.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className='queue-modal-input'>
                <span>Fuel type</span>
                <select value={fuelType} onChange={(event) => setFuelType(event.target.value)}>
                  <option value='PETROL'>Petrol</option>
                  <option value='DIESEL'>Diesel</option>
                </select>
              </label>

              <label className='queue-modal-input'>
                <span>Request by</span>
                <select value={requestMode} onChange={(event) => setRequestMode(event.target.value)}>
                  <option value='amount'>MWK amount</option>
                  <option value='litres'>Litres</option>
                </select>
              </label>

              {requestMode === 'amount' ? (
                <label className='queue-modal-input'>
                  <span>Requested amount (MWK)</span>
                  <input
                    type='number'
                    min='1'
                    step='1'
                    value={requestedAmountMwk}
                    onChange={(event) => setRequestedAmountMwk(event.target.value)}
                    placeholder='Enter whole MWK amount'
                    required
                  />
                </label>
              ) : (
                <label className='queue-modal-input'>
                  <span>Requested litres</span>
                  <input
                    type='number'
                    min='1'
                    step='0.1'
                    value={requestedLitres}
                    onChange={(event) => setRequestedLitres(event.target.value)}
                    placeholder='Enter litres'
                    required
                  />
                </label>
              )}

              <section className='station-card wallet-feedback-card manual-fuel-order-summary'>
                <p>
                  {selectedStation?.name || 'Selected station'}.
                  {' '}
                  Payment method: Wallet.
                </p>
              </section>

              {submitError ? (
                <section className='station-card coming-soon'>
                  <h3>Unable to create order</h3>
                  <p>{submitError}</p>
                </section>
              ) : null}

              <div className='queue-modal-actions'>
                <button type='button' className='details-action-button is-secondary' onClick={() => setModalOpen(false)} disabled={submitting}>
                  Cancel
                </button>
                <button type='submit' className='details-action-button is-primary' disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  )
}
