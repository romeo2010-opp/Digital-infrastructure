import { useMemo, useState } from 'react'
import { Download, Search, UserPlus } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

export function UserAdministration() {
  const { data, runAction, api, token, hasPermission } = usePortal()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [district, setDistrict] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [statusValue, setStatusValue] = useState('ACTIVE')
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    roleName: 'FIELD_COMPLIANCE_OFFICER',
    districtScope: '',
    regionScope: '',
    accountStatus: 'ACTIVE',
  })

  const rows = useMemo(() => {
    return normalizeRows(data.users).filter((row: any) => {
      if (role && row.role_code !== role) return false
      if (district && String(row.district_scope || '') !== district) return false
      return matchesSearch(row, search)
    })
  }, [data.users, district, role, search])

  const caseCounts = normalizeRows(data.complaints?.items).reduce((acc: Record<string, number>, item: any) => {
    const id = item.assignedOfficer?.publicId
    if (id) acc[id] = (acc[id] || 0) + 1
    return acc
  }, {})

  const selectedUserAudit = useMemo(
    () => normalizeRows(data.auditLogs?.items).filter((row: any) => row.actor_public_id === selectedUser?.public_id).slice(0, 8),
    [data.auditLogs, selectedUser],
  )

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        {hasPermission(MERA_PERMISSIONS.USERS_CREATE) ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setModalOpen(true)}>
            <UserPlus className="size-4" />
            Create User
          </Button>
        ) : null}
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search officers..." />
        </div>
        <select className={fieldClass} value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">All Roles</option>
          <option value="SUPER_ADMIN">Super Admin</option>
          <option value="NATIONAL_OPERATIONS_ANALYST">National Operations Analyst</option>
          <option value="REGIONAL_COMPLIANCE_SUPERVISOR">Regional Compliance Supervisor</option>
          <option value="FIELD_COMPLIANCE_OFFICER">Field Compliance Officer</option>
          <option value="PUBLIC_COMPLAINTS_ANALYST">Public Complaints Analyst</option>
          <option value="LEGAL_ENFORCEMENT_OFFICER">Legal & Enforcement Officer</option>
          <option value="LICENSING_OFFICER">Licensing Officer</option>
          <option value="MARKET_SUPPLY_ANALYST">Market / Fuel Supply Analyst</option>
          <option value="EXECUTIVE_VIEWER">Executive Viewer</option>
        </select>
        <select className={fieldClass} value={district} onChange={(event) => setDistrict(event.target.value)}>
          <option value="">All Districts</option>
          {Array.from(new Set(rows.map((row: any) => row.district_scope).filter(Boolean))).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm">
          <Download className="size-4" />
          Export
        </Button>
      </Toolbar>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
        <SectionCard title="MERA Officer Registry" subtitle="User accounts, districts, case ownership, and access control">
        <PortalTable
          rows={rows}
          columns={[
            { key: 'full_name', label: 'Officer Name' },
            { key: 'email', label: 'Email' },
            { key: 'role_display_name', label: 'Role', render: (row) => renderPill(row.role_display_name || row.role_code) },
            { key: 'district_scope', label: 'District Scope', render: (row) => row.district_scope || '-' },
            { key: 'activeCases', label: 'Active Cases', render: (row) => row.active_cases ?? caseCounts[row.public_id] ?? 0 },
            { key: 'last_login_at', label: 'Last Login', render: (row) => normalizeDate(row.last_login_at) },
            { key: 'account_status', label: 'Account Status', render: (row) => renderPill(row.account_status) },
            {
              key: 'action',
              label: 'Action',
              render: (row) => (
                <button
                  type="button"
                  className="text-[11px] font-medium text-blue-700"
                  onClick={() => {
                    setSelectedUser(row)
                    setStatusValue(row.account_status || 'ACTIVE')
                    if (hasPermission(MERA_PERMISSIONS.USERS_UPDATE) || hasPermission(MERA_PERMISSIONS.USERS_DISABLE)) {
                      setStatusOpen(true)
                    }
                  }}
                >
                  View
                </button>
              ),
            },
          ]}
        />
        </SectionCard>
        <SectionCard title="Officer Detail Panel" subtitle="Permissions, assigned district, recent actions, and audit history">
        <div className="space-y-3 px-4 py-3 text-xs">
          {selectedUser ? (
            <>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-900">{selectedUser.full_name}</div>
                <div className="mt-1 text-slate-500">{selectedUser.email}</div>
                <div className="mt-2">{renderPill(selectedUser.role_display_name || selectedUser.role_code)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Assigned District</div>
                <div className="mt-2 text-slate-700">{selectedUser.district_scope || 'National scope'}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Permissions</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {normalizeRows(selectedUser.permissions).map((permission: string) => (
                    <span key={permission}>{renderPill(permission)}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Recent Actions</div>
                <div className="mt-2 space-y-2">
                  {selectedUserAudit.length ? selectedUserAudit.map((row: any) => (
                    <div key={`${row.id}-${row.created_at}`} className="rounded-md border border-slate-100 bg-slate-50 p-2 text-slate-600">
                      <div>{row.action_type}</div>
                      <div className="mt-1 text-slate-500">{normalizeDate(row.created_at)}</div>
                    </div>
                  )) : <div className="text-slate-500">No recent actions recorded.</div>}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Audit History</div>
                <div className="mt-2 space-y-2">
                  {selectedUserAudit.length ? selectedUserAudit.map((row: any) => (
                    <div key={`audit-${row.id}`} className="rounded-md border border-slate-100 bg-slate-50 p-2 text-slate-600">
                      <div>{row.affected_entity || row.action_description}</div>
                      <div className="mt-1 text-slate-500">{row.permission_code || 'No permission code'} • {row.ip_address || 'No IP captured'}</div>
                    </div>
                  )) : <div className="text-slate-500">No audit history available.</div>}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-slate-500">
              Select an officer from the table to inspect permissions and recent audit history.
            </div>
          )}
        </div>
        </SectionCard>
      </div>

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Add MERA User"
        description="Create an officer account for the enforcement portal."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() => api.createUser(token, form))
                setModalOpen(false)
              }}
            >
              Save User
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} placeholder="Officer full name" />
          <Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Email address" />
          <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Phone number" />
          <Input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" placeholder="Temporary password" />
          <select className={fieldClass} value={form.roleName} onChange={(event) => setForm({ ...form, roleName: event.target.value })}>
            <option value="SUPER_ADMIN">Super Admin</option>
            <option value="NATIONAL_OPERATIONS_ANALYST">National Operations Analyst</option>
            <option value="REGIONAL_COMPLIANCE_SUPERVISOR">Regional Compliance Supervisor</option>
            <option value="FIELD_COMPLIANCE_OFFICER">Field Compliance Officer</option>
            <option value="PUBLIC_COMPLAINTS_ANALYST">Public Complaints Analyst</option>
            <option value="LEGAL_ENFORCEMENT_OFFICER">Legal & Enforcement Officer</option>
            <option value="LICENSING_OFFICER">Licensing Officer</option>
            <option value="MARKET_SUPPLY_ANALYST">Market / Fuel Supply Analyst</option>
            <option value="EXECUTIVE_VIEWER">Executive Viewer</option>
          </select>
          <Input value={form.districtScope} onChange={(event) => setForm({ ...form, districtScope: event.target.value })} placeholder="District scope" />
          <Input value={form.regionScope} onChange={(event) => setForm({ ...form, regionScope: event.target.value })} placeholder="Region scope" />
          <select className={fieldClass} value={form.accountStatus} onChange={(event) => setForm({ ...form, accountStatus: event.target.value })}>
            <option value="ACTIVE">Active</option>
            <option value="INVITED">Invited</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </div>
      </ModalShell>

      <ModalShell
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title="Update Account Status"
        description={selectedUser ? `Update access for ${selectedUser.full_name}.` : 'Update account status.'}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                if (!selectedUser) return
                await runAction(() => api.updateUserStatus(token, selectedUser.public_id, statusValue))
                setStatusOpen(false)
              }}
            >
              Save Status
            </Button>
          </>
        }
      >
        <select className={fieldClass} value={statusValue} onChange={(event) => setStatusValue(event.target.value)}>
          <option value="ACTIVE">Active</option>
          <option value="INVITED">Invited</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </ModalShell>
    </div>
  )
}
