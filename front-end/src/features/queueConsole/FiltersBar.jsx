const statuses = ["All", "Waiting", "Called", "Ready on site", "Assigned", "Fueling", "Late", "No-show", "Served", "Cancelled"]

export default function FiltersBar({ statusFilter, onStatusChange, searchText, onSearchChange }) {
  return (
    <section className="qc-panel qc-filters">
      <h3>Filters</h3>
      <label>
        Status
        <select value={statusFilter} onChange={(event) => onStatusChange(event.target.value)}>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label>
        Search
        <input
          value={searchText}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Plate / Queue ID"
        />
      </label>
    </section>
  )
}
