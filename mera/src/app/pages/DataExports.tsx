import { Download, FileSpreadsheet, FileText, TableProperties } from 'lucide-react'
import { Button } from '../components/ui/button'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

export function DataExports() {
  const { data } = usePortal()

  const exportRows = [
    {
      dataset: 'National availability snapshot',
      source: `${normalizeRows(data.heatmap).length} live station records`,
      format: 'CSV',
      freshness: 'Live',
      updatedAt: new Date().toISOString(),
    },
    {
      dataset: 'District shortage summary',
      source: `${normalizeRows(data.districtShortages).length} district summaries`,
      format: 'CSV',
      freshness: 'Live',
      updatedAt: new Date().toISOString(),
    },
    {
      dataset: 'Complaint case ledger',
      source: `${normalizeRows(data.complaints?.items).length} complaint records`,
      format: 'XLSX',
      freshness: 'Rolling',
      updatedAt: new Date().toISOString(),
    },
    {
      dataset: 'Compliance flag register',
      source: `${normalizeRows(data.flags?.items).length} regulatory flags`,
      format: 'CSV',
      freshness: 'Rolling',
      updatedAt: new Date().toISOString(),
    },
    {
      dataset: 'Audit activity log',
      source: `${normalizeRows(data.auditLogs?.items).length} audit events`,
      format: 'CSV',
      freshness: 'Rolling',
      updatedAt: new Date().toISOString(),
    },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Export Catalogue" subtitle="Structured data outputs prepared from current MERA operational datasets">
          <PortalTable
            rows={exportRows}
            columns={[
              { key: 'dataset', label: 'Dataset' },
              { key: 'source', label: 'Source Coverage' },
              { key: 'format', label: 'Format', render: (row) => renderPill(row.format) },
              { key: 'freshness', label: 'Freshness', render: (row) => renderPill(row.freshness) },
              { key: 'updatedAt', label: 'Updated', render: (row) => normalizeDate(row.updatedAt) },
              {
                key: 'action',
                label: 'Action',
                render: () => (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
                    <Download className="size-3.5" />
                    Export
                  </span>
                ),
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Export Guidance" subtitle="Common package types for regulator workflows and downstream analysis">
          <div className="space-y-3 px-5 py-5">
            {[
              {
                title: 'CSV extracts',
                body: 'Best for district-level reconciliation, import into other systems, and bulk verification routines.',
                icon: TableProperties,
              },
              {
                title: 'Spreadsheet packs',
                body: 'Useful for officer review, annotations, and committee-style distribution.',
                icon: FileSpreadsheet,
              },
              {
                title: 'Narrative reports',
                body: 'Best for briefing notes, executive updates, and formally shared oversight documents.',
                icon: FileText,
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <item.icon className="mt-0.5 size-4 text-blue-700" />
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{item.body}</div>
                  </div>
                </div>
              </div>
            ))}

            <Button type="button" size="sm" variant="outline" className="mt-1 w-full justify-center">
              <Download className="size-4" />
              Prepare Export Bundle
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
