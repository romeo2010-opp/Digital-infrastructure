function bookingStatusLabel(value) {
  return String(value || '').trim().replace(/_/g, ' ').toLowerCase().replace(/^\w/, (char) => char.toUpperCase())
}

function formatDateTime(value) {
  if (!value) return 'Not available'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Not available'
  return parsed.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AssistantActiveBookingCard({ card }) {
  const isQueue = String(card?.bookingType || '').trim().toLowerCase() === 'queue'

  return (
    <article className='assistant-card assistant-card--booking'>
      <div className='assistant-card-header'>
        <div>
          <h4>{card?.station?.name || 'SmartLink booking'}</h4>
          <p>{isQueue ? 'Active queue' : 'Active reservation'}</p>
        </div>
        <span className='assistant-distance-pill'>
          {bookingStatusLabel(card?.queueStatus || card?.reservationStatus || 'Active')}
        </span>
      </div>

      {isQueue ? (
        <div className='assistant-card-stat-grid'>
          <div>
            <span>Fuel</span>
            <strong>{card?.fuelType === 'DIESEL' ? 'Diesel' : 'Petrol'}</strong>
          </div>
          <div>
            <span>Position</span>
            <strong>{card?.position ? `#${card.position}` : '-'}</strong>
          </div>
          <div>
            <span>Cars ahead</span>
            <strong>{Number(card?.carsAhead || 0)}</strong>
          </div>
          <div>
            <span>ETA</span>
            <strong>{Number(card?.etaMinutes || 0)} min</strong>
          </div>
        </div>
      ) : (
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
            <span>Identifier</span>
            <strong>{card?.identifier || '-'}</strong>
          </div>
          <div>
            <span>Slot</span>
            <strong>{formatDateTime(card?.slotStart)}</strong>
          </div>
        </div>
      )}
    </article>
  )
}
