import { useCallback, useEffect, useMemo, useState } from 'react'
import { fleetApi } from '../../mobile/api/fleetApi'
import { useMiniRouter } from '../../mobile/useMiniRouter'
import './fleet.css'

function money(value) {
  const amount = Number(value || 0)
  return `MWK ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function litres(value) {
  const amount = Number(value || 0)
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 1 })} L`
}

function shortDate(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

function StatusChip({ children, tone = '' }) {
  return <span className={`fleet-status-chip ${tone ? `tone-${tone}` : ''}`}>{children}</span>
}

function FleetDriverEmpty({ title, body, action }) {
  return (
    <section className='fleet-empty-state'>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </section>
  )
}

function requestAmountLabel(request) {
  if (Number(request?.requestedAmount || 0) > 0) return money(request.requestedAmount)
  if (Number(request?.requestedLitres || 0) > 0) return litres(request.requestedLitres)
  return 'Amount not set'
}

function DriverRequestForm({ assignments, allocations, onSubmit, submitting }) {
  const firstAssignment = assignments[0] || null
  const [form, setForm] = useState({
    assignmentKey: firstAssignment ? `${firstAssignment.fleet.publicId}:${firstAssignment.vehicle.publicId}` : '',
    requestMode: 'amount',
    paymentContextType: 'fleet_wallet',
    requestedAmount: '',
    requestedLitres: '',
    odometerReading: '',
    stationPublicId: '',
    reason: '',
  })

  useEffect(() => {
    if (!form.assignmentKey && firstAssignment) {
      setForm((current) => ({
        ...current,
        assignmentKey: `${firstAssignment.fleet.publicId}:${firstAssignment.vehicle.publicId}`,
      }))
    }
  }, [firstAssignment, form.assignmentKey])

  const selectedAssignment = useMemo(() => {
    return assignments.find((item) => `${item.fleet.publicId}:${item.vehicle.publicId}` === form.assignmentKey) || null
  }, [assignments, form.assignmentKey])

  const selectedAllocation = useMemo(() => {
    if (!selectedAssignment) return null
    return (
      allocations.find((allocation) => allocation.vehicle?.publicId === selectedAssignment.vehicle.publicId || allocation.driver?.publicId) ||
      allocations.find((allocation) => allocation.department?.publicId === selectedAssignment.department?.publicId) ||
      allocations[0] ||
      null
    )
  }, [allocations, selectedAssignment])

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  if (!assignments.length) {
    return (
      <FleetDriverEmpty
        title='No assigned vehicles'
        body='A fleet administrator must assign you to an active vehicle before you can request fleet fuel.'
      />
    )
  }

  return (
    <form
      className='fleet-form fleet-driver-request-form'
      onSubmit={(event) => {
        event.preventDefault()
        if (!selectedAssignment) return
        const action = event.nativeEvent?.submitter?.value || 'requestExtra'
        onSubmit({
          fleetId: selectedAssignment.fleet.publicId,
          vehicleId: selectedAssignment.vehicle.publicId,
          stationPublicId: form.stationPublicId || undefined,
          allocationId: selectedAllocation?.publicId || undefined,
          fuelCardId: selectedAllocation?.fuelCard?.publicId || undefined,
          paymentContextType: form.paymentContextType,
          requestedAmount: form.requestMode === 'amount' && form.requestedAmount ? Number(form.requestedAmount) : undefined,
          requestedLitres: form.requestMode === 'litres' && form.requestedLitres ? Number(form.requestedLitres) : undefined,
          odometerReading: form.odometerReading ? Number(form.odometerReading) : undefined,
          reason: form.reason || undefined,
        }, action)
      }}
    >
      <label>
        <span>Fueling source</span>
        <select value={form.assignmentKey} onChange={(event) => update('assignmentKey', event.target.value)} required>
          {assignments.map((assignment) => (
            <option
              key={`${assignment.fleet.publicId}:${assignment.vehicle.publicId}`}
              value={`${assignment.fleet.publicId}:${assignment.vehicle.publicId}`}
            >
              Fleet Wallet: {assignment.fleet.name} - {assignment.vehicle.plateNumber}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Assigned vehicle</span>
        <input
          value={
            selectedAssignment
              ? `${selectedAssignment.vehicle.plateNumber} ${selectedAssignment.vehicle.vehicleName || ''}`.trim()
              : ''
          }
          readOnly
        />
      </label>

      <div className='fleet-driver-allocation-card'>
        <span>{selectedAssignment?.department?.name || selectedAllocation?.department?.name || 'Fleet allocation'}</span>
        <strong>{selectedAllocation ? `${litres(selectedAllocation.currentLitreBalance)} remaining` : 'No active allocation found'}</strong>
        <small>
          Used {selectedAllocation ? litres(selectedAllocation.usedLitresCurrentPeriod) : '0 L'} of monthly cap {selectedAllocation ? litres(selectedAllocation.monthlyLitreCap) : 'not set'}
        </small>
      </div>

      <label>
        <span>Payment source</span>
        <select value={form.paymentContextType} onChange={(event) => update('paymentContextType', event.target.value)}>
          <option value='fleet_wallet'>Fleet Wallet</option>
          <option value='fuel_card_manual'>Manual fuel card</option>
          <option value='station_credit'>Station credit</option>
        </select>
      </label>

      <label>
        <span>Fueling unit</span>
        <select value={form.requestMode} onChange={(event) => update('requestMode', event.target.value)}>
          <option value='amount'>Amount</option>
          <option value='litres'>Litres</option>
        </select>
      </label>

      {form.requestMode === 'amount' ? (
        <label>
          <span>Requested amount</span>
          <input type='number' min='1' value={form.requestedAmount} onChange={(event) => update('requestedAmount', event.target.value)} required />
        </label>
      ) : (
        <label>
          <span>Requested litres</span>
          <input type='number' min='0.1' step='0.1' value={form.requestedLitres} onChange={(event) => update('requestedLitres', event.target.value)} required />
        </label>
      )}

      <label>
        <span>Odometer reading</span>
        <input type='number' min='0' value={form.odometerReading} onChange={(event) => update('odometerReading', event.target.value)} required />
      </label>

      <label>
        <span>Station public ID</span>
        <input value={form.stationPublicId} onChange={(event) => update('stationPublicId', event.target.value)} placeholder='Optional until queue integration is connected' />
      </label>

      <label className='fleet-form-wide'>
        <span>Reason or trip reference</span>
        <textarea value={form.reason} onChange={(event) => update('reason', event.target.value)} rows='3' />
      </label>

      <div className='fleet-action-row fleet-form-wide'>
        <button type='submit' name='action' value='fuelNow' className='fleet-primary-button' disabled={submitting || !selectedAllocation}>
          {submitting ? 'Checking allocation...' : 'Fuel Now'}
        </button>
        <button type='submit' name='action' value='requestExtra' className='fleet-secondary-button' disabled={submitting}>
          {submitting ? 'Submitting...' : 'Request Extra Fuel'}
        </button>
      </div>
    </form>
  )
}

export function FleetDriverMode({ layout = 'mobile', onBack }) {
  const { navigate } = useMiniRouter()
  const [summary, setSummary] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [fuelingSource, setFuelingSource] = useState('personal')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextSummary, nextHistory] = await Promise.all([
        fleetApi.driverSummary(),
        fleetApi.driverHistory(),
      ])
      setSummary(nextSummary)
      setHistory(nextHistory.items || [])
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load fleet driver mode.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const assignments = summary?.assignedVehicles || []
  const allocations = summary?.allocations || []
  const requests = summary?.requests || []
  const memberships = summary?.memberships || []
  const pendingRequests = requests.filter((request) => request.status === 'pending')
  const approvedRequests = requests.filter((request) => request.status === 'approved')

  async function submitRequest(payload, action = 'requestExtra') {
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      if (action === 'fuelNow') {
        const validation = await fleetApi.validateFuelNow(payload)
        if (validation.allowed === false) {
          setError(`${validation.checks?.[0]?.message || 'Fuel Now is not available.'} Use Request Extra Fuel for this exception.`)
          return
        }
        const session = await fleetApi.createFuelNowSession(payload)
        if (session.allowed === false) {
          setError(`${session.checks?.[0]?.message || 'Fuel Now is not available.'} Use Request Extra Fuel for this exception.`)
          return
        }
        setSuccess('Fuel Now authorized. Continue at the station or kiosk to complete fueling.')
      } else {
        await fleetApi.createDriverFuelRequest(payload)
        setSuccess('Extra fuel request submitted for approval.')
      }
      await loadData()
    } catch (requestError) {
      setError(requestError?.message || 'Unable to submit fleet fuel request.')
    } finally {
      setSubmitting(false)
    }
  }

  function openPersonalWalletFlow() {
    navigate(layout === 'mobile' ? '/m/wallet' : '/d/transactions')
  }

  return (
    <main className={`fleet-driver-root layout-${layout}`}>
      <header className='fleet-driver-hero'>
        <div>
          <span className='fleet-kicker'>Fleet driver mode</span>
          <h1>Fuel from personal wallet or an approved fleet allocation.</h1>
          <p>Personal Wallet is the default. Select Fleet only when the trip belongs to your assigned fleet vehicle.</p>
        </div>
        <div className='fleet-driver-hero-actions'>
          {onBack ? (
            <button type='button' className='fleet-secondary-button' onClick={onBack}>
              Back
            </button>
          ) : null}
          <button type='button' className='fleet-secondary-button' onClick={loadData} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {loading ? <section className='fleet-loading-panel'>Loading fleet driver workspace...</section> : null}
      {!loading && error ? <p className='fleet-error-note'>{error}</p> : null}
      {!loading && success ? <p className='fleet-success-note'>{success}</p> : null}

      {!loading && !memberships.length ? (
        <FleetDriverEmpty
          title='No fleet driver access'
          body='You do not currently have an active fleet driver membership. Ask your fleet administrator to invite or activate your account.'
        />
      ) : null}

      {!loading && memberships.length ? (
        <div className='fleet-driver-grid'>
          <section className='fleet-panel'>
            <header>
              <h3>How are you fueling today?</h3>
              <StatusChip tone={assignments.length ? 'safe' : 'warning'}>{assignments.length} assigned vehicle{assignments.length === 1 ? '' : 's'}</StatusChip>
            </header>
            <div className='fleet-source-selector' aria-label='Fueling source'>
              <button
                type='button'
                className={fuelingSource === 'personal' ? 'is-active' : ''}
                onClick={() => setFuelingSource('personal')}
              >
                Personal Wallet
              </button>
              <button
                type='button'
                className={fuelingSource === 'fleet' ? 'is-active' : ''}
                onClick={() => setFuelingSource('fleet')}
              >
                Fleet Wallet
              </button>
            </div>
            {fuelingSource === 'personal' ? (
              <FleetDriverEmpty
                title='Personal Wallet selected'
                body='Use the existing SmartLink wallet, queue, and reservation flows for personal fueling. Fleet policies and company approvals are not applied there.'
                action={<button type='button' className='fleet-secondary-button' onClick={openPersonalWalletFlow}>Open personal wallet</button>}
              />
            ) : (
              <DriverRequestForm assignments={assignments} allocations={allocations} onSubmit={submitRequest} submitting={submitting} />
            )}
          </section>

          <section className='fleet-driver-side'>
            <article className='fleet-panel'>
              <header><h3>Approval status</h3></header>
              <div className='fleet-kpi-grid compact'>
                <article className='fleet-kpi'><span>Pending</span><strong>{pendingRequests.length}</strong></article>
                <article className='fleet-kpi'><span>Approved</span><strong>{approvedRequests.length}</strong></article>
              </div>
              {requests.length ? (
                <div className='fleet-driver-list'>
                  {requests.slice(0, 6).map((request) => (
                    <article key={request.publicId} className='fleet-driver-list-row'>
                      <div>
                        <strong>{request.vehicle?.plateNumber || 'Vehicle'}</strong>
                        <span>{requestAmountLabel(request)} - {shortDate(request.createdAt)}</span>
                        {request.rejectedReason ? <small>{request.rejectedReason}</small> : null}
                      </div>
                      <StatusChip tone={request.status === 'approved' ? 'safe' : request.status === 'rejected' ? 'danger' : 'warning'}>
                        {request.status}
                      </StatusChip>
                    </article>
                  ))}
                </div>
              ) : (
                <FleetDriverEmpty title='No requests yet' body='Your fleet fuel requests and rejection reasons will appear here.' />
              )}
            </article>

            <article className='fleet-panel'>
              <header><h3>Own fleet fuel history</h3></header>
              {history.length ? (
                <div className='fleet-driver-list'>
                  {history.slice(0, 6).map((transaction) => (
                    <article key={transaction.publicId} className='fleet-driver-list-row'>
                      <div>
                        <strong>{transaction.vehicle?.plateNumber || 'Vehicle'} at {transaction.station?.name || 'station'}</strong>
                        <span>{litres(transaction.litres)} - {money(transaction.amount)} - {shortDate(transaction.createdAt)}</span>
                      </div>
                      <StatusChip tone={transaction.riskStatus === 'normal' ? 'safe' : 'warning'}>{transaction.status}</StatusChip>
                    </article>
                  ))}
                </div>
              ) : (
                <FleetDriverEmpty title='No completed fleet transactions' body='Only your own fleet transaction history is shown here.' />
              )}
            </article>
          </section>
        </div>
      ) : null}
    </main>
  )
}
