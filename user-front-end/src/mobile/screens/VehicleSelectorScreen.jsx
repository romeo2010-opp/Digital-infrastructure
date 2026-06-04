import { useEffect, useState } from 'react'
import { BackIcon, CarIcon, FuelPumpIcon } from '../icons'
import { vehiclesApi } from '../api/vehiclesApi'
import { displayEnum } from '../vehicleCatalog'

export function VehicleSelectorScreen({ onBack, onSelectVehicle }) {
  const [vehicles, setVehicles] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    vehiclesApi
      .list()
      .then((payload) => {
        if (cancelled) return
        const items = Array.isArray(payload) ? payload : []
        setVehicles(items)
        setSelectedId(items.find((item) => item.isDefault)?.id || items[0]?.id || '')
      })
      .catch((err) => setError(err?.message || 'Unable to load vehicles.'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className='vehicles-screen'>
      <header className='screen-header vehicle-screen-header'>
        <button type='button' className='icon-back' onClick={onBack} aria-label='Back'>
          <BackIcon size={18} />
        </button>
        <div>
          <h2>Which vehicle?</h2>
          <p>Vehicle selection is optional during the pilot.</p>
        </div>
      </header>

      {loading ? <article className='station-card vehicle-empty-card'><p>Loading vehicles...</p></article> : null}
      {error ? <p className='details-inline-error'>{error}</p> : null}

      {!loading && !vehicles.length ? (
        <article className='station-card vehicle-empty-card'>
          <FuelPumpIcon size={22} />
          <h3>Pilot mode active</h3>
          <p>Vehicle profiles are paused for now. Continue by choosing a station and entering your queue identifier.</p>
        </article>
      ) : null}

      <div className='vehicle-list'>
        {vehicles.map((vehicle) => (
          <button
            key={vehicle.id}
            type='button'
            className={`vehicle-select-card ${selectedId === vehicle.id ? 'is-selected' : ''}`}
            onClick={() => setSelectedId(vehicle.id)}
          >
            <span className='vehicle-list-icon'><CarIcon size={18} /></span>
            <span>
              <strong>{vehicle.make} {vehicle.model}</strong>
              <small>{vehicle.numberPlate} · {displayEnum(vehicle.fuelType)} · Tank: {displayEnum(vehicle.tankSide)}</small>
            </span>
            {vehicle.isDefault ? <em>Default</em> : null}
          </button>
        ))}
      </div>

      {vehicles.length ? (
        <footer className='vehicle-wizard-actions'>
          <button
            type='button'
            className='details-action-button is-primary'
            disabled={!selectedId}
            onClick={() => onSelectVehicle?.(vehicles.find((item) => item.id === selectedId))}
          >
            Use Vehicle
          </button>
        </footer>
      ) : null}
    </section>
  )
}
