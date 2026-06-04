import { useEffect, useState } from 'react'
import { BackIcon, CarIcon, FuelPumpIcon } from '../icons'
import { vehiclesApi } from '../api/vehiclesApi'
import { displayEnum } from '../vehicleCatalog'

function vehicleTitle(vehicle) {
  return [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || vehicle?.nickname || 'Vehicle'
}

export function VehiclesScreen({ onBack }) {
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const loadVehicles = () => {
    setLoading(true)
    setError('')
    vehiclesApi
      .list()
      .then((payload) => setVehicles(Array.isArray(payload) ? payload : []))
      .catch((err) => setError(err?.message || 'Unable to load vehicles.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadVehicles()
  }, [])

  const setDefault = async (vehicleId) => {
    setBusyId(vehicleId)
    setError('')
    try {
      await vehiclesApi.setDefault(vehicleId)
      loadVehicles()
    } catch (err) {
      setError(err?.message || 'Unable to set default vehicle.')
    } finally {
      setBusyId('')
    }
  }

  const archive = async (vehicleId) => {
    setBusyId(vehicleId)
    setError('')
    try {
      await vehiclesApi.archive(vehicleId)
      loadVehicles()
    } catch (err) {
      setError(err?.message || 'Unable to archive vehicle.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className='vehicles-screen'>
      <header className='screen-header vehicle-screen-header'>
        <button type='button' className='icon-back' onClick={onBack} aria-label='Back'>
          <BackIcon size={18} />
        </button>
        <div>
          <h2>Vehicles</h2>
          <p>Vehicle profiles are paused during the pilot.</p>
        </div>
      </header>

      {error ? <p className='details-inline-error'>{error}</p> : null}

      {loading ? (
        <article className='station-card vehicle-empty-card'>
          <p>Loading vehicles...</p>
        </article>
      ) : vehicles.length ? (
        <div className='vehicle-list'>
          {vehicles.map((vehicle) => (
            <article key={vehicle.id} className='vehicle-list-card'>
              <div className='vehicle-list-main'>
                <span className='vehicle-list-icon'>
                  <CarIcon size={18} />
                </span>
                <div>
                  <h3>{vehicle.nickname || vehicleTitle(vehicle)}</h3>
                  <p>{vehicleTitle(vehicle)} · {vehicle.numberPlate}</p>
                  <small>
                    {displayEnum(vehicle.fuelType)} · Tank: {displayEnum(vehicle.tankSide)}
                  </small>
                </div>
              </div>
              <div className='vehicle-list-badges'>
                {vehicle.isDefault ? <span>Default</span> : null}
                <span>{displayEnum(vehicle.vehicleType)}</span>
              </div>
              <div className='vehicle-list-actions'>
                {!vehicle.isDefault ? (
                  <button type='button' disabled={busyId === vehicle.id} onClick={() => setDefault(vehicle.id)}>
                    Set default
                  </button>
                ) : null}
                <button type='button' disabled={busyId === vehicle.id} onClick={() => archive(vehicle.id)}>
                  Archive
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <article className='station-card vehicle-empty-card'>
          <FuelPumpIcon size={22} />
          <h3>Pilot mode active</h3>
          <p>Vehicle setup is not required for the pilot. You can join a digital queue with a station, fuel type and identifier.</p>
        </article>
      )}
    </section>
  )
}
