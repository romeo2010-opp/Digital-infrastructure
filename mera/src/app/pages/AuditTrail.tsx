import { useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

function isSeriousAuditLog(row: any) {
  const actionType = String(row?.action_type || '').toUpperCase()
  const actorRole = String(row?.actor_role || '').toUpperCase()
  const description = String(row?.action_description || '').toUpperCase()

  if (actorRole.includes('ADMIN') || actorRole.includes('SUPERVISOR')) return true
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
      if (officer && (row.actor_name || 'System') !== officer) return false
      if (actionType && row.action_type !== actionType) return false
      return matchesSearch(row, search)
    })
  }, [actionType, officer, search, seriousLogs])

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search audit logs..." />
        </div>
        <select className={fieldClass} value={officer} onChange={(event) => setOfficer(event.target.value)}>
          <option value="">All Officers</option>
          {Array.from(new Set(rows.map((row: any) => row.actor_name || 'System'))).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select className={fieldClass} value={actionType} onChange={(event) => setActionType(event.target.value)}>
          <option value="">Serious Actions</option>
          {Array.from(new Set(seriousLogs.map((row: any) => row.action_type))).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input type="date" className={fieldClass} />
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

      <SectionCard title="Recent Regulatory Incidents" subtitle="Recent incidents filtered to material enforcement, escalation, and oversight activity">
        <PortalTable
          rows={recentIncidents}
          columns={[
            { key: 'created_at', label: 'Timestamp', render: (row) => normalizeDate(row.created_at) },
            { key: 'action_type', label: 'Incident Type', render: (row) => renderPill(row.action_type) },
            { key: 'actor_name', label: 'Officer', render: (row) => row.actor_name || 'System' },
            { key: 'action_description', label: 'Notes' },
          ]}
        />
      </SectionCard>

      <SectionCard title="System Audit Trail" subtitle="Only serious audit entries are shown here to keep the log focused on material actions">
        <PortalTable
          rows={rows}
          columns={[
            { key: 'id', label: 'Log Ref', render: (row) => `LOG-${row.id}` },
            { key: 'actor_name', label: 'Officer', render: (row) => row.actor_name || 'System' },
            { key: 'actor_role', label: 'Role', render: (row) => renderPill(row.actor_role) },
            { key: 'action_type', label: 'Action Type', render: (row) => renderPill(row.action_type) },
            { key: 'affected', label: 'Affected Station/Case', render: (row) => row.action_description },
            { key: 'created_at', label: 'Timestamp', render: (row) => normalizeDate(row.created_at) },
            { key: 'ip', label: 'IP/Device', render: (row) => row.actor_public_id || 'System session' },
            { key: 'notes', label: 'Notes', render: (row) => row.action_description },
          ]}
        />
      </SectionCard>
    </div>
  )
}
