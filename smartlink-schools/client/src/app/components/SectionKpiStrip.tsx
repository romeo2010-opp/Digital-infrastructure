import { useMemo, useState, type ReactNode } from 'react'
import { accentForKpiTone, KpiDrilldownCard, KpiDrilldownDrawer, renderDrilldownValue, type DrilldownColumn, type DrilldownConfig } from './KpiDrilldown'

export type SectionKpiItem = {
  label: string
  value: ReactNode
  helper?: ReactNode
  delta?: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  accent?: string
  rows?: any[]
  columns?: DrilldownColumn[]
  subtitle?: string
  note?: string
}

function humanizeKey(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function defaultColumns(rows: any[] = []): DrilldownColumn[] {
  const sample = rows.find((row) => row && typeof row === 'object') || {}
  const keys = Object.keys(sample)
    .filter((key) => !['id'].includes(key))
    .slice(0, 5)
  return keys.length
    ? keys.map((key) => ({
        key,
        label: humanizeKey(key),
        render: (row: any) => renderDrilldownValue(row?.[key]),
      }))
    : [{ key: 'record', label: 'Record', render: (row: any) => renderDrilldownValue(row) }]
}

function numericKpiValue(value: ReactNode) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null
  const parsed = Number(value.replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0])
  return Number.isFinite(parsed) ? parsed : null
}

function deriveKpiTone(item: SectionKpiItem): NonNullable<SectionKpiItem['tone']> {
  if (item.tone) return item.tone
  const value = numericKpiValue(item.value)
  const label = `${item.label} ${item.helper || ''} ${item.delta || ''}`.toLowerCase()
  const riskSignal = /(critical|violation|breach|overdue|expired|revoked|suspended|mismatch|anomal|risk|shortage|complaint|open|pending|flag)/.test(label)
  const positiveSignal = /(compliant|resolved|closed|active|complete|available|approved|uptime|healthy)/.test(label)

  if (value !== null && value <= 0 && riskSignal) return 'good'
  if (value !== null && value > 0 && /(critical|violation|breach|overdue|expired|revoked|suspended|mismatch|anomal)/.test(label)) return 'bad'
  if (value !== null && value > 0 && riskSignal) return 'warn'
  if (positiveSignal) return 'good'
  return 'neutral'
}

function fallbackRowsForItem(item: SectionKpiItem, rows: any[]) {
  if (rows.length) return rows
  const value = numericKpiValue(item.value)
  if (value === null || value <= 0) return rows
  return [{
    metric: item.label,
    value: renderDrilldownValue(item.value),
    status: renderDrilldownValue(item.delta || item.helper || 'Computed KPI'),
  }]
}

export function SectionKpiStrip({
  items,
  columns,
  className = '',
}: {
  items: SectionKpiItem[]
  columns?: DrilldownColumn[]
  className?: string
}) {
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null)
  const safeItems = useMemo(() => {
    const unique = new Map<string, SectionKpiItem>()
    for (const item of items || []) {
      const key = String(item?.label || '').trim().toLowerCase()
      if (key && !unique.has(key)) unique.set(key, item)
    }
    return [...unique.values()].slice(0, 4)
  }, [items])

  return (
    <>
      <div className={`grid gap-3 md:grid-cols-2 xl:grid-cols-4 ${className}`}>
        {safeItems.map((item) => {
          const sourceRows = item.rows || []
          const rows = fallbackRowsForItem(item, sourceRows)
          const tone = deriveKpiTone(item)
          return (
            <KpiDrilldownCard
              key={item.label}
              label={item.label}
              value={item.value}
              helper={item.helper || 'records'}
              delta={item.delta ?? `${sourceRows.length || rows.length} rows`}
              tone={tone}
              accent={item.accent || accentForKpiTone(tone)}
              onClick={() =>
                setDrilldown({
                  title: item.label,
                  value: item.value,
                  subtitle: item.subtitle || 'Records represented by this KPI.',
                  note: item.note,
                  rows,
                  columns: item.columns || columns || defaultColumns(rows),
                })
              }
            />
          )
        })}
      </div>
      <KpiDrilldownDrawer open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)} drilldown={drilldown} />
    </>
  )
}
