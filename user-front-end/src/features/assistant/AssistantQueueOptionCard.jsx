function actionToneClass(tone) {
  const normalized = String(tone || 'secondary').trim().toLowerCase()
  if (normalized === 'primary') return 'assistant-action-button--primary'
  if (normalized === 'danger') return 'assistant-action-button--danger'
  return 'assistant-action-button--secondary'
}

export function AssistantQueueOptionCard({ card, onAction }) {
  const actions = Array.isArray(card?.actions) ? card.actions : []

  return (
    <article className='assistant-card assistant-card--queue-option'>
      <div className='assistant-card-header'>
        <div>
          <h4>{card?.stationName || 'Station'}</h4>
          <p>{card?.address || 'Address unavailable'}</p>
        </div>
        {card?.recommendation ? <span className='assistant-recommendation-pill'>{card.recommendation}</span> : null}
      </div>

      <div className='assistant-card-stat-grid'>
        <div>
          <span>Fuel</span>
          <strong>{card?.fuelType === 'DIESEL' ? 'Diesel' : 'Petrol'}</strong>
        </div>
        <div>
          <span>Wait</span>
          <strong>{Number(card?.estimatedWaitMinutes || 0)} min</strong>
        </div>
        <div>
          <span>Queue</span>
          <strong>{Number(card?.activeQueueCount || 0)} cars</strong>
        </div>
        <div>
          <span>Distance</span>
          <strong>{Number.isFinite(Number(card?.distanceKm)) ? `${Number(card.distanceKm).toFixed(1)} km` : 'N/A'}</strong>
        </div>
      </div>

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
