import React from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

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
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Table className="text-sm">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={`sticky top-0 z-20 h-11 border-b border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-4 text-xs font-medium text-[var(--mera-panel-text-muted)] shadow-[0_1px_0_0_var(--mera-panel-border)] ${column.className || ''}`}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row, index) => (
              <TableRow
                key={row.id || row.publicId || row.public_id || row.licenseNumber || row.logRef || row.recordId || row.caseId || index}
                className={onRowClick ? 'cursor-pointer hover:bg-[var(--mera-panel-muted)]' : ''}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <TableCell key={column.key} className="px-4 py-3 text-[var(--mera-panel-text-soft)]">
                    {column.render ? column.render(row, index) : String(row?.[column.key] ?? '-')}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="px-3 py-8 text-center text-sm text-[var(--mera-panel-text-muted)]">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
