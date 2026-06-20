import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, Copy, Plus, Search, UserRound } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { Toolbar } from '../components/Toolbar'
import { usePortal } from '../lib/portalContext'

const initialForm = {
  first_name: '',
  last_name: '',
  gender: '',
  date_of_birth: '',
  phone: '',
  email: '',
  national_id: '',
  employee_id: '',
  qualification: '',
  specialization: '',
  address: '',
  employment_status: 'active',
  role_type: 'teacher',
}

const selectClassName = 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'

function Field({ label, children }: { label: string; children: any }) {
  return <label className={labelClass}>{label}{children}</label>
}

export function TeachersPage() {
  const { token, api, user } = usePortal()
  const navigate = useNavigate()
  const [teachers, setTeachers] = useState<any[]>([])
  const [form, setForm] = useState<any>(initialForm)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [created, setCreated] = useState<any>(null)
  const [copiedCredentials, setCopiedCredentials] = useState(false)
  const canManage = ['school_owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())

  const refresh = async () => {
    if (!token) return
    const payload = await api.listTeachers(token)
    setTeachers(payload?.teachers || [])
  }

  useEffect(() => {
    refresh().catch((err: any) => setError(err?.message || 'Unable to load teachers.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const visibleTeachers = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return teachers
    return teachers.filter((row) => `${row.full_name} ${row.email} ${row.phone} ${row.employee_id} ${row.specialization}`.toLowerCase().includes(value))
  }, [query, teachers])

  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }))

  const submit = async () => {
    if (!token || !canManage) return
    setError('')
    setCreated(null)
    setCopiedCredentials(false)
    try {
      const payload = await api.createTeacher(token, form)
      setCreated(payload)
      setForm(initialForm)
      await refresh()
    } catch (err: any) {
      setError(err?.message || 'Unable to create teacher.')
    }
  }

  const copyCreatedCredentials = async () => {
    if (!created?.teacher || !created?.temporary_password) return
    const text = `SmartLink Schools login\nEmail: ${created.teacher.email}\nTemporary password: ${created.temporary_password}`
    await navigator.clipboard?.writeText(text)
    setCopiedCredentials(true)
    window.setTimeout(() => setCopiedCredentials(false), 1800)
  }

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Teachers</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">Create school-scoped teachers before assigning classes and subjects.</p>
          </div>
          <div className="rounded-[5px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[12px] font-semibold text-[#111827]">{teachers.length} staff records</div>
        </div>
      </section>

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      {created?.teacher ? (
        <div className="rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] p-4">
          <div className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#166534]">Teacher Created</div>
          <div className="mt-1 text-[22px] font-bold tracking-[-0.04em] text-[#111827]">{created.teacher.full_name}</div>
          <p className="mt-1 text-[12px] font-medium text-[#166534]">Share these first-login credentials. The teacher must change the password immediately after signing in.</p>
          <div className="mt-3 grid gap-2 rounded-[6px] border border-[#86efac] bg-white p-3 text-[12px]">
            <div className="grid gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Email</span>
              <span className="break-all font-semibold text-[#111827]">{created.teacher.email}</span>
            </div>
            <div className="grid gap-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Temporary password</span>
              <span className="break-all font-mono text-[15px] font-bold text-[#111827]">{created.temporary_password}</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={copyCreatedCredentials}>
              {copiedCredentials ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copiedCredentials ? 'Copied' : 'Copy credentials'}
            </Button>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setCreated(null)}><Plus className="size-3.5" /> Add Another Teacher</Button>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate(`/teachers/${created.teacher.id}`)}><UserRound className="size-3.5" /> View Teacher Profile</Button>
            <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/classes')}>Assign Teacher to Subject/Class</Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[420px_minmax(0,1fr)]">
        <SectionCard title="Create Teacher" subtitle="First name, last name and phone are required">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="First Name"><Input className="h-8 text-[12px]" value={form.first_name} onChange={(event) => update('first_name', event.target.value)} /></Field>
            <Field label="Last Name"><Input className="h-8 text-[12px]" value={form.last_name} onChange={(event) => update('last_name', event.target.value)} /></Field>
            <Field label="Phone"><Input className="h-8 text-[12px]" value={form.phone} onChange={(event) => update('phone', event.target.value)} /></Field>
            <Field label="Email"><Input className="h-8 text-[12px]" value={form.email} onChange={(event) => update('email', event.target.value)} /></Field>
            <Field label="Gender"><select className={selectClassName} value={form.gender} onChange={(event) => update('gender', event.target.value)}><option value="">Not set</option><option>Female</option><option>Male</option></select></Field>
            <Field label="Date of Birth"><Input type="date" className="h-8 text-[12px]" value={form.date_of_birth} onChange={(event) => update('date_of_birth', event.target.value)} /></Field>
            <Field label="Employee ID"><Input className="h-8 text-[12px]" value={form.employee_id} onChange={(event) => update('employee_id', event.target.value)} /></Field>
            <Field label="National ID"><Input className="h-8 text-[12px]" value={form.national_id} onChange={(event) => update('national_id', event.target.value)} /></Field>
            <Field label="Qualification"><Input className="h-8 text-[12px]" value={form.qualification} onChange={(event) => update('qualification', event.target.value)} /></Field>
            <Field label="Specialization"><Input className="h-8 text-[12px]" value={form.specialization} onChange={(event) => update('specialization', event.target.value)} /></Field>
            <Field label="Employment Status"><select className={selectClassName} value={form.employment_status} onChange={(event) => update('employment_status', event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option><option value="left">Left</option></select></Field>
            <Field label="Role Type"><select className={selectClassName} value={form.role_type} onChange={(event) => update('role_type', event.target.value)}><option value="teacher">Teacher</option><option value="headteacher">Headteacher</option><option value="deputy_headteacher">Deputy Headteacher</option><option value="admin_teacher">Admin Teacher</option></select></Field>
            <Field label="Address"><Input className="h-8 text-[12px]" value={form.address} onChange={(event) => update('address', event.target.value)} /></Field>
            <Button disabled={!canManage} type="button" className="h-8 rounded-[5px] text-[12px] sm:col-span-2" onClick={submit}><Plus className="size-3.5" /> Create Teacher</Button>
          </div>
        </SectionCard>

        <SectionCard title="Teacher Directory" subtitle="Sorted alphabetically and scoped to this school">
          <div className="grid gap-3 p-4">
            <Toolbar>
              <div className="relative min-w-[260px] flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 pl-9 text-[12px]" placeholder="Search teachers..." />
              </div>
            </Toolbar>
            <PortalTable
              columns={[
                { key: 'full_name', label: 'Teacher' },
                { key: 'phone', label: 'Phone' },
                { key: 'email', label: 'Email' },
                { key: 'specialization', label: 'Specialization' },
                { key: 'employment_status', label: 'Status' },
              ]}
              rows={visibleTeachers}
              onRowClick={(row) => navigate(`/teachers/${row.id}`)}
              emptyMessage="No teacher records found."
            />
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
