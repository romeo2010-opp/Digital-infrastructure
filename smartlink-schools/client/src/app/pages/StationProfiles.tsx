import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Input } from '../components/ui/input'
import { ToolbarField } from '../components/FieldLabel'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'
import { KpiDrilldownCard, KpiDrilldownDrawer, type DrilldownConfig } from '../components/KpiDrilldown'
import { KpiSkeletonStrip, PanelSkeleton, TableSkeleton } from '../components/LiveDataSkeleton'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const stationColumns = [
  { key: 'name', label: 'Station' },
  { key: 'operator', label: 'Operator', render: (row: any) => row.operator_name || row.operatorName || row.owner || '-' },
  { key: 'city', label: 'District', render: (row: any) => row.city || '-' },
  { key: 'license_status', label: 'License', render: (row: any) => renderPill(row.license_status || 'UNLICENSED') },
  { key: 'open_flags', label: 'Open Flags', render: (row: any) => row.open_flags || 0 },
]

function licenseStatus(station: any) {
  return String(station.license_status || station.licenseStatus || 'UNLICENSED').toUpperCase()
}

export function StationProfiles() {
  const { data, selectedProfile, selectedProfileEnforcement, openProfile, hasPermission, packetStatus } = usePortal()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null)
  const canCreateTask = hasPermission(MERA_PERMISSIONS.TASKS_CREATE) || hasPermission(MERA_PERMISSIONS.TASKS_ASSIGN) || hasPermission(MERA_PERMISSIONS.TASKS_MANAGE)

  const allStations = useMemo(() => normalizeRows(data.profiles), [data.profiles])
  const stations = useMemo(
    () =>
      allStations.filter((station: any) => {
        if (status && licenseStatus(station) !== status) return false
        return JSON.stringify(station).toLowerCase().includes(search.trim().toLowerCase())
      }),
    [allStations, search, status],
  )
  const isInitialLoading = packetStatus.profiles === 'loading' && data.profiles === undefined
  const activeRows = stations.filter((station: any) => ['ACTIVE', 'VALID'].includes(licenseStatus(station)))
  const expiredRows = stations.filter((station: any) => ['EXPIRED', 'REVOKED', 'SUSPENDED', 'UNLICENSED'].includes(licenseStatus(station)))
  const renewalRows = stations.filter((station: any) => ['PENDING', 'PENDING_RENEWAL'].includes(licenseStatus(station)))
  const flaggedRows = stations.filter((station: any) => Number(station.open_flags || station.openFlags || 0) > 0)
  const linkedTasks = useMemo(() => {
    const stationPublicId = selectedProfile?.station?.public_id
    if (!stationPublicId) return []
    return [...normalizeRows(data.tasks?.items), ...normalizeRows(data.myTasks?.items)]
      .filter((task: any, index, array) => {
        const matchesStation = task.stationPublicId === stationPublicId || task.stationId === stationPublicId || (task.linkedEntityType === 'STATION' && task.linkedEntityId === stationPublicId)
        return matchesStation && array.findIndex((item: any) => item.taskNumber === task.taskNumber) === index
      })
      .slice(0, 20)
  }, [data.myTasks, data.tasks, selectedProfile?.station?.public_id])

  const createTask = () => {
    const station = selectedProfile?.station
    if (!station) return
    const params = new URLSearchParams({
      linkedEntityType: 'STATION',
      linkedEntityId: station.public_id || '',
      stationPublicId: station.public_id || '',
      stationName: station.name || '',
      district: station.city || '',
      type: 'STATION_INSPECTION',
      title: `Compliance task for ${station.name || 'station'}`,
      description: `Create a compliance follow-up task for ${station.name || 'this station'}.`,
    })
    navigate(`/tasks/new?${params.toString()}`)
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#f4f5f7] p-4 text-[#111827]">
      {isInitialLoading ? (
        <>
          <KpiSkeletonStrip count={4} />
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_340px]">
            <TableSkeleton rows={8} columns={5} />
            <PanelSkeleton />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <KpiDrilldownCard label="Registered Stations" value={stations.length.toLocaleString()} delta={`${stations.length} rows`} helper="current registry" accent="#7c3aed" onClick={() => setDrilldown({ title: 'Registered stations', value: stations.length.toLocaleString(), rows: stations, columns: stationColumns })} />
            <KpiDrilldownCard label="Active Licenses" value={activeRows.length.toLocaleString()} delta="active" helper="valid license status" tone="good" accent="#10b981" onClick={() => setDrilldown({ title: 'Active licenses', value: activeRows.length.toLocaleString(), rows: activeRows, columns: stationColumns })} />
            <KpiDrilldownCard label="Expired / Revoked" value={expiredRows.length.toLocaleString()} delta="review" helper="non-active status" tone={expiredRows.length ? 'bad' : 'good'} accent="#dc2626" onClick={() => setDrilldown({ title: 'Expired, revoked, suspended, or unlicensed', value: expiredRows.length.toLocaleString(), rows: expiredRows, columns: stationColumns })} />
            <KpiDrilldownCard label="Renewals Pending" value={renewalRows.length.toLocaleString()} delta={`${flaggedRows.length} flagged`} helper="pending queue" tone="warn" accent="#f59e0b" onClick={() => setDrilldown({ title: 'Renewals pending', value: renewalRows.length.toLocaleString(), rows: renewalRows, columns: stationColumns })} />
          </div>

          <div className="rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <ToolbarField label="Search stations" hint="Filter station profiles by station, operator, licence, district, or risk marker. Example: active licence or Mzuzu." className="min-w-[280px] flex-1">
              <div className="flex items-center gap-2">
                <Search className="size-4 text-[#9ca3af]" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stations, operators, licenses..." />
              </div>
              </ToolbarField>
              <ToolbarField label="Licence status" hint="Filter stations by licence status. Example: Expired, Suspended, or Pending Renewal.">
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-[5px] border border-[#e2e8f0] bg-white px-3 text-[12px] font-semibold text-[#374151]">
                <option value="">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="PENDING_RENEWAL">Pending Renewal</option>
                <option value="EXPIRED">Expired</option>
                <option value="REVOKED">Revoked</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="UNLICENSED">Unlicensed</option>
              </select>
              </ToolbarField>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1fr_360px]">
            <SectionCard title="Station Registry" subtitle={`${stations.length.toLocaleString()} stations`}>
              <PortalTable
                rows={stations}
                onRowClick={(station) => openProfile(station.public_id)}
                columns={[
                  { key: 'index', label: '#', render: (_row, index) => index + 1 },
                  ...stationColumns,
                ]}
              />
            </SectionCard>

            <SectionCard
              title={selectedProfile?.station?.name || 'Station Detail'}
              subtitle={selectedProfile?.station?.public_id || 'Select a station row to open its profile'}
              actions={canCreateTask && selectedProfile ? (
                <button type="button" onClick={createTask} className="inline-flex h-8 items-center gap-2 rounded-[4px] bg-[#111827] px-3 text-[11px] font-semibold text-white hover:bg-[#1f2937]">
                  <Plus className="size-3.5" />
                  Task
                </button>
              ) : null}
            >
              {selectedProfile ? (
                <div className="min-h-0 overflow-y-auto">
                  <div className="grid gap-3 border-b border-[#f1f5f9] px-4 py-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div><div className="text-[#9ca3af]">District</div><div className="mt-1 font-semibold text-[#111827]">{selectedProfile.station?.city || '-'}</div></div>
                      <div><div className="text-[#9ca3af]">Address</div><div className="mt-1 font-semibold text-[#111827]">{selectedProfile.station?.address || '-'}</div></div>
                      <div><div className="text-[#9ca3af]">Licenses</div><div className="mt-1 font-semibold text-[#111827]">{normalizeRows(selectedProfile.licenses).length}</div></div>
                      <div><div className="text-[#9ca3af]">Enforcement</div><div className="mt-1 font-semibold text-[#111827]">{normalizeRows(selectedProfileEnforcement?.items).length}</div></div>
                    </div>
                  </div>
                  <div className="border-b border-[#f1f5f9] px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Tank Status</div>
                    <div className="mt-2 grid gap-2">
                      {normalizeRows(selectedProfile.tanks).length ? normalizeRows(selectedProfile.tanks).map((tank: any, index: number) => (
                        <div key={`${tank.fuel_type || tank.fuel}-${index}`} className="grid grid-cols-[72px_minmax(0,1fr)_42px] items-center gap-2 text-[11px]">
                          <span className="truncate font-semibold text-[#374151]">{tank.fuel_type || tank.fuel || 'Fuel'}</span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-[#f1f5f9]"><span className="block h-full rounded-full bg-[#7c3aed]" style={{ width: `${Number(tank.percent || tank.pct || 0)}%` }} /></span>
                          <span className="text-right font-bold text-[#111827]">{Number(tank.percent || tank.pct || 0)}%</span>
                        </div>
                      )) : <div className="text-[12px] text-[#9ca3af]">No tank status available.</div>}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Linked Tasks</div>
                    <div className="mt-2 divide-y divide-[#f9fafb]">
                      {linkedTasks.length ? linkedTasks.map((task: any) => (
                        <button key={task.taskNumber} type="button" onClick={() => navigate(`/tasks/${task.taskNumber}`)} className="grid w-full gap-1 py-2 text-left text-[11px] hover:bg-[#f9fafb]">
                          <span className="font-semibold text-[#111827]">{task.taskNumber}</span>
                          <span className="truncate text-[#6b7280]">{task.title}</span>
                          <span>{renderPill(task.status)}</span>
                        </button>
                      )) : <div className="text-[12px] text-[#9ca3af]">No linked task activity.</div>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[300px] items-center justify-center px-5 text-center text-[12px] font-semibold text-[#9ca3af]">
                  Select a station from the registry to view profile, tank status, license details, and linked tasks.
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}

      <KpiDrilldownDrawer open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)} drilldown={drilldown} />
    </div>
  )
}
