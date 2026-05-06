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
                className={`sticky top-0 z-20 h-11 border-b border-slate-200 bg-white px-4 text-xs font-medium text-slate-500 shadow-[0_1px_0_0_rgba(226,232,240,0.9)] ${column.className || ''}`}
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
                className={onRowClick ? 'cursor-pointer hover:bg-slate-50/80' : ''}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <TableCell key={column.key} className="px-4 py-3 text-slate-700">
                    {column.render ? column.render(row, index) : String(row?.[column.key] ?? '-')}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="px-3 py-8 text-center text-sm text-slate-500">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
