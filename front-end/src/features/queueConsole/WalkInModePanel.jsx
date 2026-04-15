import { useState } from "react"

export default function WalkInModePanel({ mode, hybridRatio, onSetPriorityMode }) {
  const [ratioDraft, setRatioDraft] = useState(String(hybridRatio || 1))

  return (
    <section className="qc-panel">
      <h3>Walk-in Controls</h3>
      <div className="qc-radio-row">
        <label>
          <input
            type="radio"
            checked={mode === "OFF"}
            onChange={() => onSetPriorityMode("OFF", hybridRatio)}
          />
          Priority OFF
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "ON"}
            onChange={() => onSetPriorityMode("ON", hybridRatio)}
          />
          Priority ON
        </label>
        <label>
          <input
            type="radio"
            checked={mode === "HYBRID"}
            onChange={() => onSetPriorityMode("HYBRID", Number(ratioDraft) || hybridRatio)}
          />
          HYBRID
        </label>
      </div>

      {mode === "HYBRID" ? (
        <div className="qc-hybrid-input">
          <label>
            Ratio (Queue : Walk-in)
            <input
              type="number"
              min="1"
              value={ratioDraft}
              onChange={(event) => setRatioDraft(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => onSetPriorityMode("HYBRID", Number(ratioDraft) || 1)}
          >
            Apply Ratio
          </button>
        </div>
      ) : null}
    </section>
  )
}
