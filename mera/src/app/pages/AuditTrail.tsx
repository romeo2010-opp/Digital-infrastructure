import { useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ToolbarField } from '../components/FieldLabel'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

function isSeriousAuditLog(row: any) {
  const actionType = String(row?.action_type || '').toUpperCase()
  const actorRole = String(row?.actor_role || '').toUpperCase()
  const description = String(row?.action_description || '').toUpperCase()

  if (!row?.actor_name && !row?.actor_public_id) return false
  if (actionType.includes('DELETE') || actionType.includes('DISMISS') || actionType.includes('SUSPEND')) return true
  if (actionType.includes('ESCALAT') || actionType.includes('RESOLVE') || actionType.includes('ENFORC')) return true
  if (actionType.includes('ASSIGN') || actionType.includes('STATUS')) return true
  if (description.includes('WARNING') || description.includes('FINE') || description.includes('CLOSURE')) return true
  if (description.includes('COMPLIANCE') || description.includes('VIOLATION') || description.includes('HIGH RISK')) return true
  return false
}

export function AuditTrail() {
  const { data } = usePortal()
  const [search, setSearch] = useState('')
  const [officer, setOfficer] = useState('')
  const [actionType, setActionType] = useState('')
  const seriousLogs = useMemo(
    () => normalizeRows(data.auditLogs?.items).filter((row: any) => isSeriousAuditLog(row)),
    [data.auditLogs],
  )
  const recentIncidents = seriousLogs.slice(0, 8)

  const rows = useMemo(() => {
    return seriousLogs.filter((row: any) => {
      if (officer && row.actor_name !== officer) return false
      if (actionType && row.action_type !== actionType) return false
      return matchesSearch(row, search)
    })
  }, [actionType, officer, search, seriousLogs])
  const escalationRows = rows.filter((row: any) => /ESCALAT|ENFORC|WARNING|FINE|CLOSURE/i.test(`${row.action_type || ''} ${row.action_description || ''}`))
  const resolvedRows = rows.filter((row: any) => /RESOLVE|CLOSE|COMPLIED|DISMISS/i.test(`${row.action_type || ''} ${row.action_description || ''}`))
  const adminRows = rows.filter((row: any) => /ADMIN|SUPERVISOR/i.test(String(row.actor_role || '')))
  const auditColumns = [
    { key: 'id', label: 'Log', render: (row: any) => `LOG-${row.id}` },
    { key: 'actor_name', label: 'Actor', render: (row: any) => row.actor_name || '-' },
    { key: 'actor_role', label: 'Role', render: (row: any) => row.actor_role || '-' },
    { key: 'action_type', label: 'Action', render: (row: any) => row.action_type || '-' },
    { key: 'created_at', label: 'Timestamp', render: (row: any) => normalizeDate(row.created_at) },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <ToolbarField label="Search audit" hint="Filter material audit entries by officer, action, station, case, or note. Example: search ESCALATED or a station name." className="min-w-[280px] flex-1">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search audit logs..." />
        </div>
        </ToolbarField>
        <ToolbarField label="Officer" hint="Limit audit entries to one officer or system actor. Example: select a supervisor before exporting.">
        <select className={fieldClass} value={officer} onChange={(event) => setOfficer(event.target.value)}>
          <option value="">All Officers</option>
          {Array.from(new Set(rows.map((row: any) => row.actor_name).filter(Boolean))).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        </ToolbarField>
        <ToolbarField label="Action type" hint="Limit the trail to a serious action category. Example: enforcement, escalation, suspension, or status changes.">
        <select className={fieldClass} value={actionType} onChange={(event) => setActionType(event.target.value)}>
          <option value="">Serious Actions</option>
          {Array.from(new Set(seriousLogs.map((row: any) => row.action_type))).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        </ToolbarField>
        <ToolbarField label="Audit date" hint="Choose a date when reviewing a specific day of oversight activity. Example: the day a closure notice was issued.">
          <input type="date" className={fieldClass} />
        </ToolbarField>
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

      <SectionKpiStrip
        columns={auditColumns}
        items={[
          { label: 'Serious Incidents', value: rows.length, rows, tone: rows.length ? 'warn' : 'good', accent: '#f59e0b' },
          { label: 'Escalations', value: escalationRows.length, rows: escalationRows, tone: escalationRows.length ? 'bad' : 'good', accent: '#dc2626' },
          { label: 'Resolved Actions', value: resolvedRows.length, rows: resolvedRows, tone: 'good', accent: '#10b981' },
          { label: 'Admin Actions', value: adminRows.length, rows: adminRows, accent: '#2563eb' },
        ]}
      />

      <SectionCard title="Recent Regulatory Incidents" subtitle="Recent incidents filtered to material enforcement, escalation, and oversight activity">
        <PortalTable
          rows={recentIncidents}
          columns={[
            { key: 'created_at', label: 'Timestamp', render: (row) => normalizeDate(row.created_at) },
            { key: 'action_type', label: 'Incident Type', render: (row) => renderPill(row.action_type) },
            { key: 'actor_name', label: 'Officer', render: (row) => row.actor_name || '-' },
            { key: 'action_description', label: 'Notes' },
          ]}
        />
      </SectionCard>

      <SectionCard title="Audit Trail" subtitle="Only important user actions are shown here; background system events are omitted">
        <PortalTable
          rows={rows}
          columns={[
            { key: 'id', label: 'Log Ref', render: (row) => `LOG-${row.id}` },
            { key: 'actor_name', label: 'Officer', render: (row) => row.actor_name || '-' },
            { key: 'actor_role', label: 'Role', render: (row) => renderPill(row.actor_role) },
            { key: 'action_type', label: 'Action Type', render: (row) => renderPill(row.action_type) },
            { key: 'affected', label: 'Affected Station/Case', render: (row) => row.action_description },
            { key: 'created_at', label: 'Timestamp', render: (row) => normalizeDate(row.created_at) },
            { key: 'ip', label: 'IP/Device', render: (row) => row.actor_public_id || '-' },
            { key: 'notes', label: 'Notes', render: (row) => row.action_description },
          ]}
        />
      </SectionCard>
    </div>
  )
}
