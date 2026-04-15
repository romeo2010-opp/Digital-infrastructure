import { shiftUtcISODate, utcTodayISO } from "../../../utils/dateTime"

export default function ReportsHeaderBar({ filters, pumps, onChange }) {
  const today = utcTodayISO()
  const uniquePumps = Array.from(
    new Map((pumps || []).map((pump) => [pump.pumpPublicId || pump.pumpId, pump])).values()
  )

  function changeField(field, value) {
    if (field === "preset") {
      if (value === "TODAY") {
        onChange({ ...filters, preset: value, fromDate: today, toDate: today })
        return
      }
      if (value === "YESTERDAY") {
        const yesterday = shiftUtcISODate(today, -1)
        onChange({ ...filters, preset: value, fromDate: yesterday, toDate: yesterday })
        return
      }
      if (value === "LAST_7_DAYS") {
        const from = shiftUtcISODate(today, -6)
        onChange({ ...filters, preset: value, fromDate: from, toDate: today })
        return
      }
      onChange({ ...filters, preset: value })
      return
    }

    if ((field === "fromDate" || field === "toDate") && value > today) {
      onChange({ ...filters, [field]: today, preset: "CUSTOM" })
      return
    }
    onChange({ ...filters, [field]: value, preset: "CUSTOM" })
  }

  return (
    <section className="reports-panel reports-header">
      <div className="reports-header-title">
        <h2>Station Manager Reports</h2>
        <p>Generate operational and financial snapshots for SmartLink stations.</p>
      </div>

      <div className="reports-filter-grid">
        <label>
          Date Preset
          <select value={filters.preset} onChange={(event) => changeField("preset", event.target.value)}>
            <option value="TODAY">Today</option>
            <option value="YESTERDAY">Yesterday</option>
            <option value="LAST_7_DAYS">Last 7 Days</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.fromDate}
            max={today}
            onChange={(event) => changeField("fromDate", event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.toDate}
            max={today}
            onChange={(event) => changeField("toDate", event.target.value)}
          />
        </label>
        <label>
          Shift
          <select value={filters.shift} onChange={(event) => changeField("shift", event.target.value)}>
            <option value="ALL">All</option>
            <option value="MORNING">Morning</option>
            <option value="AFTERNOON">Afternoon</option>
            <option value="NIGHT">Night</option>
          </select>
        </label>
        <label>
          Fuel Type
          <select value={filters.fuelType} onChange={(event) => changeField("fuelType", event.target.value)}>
            <option value="ALL">All</option>
            <option value="PETROL">Petrol</option>
            <option value="DIESEL">Diesel</option>
          </select>
        </label>
        <label>
          Pump
          <select value={filters.pumpId} onChange={(event) => changeField("pumpId", event.target.value)}>
            <option value="ALL">All pumps</option>
            {uniquePumps.map((pump) => (
              <option key={pump.pumpPublicId || pump.pumpId} value={pump.pumpPublicId || pump.pumpId}>
                Pump {pump.pumpId}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
