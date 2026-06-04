import { isValidElement } from "react"
import { ArrowRight } from "lucide-react"
import { formatCodeLabel } from "../utils/display"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer"

export function accentForInternalKpiTone(tone = "neutral") {
  if (tone === "good" || tone === "success") return "var(--internal-success)"
  if (tone === "warn" || tone === "warning") return "var(--internal-warning)"
  if (tone === "bad" || tone === "danger") return "var(--internal-danger)"
  if (tone === "accent") return "var(--internal-info)"
  return "var(--internal-text-soft)"
}

export function normalizeInternalTone(tone = "neutral") {
  if (tone === "success") return "good"
  if (tone === "warning") return "warn"
  if (tone === "danger") return "bad"
  return tone || "neutral"
}

export function renderDrilldownValue(value) {
  if (value === null || value === undefined || value === "") return "-"
  if (isValidElement(value)) return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "-" : value.toLocaleString()
  if (typeof value === "string") return formatCodeLabel(value)
  if (typeof value === "number") return value
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.length ? value.map(renderDrilldownValue).join(", ") : "-"
  if (typeof value === "object") {
    const preferred = ["name", "fullName", "full_name", "title", "label", "publicId", "public_id", "id"]
      .map((key) => value?.[key])
      .find((item) => item !== undefined && item !== null && item !== "")
    if (preferred !== undefined) return renderDrilldownValue(preferred)
    try {
      return JSON.stringify(value)
    } catch {
      return "-"
    }
  }
  return String(value)
}

export function InternalKpiDrilldownCard({
  label,
  value,
  helper,
  delta,
  tone = "neutral",
  accent,
  onClick,
}) {
  const normalizedTone = normalizeInternalTone(tone)
  const topAccent = accent || accentForInternalKpiTone(normalizedTone)

  const content = (
    <>
      <div className="internal-kpi-card__accent" style={{ background: topAccent }} />
      <div className="internal-kpi-card__head">
        <div className="internal-kpi-card__copy">
          <div className="internal-kpi-card__label">{label}</div>
          <div className="internal-kpi-card__value">{renderDrilldownValue(value)}</div>
        </div>
        {onClick ? <ArrowRight className="internal-kpi-card__arrow" aria-hidden="true" /> : null}
      </div>
      <div className="internal-kpi-card__meta">
        {delta ? <span className={`internal-kpi-card__delta internal-kpi-card__delta--${normalizedTone}`}>{renderDrilldownValue(delta)}</span> : null}
        {helper ? <span className="internal-kpi-card__helper">{renderDrilldownValue(helper)}</span> : null}
      </div>
    </>
  )

  return onClick ? (
    <button type="button" onClick={onClick} className="internal-kpi-card internal-kpi-card--interactive">
      {content}
    </button>
  ) : (
    <article className="internal-kpi-card">{content}</article>
  )
}

export function InternalKpiDrilldownDrawer({ open, onOpenChange, drilldown }) {
  const rows = drilldown?.rows || []
  const columns = drilldown?.columns || []
  const hasSummaryValue = drilldown?.value !== undefined && drilldown?.value !== null && drilldown?.value !== ""

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="internal-kpi-drawer">
        <DrawerHeader>
          <DrawerTitle>{drilldown?.title || "KPI detail"}</DrawerTitle>
          <DrawerDescription>{drilldown?.subtitle || "Records represented by this metric."}</DrawerDescription>
          <div className="internal-drawer-metric">
            <div>Metric value</div>
            <strong>{renderDrilldownValue(drilldown?.value)}</strong>
          </div>
        </DrawerHeader>
        <div className="internal-drawer-body">
          {drilldown?.note ? <div className="internal-drawer-note">{drilldown.note}</div> : null}
          {typeof drilldown?.renderContent === "function" ? (
            drilldown.renderContent({ rows, item: drilldown })
          ) : drilldown?.content ? (
            drilldown.content
          ) : rows.length && columns.length ? (
            <div className="internal-drawer-table-wrap">
              <table className="internal-drawer-table">
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column.key} className={column.align === "right" ? "is-right" : ""}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={row.id || row.publicId || row.public_id || row.taskNumber || rowIndex}>
                      {columns.map((column) => (
                        <td key={column.key} className={column.align === "right" ? "is-right" : ""}>
                          {renderDrilldownValue(column.render ? column.render(row, rowIndex) : row?.[column.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : hasSummaryValue ? (
            <div className="internal-drawer-empty">
              <div>Summary</div>
              <strong>{renderDrilldownValue(drilldown?.value)}</strong>
              <p>This KPI has a computed value, but the current packet did not include individual source rows for this view.</p>
            </div>
          ) : (
            <div className="internal-drawer-empty">No records are currently represented by this KPI.</div>
          )}
        </div>
        {drilldown?.onAction ? (
          <div className="internal-drawer-footer">
            <button type="button" onClick={drilldown.onAction} className="internal-primary-button">
              {drilldown.actionLabel || "Open records"}
              <ArrowRight className="size-3-5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}
