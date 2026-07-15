import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { HeartHandshake, Users } from 'lucide-react'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { PageBackButton } from '../components/PageBackButton'
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
  const [academic, setAcademic] = useState<any>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !classId) return
    api.getClass(token, classId)
      .then((payload: any) => setClassRecord(payload?.class || null))
      .catch((err: any) => setError(err?.message || 'Unable to load class detail.'))
  }, [api, classId, token])

  useEffect(() => {
    if (!token || !classId) return
    api.getAcademicClass(token, classId)
      .then((payload: any) => setAcademic(payload))
      .catch(() => setAcademic(null))
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
            <PageBackButton fallback={backPath} className="mb-3" />
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

      {academic ? <>
        <SectionKpiStrip items={[
          { label: 'Academic state', value: valueLabel(academic.overall_state), helper: 'validated open evidence', delta: 'operational' },
          { label: 'Readiness', value: academic.readiness?.[0]?.readiness_score === null || academic.readiness?.[0]?.readiness_score === undefined ? '—' : `${Number(academic.readiness[0].readiness_score).toFixed(0)}%`, helper: 'not a predicted mark', delta: `${Number(academic.readiness?.[0]?.confidence_score || 0).toFixed(0)}% confidence` },
          { label: 'Topics measured', value: academic.topic_matrix?.length || 0, helper: 'published mapped evidence', delta: 'current scope' },
          { label: 'Active interventions', value: academic.interventions?.length || 0, helper: 'owned support plans', delta: 'measured follow-up' },
        ]} />
        <SectionCard title="Class Academic Intelligence" subtitle="Delivery, mapped evidence and learner distribution remain separate; drill into the learner or assessment for source evidence.">
          <PortalTable columns={[
            { key: 'subject_name', label: 'Subject' },
            { key: 'topic_name', label: 'Topic' },
            { key: 'class_result', label: 'Class result', render: (row: any) => row.class_result === null ? 'Insufficient evidence' : `${Number(row.class_result).toFixed(1)}%` },
            { key: 'learners_below_secure', label: 'Below secure' },
            { key: 'trend', label: 'Trend', render: (row: any) => valueLabel(row.trend) },
            { key: 'confidence', label: 'Confidence', render: (row: any) => row.confidence === null ? '—' : `${Number(row.confidence).toFixed(0)}%` },
          ]} rows={academic.topic_matrix || []} emptyMessage="No published mapped topic evidence is available for this class yet." />
        </SectionCard>
        <div className="grid gap-3 xl:grid-cols-2"><SectionCard title="Learner mastery distribution" subtitle="No rank exposure; only the evidence state needed for support planning."><PortalTable columns={[{ key: 'mastery_status', label: 'Mastery state', render: (row: any) => valueLabel(row.mastery_status) }, { key: 'learner_count', label: 'Learners' }]} rows={academic.learner_distribution || []} /></SectionCard><SectionCard title="Upcoming assessments" subtitle="Use mapped assessments to close evidence gaps."><PortalTable columns={[{ key: 'name', label: 'Assessment' }, { key: 'subject_name', label: 'Subject' }, { key: 'assessment_type', label: 'Type', render: (row: any) => valueLabel(row.assessment_type) }, { key: 'exam_date', label: 'Date', render: (row: any) => row.exam_date ? new Date(row.exam_date).toLocaleDateString() : 'Not scheduled' }]} rows={academic.upcoming_assessments || []} /></SectionCard></div>
      </> : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <SectionCard title="Students Inside This Class" subtitle="Click a learner to open the full student profile">
          <PortalTable
            columns={[
              { key: 'student_id', label: 'Student ID' },
              { key: 'student', label: 'Student', render: (row) => `${row.first_name} ${row.last_name}` },
              { key: 'gender', label: 'Gender' },
              { key: 'stream_section', label: 'Stream / Section' },
              { key: 'learner_support', label: 'Learning support', render: (row: any) => row.learner_support ? <button type="button" onClick={(event) => { event.stopPropagation(); navigate(`/learner-support/${row.learner_support.case_ref}`) }} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700"><HeartHandshake className="size-3"/>{valueLabel(row.learner_support.support_state)}</button> : <span className="text-[10px] text-[#94a3b8]">No active support</span> },
              { key: 'status', label: 'Status' },
            ]}
            rows={students}
            onRowClick={(row) => navigate(`/students/${row.public_ref}`, { state: { fromClass: classRecord?.public_ref } })}
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
