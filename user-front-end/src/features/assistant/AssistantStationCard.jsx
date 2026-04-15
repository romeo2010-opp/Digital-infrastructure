function actionToneClass(tone) {
  const normalized = String(tone || 'secondary').trim().toLowerCase()
  if (normalized === 'primary') return 'assistant-action-button--primary'
  if (normalized === 'danger') return 'assistant-action-button--danger'
  return 'assistant-action-button--secondary'
}

function fuelStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'available') return 'Available'
  if (normalized === 'low') return 'Low'
  if (normalized === 'in_use' || normalized === 'in use') return 'Busy'
  if (normalized === 'unavailable') return 'Unavailable'
  return 'Unknown'
}

function fuelStatusTone(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'available') return 'is-available'
  if (normalized === 'low') return 'is-low'
  if (normalized === 'in_use' || normalized === 'in use') return 'is-busy'
  return 'is-unavailable'
}

export function AssistantStationCard({ card, onAction }) {
  const fuelStatuses = Array.isArray(card?.fuelStatuses) ? card.fuelStatuses : []
  const actions = Array.isArray(card?.actions) ? card.actions : []

  return (
    <article className='assistant-card assistant-card--station'>
      <div className='assistant-card-header'>
        <div>
          <h4>{card?.name || 'Station'}</h4>
          <p>{card?.address || 'Station address unavailable'}</p>
        </div>
        {Number.isFinite(Number(card?.distanceKm)) ? (
          <span className='assistant-distance-pill'>{Number(card.distanceKm).toFixed(1)} km</span>
        ) : null}
      </div>

      <div className='assistant-card-meta'>
        {card?.activeQueueCount !== undefined && card?.activeQueueCount !== null ? (
          <span>{Number(card.activeQueueCount)} in queue</span>
        ) : null}
      </div>

      {fuelStatuses.length ? (
        <div className='assistant-fuel-status-row'>
          {fuelStatuses.map((status, index) => (
            <span
              key={`${card?.stationPublicId || card?.name || 'station'}-fuel-${index}`}
              className={`assistant-fuel-chip ${fuelStatusTone(status?.status)}`}
            >
              <strong>{String(status?.label || status?.code || 'Fuel')}</strong>
              <span>{fuelStatusLabel(status?.status)}</span>
            </span>
          ))}
        </div>
      ) : null}

      {actions.length ? (
        <div className='assistant-card-actions'>
          {actions.map((action) => (
            <button
              key={`${action.id}-${action.label}`}
              type='button'
              className={`assistant-action-button ${actionToneClass(action.tone)}`}
              onClick={() => onAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  )
}
