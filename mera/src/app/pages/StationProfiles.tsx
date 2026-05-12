import { useMemo, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { Search } from 'lucide-react'
import { Input } from '../components/ui/input'
import { SectionCard } from '../components/SectionCard'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

export function StationProfiles() {
  const { data, selectedProfile, selectedProfileEnforcement, openProfile } = usePortal()
  const [search, setSearch] = useState('')

  const stations = useMemo(
    () =>
      normalizeRows(data.profiles).filter((station: any) =>
        JSON.stringify(station).toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [data.profiles, search],
  )

  const renderList = (items: any[], render: (item: any, index: number) => React.ReactNode) => {
    if (!items.length) {
      return <div className="px-4 py-6 text-xs text-slate-500">No records available.</div>
    }
    return <div className="divide-y divide-slate-200">{items.map(render)}</div>
  }

  return (
    <div className="flex h-full overflow-hidden bg-white">
      <aside className="w-72 border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-slate-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search station..." />
          </div>
        </div>
        <div className="overflow-y-auto p-2">
          {stations.map((station: any) => {
            const active = selectedProfile?.station?.public_id === station.public_id
            return (
              <button
                key={station.public_id}
                type="button"
                onClick={() => openProfile(station.public_id)}
                className={`mb-1 w-full rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                  active ? 'border-slate-200 bg-slate-50 text-slate-900' : 'border-transparent bg-white text-slate-700 hover:border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="font-medium">{station.name}</div>
                <div className="mt-1 text-slate-500">{station.city || 'No district'}</div>
                <div className="mt-2 flex gap-2">
                  {renderPill(station.license_status || 'UNLICENSED')}
                  {renderPill(`${station.open_flags || 0} OPEN FLAGS`)}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto bg-white p-4">
        {selectedProfile ? (
          <>
            <SectionCard title="Station Dossier" subtitle="Licensing, complaints, inspections, declarations, and enforcement history">
              <div className="grid gap-4 px-4 py-3 text-xs md:grid-cols-4">
                <div>
                  <div className="uppercase tracking-[0.08em] text-slate-500">Station</div>
                  <div className="mt-1 font-medium text-slate-900">{selectedProfile.station?.name}</div>
                </div>
                <div>
                  <div className="uppercase tracking-[0.08em] text-slate-500">District</div>
                  <div className="mt-1 text-slate-700">{selectedProfile.station?.city || '-'}</div>
                </div>
                <div>
                  <div className="uppercase tracking-[0.08em] text-slate-500">Address</div>
                  <div className="mt-1 text-slate-700">{selectedProfile.station?.address || '-'}</div>
                </div>
                <div>
                  <div className="uppercase tracking-[0.08em] text-slate-500">Open Enforcement Cases</div>
                  <div className="mt-1 text-slate-700">{normalizeRows(selectedProfileEnforcement?.items).length}</div>
                </div>
              </div>
            </SectionCard>

            <Tabs.Root defaultValue="license" className="mt-4 rounded-xl border border-slate-200 bg-white">
              <Tabs.List className="flex flex-wrap gap-2 border-b border-slate-200 px-4 py-3">
                {['license', 'complaints', 'inspections', 'deliveries', 'declarations', 'enforcement', 'risk'].map((tab) => (
                  <Tabs.Trigger
                    key={tab}
                    value={tab}
                    className="rounded-md border border-transparent px-3 py-1 text-xs font-medium capitalize text-slate-600 data-[state=active]:border-slate-200 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900"
                  >
                    {tab === 'risk' ? 'Risk Score History' : tab}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              <Tabs.Content value="license">
                {renderList(normalizeRows(selectedProfile.licenses), (item: any) => (
                  <div key={`${item.id}-${item.license_number}`} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-5">
                    <div className="font-medium text-slate-900">{item.license_number}</div>
                    <div>{normalizeDate(item.issue_date)}</div>
                    <div>{normalizeDate(item.expiry_date)}</div>
                    <div>{renderPill(item.license_status)}</div>
                    <div className="text-slate-600">{item.compliance_conditions || 'No conditions logged.'}</div>
                  </div>
                ))}
              </Tabs.Content>

              <Tabs.Content value="complaints">
                {renderList(normalizeRows(selectedProfile.complaints), (item: any, index: number) => (
                  <div key={`${item.created_at}-${index}`} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-4">
                    <div>{renderPill(item.complaint_type)}</div>
                    <div>{renderPill(item.complaint_status)}</div>
                    <div>{normalizeDate(item.created_at)}</div>
                    <div className="text-slate-600">Case reference: CMP-{String(index + 1).padStart(4, '0')}</div>
                  </div>
                ))}
              </Tabs.Content>

              <Tabs.Content value="inspections">
                {renderList(normalizeRows(selectedProfile.inspections), (item: any) => (
                  <div key={item.public_id} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-5">
                    <div className="font-medium text-slate-900">{item.public_id}</div>
                    <div>{renderPill(item.inspection_type)}</div>
                    <div>{renderPill(item.inspection_status)}</div>
                    <div>{item.officer_name}</div>
                    <div>{normalizeDate(item.created_at)}</div>
                  </div>
                ))}
              </Tabs.Content>

              <Tabs.Content value="deliveries">
                {renderList(normalizeRows(selectedProfile.deliveries), (item: any, index: number) => (
                  <div key={`${item.id}-${index}`} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-5">
                    <div className="font-medium text-slate-900">DLV-{item.id}</div>
                    <div>{renderPill(item.fuel_type)}</div>
                    <div>{item.estimated_volume ? `${item.estimated_volume} L` : '-'}</div>
                    <div>{item.reported_by || '-'}</div>
                    <div>{normalizeDate(item.delivery_time)}</div>
                  </div>
                ))}
              </Tabs.Content>

              <Tabs.Content value="declarations">
                {renderList(normalizeRows(selectedProfile.declarations), (item: any, index: number) => (
                  <div key={`${item.id}-${index}`} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-5">
                    <div className="font-medium text-slate-900">SAR-{item.id}</div>
                    <div>{renderPill(item.petrol_available ? 'PETROL AVAILABLE' : 'PETROL DRY')}</div>
                    <div>{renderPill(item.diesel_available ? 'DIESEL AVAILABLE' : 'DIESEL DRY')}</div>
                    <div>Pumps active: {item.active_pumps ?? '-'}</div>
                    <div>{normalizeDate(item.created_at)}</div>
                  </div>
                ))}
              </Tabs.Content>

              <Tabs.Content value="enforcement">
                {renderList(normalizeRows(selectedProfileEnforcement?.items), (item: any) => (
                  <div key={item.public_id} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-5">
                    <div className="font-medium text-slate-900">{item.public_id}</div>
                    <div>{renderPill(item.action_type)}</div>
                    <div>{renderPill(item.action_status)}</div>
                    <div>{item.actor_name || '-'}</div>
                    <div>{normalizeDate(item.issued_at)}</div>
                  </div>
                ))}
              </Tabs.Content>

              <Tabs.Content value="risk">
                {renderList(normalizeRows(selectedProfile.riskHistory), (item: any) => (
                  <div key={`${item.id}-${item.last_calculated_at}`} className="grid gap-3 px-4 py-3 text-xs md:grid-cols-4">
                    <div className="font-medium text-slate-900">Score {item.risk_score}</div>
                    <div>{renderPill(item.escalation_status)}</div>
                    <div>{normalizeDate(item.last_calculated_at)}</div>
                    <div className="text-slate-600">{item.generated_factors_json || 'No factor JSON recorded.'}</div>
                  </div>
                ))}
              </Tabs.Content>
            </Tabs.Root>
          </>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
            Select a station from the directory to open its regulatory dossier.
          </div>
        )}
      </div>
    </div>
  )
}
