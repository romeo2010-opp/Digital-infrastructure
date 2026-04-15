import { useEffect, useMemo, useState } from "react"
import { DataTable } from "./PanelTable"

function MetricDrilldownModal({ item, onClose }) {
  const drilldown = item?.drilldown || {}
  const rows = Array.isArray(drilldown.rows) ? drilldown.rows : []
  const title = drilldown.title || item?.label || "KPI Detail"
  const subtitle = drilldown.subtitle || "Related records for this KPI."
  const emptyLabel = drilldown.emptyLabel || "No related data available."

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  const countLabel = drilldown.countLabel || (rows.length ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : "")

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="internal-modal internal-modal--table" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <div className="internal-modal-header-actions">
            {countLabel ? <span className="internal-modal-count">{countLabel}</span> : null}
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--table">
          {typeof drilldown.renderContent === "function"
            ? drilldown.renderContent({ item, rows })
            : drilldown.content || (
              <DataTable
                columns={drilldown.columns || [{ key: "value", label: item?.label || "Value" }]}
                rows={rows}
                emptyLabel={emptyLabel}
                compact={Boolean(drilldown.compact)}
                minWidth={drilldown.minWidth || null}
                onRowClick={typeof drilldown.onRowClick === "function" ? drilldown.onRowClick : null}
                getRowClassName={typeof drilldown.getRowClassName === "function" ? drilldown.getRowClassName : null}
              />
            )}
        </div>
      </div>
    </div>
  )
}

export default function MetricGrid({ items }) {
  const [activeKey, setActiveKey] = useState("")
  const safeItems = Array.isArray(items) ? items : []
  const activeItem = useMemo(
    () => safeItems.find((item) => String(item?.modalKey || item?.label || "") === activeKey) || null,
    [activeKey, safeItems]
  )

  return (
    <>
      <div className="metric-grid">
        {safeItems.map((item) => {
          const interactive = Boolean(item?.drilldown) || typeof item?.onClick === "function"
          const className = `metric-card metric-card--${item.tone || "neutral"} ${interactive ? "metric-card--interactive" : ""}`.trim()
          const handleClick = () => {
            if (item?.drilldown) {
              setActiveKey(String(item.modalKey || item.label || ""))
              return
            }
            if (typeof item?.onClick === "function") {
              item.onClick()
            }
          }

          const content = (
            <>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.meta ? <small>{item.meta}</small> : null}
            </>
          )

          if (interactive) {
            return (
              <button key={item.label} type="button" className={className} onClick={handleClick}>
                {content}
              </button>
            )
          }

          return (
            <article key={item.label} className={className}>
              {content}
            </article>
          )
        })}
      </div>
      {activeItem?.drilldown ? <MetricDrilldownModal item={activeItem} onClose={() => setActiveKey("")} /> : null}
    </>
  )
}
