import { useEffect, useMemo, useState } from 'react'
import { Download, Plus, RefreshCcw, Search } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { FieldShell, ToolbarField } from '../components/FieldLabel'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-[#e2e8f0] bg-white px-3 text-[12px] font-medium text-[#6b7280]'

export function PriceCompliance() {
  const { token, api, runAction, data, requestPackets, packetStatus, packetErrors } = usePortal()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ fuelType: 'PETROL', pricePerLitre: '', effectiveDate: new Date().toISOString().slice(0, 10), status: 'active' })

  const packet = data.priceCompliance || {}
  const official = packet.official || { items: [] }
  const compliance = packet.compliance || { items: [] }
  const violations = packet.violations || { items: [] }
  const loading = packetStatus.priceCompliance === 'loading' && data.priceCompliance === undefined
  const refreshing = packetStatus.priceCompliance === 'loading'
  const error = packetErrors.priceCompliance || ''

  const load = () => {
    if (!token) return
    requestPackets(['priceCompliance'], { reason: 'price-compliance-refresh', force: true })
  }

  useEffect(() => {
    if (!token || data.priceCompliance !== undefined) return
    load()
  }, [data.priceCompliance, token])

  const rows = useMemo(() => normalizeRows(compliance.items).filter((row: any) => matchesSearch(row, search)), [compliance, search])
  const violationRows = normalizeRows(violations.items)
  const compliantRows = rows.filter((row: any) => String(row.status || '').toLowerCase() === 'compliant')
  const mismatchRows = rows.filter((row: any) => Math.abs(Number(row.mismatchAmount || 0)) > 0 && String(row.mismatchDirection || 'NONE') !== 'NONE')
  const columns = [
    { key: 'stationName', label: 'Station' },
    { key: 'district', label: 'District' },
    { key: 'fuelType', label: 'Fuel' },
    { key: 'officialPrice', label: 'Official', render: (row: any) => row.officialPrice ? `MK ${Number(row.officialPrice).toLocaleString()}` : '-' },
    { key: 'stationReportedPrice', label: 'Reported', render: (row: any) => row.stationReportedPrice ? `MK ${Number(row.stationReportedPrice).toLocaleString()}` : '-' },
    {
      key: 'mismatchAmount',
      label: 'Mismatch',
      render: (row: any) => {
        const amount = Number(row.mismatchAmount || 0)
        const direction = row.mismatchDirection === 'BELOW_OFFICIAL' ? 'below' : row.mismatchDirection === 'ABOVE_OFFICIAL' ? 'above' : 'clear'
        return amount ? `${amount > 0 ? '+' : ''}MK ${amount.toLocaleString()} ${direction}` : 'Clear'
      },
    },
    { key: 'severity', label: 'Severity', render: (row: any) => row.activeFlagSeverity || row.severity ? renderPill(row.activeFlagSeverity || row.severity) : '-' },
    { key: 'activeFlagPublicId', label: 'Flag', render: (row: any) => row.activeFlagPublicId || '-' },
    { key: 'status', label: 'Status', render: (row: any) => renderPill(row.status) },
  ]

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#f9fafb] p-4 text-[#111827]">
      <SectionKpiStrip
        columns={columns}
        items={[
          { label: 'Official Prices', value: normalizeRows(official.items).length, rows: normalizeRows(official.items), accent: '#185FA5' },
          { label: 'Compliant Records', value: compliantRows.length, rows: compliantRows, tone: 'good', accent: '#1D9E75' },
          { label: 'Price Mismatches', value: mismatchRows.length, rows: mismatchRows, tone: mismatchRows.length ? 'warn' : 'good', accent: '#EF9F27' },
          { label: 'Violations', value: violationRows.length, rows: violationRows, tone: violationRows.length ? 'bad' : 'good', accent: '#E24B4A' },
        ]}
      />

      <Toolbar>
        <Button type="button" size="sm" className="bg-[#111827] hover:bg-[#111827]" onClick={() => setModalOpen(true)}>
          <Plus className="size-4" />
          Official Price
        </Button>
        <ToolbarField label="Search prices" hint="Filter price compliance rows by station, district, product, status, or mismatch evidence. Example: search diesel or Blantyre." className="min-w-[260px] flex-1">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-[#6b7280]" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter station, district, or fuel..." />
        </div>
        </ToolbarField>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={refreshing}>
          <RefreshCcw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => runAction(() => api.generateReport(token, { type: 'Price Compliance Report', filters: { search } }), 'Generating price compliance report...', { refresh: false })}
        >
          <Download className="size-4" />
          Report
        </Button>
      </Toolbar>

      {error ? <div className="rounded-md border border-[#e2e8f0] bg-[#fef2f2] px-3 py-2 text-sm text-[#dc2626]">{error}</div> : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <SectionCard title="Station Price Compliance" subtitle="Official MERA price comparison against station reported pump prices">
          <PortalTable rows={rows} columns={columns} emptyMessage={loading ? 'Loading price compliance...' : 'No price compliance records available.'} />
        </SectionCard>

        <SectionCard title="Official Fuel Prices" subtitle="Effective MERA price schedule and history">
          <PortalTable
            rows={normalizeRows(official.items)}
            columns={[
              { key: 'fuel_type', label: 'Fuel Type' },
              { key: 'price_per_litre', label: 'Price', render: (row: any) => `MK ${Number(row.price_per_litre || 0).toLocaleString()}` },
              { key: 'effective_date', label: 'Effective', render: (row: any) => normalizeDate(row.effective_date) },
              { key: 'status', label: 'Status', render: (row: any) => renderPill(row.status) },
            ]}
          />
        </SectionCard>
      </div>

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Official Fuel Price"
        description="Create a MERA official price record used by compliance monitoring."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-[#111827] hover:bg-[#111827]"
              onClick={async () => {
                await runAction(() => api.createOfficialPrice(token, form), 'Saving official price...', { refresh: false })
                setModalOpen(false)
                load()
              }}
            >
              Save Price
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <FieldShell label="Fuel type" hint="Select the product this official MERA price applies to. Example: Petrol for the national petrol pump price.">
            <select className={`${fieldClass} w-full`} value={form.fuelType} onChange={(event) => setForm({ ...form, fuelType: event.target.value })}>
              <option value="PETROL">Petrol</option>
              <option value="DIESEL">Diesel</option>
              <option value="PARAFFIN">Paraffin</option>
            </select>
          </FieldShell>
          <FieldShell label="Price per litre" hint="Enter the official pump price per litre in MWK. Example: 2530.00.">
            <Input value={form.pricePerLitre} onChange={(event) => setForm({ ...form, pricePerLitre: event.target.value })} placeholder="Price per litre" />
          </FieldShell>
          <FieldShell label="Effective date" hint="Set when this price becomes valid for compliance checks. Example: the MERA gazette effective date.">
            <input type="date" className={`${fieldClass} w-full`} value={form.effectiveDate} onChange={(event) => setForm({ ...form, effectiveDate: event.target.value })} />
          </FieldShell>
          <FieldShell label="Status" hint="Use Active for the current price and Superseded for historical prices no longer enforced.">
            <select className={`${fieldClass} w-full`} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="active">Active</option>
              <option value="superseded">Superseded</option>
            </select>
          </FieldShell>
        </div>
      </ModalShell>
    </div>
  )
}
