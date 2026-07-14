import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { BookOpenCheck, UserRound } from 'lucide-react'
import { Button } from '../components/ui/button'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { PageBackButton } from '../components/PageBackButton'
import { usePortal } from '../lib/portalContext'

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2 border-b border-[#e2e8f0] py-2 text-[12px] last:border-b-0">
      <span className="font-semibold text-[#6b7280]">{label}</span>
      <span className="min-w-0 break-words font-medium text-[#111827]">{value || '-'}</span>
    </div>
  )
}

function valueLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function initials(name: string) {
  return String(name || 'Teacher').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export function TeacherProfilePage() {
  const { teacherId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { token, api } = usePortal()
  const [teacher, setTeacher] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !teacherId) return
    api.getTeacher(token, teacherId)
      .then((payload: any) => setTeacher(payload?.teacher || null))
      .catch((err: any) => setError(err?.message || 'Unable to load teacher profile.'))
  }, [api, teacherId, token])

  const searchQuery = (location.state as any)?.search
  const backPath = (location.state as any)?.fromSearch ? `/search${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : (window.location.search || '')}` : '/teachers'

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-[6px] bg-[#111827] text-[14px] font-bold text-white">{initials(teacher?.full_name)}</div>
            <div>
              <PageBackButton fallback={backPath} className="mb-2" />
              <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">{teacher?.full_name || 'Teacher Profile'}</h1>
              <p className="mt-1 text-[13px] text-[var(--mera-panel-text-muted)]">{valueLabel(teacher?.role_type)} · {valueLabel(teacher?.employment_status)}</p>
            </div>
          </div>
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/classes')}>
            <BookOpenCheck className="size-3.5" />
            Assign Teacher
          </Button>
        </div>
      </section>

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

      <div className="grid gap-3 xl:grid-cols-2">
        <SectionCard title="Teacher Details" subtitle="School-scoped staff identity">
          <div className="p-4">
            <Row label="Full Name" value={teacher?.full_name} />
            <Row label="Phone" value={teacher?.phone} />
            <Row label="Email" value={teacher?.email} />
            <Row label="Employee ID" value={teacher?.employee_id} />
            <Row label="National ID" value={teacher?.national_id} />
            <Row label="Gender" value={teacher?.gender} />
            <Row label="Date of Birth" value={teacher?.date_of_birth?.slice?.(0, 10) || teacher?.date_of_birth} />
          </div>
        </SectionCard>

        <SectionCard title="Professional Profile" subtitle="Qualifications and specialization">
          <div className="p-4">
            <Row label="Qualification" value={teacher?.qualification} />
            <Row label="Specialization" value={teacher?.specialization} />
            <Row label="Address" value={teacher?.address} />
            <Row label="Status" value={valueLabel(teacher?.employment_status)} />
            <Row label="Role Type" value={valueLabel(teacher?.role_type)} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Teacher Workload" subtitle="Classes, subjects, academic year and term assignments">
        <PortalTable
          columns={[
            { key: 'class_name', label: 'Class' },
            { key: 'subject_name', label: 'Subject' },
            { key: 'role', label: 'Role', render: (row) => valueLabel(row.role) },
            { key: 'academic_year_name', label: 'Academic Year' },
            { key: 'term_name', label: 'Term' },
            { key: 'is_active', label: 'Status', render: (row) => row.is_active ? 'Active' : 'Inactive' },
          ]}
          rows={teacher?.assignments || []}
          emptyMessage="No active workload has been assigned to this teacher."
        />
      </SectionCard>
    </div>
  )
}
