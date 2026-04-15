function actionToneClass(tone) {
  const normalized = String(tone || 'secondary').trim().toLowerCase()
  if (normalized === 'primary') return 'assistant-action-button--primary'
  if (normalized === 'danger') return 'assistant-action-button--danger'
  return 'assistant-action-button--secondary'
}

export function AssistantReservationSlotCard({ card, onAction }) {
  const actions = Array.isArray(card?.actions) ? card.actions : []

  return (
    <article className='assistant-card assistant-card--reservation-slot'>
      <div className='assistant-card-header'>
        <div>
          <h4>{card?.stationName || 'Reservation slot'}</h4>
          <p>{card?.slotDateLabel || 'Selected day'}</p>
        </div>
        <span className='assistant-distance-pill'>{card?.slotLabel || 'Time slot'}</span>
      </div>

      <div className='assistant-card-stat-grid'>
        <div>
          <span>Fuel</span>
          <strong>{card?.fuelType === 'DIESEL' ? 'Diesel' : 'Petrol'}</strong>
        </div>
        <div>
          <span>Litres</span>
          <strong>{Number(card?.litres || 0)} L</strong>
        </div>
        <div>
          <span>Open spots</span>
          <strong>{Number(card?.availableSpots || 0)}</strong>
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
