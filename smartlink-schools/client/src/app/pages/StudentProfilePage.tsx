import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, FileText, Printer } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '../components/ui/dialog'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'
import { resolvePortalAssetUrl } from '../lib/portalApi'

function valueLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function initialsFor(student: any) {
  return [student?.first_name, student?.last_name].filter(Boolean).map((part) => String(part)[0]).join('').toUpperCase() || 'ST'
}

function photoUrlFor(student: any) {
  return resolvePortalAssetUrl(student?.profile_photo_url || student?.profilePhotoUrl || '')
}

function StudentIdentityPhoto({ student, onClick }: { student: any; onClick: () => void }) {
  const [failed, setFailed] = useState(false)
  const photoUrl = photoUrlFor(student)

  useEffect(() => {
    setFailed(false)
  }, [photoUrl])

  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-28 place-items-center overflow-hidden rounded-full border-4 border-white bg-[#111827] text-[28px] font-bold text-white shadow-[0_16px_34px_rgba(15,23,42,0.18)] ring-1 ring-[#dbe1ea] transition hover:scale-[1.02] hover:ring-[#94a3b8] focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
      aria-label="Preview student photo"
    >
      {photoUrl && !failed ? (
        <img src={photoUrl} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initialsFor(student)
      )}
    </button>
  )
}

function StudentPhotoPreview({ student }: { student: any }) {
  const [failed, setFailed] = useState(false)
  const photoUrl = photoUrlFor(student)

  useEffect(() => {
    setFailed(false)
  }, [photoUrl])

  return (
    <div className="grid justify-items-center gap-4">
      <div className="grid max-h-[70vh] min-h-[280px] w-full place-items-center overflow-hidden rounded-[8px] border border-[#dbe1ea] bg-[#f8fafc]">
        {photoUrl && !failed ? (
          <img src={photoUrl} alt="" className="max-h-[70vh] w-full object-contain" onError={() => setFailed(true)} />
        ) : (
          <div className="grid size-56 place-items-center rounded-full bg-[#111827] text-[56px] font-bold text-white">
            {initialsFor(student)}
          </div>
        )}
      </div>
      <div className="text-center">
        <div className="text-[16px] font-bold tracking-[-0.025em] text-[#111827]">{student ? `${student.first_name} ${student.last_name}` : 'Student'}</div>
        <div className="mt-1 text-[12px] font-semibold text-[#64748b]">{student?.student_id || student?.admission_no || '-'}</div>
      </div>
    </div>
  )
}

function scoreLabel(value: any, suffix = '') {
  if (value === null || value === undefined || value === '') return '-'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`
}

function percentLabel(value: any) {
  return value === null || value === undefined || value === '' ? 'N/A' : scoreLabel(value, '%')
}

function remarkClass(remark: any) {
  return String(remark || '').toUpperCase() === 'PASS'
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
    : 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2 border-b border-[#e2e8f0] py-2 text-[12px] last:border-b-0">
      <span className="font-semibold text-[#6b7280]">{label}</span>
      <span className="min-w-0 break-words font-medium text-[#111827]">{value || '-'}</span>
    </div>
  )
}

export function StudentProfilePage() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { token, api } = usePortal()
  const [student, setStudent] = useState<any>(null)
  const [error, setError] = useState('')
  const [openingReportId, setOpeningReportId] = useState<any>(null)
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false)

  useEffect(() => {
    if (!token || !studentId) return
    api.getStudent(token, studentId)
      .then((payload: any) => setStudent(payload?.student || null))
      .catch((err: any) => setError(err?.message || 'Unable to load student profile.'))
  }, [api, studentId, token])

  const printProfile = () => window.print()
  const searchQuery = (location.state as any)?.search
  const backPath = (location.state as any)?.fromSearch ? `/search${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : (window.location.search || '')}` : (location.state as any)?.fromClass ? `/classes/${(location.state as any).fromClass}` : '/students'
  const examReports = student?.exam_reports || student?.results || []
  const subjectGradeCount = examReports.reduce((sum: number, report: any) => sum + Number(report.subject_count || report.subjects?.length || 0), 0)
  const openReport = async (report: any) => {
    const reportId = report?.report_card_id || report?.id
    if (!reportId || !token) return
    const pdfWindow = window.open('', '_blank')
    pdfWindow?.document.write('<title>Preparing report card...</title><body style="font-family: system-ui, sans-serif; padding: 24px;">Preparing PDF...</body>')
    setOpeningReportId(reportId)
    setError('')
    try {
      const blob = await api.getReportCardPdf(token, reportId)
      const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
      const pdfUrl = URL.createObjectURL(pdfBlob)
      if (pdfWindow) pdfWindow.location.href = pdfUrl
      else window.open(pdfUrl, '_blank')
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000)
    } catch (err: any) {
      pdfWindow?.close()
      setError(err?.message || 'Unable to prepare report card PDF.')
    } finally {
      setOpeningReportId(null)
    }
  }

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button type="button" onClick={() => navigate(backPath)} className="mb-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#6b7280] hover:text-[#111827]">
              <ArrowLeft className="size-3.5" />
              Back
            </button>
            <div className="flex items-center gap-3">
              <div className="grid size-12 place-items-center rounded-[6px] bg-[#111827] text-[14px] font-bold text-white">{initialsFor(student)}</div>
              <div>
                <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">
                  {student ? `${student.first_name} ${student.last_name}` : 'Student Profile'}
                </h1>
                <p className="mt-1 text-[13px] text-[var(--mera-panel-text-muted)]">{student?.student_id || student?.admission_no || 'Loading school record...'} · {valueLabel(student?.status)}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/results')} className="h-8 rounded-[5px] text-[12px]"><FileText className="size-3.5" /> View Results</Button>
            <Button type="button" onClick={printProfile} className="h-8 rounded-[5px] text-[12px]">
              <Printer className="size-3.5" />
              Print Admission Card
            </Button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

      <SectionKpiStrip items={[
        { label: 'Current Class', value: student?.class_name || '-', helper: student?.academic_year_name || 'academic year', delta: student?.term_name || 'term' },
        { label: 'Stream', value: student?.stream_section || '-', helper: 'section', delta: student?.enrollment_status || student?.status || '-' },
        { label: 'Results', value: examReports.length, helper: 'exam sessions', delta: `${subjectGradeCount} subject grades` },
        { label: 'Fees', value: student?.fees?.length || 0, helper: 'fee records', delta: valueLabel(student?.fee_category) },
      ]} />

      <div className="grid gap-3 xl:grid-cols-2">
        <SectionCard title="Student Identity" subtitle="Generated school ID and personal details">
          <div className="grid gap-4 p-4">
            <div className="grid justify-items-center gap-2.5 border-b border-[#e2e8f0] pb-4 text-center">
              <StudentIdentityPhoto student={student} onClick={() => setPhotoPreviewOpen(true)} />
              <div>
                <div className="text-[17px] font-bold tracking-[-0.025em] text-[#111827]">
                  {student ? `${student.first_name} ${student.last_name}` : 'Student'}
                </div>
                <div className="mt-1 text-[12px] font-semibold text-[#64748b]">{student?.student_id || student?.admission_no || '-'}</div>
              </div>
            </div>
            <div className="mx-auto w-full max-w-[440px]">
              <Row label="Student ID" value={student?.student_id || student?.admission_no} />
              <Row label="Full Name" value={student ? `${student.first_name} ${student.last_name}` : '-'} />
              <Row label="Date of Birth" value={student?.date_of_birth?.slice?.(0, 10) || student?.date_of_birth} />
              <Row label="Gender" value={student?.gender} />
              <Row label="National ID" value={student?.national_id} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Academic Placement" subtitle="Class, stream and enrollment data">
          <div className="p-4">
            <Row label="Class" value={student?.class_name} />
            <Row label="Stream / Section" value={student?.stream_section} />
            <Row label="Academic Year" value={student?.academic_year_name} />
            <Row label="Current Term" value={student?.term_name} />
            <Row label="Enrollment Status" value={valueLabel(student?.enrollment_status)} />
            <Row label="Enrollment Date" value={student?.enrollment_date?.slice?.(0, 10) || student?.enrollment_date} />
            <Row label="Student Type" value={valueLabel(student?.student_type)} />
            <Row label="Previous School" value={student?.previous_school} />
          </div>
        </SectionCard>

        <SectionCard title="Guardians" subtitle="Parent and guardian contacts">
          <div className="grid gap-3 p-4">
            {(student?.guardians || []).length ? student.guardians.map((guardian: any) => (
              <article key={guardian.guardian_number} className="rounded-[5px] border border-[#e2e8f0] bg-white p-3">
                <Row label={`Guardian ${guardian.guardian_number}`} value={guardian.full_name} />
                <Row label="Relationship" value={guardian.relationship} />
                <Row label="Primary Phone" value={guardian.primary_phone} />
                <Row label="Email" value={guardian.email} />
              </article>
            )) : <div className="text-[12px] text-[#6b7280]">No guardian records found.</div>}
          </div>
        </SectionCard>

        <SectionCard title="Fee Profile" subtitle="Category, payment plan and discounts">
          <div className="p-4">
            <Row label="Fee Category" value={valueLabel(student?.fee_category)} />
            <Row label="Payment Plan" value={valueLabel(student?.payment_plan)} />
            <Row label="Discount" value={`${Number(student?.discount_percent || 0)}%`} />
            <Row label="Reason" value={student?.discount_reason} />
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <SectionCard title="Academic History" subtitle="Enrollment records preserve previous terms and classes">
          <PortalTable
            columns={[
              { key: 'academic_year_name', label: 'Academic Year' },
              { key: 'term_name', label: 'Term' },
              { key: 'class_name', label: 'Class' },
              { key: 'enrollment_type', label: 'Type', render: (row) => valueLabel(row.enrollment_type) },
              { key: 'enrollment_status', label: 'Status', render: (row) => valueLabel(row.enrollment_status) },
            ]}
            rows={student?.enrollments || []}
            emptyMessage="No academic history records found."
          />
        </SectionCard>

        <SectionCard title="Results" subtitle="Exam sessions and official report cards">
          <PortalTable
            columns={[
              { key: 'academic_year_name', label: 'Year' },
              { key: 'term_name', label: 'Term' },
              { key: 'exam_session_name', label: 'Exam Session' },
              { key: 'average_score', label: 'Average', render: (row) => percentLabel(row.average_score) },
              { key: 'grade', label: 'Grade' },
              { key: 'position', label: 'Position', render: (row) => row.position ? `${row.position} / ${row.class_total || '-'}` : '-' },
              { key: 'class_total', label: 'Class Total', render: (row) => row.class_total || '-' },
              {
                key: 'remark',
                label: 'Remarks',
                render: (row) => <span className={`rounded-[4px] border px-2 py-1 text-[11px] font-bold ${remarkClass(row.remark)}`}>{row.remark || '-'}</span>,
              },
              {
                key: 'report_card_id',
                label: 'Report Card',
                render: (row) => row.report_card_id || row.id ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[#2563eb] disabled:text-[#94a3b8]"
                    disabled={String(openingReportId || '') === String(row.report_card_id || row.id)}
                    onClick={() => openReport(row)}
                  >
                    {String(openingReportId || '') === String(row.report_card_id || row.id) ? 'Preparing...' : 'Open'}
                  </button>
                ) : '-',
              },
            ]}
            rows={examReports}
            emptyMessage="No exam session reports are available yet."
          />
        </SectionCard>

        <SectionCard title="Recurring Assessments" subtitle="Weekly tests and classroom checks separate from report cards">
          <PortalTable
            columns={[
              { key: 'instance_date', label: 'Date', render: (row) => row.instance_date?.slice?.(0, 10) || row.instance_date },
              { key: 'assessment_name', label: 'Assessment' },
              { key: 'assessment_type', label: 'Type', render: (row) => valueLabel(row.assessment_type) },
              { key: 'subject_name', label: 'Subject' },
              { key: 'score', label: 'Score', render: (row) => `${row.score ?? '-'} / ${row.total_marks || '-'}` },
              { key: 'status', label: 'Status', render: (row) => valueLabel(row.status) },
              { key: 'teacher_name', label: 'Teacher', render: (row) => row.teacher_name || '-' },
            ]}
            rows={student?.recurring_assessments || []}
            emptyMessage="No recurring assessment progress is available yet."
          />
        </SectionCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <SectionCard title="Attendance" subtitle="Recent attendance records">
          <PortalTable
            columns={[
              { key: 'attendance_date', label: 'Date', render: (row) => row.attendance_date?.slice?.(0, 10) || row.attendance_date },
              { key: 'status', label: 'Status', render: (row) => valueLabel(row.status) },
              { key: 'note', label: 'Note' },
            ]}
            rows={student?.attendance || []}
            emptyMessage="No attendance records are available."
          />
        </SectionCard>

        <SectionCard title="Fee Records" subtitle="Fee status is separate from academic promotion">
          <PortalTable
            columns={[
              { key: 'term_name', label: 'Term' },
              { key: 'amount_due', label: 'Due', render: (row) => `MWK ${Number(row.amount_due || 0).toLocaleString()}` },
              { key: 'amount_paid', label: 'Paid', render: (row) => `MWK ${Number(row.amount_paid || 0).toLocaleString()}` },
              { key: 'status', label: 'Status', render: (row) => valueLabel(row.status) },
            ]}
            rows={student?.fees || []}
            emptyMessage="No fee records are available."
          />
        </SectionCard>
      </div>

      <Dialog open={photoPreviewOpen} onOpenChange={setPhotoPreviewOpen}>
        <DialogContent className="max-w-[min(760px,calc(100vw-32px))] rounded-[10px] border-[#dbe1ea] bg-white p-4">
          <DialogTitle className="sr-only">Student photo preview</DialogTitle>
          <StudentPhotoPreview student={student} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
