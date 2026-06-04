import { useEffect, useMemo, useState } from 'react'
import { BackIcon, CarIcon, FuelPumpIcon } from '../icons'
import { vehiclesApi } from '../api/vehiclesApi'
import {
  FUEL_TYPES,
  VEHICLE_MAKES,
  VEHICLE_MODELS_BY_MAKE,
  VEHICLE_TYPES,
  VEHICLE_USAGE_TYPES,
  displayEnum,
  normalizePlate,
} from '../vehicleCatalog'
import { resolveVehicleVisual } from '../vehicleVisualMap'
import { VehicleMockup } from '../components/VehicleMockup'

const STEPS = ['Vehicle Type', 'Vehicle Details', 'Fuel Details', 'Tank Side', 'Review & Save']

const DEFAULT_FORM = {
  vehicleType: 'SEDAN',
  usageType: 'PRIVATE',
  make: '',
  model: '',
  year: '',
  numberPlate: '',
  nickname: '',
  fuelType: 'PETROL',
  tankCapacityLitres: '',
  isFullTank: false,
  tankSide: 'UNKNOWN',
  tankSideSource: 'USER_CONFIRMED',
  tankSideConfidence: 'LOW',
  isDefault: false,
}

function vehicleLabel(form) {
  return [form.make, form.model].filter(Boolean).join(' ') || displayEnum(form.vehicleType)
}

function toPayload(form, visual) {
  return {
    nickname: form.nickname || null,
    vehicleType: form.vehicleType,
    usageType: form.usageType || null,
    make: form.make,
    model: form.model,
    year: form.year ? Number(form.year) : null,
    numberPlate: normalizePlate(form.numberPlate),
    fuelType: form.fuelType,
    tankCapacityLitres: form.tankCapacityLitres ? Number(form.tankCapacityLitres) : null,
    isFullTank: Boolean(form.isFullTank),
    tankSide: form.tankSide,
    tankSideSource: form.tankSide === 'UNKNOWN' ? 'USER_CONFIRMED' : 'USER_CONFIRMED',
    tankSideConfidence: form.tankSide === 'UNKNOWN' ? 'LOW' : 'MEDIUM',
    visualMockupKey: visual.mockupKey,
    isDefault: Boolean(form.isDefault),
  }
}

export function VehicleWizardScreen({ vehicleId = '', onBack, onSaved }) {
  const isEditing = Boolean(vehicleId)
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEditing) return
    let cancelled = false
    setLoading(true)
    vehiclesApi
      .get(vehicleId)
      .then((vehicle) => {
        if (cancelled) return
        setForm({
          vehicleType: vehicle.vehicleType || 'OTHER',
          usageType: vehicle.usageType || 'PRIVATE',
          make: vehicle.make || '',
          model: vehicle.model || '',
          year: vehicle.year || '',
          numberPlate: vehicle.numberPlate || '',
          nickname: vehicle.nickname || '',
          fuelType: vehicle.fuelType || 'PETROL',
          tankCapacityLitres: vehicle.tankCapacityLitres || '',
          isFullTank: Boolean(vehicle.isFullTank),
          tankSide: vehicle.tankSide || 'UNKNOWN',
          tankSideSource: vehicle.tankSideSource || 'USER_CONFIRMED',
          tankSideConfidence: vehicle.tankSideConfidence || 'LOW',
          isDefault: Boolean(vehicle.isDefault),
        })
      })
      .catch((err) => setError(err?.message || 'Unable to load vehicle.'))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isEditing, vehicleId])

  const visual = useMemo(() => resolveVehicleVisual(form), [form])
  const modelOptions = VEHICLE_MODELS_BY_MAKE[form.make] || ['Other']

  const update = (patch) => {
    setForm((current) => ({ ...current, ...patch }))
    setError('')
  }

  const validateStep = () => {
    if (step === 1) {
      if (!form.make.trim() || !form.model.trim()) return 'Make and model are required.'
      if (!normalizePlate(form.numberPlate)) return 'Number plate is required.'
    }
    if (step === 2 && !FUEL_TYPES.includes(form.fuelType)) return 'Choose a supported fuel type.'
    return ''
  }

  const goNext = () => {
    const validation = validateStep()
    if (validation) {
      setError(validation)
      return
    }
    setStep((current) => Math.min(STEPS.length - 1, current + 1))
  }

  const save = async () => {
    const validation = validateStep()
    if (validation) {
      setError(validation)
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = toPayload(form, visual)
      const vehicle = isEditing
        ? await vehiclesApi.update(vehicleId, payload)
        : await vehiclesApi.create(payload)
      onSaved?.(vehicle)
    } catch (err) {
      setError(err?.message || 'Unable to save vehicle.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <section className='vehicles-screen'>
        <article className='station-card vehicle-empty-card'>
          <p>Loading vehicle...</p>
        </article>
      </section>
    )
  }

  return (
    <section className='vehicles-screen vehicle-wizard-screen'>
      <header className='screen-header vehicle-screen-header'>
        <button type='button' className='icon-back' onClick={onBack} aria-label='Back'>
          <BackIcon size={18} />
        </button>
        <div>
          <h2>{isEditing ? 'Edit Vehicle' : 'Add Vehicle'}</h2>
          <p>{STEPS[step]}</p>
        </div>
      </header>

      <div className='vehicle-step-bars' aria-label='Vehicle profile progress'>
        {STEPS.map((label, index) => (
          <span key={label} className={index <= step ? 'is-active' : ''} />
        ))}
      </div>

      {step === 0 ? (
        <section className='vehicle-step-panel'>
          <div className='vehicle-option-grid'>
            {VEHICLE_TYPES.map((type) => (
              <button
                key={type}
                type='button'
                className={`vehicle-choice ${form.vehicleType === type ? 'is-selected' : ''}`}
                onClick={() => update({ vehicleType: type })}
              >
                <CarIcon size={18} />
                {displayEnum(type)}
              </button>
            ))}
          </div>
          <label className='queue-modal-input'>
            <span>Vehicle usage</span>
            <select value={form.usageType} onChange={(event) => update({ usageType: event.target.value })}>
              {VEHICLE_USAGE_TYPES.map((type) => (
                <option key={type} value={type}>{displayEnum(type)}</option>
              ))}
            </select>
          </label>
        </section>
      ) : null}

      {step === 1 ? (
        <section className='vehicle-step-panel'>
          <label className='queue-modal-input'>
            <span>Make</span>
            <input
              list='vehicle-makes'
              value={form.make}
              onChange={(event) => update({ make: event.target.value, model: '' })}
              placeholder='Search make'
            />
            <datalist id='vehicle-makes'>
              {VEHICLE_MAKES.map((make) => <option key={make} value={make} />)}
            </datalist>
          </label>
          <label className='queue-modal-input'>
            <span>Model</span>
            <input
              list='vehicle-models'
              value={form.model}
              onChange={(event) => update({ model: event.target.value })}
              placeholder='Search model'
            />
            <datalist id='vehicle-models'>
              {modelOptions.map((model) => <option key={model} value={model} />)}
            </datalist>
          </label>
          <div className='vehicle-two-col'>
            <label className='queue-modal-input'>
              <span>Year</span>
              <input inputMode='numeric' value={form.year} onChange={(event) => update({ year: event.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </label>
            <label className='queue-modal-input'>
              <span>Number plate</span>
              <input value={form.numberPlate} maxLength={32} onChange={(event) => update({ numberPlate: normalizePlate(event.target.value) })} />
            </label>
          </div>
          <label className='queue-modal-input'>
            <span>Nickname</span>
            <input value={form.nickname} maxLength={120} onChange={(event) => update({ nickname: event.target.value })} />
          </label>
        </section>
      ) : null}

      {step === 2 ? (
        <section className='vehicle-step-panel'>
          <div className='vehicle-option-grid is-two'>
            {FUEL_TYPES.map((type) => (
              <button
                key={type}
                type='button'
                className={`vehicle-choice ${form.fuelType === type ? 'is-selected' : ''}`}
                onClick={() => update({ fuelType: type })}
              >
                <FuelPumpIcon size={18} />
                {displayEnum(type)}
              </button>
            ))}
          </div>
          <label className='queue-modal-input'>
            <span>Tank capacity litres</span>
            <input inputMode='decimal' value={form.tankCapacityLitres} onChange={(event) => update({ tankCapacityLitres: event.target.value })} placeholder='Optional' />
          </label>
          <label className='vehicle-toggle-row'>
            <input type='checkbox' checked={form.isFullTank} onChange={(event) => update({ isFullTank: event.target.checked })} />
            <span>Usually fill the tank</span>
          </label>
        </section>
      ) : null}

      {step === 3 ? (
        <section className='vehicle-step-panel'>
          <p className='vehicle-helper-copy'>Check your dashboard fuel icon. The small arrow usually points to the fuel cap side.</p>
          <div className='vehicle-tank-options'>
            {[
              ['DRIVER_SIDE', 'Fuel cap on driver side'],
              ['PASSENGER_SIDE', 'Fuel cap on passenger side'],
              ['UNKNOWN', 'Not sure'],
            ].map(([side, label]) => (
              <button
                key={side}
                type='button'
                className={`vehicle-tank-card ${form.tankSide === side ? 'is-selected' : ''}`}
                onClick={() => update({ tankSide: side })}
              >
                <VehicleMockup {...form} optionSide={side} selected={form.tankSide === side} />
                <strong>{label}</strong>
                {side === 'UNKNOWN' ? (
                  <small>SmartLink may use a flexible/manual pump until confirmed.</small>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className='vehicle-step-panel'>
          <article className='vehicle-review-card'>
            <VehicleMockup {...form} optionSide={form.tankSide} compact />
            <h3>{vehicleLabel(form)}</h3>
            <dl>
              <div><dt>Type</dt><dd>{displayEnum(form.vehicleType)}</dd></div>
              <div><dt>Usage</dt><dd>{displayEnum(form.usageType)}</dd></div>
              <div><dt>Plate</dt><dd>{normalizePlate(form.numberPlate)}</dd></div>
              <div><dt>Fuel</dt><dd>{displayEnum(form.fuelType)}</dd></div>
              <div><dt>Capacity</dt><dd>{form.tankCapacityLitres ? `${form.tankCapacityLitres}L` : 'Not set'}</dd></div>
              <div><dt>Tank side</dt><dd>{displayEnum(form.tankSide)}</dd></div>
              <div><dt>Source</dt><dd>User confirmed</dd></div>
              <div><dt>Confidence</dt><dd>{form.tankSide === 'UNKNOWN' ? 'Low' : 'Medium'}</dd></div>
              <div><dt>Full tank</dt><dd>{form.isFullTank ? 'Yes' : 'No'}</dd></div>
            </dl>
            <label className='vehicle-toggle-row'>
              <input type='checkbox' checked={form.isDefault} onChange={(event) => update({ isDefault: event.target.checked })} />
              <span>Set as default vehicle</span>
            </label>
          </article>
        </section>
      ) : null}

      {error ? <p className='details-inline-error'>{error}</p> : null}

      <footer className='vehicle-wizard-actions'>
        <button type='button' className='details-action-button is-secondary' onClick={() => (step === 0 ? onBack?.() : setStep((current) => current - 1))} disabled={saving}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button type='button' className='details-action-button is-primary' onClick={goNext}>
            Continue
          </button>
        ) : (
          <button type='button' className='details-action-button is-primary' onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save Vehicle'}
          </button>
        )}
      </footer>
    </section>
  )
}
