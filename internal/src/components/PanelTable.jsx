export function Panel({ title, subtitle, actions = null, children }) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

function renderCellValue(value) {
  if (value === null || value === undefined || value === "") return "-"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === null || item === undefined) return null
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return String(item)
        }
        return JSON.stringify(item)
      })
      .filter(Boolean)
      .join(", ") || "-"
  }
  if (typeof value === "object") {
    if (Array.isArray(value?.d) && typeof value?.s === "number" && typeof value?.e === "number") {
      const digits = value.d.map((part) => String(part)).join("")
      if (!digits) return "-"
      const exponent = Number(value.e || 0)
      const sign = Number(value.s || 1) < 0 ? "-" : ""
      const decimalIndex = exponent + 1

      let normalized
      if (decimalIndex <= 0) {
        normalized = `0.${"0".repeat(Math.abs(decimalIndex))}${digits}`
      } else if (decimalIndex >= digits.length) {
        normalized = `${digits}${"0".repeat(decimalIndex - digits.length)}`
      } else {
        normalized = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`
      }

      const asNumber = Number(`${sign}${normalized}`)
      if (Number.isFinite(asNumber)) {
        return asNumber.toLocaleString(undefined, { maximumFractionDigits: 6 })
      }
      return `${sign}${normalized}`
    }

    if (typeof value?.toString === "function" && value.toString !== Object.prototype.toString) {
      const text = value.toString()
      if (text && text !== "[object Object]") return text
    }

    if (typeof value?.value === "number" || typeof value?.value === "string") {
      const numeric = Number(value.value)
      if (Number.isFinite(numeric)) return numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })
      return String(value.value)
    }

    if (typeof value?.amount === "number" || typeof value?.amount === "string") {
      const numeric = Number(value.amount)
      if (Number.isFinite(numeric)) return numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })
      return String(value.amount)
    }

    return "-"
  }
  return String(value)
}

export function DataTable({
  columns,
  rows,
  emptyLabel = "No data available.",
  minWidth = null,
  compact = false,
  onRowClick = null,
  getRowClassName = null,
}) {
  return (
    <div className={`table-wrap ${compact ? "table-wrap--compact" : ""}`}>
      <table className={`data-table ${compact ? "data-table--compact" : ""}`} style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows?.length ? (
            rows.map((row, index) => {
              const interactive = typeof onRowClick === "function"
              const rowClassName = typeof getRowClassName === "function" ? getRowClassName(row) : ""

              return (
                <tr
                  key={row.public_id || row.publicId || row.id || index}
                  className={[rowClassName, interactive ? "data-table__row--interactive" : ""].filter(Boolean).join(" ")}
                  onClick={interactive ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    interactive
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                  tabIndex={interactive ? 0 : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.render ? column.render(row) : renderCellValue(row[column.key])}
                    </td>
                  ))}
                </tr>
              )
            })
          ) : (
            <tr>
              <td colSpan={columns.length} className="empty-cell">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
