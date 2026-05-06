import { useMemo, useState } from 'react'
import { Download, Search, UserPlus } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700'

export function UserAdministration() {
  const { data, runAction, api, token } = usePortal()
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
    roleName: 'COMPLIANCE_OFFICER',
    district: '',
    accountStatus: 'ACTIVE',
  })

  const rows = useMemo(() => {
    return normalizeRows(data.users).filter((row: any) => {
      if (role && row.role_name !== role) return false
      if (district && String(row.district || '') !== district) return false
      return matchesSearch(row, search)
    })
  }, [data.users, district, role, search])

  const caseCounts = normalizeRows(data.complaints?.items).reduce((acc: Record<string, number>, item: any) => {
    const id = item.assignedOfficer?.publicId
    if (id) acc[id] = (acc[id] || 0) + 1
    return acc
  }, {})

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Toolbar>
        <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => setModalOpen(true)}>
          <UserPlus className="size-4" />
          Add User
        </Button>
        <div className="flex min-w-[280px] flex-1 items-center gap-2">
          <Search className="size-4 text-slate-400" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search officers..." />
        </div>
        <select className={fieldClass} value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">All Roles</option>
          <option value="SUPER_ADMIN">Super Admin</option>
          <option value="COMPLIANCE_OFFICER">Compliance Officer</option>
          <option value="LEGAL_ENFORCEMENT">Legal Enforcement</option>
          <option value="PUBLIC_COMPLAINT_ANALYST">Public Complaint Analyst</option>
          <option value="MARKET_ANALYST">Market Analyst</option>
        </select>
        <select className={fieldClass} value={district} onChange={(event) => setDistrict(event.target.value)}>
          <option value="">All Districts</option>
          {Array.from(new Set(rows.map((row: any) => row.district).filter(Boolean))).map((value) => (
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

      <SectionCard title="MERA Officer Registry" subtitle="User accounts, districts, case ownership, and access control">
        <PortalTable
          rows={rows}
          columns={[
            { key: 'full_name', label: 'Officer Name' },
            { key: 'role_name', label: 'Role', render: (row) => renderPill(row.role_name) },
            { key: 'district', label: 'District', render: (row) => row.district || '-' },
            { key: 'activeCases', label: 'Active Cases', render: (row) => caseCounts[row.public_id] || 0 },
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
                    setStatusOpen(true)
                  }}
                >
                  Manage
                </button>
              ),
            },
          ]}
        />
      </SectionCard>

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
            <option value="COMPLIANCE_OFFICER">Compliance Officer</option>
            <option value="LEGAL_ENFORCEMENT">Legal Enforcement</option>
            <option value="PUBLIC_COMPLAINT_ANALYST">Public Complaint Analyst</option>
            <option value="MARKET_ANALYST">Market Analyst</option>
          </select>
          <Input value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })} placeholder="District" />
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
