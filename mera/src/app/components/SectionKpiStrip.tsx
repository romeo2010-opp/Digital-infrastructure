import { useMemo, useState, type ReactNode } from 'react'
import { KpiDrilldownCard, KpiDrilldownDrawer, renderDrilldownValue, type DrilldownColumn, type DrilldownConfig } from './KpiDrilldown'

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
  const safeItems = useMemo(() => items || [], [items])

  return (
    <>
      <div className={`grid gap-3 md:grid-cols-2 xl:grid-cols-4 ${className}`}>
        {safeItems.map((item) => {
          const rows = item.rows || []
          return (
            <KpiDrilldownCard
              key={item.label}
              label={item.label}
              value={item.value}
              helper={item.helper || 'records'}
              delta={item.delta ?? `${rows.length} rows`}
              tone={item.tone || 'neutral'}
              accent={item.accent || '#111827'}
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
