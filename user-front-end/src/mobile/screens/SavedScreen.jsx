import { ChevronRightIcon, FuelPumpIcon } from '../icons'

export function SavedScreen({ stations, onSelectStation }) {
  const savedStations = Array.isArray(stations) ? stations : []

  return (
    <section>
      <header className='screen-header'>
        <h2>Saved</h2>
        <p>{savedStations.length} saved stations</p>
      </header>

      {savedStations.length ? (
        <section className='station-card saved-list'>
          {savedStations.map((station) => (
            <button key={station.id} type='button' className='saved-row' onClick={() => onSelectStation(station.id)}>
              <span className='saved-row-left'>
                <span className='saved-row-icon'>
                  <FuelPumpIcon size={14} />
                </span>
                <span className='saved-row-main'>
                  <strong>{station.name}</strong>
                  <em>{station.address}</em>
                </span>
              </span>

              <span className='saved-row-right'>
                <small>{station.distanceKm.toFixed(1)} km</small>
                <ChevronRightIcon size={16} />
              </span>
            </button>
          ))}
        </section>
      ) : (
        <section className='station-card coming-soon'>
          <h3>No saved stations yet</h3>
          <p>Use the bookmark button on a station to keep it here.</p>
        </section>
      )}
    </section>
  )
}
