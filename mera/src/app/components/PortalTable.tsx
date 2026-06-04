import React, { useEffect, useRef, useState } from 'react'
import { renderDrilldownValue } from './KpiDrilldown'

export function PortalTable({
  columns,
  rows,
  onRowClick,
  emptyMessage = 'No records available.',
}: {
  columns: Array<{ key: string; label: string; render?: (row: any, index: number) => React.ReactNode; className?: string }>
  rows: any[]
  onRowClick?: (row: any) => void
  emptyMessage?: string
}) {
  const topScrollRef = useRef<HTMLDivElement | null>(null)
  const bodyScrollRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  const [scrollWidth, setScrollWidth] = useState(0)
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false)

  useEffect(() => {
    const body = bodyScrollRef.current
    const table = tableRef.current
    if (!body || !table) return undefined

    const updateScrollMetrics = () => {
      const nextWidth = Math.max(table.scrollWidth, body.scrollWidth, body.clientWidth)
      setScrollWidth(nextWidth)
      setHasHorizontalOverflow(nextWidth > body.clientWidth + 1)
    }

    updateScrollMetrics()
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScrollMetrics) : null
    resizeObserver?.observe(body)
    resizeObserver?.observe(table)
    window.addEventListener('resize', updateScrollMetrics)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateScrollMetrics)
    }
  }, [columns, rows])

  const syncHorizontalScroll = (source: HTMLDivElement | null, target: HTMLDivElement | null) => {
    if (!source || !target) return
    if (Math.abs(target.scrollLeft - source.scrollLeft) > 1) {
      target.scrollLeft = source.scrollLeft
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-col overflow-hidden">
      <div
        ref={topScrollRef}
        className={`shrink-0 overflow-x-auto overflow-y-hidden border-b border-[var(--mera-panel-border)] bg-[var(--mera-panel-muted)] ${hasHorizontalOverflow ? 'h-3' : 'hidden'}`}
        onScroll={() => syncHorizontalScroll(topScrollRef.current, bodyScrollRef.current)}
        aria-hidden="true"
      >
        <div style={{ width: scrollWidth || '100%', height: 1 }} />
      </div>
      <div
        ref={bodyScrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
        style={{ maxHeight: 'clamp(280px, 48vh, 520px)' }}
        onScroll={() => syncHorizontalScroll(bodyScrollRef.current, topScrollRef.current)}
      >
        <table ref={tableRef} data-slot="table" className="w-full min-w-max caption-bottom text-sm">
          <thead data-slot="table-header" className="[&_tr]:border-b">
          <tr data-slot="table-row" className="border-b transition-colors">
            {columns.map((column) => (
              <th
                key={column.key}
                data-slot="table-head"
                className={`sticky top-0 z-20 h-11 whitespace-nowrap border-b border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-4 text-left align-middle text-xs font-semibold text-[var(--mera-panel-text-muted)] shadow-[0_1px_0_0_var(--mera-panel-border)] [[data-mera-density=compact]_&]:h-8 [[data-mera-density=compact]_&]:px-3 [[data-mera-density=compact]_&]:text-[11px] ${column.className || ''}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
          </thead>
        <tbody data-slot="table-body" className="[&_tr:last-child]:border-0">
          {rows.length ? (
            rows.map((row, index) => (
              <tr
                key={row.id || row.publicId || row.public_id || row.licenseNumber || row.logRef || row.recordId || row.caseId || index}
                data-slot="table-row"
                className={`border-b transition-colors ${onRowClick ? 'cursor-pointer hover:bg-[var(--mera-panel-muted)]' : ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} data-slot="table-cell" className="whitespace-nowrap px-4 py-3 align-middle text-[var(--mera-panel-text-soft)] [[data-mera-density=compact]_&]:px-3 [[data-mera-density=compact]_&]:py-2 [[data-mera-density=compact]_&]:text-[12px]">
                    {renderDrilldownValue(column.render ? column.render(row, index) : row?.[column.key])}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr data-slot="table-row" className="border-b transition-colors">
              <td colSpan={columns.length} data-slot="table-cell" className="whitespace-nowrap px-3 py-8 text-center align-middle text-sm text-[var(--mera-panel-text-muted)]">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
