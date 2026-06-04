import { useMemo, useState } from "react"
import { InternalKpiDrilldownCard, InternalKpiDrilldownDrawer } from "./InternalKpiDrilldown"

export default function MetricGrid({ items }) {
  const [activeKey, setActiveKey] = useState("")
  const [showAll, setShowAll] = useState(false)
  const safeItems = Array.isArray(items) ? items : []
  const compactLimit = 6
  const hasOverflow = safeItems.length > compactLimit
  const visibleItems = hasOverflow && !showAll ? safeItems.slice(0, compactLimit) : safeItems
  const activeItem = useMemo(
    () => safeItems.find((item) => String(item?.modalKey || item?.label || "") === activeKey) || null,
    [activeKey, safeItems],
  )
  const activeDrilldown = useMemo(() => {
    if (!activeItem?.drilldown) return null
    return {
      title: activeItem.drilldown.title || activeItem.label || "KPI detail",
      subtitle: activeItem.drilldown.subtitle || "Records represented by this metric.",
      value: activeItem.drilldown.value ?? activeItem.value,
      note: activeItem.drilldown.note,
      rows: activeItem.drilldown.rows,
      columns: activeItem.drilldown.columns,
      content: activeItem.drilldown.content,
      renderContent: activeItem.drilldown.renderContent,
      actionLabel: activeItem.drilldown.actionLabel,
      onAction: activeItem.drilldown.onAction,
    }
  }, [activeItem])

  return (
    <>
      <div className={`metric-grid-shell ${hasOverflow ? "metric-grid-shell--overflow" : ""}`}>
        <div className="metric-grid">
          {visibleItems.map((item) => {
            const interactive = Boolean(item?.drilldown) || typeof item?.onClick === "function"
            const handleClick = () => {
              if (item?.drilldown) {
                setActiveKey(String(item.modalKey || item.label || ""))
                return
              }
              if (typeof item?.onClick === "function") item.onClick()
            }

            return (
              <InternalKpiDrilldownCard
                key={item.label}
                label={item.label}
                value={item.value}
                helper={item.helper ?? item.meta}
                delta={item.delta}
                tone={item.tone || "neutral"}
                accent={item.accent}
                onClick={interactive ? handleClick : undefined}
              />
            )
          })}
        </div>
        {hasOverflow ? (
          <button type="button" className="metric-grid-view-all" onClick={() => setShowAll((prev) => !prev)}>
            {showAll ? "Show less" : `View all ${safeItems.length}`}
          </button>
        ) : null}
      </div>
      <InternalKpiDrilldownDrawer open={Boolean(activeDrilldown)} onOpenChange={(open) => !open && setActiveKey("")} drilldown={activeDrilldown} />
    </>
  )
}
