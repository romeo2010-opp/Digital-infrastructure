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
  accent = '#111827',
  onClick,
}: {
  label: string
  value: ReactNode
  helper?: ReactNode
  delta?: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  accent?: string
  onClick?: () => void
}) {
  const toneClass =
    tone === 'good'
      ? 'bg-[#ecfdf5] text-[#059669]'
      : tone === 'warn'
        ? 'bg-[#fffbeb] text-[#d97706]'
        : tone === 'bad'
          ? 'bg-[#fef2f2] text-[#dc2626]'
          : 'bg-[#f3f4f6] text-[#6b7280]'

  const content = (
    <>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-bold uppercase tracking-[0.09em] text-[#9ca3af]">{label}</div>
          <div className="mt-2 truncate text-[24px] font-bold leading-none text-[#111827]">{renderDrilldownValue(value)}</div>
        </div>
        {onClick ? <ArrowRight className="mt-1 size-4 shrink-0 text-[#cbd5e0] transition group-hover:text-[#111827]" /> : null}
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        {delta ? <span className={`rounded-[3px] px-2 py-1 text-[11px] font-bold leading-none ${toneClass}`}>{renderDrilldownValue(delta)}</span> : null}
        {helper ? <span className="min-w-0 truncate text-[11px] font-medium text-[#9ca3af]">{renderDrilldownValue(helper)}</span> : null}
      </div>
    </>
  )

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="group relative min-h-[112px] overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-[#cbd5e0] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#111827]/15"
    >
      {content}
    </button>
  ) : (
    <article className="relative min-h-[112px] overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white px-4 py-3 text-left">
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

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="w-[760px] max-w-[98vw] border-[#e2e8f0] bg-white text-[#111827] sm:max-w-[760px]">
        <DrawerHeader className="border-b border-[#f1f5f9] p-5">
          <DrawerTitle className="text-[17px] text-[#111827]">{drilldown?.title || 'KPI detail'}</DrawerTitle>
          <DrawerDescription className="text-[#6b7280]">{drilldown?.subtitle || 'Records represented by this metric.'}</DrawerDescription>
          <div className="pt-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#9ca3af]">Metric value</div>
            <div className="mt-1 text-[28px] font-bold leading-none text-[#111827]">{renderDrilldownValue(drilldown?.value)}</div>
          </div>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {drilldown?.note ? (
            <div className="mb-4 rounded-[6px] border border-[#e2e8f0] bg-[#f9fafb] px-3 py-2 text-[12px] leading-5 text-[#4b5563]">
              {drilldown.note}
            </div>
          ) : null}
          {rows.length && columns.length ? (
            <div className="overflow-x-auto rounded-[6px] border border-[#e2e8f0]">
              <table className="w-full min-w-[460px] text-[12px]">
                <thead>
                  <tr className="border-b border-[#f1f5f9] bg-[#f9fafb] text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">
                    {columns.map((column) => (
                      <th key={column.key} className={`px-3 py-2 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={row.id || row.publicId || row.public_id || row.taskNumber || rowIndex} className="border-b border-[#f9fafb] last:border-b-0">
                      {columns.map((column) => (
                        <td key={column.key} className={`px-3 py-2 text-[#374151] ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                          {renderDrilldownValue(column.render ? column.render(row, rowIndex) : row?.[column.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-[6px] border border-dashed border-[#cbd5e0] bg-[#f9fafb] px-4 py-8 text-center text-[13px] font-semibold text-[#6b7280]">
              No records are currently represented by this KPI.
            </div>
          )}
        </div>
        {drilldown?.onAction ? (
          <div className="border-t border-[#f1f5f9] p-5">
            <button type="button" onClick={drilldown.onAction} className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-[#111827] px-3 text-[12px] font-semibold text-white hover:bg-[#1f2937]">
              {drilldown.actionLabel || 'Open records'}
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}
