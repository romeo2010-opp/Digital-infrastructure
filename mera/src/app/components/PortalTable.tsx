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
    <Table className="text-xs">
      <TableHeader className="bg-slate-50">
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={`h-9 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${column.className || ''}`}>
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
              className={onRowClick ? 'cursor-pointer hover:bg-blue-50/50' : ''}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <TableCell key={column.key} className="px-3 py-2 text-slate-700">
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
  )
}
