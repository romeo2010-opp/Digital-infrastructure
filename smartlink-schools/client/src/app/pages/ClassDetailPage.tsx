import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Users } from 'lucide-react'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'

function valueLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function ClassDetailPage() {
  const { classId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { token, api } = usePortal()
  const [classRecord, setClassRecord] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !classId) return
    api.getClass(token, classId)
      .then((payload: any) => setClassRecord(payload?.class || null))
      .catch((err: any) => setError(err?.message || 'Unable to load class detail.'))
  }, [api, classId, token])

  const assignments = classRecord?.assignments || []
  const students = useMemo(() => [...(classRecord?.students || [])].sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)), [classRecord?.students])
  const classTeacher = assignments.find((row: any) => row.role === 'class_teacher' && row.is_active)?.teacher_name || classRecord?.teacher_name || 'Unassigned'
  const subjectTeachers = assignments.filter((row: any) => row.role === 'subject_teacher')
  const searchQuery = (location.state as any)?.search
  const backPath = (location.state as any)?.fromSearch ? `/search${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : (window.location.search || '')}` : '/classes'

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button type="button" onClick={() => navigate(backPath)} className="mb-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#6b7280] hover:text-[#111827]">
              <ArrowLeft className="size-3.5" /> Back
            </button>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">{classRecord?.name || 'Class Detail'}</h1>
            <p className="mt-1 text-[13px] text-[var(--mera-panel-text-muted)]">{classRecord?.grade_level || 'School class'} · Class Teacher: {classTeacher}</p>
          </div>
          <div className="grid size-10 place-items-center rounded-[6px] bg-[#eef2ff] text-[#1557dc]"><Users className="size-5" /></div>
        </div>
      </section>

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

      <SectionKpiStrip items={[
        { label: 'Students', value: students.length, helper: 'alphabetized list', delta: 'active learners' },
        { label: 'Class Teacher', value: classTeacher, helper: 'homeroom role', delta: classTeacher === 'Unassigned' ? 'review' : 'assigned' },
        { label: 'Subject Teachers', value: subjectTeachers.length, helper: 'active assignments', delta: 'current term' },
        { label: 'Grade', value: classRecord?.grade_level || '-', helper: 'class setup', delta: 'database' },
      ]} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <SectionCard title="Students Inside This Class" subtitle="Click a learner to open the full student profile">
          <PortalTable
            columns={[
              { key: 'student_id', label: 'Student ID' },
              { key: 'student', label: 'Student', render: (row) => `${row.first_name} ${row.last_name}` },
              { key: 'gender', label: 'Gender' },
              { key: 'stream_section', label: 'Stream / Section' },
              { key: 'status', label: 'Status' },
            ]}
            rows={students}
            onRowClick={(row) => navigate(`/students/${row.id}`, { state: { fromClass: classRecord?.id } })}
            emptyMessage="No students are currently assigned to this class."
          />
        </SectionCard>

        <SectionCard title="Teacher Assignments" subtitle="Class teacher is separate from subject teachers">
          <PortalTable
            columns={[
              { key: 'subject_name', label: 'Subject', render: (row) => row.role === 'class_teacher' ? 'Class Teacher' : row.subject_name },
              { key: 'teacher_name', label: 'Teacher' },
              { key: 'role', label: 'Role', render: (row) => valueLabel(row.role) },
              { key: 'term_name', label: 'Term' },
            ]}
            rows={assignments}
            emptyMessage="No teacher assignments are available for this class."
          />
        </SectionCard>
      </div>
    </div>
  )
}
