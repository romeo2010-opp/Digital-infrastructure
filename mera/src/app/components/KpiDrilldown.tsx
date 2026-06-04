import { isValidElement, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from './ui/drawer'

export type DrilldownColumn = {
  key: string
  label: string
  render?: (row: any, index: number) => ReactNode
  align?: 'left' | 'right'
}

export type DrilldownConfig = {
  title: string
  value: ReactNode
  subtitle?: string
  note?: string
  rows?: any[]
  columns?: DrilldownColumn[]
  actionLabel?: string
  onAction?: () => void
}

type KpiTone = 'neutral' | 'good' | 'warn' | 'bad'

export function accentForKpiTone(tone: KpiTone = 'neutral') {
  if (tone === 'good') return 'var(--mera-success)'
  if (tone === 'warn') return 'var(--mera-warning)'
  if (tone === 'bad') return 'var(--mera-danger)'
  return 'var(--mera-panel-text-soft)'
}

export function renderDrilldownValue(value: any): ReactNode {
  if (value === null || value === undefined || value === '') return '-'
  if (isValidElement(value)) return value
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '-' : value.toLocaleString()
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map(renderDrilldownValue).join(', ') : '-'
  if (typeof value === 'object') {
    const preferred = ['name', 'fullName', 'full_name', 'title', 'label', 'publicId', 'public_id', 'id']
      .map((key) => value?.[key])
      .find((item) => item !== undefined && item !== null && item !== '')
    if (preferred !== undefined) return renderDrilldownValue(preferred)
    try {
      return JSON.stringify(value)
    } catch {
      return '-'
    }
  }
  return String(value)
}

export function KpiDrilldownCard({
  label,
  value,
  helper,
  delta,
  tone = 'neutral',
  accent,
  onClick,
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
  delta?: ReactNode
  tone?: KpiTone
  accent?: string
  onClick?: () => void
}) {
  const topAccent = accent || accentForKpiTone(tone)
  const toneClass =
    tone === 'good'
      ? 'bg-[color-mix(in_srgb,var(--mera-success)_12%,var(--mera-panel))] text-[var(--mera-success)]'
      : tone === 'warn'
        ? 'bg-[color-mix(in_srgb,var(--mera-warning)_13%,var(--mera-panel))] text-[var(--mera-warning)]'
        : tone === 'bad'
          ? 'bg-[color-mix(in_srgb,var(--mera-danger)_12%,var(--mera-panel))] text-[var(--mera-danger)]'
          : 'bg-[var(--mera-control-muted)] text-[var(--mera-panel-text-muted)]'

  const content = (
    <>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: topAccent }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--mera-panel-text-muted)]">{label}</div>
          <div className="mt-2 truncate text-[24px] font-bold leading-none text-[var(--mera-panel-text)]">{renderDrilldownValue(value)}</div>
        </div>
        {onClick ? <ArrowRight className="mt-1 size-4 shrink-0 text-[var(--mera-panel-border-strong)] transition group-hover:text-[var(--mera-panel-text)]" /> : null}
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        {delta ? <span className={`rounded-[3px] px-2 py-1 text-[11px] font-bold leading-none ${toneClass}`}>{renderDrilldownValue(delta)}</span> : null}
        {helper ? <span className="min-w-0 truncate text-[11px] font-medium text-[var(--mera-panel-text-muted)]">{renderDrilldownValue(helper)}</span> : null}
      </div>
    </>
  )

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="group relative min-h-[112px] overflow-hidden rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-[var(--mera-panel-border-strong)] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--mera-panel-text)]/15"
    >
      {content}
    </button>
  ) : (
    <article className="relative min-h-[112px] overflow-hidden rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-4 py-3 text-left">
      {content}
    </article>
  )
}

export function KpiDrilldownDrawer({
  open,
  onOpenChange,
  drilldown,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  drilldown: DrilldownConfig | null
}) {
  const rows = drilldown?.rows || []
  const columns = drilldown?.columns || []
  const hasSummaryValue = drilldown?.value !== undefined && drilldown?.value !== null && drilldown?.value !== ''

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="w-[760px] max-w-[98vw] border-[var(--mera-panel-border)] bg-[var(--mera-panel)] text-[var(--mera-panel-text)] sm:max-w-[760px]">
        <DrawerHeader className="border-b border-[var(--mera-panel-border-soft)] p-5">
          <DrawerTitle className="text-[17px] text-[var(--mera-panel-text)]">{drilldown?.title || 'KPI detail'}</DrawerTitle>
          <DrawerDescription className="text-[var(--mera-panel-text-muted)]">{drilldown?.subtitle || 'Records represented by this metric.'}</DrawerDescription>
          <div className="pt-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--mera-panel-text-muted)]">Metric value</div>
            <div className="mt-1 text-[28px] font-bold leading-none text-[var(--mera-panel-text)]">{renderDrilldownValue(drilldown?.value)}</div>
          </div>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {drilldown?.note ? (
            <div className="mb-4 rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel-muted)] px-3 py-2 text-[12px] leading-5 text-[var(--mera-panel-text-soft)]">
              {drilldown.note}
            </div>
          ) : null}
          {rows.length && columns.length ? (
            <div className="overflow-x-auto rounded-[6px] border border-[var(--mera-panel-border)]">
              <table className="w-full min-w-[460px] text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--mera-panel-border-soft)] bg-[var(--mera-panel-muted)] text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--mera-panel-text-muted)]">
                    {columns.map((column) => (
                      <th key={column.key} className={`px-3 py-2 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={row.id || row.publicId || row.public_id || row.taskNumber || rowIndex} className="border-b border-[var(--mera-panel-border-soft)] last:border-b-0">
                      {columns.map((column) => (
                        <td key={column.key} className={`px-3 py-2 text-[var(--mera-panel-text-soft)] ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                          {renderDrilldownValue(column.render ? column.render(row, rowIndex) : row?.[column.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : hasSummaryValue ? (
            <div className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel-muted)] px-4 py-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-[var(--mera-panel-text-muted)]">Summary</div>
              <div className="mt-2 text-[18px] font-bold text-[var(--mera-panel-text)]">{renderDrilldownValue(drilldown?.value)}</div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--mera-panel-text-muted)]">
                This KPI has a computed value, but the current packet did not include individual source rows for this view.
              </div>
            </div>
          ) : (
            <div className="rounded-[6px] border border-dashed border-[var(--mera-panel-border-strong)] bg-[var(--mera-panel-muted)] px-4 py-8 text-center text-[13px] font-semibold text-[var(--mera-panel-text-muted)]">
              No records are currently represented by this KPI.
            </div>
          )}
        </div>
        {drilldown?.onAction ? (
          <div className="border-t border-[var(--mera-panel-border-soft)] p-5">
            <button type="button" onClick={drilldown.onAction} className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-[var(--mera-button-bg)] px-3 text-[12px] font-semibold text-[var(--mera-button-text)] hover:opacity-90">
              {drilldown.actionLabel || 'Open records'}
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}
