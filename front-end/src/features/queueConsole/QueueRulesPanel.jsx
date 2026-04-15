import { useEffect, useState } from "react"

export default function QueueRulesPanel({ settings, onUpdateSettings, onPauseJoins, onResumeJoins }) {
  const [draft, setDraft] = useState(settings)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  function setField(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }))
  }

  function setFuelType(field, value) {
    setDraft((prev) => ({
      ...prev,
      fuelTypes: { ...prev.fuelTypes, [field]: value },
    }))
  }

  return (
    <section className="qc-panel">
      <h3>Queue Rules</h3>
      <div className="qc-rules-grid">
        <label>
          Grace Period (minutes)
          <input
            type="number"
            min="1"
            value={draft.graceMinutes}
            onChange={(event) => setField("graceMinutes", Number(event.target.value))}
          />
        </label>

        <label>
          Capacity
          <input
            type="number"
            min="1"
            value={draft.capacity}
            onChange={(event) => setField("capacity", Number(event.target.value))}
          />
        </label>

        <div className="qc-fuel-switches">
          <label>
            <input
              type="checkbox"
              checked={Boolean(draft.fuelTypes?.petrol)}
              onChange={(event) => setFuelType("petrol", event.target.checked)}
            />
            Petrol enabled
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(draft.fuelTypes?.diesel)}
              onChange={(event) => setFuelType("diesel", event.target.checked)}
            />
            Diesel enabled
          </label>
        </div>
      </div>

      <div className="qc-panel-actions">
        <button type="button" onClick={() => onUpdateSettings(draft)}>Save Rules</button>
        {settings.joinsPaused ? (
          <button type="button" onClick={onResumeJoins}>Resume Joins</button>
        ) : (
          <button type="button" onClick={onPauseJoins}>Pause Joins</button>
        )}
      </div>
    </section>
  )
}
