import { FuelPumpIcon } from '../icons'

export function StationsScreen({ stations, onSelectStation }) {
  const sortedStations = [...stations].sort((a, b) => Number(a.distanceKm || 0) - Number(b.distanceKm || 0))
  const selectedStation = sortedStations[0] || null
  const pin = selectedStation?.pin || { x: 54, y: 38 }

  return (
    <section className='stations-list-screen'>
      <div className='stations-list-map' aria-hidden='true'>
        <div className='stations-list-map-grid' />
        <div className='stations-list-map-road' />

        {selectedStation ? (
          <div
            className='stations-list-selected-wrap'
            style={{
              left: `${pin.x}%`,
              top: `${pin.y}%`,
            }}
          >
            <span className='stations-list-selected-chip'>{selectedStation.chipLabel || selectedStation.name}</span>
            <span className='stations-list-selected-pin'>
              <FuelPumpIcon size={14} />
            </span>
          </div>
        ) : null}
      </div>

      <article className='stations-list-sheet'>
        <h2>Near You Station</h2>

        <div className='stations-list-rows'>
          {sortedStations.map((station) => (
            <button
              key={station.id}
              type='button'
              className='stations-list-row'
              onClick={() => onSelectStation(station.id)}
            >
              <span className='stations-list-row-icon'>
                <FuelPumpIcon size={13} />
              </span>

              <span className='stations-list-row-main'>
                <strong>{station.name}</strong>
                <em>{station.distanceKm.toFixed(1)} km</em>
              </span>

              <span className='stations-list-row-hours'>{station.hoursLabel || 'Open 24h'}</span>
            </button>
          ))}
        </div>
      </article>
    </section>
  )
}
