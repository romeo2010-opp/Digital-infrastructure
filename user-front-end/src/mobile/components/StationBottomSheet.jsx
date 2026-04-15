import { useRef, useState } from 'react'
import { FuelPumpIcon } from '../icons'

function ratingStars(rating) {
  const filled = Math.round(Number(rating || 0))
  return new Array(5).fill('☆').map((star, index) => (index < filled ? '★' : star)).join(' ')
}

function stationToneClass(station) {
  if (station?.status === 'In Use') return 'tone-in-use'
  if (station?.fuelLevel === 'low') return 'tone-low'
  if (station?.fuelLevel === 'medium') return 'tone-medium'
  return 'tone-high'
}

function stationStateLabel(station) {
  if (station?.status === 'In Use') return 'In Use'
  if (station?.fuelLevel === 'low') return 'Low Fuel'
  if (station?.fuelLevel === 'medium') return 'Medium Fuel'
  return 'Available'
}

export function StationBottomSheet({
  station,
  stations,
  selectedStationId,
  onSelectStation,
  onView,
  routeMetricsByStationId,
}) {
  const [expanded, setExpanded] = useState(false)
  const touchStartYRef = useRef(0)
  const touchDeltaRef = useRef(0)

  if (!station) return null

  const selectedRouteMetrics = routeMetricsByStationId?.[station.id] || null
  const selectedDistanceKm = selectedRouteMetrics?.distanceKm ?? station.distanceKm
  const selectedEtaMin = selectedRouteMetrics?.etaMin ?? station.etaMin

  const onTouchStart = (event) => {
    touchStartYRef.current = event.touches[0].clientY
    touchDeltaRef.current = 0
  }

  const onTouchMove = (event) => {
    touchDeltaRef.current = event.touches[0].clientY - touchStartYRef.current
  }

  const onTouchEnd = () => {
    if (touchDeltaRef.current < -36) {
      setExpanded(true)
    } else if (touchDeltaRef.current > 36) {
      setExpanded(false)
    }
  }

  return (
    <article className={`map-bottom-sheet ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <div className='map-sheet-drag-zone' onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <button
          type='button'
          className='map-sheet-grabber'
          onClick={() => setExpanded((prev) => !prev)}
          aria-label={expanded ? 'Collapse stations list' : 'Expand stations list'}
        >
          <span />
        </button>

        <div className='map-sheet-top'>
          <div>
            <h3>{station.name}</h3>
            <p>{station.address}</p>
          </div>

          <button type='button' className='map-sheet-nav' onClick={() => onView(station.id)} aria-label='View station'>
            <span>➤</span>
          </button>
        </div>

        <div className='map-sheet-meta'>
          <span className={`status-pill map-sheet-status-pill ${stationToneClass(station)}`}>{stationStateLabel(station)}</span>
          <span className='map-rating-stars'>{ratingStars(station.rating)}</span>
          <span className='map-review-count'>({station.reviewsCount} reviews)</span>
        </div>

        <div className='map-sheet-meta muted'>
          <span className='map-distance'>{selectedDistanceKm.toFixed(1)} km</span>
          <span className='map-eta'>{selectedEtaMin} min</span>
        </div>

        <button type='button' className='primary-button map-sheet-cta' onClick={() => onView(station.id)}>
          View
        </button>
      </div>

      <div className={`map-sheet-list ${expanded ? 'is-open' : 'is-closed'}`} role='list' aria-hidden={!expanded}>
        {stations.map((item, index) => {
          const rowRouteMetrics = routeMetricsByStationId?.[item.id] || null
          const rowDistanceKm = rowRouteMetrics?.distanceKm ?? item.distanceKm
          const rowEtaMin = rowRouteMetrics?.etaMin ?? item.etaMin

          return (
            <button
              key={item.id}
              type='button'
              role='listitem'
              className={`map-sheet-list-item ${item.id === selectedStationId ? 'is-active' : ''}`}
              style={{ '--intro-delay': `${index * 55}ms` }}
              onClick={() => onSelectStation(item.id)}
              tabIndex={expanded ? 0 : -1}
            >
              <span className={`map-sheet-list-icon ${stationToneClass(item)}`}>
                <FuelPumpIcon size={14} />
              </span>
              <span className='map-sheet-list-main'>
                <strong>{item.name}</strong>
                <em>{item.address}</em>
              </span>
              <span className='map-sheet-list-side'>
                <b>{rowDistanceKm.toFixed(1)} km</b>
                <small>{rowEtaMin} min</small>
              </span>
            </button>
          )
        })}
      </div>
    </article>
  )
}
