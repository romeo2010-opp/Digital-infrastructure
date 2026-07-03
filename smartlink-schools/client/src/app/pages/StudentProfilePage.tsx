import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, FileText, ImagePlus, PencilLine, Printer, Save } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'
import { resolvePortalAssetUrl } from '../lib/portalApi'

const inputClassName = 'h-10 min-w-0 rounded-[7px] border-[#d9dce3] bg-white text-[13px] font-medium text-[#111827]'
const selectClassName = 'h-10 min-w-0 w-full rounded-[7px] border border-[#d9dce3] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const fieldLabelClassName = 'grid min-w-0 gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read image file.'))
    reader.readAsDataURL(file)
  })
}

function dateInputValue(value: any) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

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

function EditField({ label, children }: { label: string; children: any }) {
  return <label className={fieldLabelClassName}>{label}{children}</label>
}

function EditStudentDialog({
  open,
  onOpenChange,
  form,
  setForm,
  classes,
  photoPreviewUrl,
  onPhotoChange,
  onSave,
  saving,
  error,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  form: any
  setForm: (updater: any) => void
  classes: any[]
  photoPreviewUrl: string
  onPhotoChange: (event: ChangeEvent<HTMLInputElement>) => void
  onSave: () => void
  saving: boolean
  error: string
}) {
  const update = (key: string, value: any) => setForm((current: any) => ({ ...(current || {}), [key]: value }))
  const previewUrl = photoPreviewUrl || photoUrlFor(form)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex !w-[min(1040px,calc(100vw-32px))] !max-w-[min(1040px,calc(100vw-32px))] max-h-[calc(100vh-32px)] flex-col overflow-hidden rounded-[10px] border-[#dbe1ea] bg-white p-0 sm:!max-w-[min(1040px,calc(100vw-32px))]">
        <DialogHeader className="shrink-0 border-b border-[#e2e8f0] px-6 py-4">
          <DialogTitle className="text-[18px] font-bold tracking-[-0.025em] text-[#111827]">Edit Student Profile</DialogTitle>
          <DialogDescription className="text-[12px] font-medium text-[#64748b]">Update identity, placement and profile photo details.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

          <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="grid self-start justify-items-center gap-4 rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] px-5 py-6 text-center">
              <div className="grid size-32 place-items-center overflow-hidden rounded-full bg-[#111827] text-[32px] font-bold text-white ring-1 ring-[#dbe1ea]">
                {previewUrl ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : initialsFor(form)}
              </div>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[7px] border border-[#d9dce3] bg-white px-4 text-[13px] font-semibold text-[#111827] shadow-sm transition hover:bg-white/80">
                <ImagePlus className="size-3.5" />
                Upload Photo
                <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={onPhotoChange} />
              </label>
              <span className="max-w-[180px] text-[11px] font-medium leading-5 text-[#64748b]">PNG or JPEG, up to 4MB.</span>
            </div>

            <div className="grid gap-5">
              <section className="grid gap-3">
                <div className="text-[12px] font-bold text-[#111827]">Identity</div>
                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <EditField label="First Name">
                    <Input value={form?.first_name || ''} onChange={(event) => update('first_name', event.target.value)} className={inputClassName} />
                  </EditField>
                  <EditField label="Last Name">
                    <Input value={form?.last_name || ''} onChange={(event) => update('last_name', event.target.value)} className={inputClassName} />
                  </EditField>
                  <EditField label="Date of Birth">
                    <Input type="date" value={form?.date_of_birth || ''} onChange={(event) => update('date_of_birth', event.target.value)} className={inputClassName} />
                  </EditField>
                  <EditField label="Gender">
                    <select value={form?.gender || ''} onChange={(event) => update('gender', event.target.value)} className={selectClassName}>
                      <option value="">Select gender</option>
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other</option>
                    </select>
                  </EditField>
                  <EditField label="National ID">
                    <Input value={form?.national_id || ''} onChange={(event) => update('national_id', event.target.value)} className={inputClassName} />
                  </EditField>
                  <EditField label="Status">
                    <select value={form?.status || 'active'} onChange={(event) => update('status', event.target.value)} className={selectClassName}>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="transferred_out">Transferred Out</option>
                      <option value="withdrawn">Withdrawn</option>
                      <option value="graduated">Graduated</option>
                      <option value="archived">Archived</option>
                    </select>
                  </EditField>
                </div>
              </section>

              <section className="grid gap-3 border-t border-[#e2e8f0] pt-5">
                <div className="text-[12px] font-bold text-[#111827]">Placement</div>
                <div className="grid min-w-0 gap-4 md:grid-cols-2">
                  <EditField label="Class">
                    <select value={form?.class_id || ''} onChange={(event) => update('class_id', event.target.value)} className={selectClassName}>
                      <option value="">No class assigned</option>
                      {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </EditField>
                  <EditField label="Stream / Section">
                    <Input value={form?.stream_section || ''} onChange={(event) => update('stream_section', event.target.value)} className={inputClassName} />
                  </EditField>
                  <EditField label="Enrollment Date">
                    <Input type="date" value={form?.enrollment_date || ''} onChange={(event) => update('enrollment_date', event.target.value)} className={inputClassName} />
                  </EditField>
                  <EditField label="Student Type">
                    <select value={form?.student_type || 'new'} onChange={(event) => update('student_type', event.target.value)} className={selectClassName}>
                      <option value="new">New</option>
                      <option value="returning">Returning</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </EditField>
                  <EditField label="Previous School">
                    <Input value={form?.previous_school || ''} onChange={(event) => update('previous_school', event.target.value)} className={inputClassName} />
                  </EditField>
                </div>
              </section>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-[#e2e8f0] bg-[#f8fafc] px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-9 rounded-[7px] text-[12px]" disabled={saving}>Cancel</Button>
          <Button type="button" onClick={onSave} className="h-9 rounded-[7px] text-[12px]" disabled={saving}>
            <Save className="size-3.5" />
            {saving ? 'Saving...' : 'Save Profile'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function StudentProfilePage() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { token, api, user, runAction } = usePortal()
  const [student, setStudent] = useState<any>(null)
  const [error, setError] = useState('')
  const [openingReportId, setOpeningReportId] = useState<any>(null)
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [classes, setClasses] = useState<any[]>([])
  const [pendingPhoto, setPendingPhoto] = useState<any>(null)
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState('')
  const [editError, setEditError] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    if (!token || !studentId) return
    api.getStudent(token, studentId)
      .then((payload: any) => setStudent(payload?.student || null))
      .catch((err: any) => setError(err?.message || 'Unable to load student profile.'))
  }, [api, studentId, token])

  useEffect(() => {
    if (!token || !editOpen) return
    api.listClasses(token)
      .then((payload: any) => setClasses(payload?.classes || []))
      .catch(() => setClasses([]))
  }, [api, editOpen, token])

  const openEditProfile = () => {
    if (!student) return
    setEditError('')
    setPendingPhoto(null)
    setPendingPhotoPreview('')
    setEditForm({
      id: student.id,
      class_id: student.class_id || '',
      first_name: student.first_name || '',
      last_name: student.last_name || '',
      date_of_birth: dateInputValue(student.date_of_birth),
      gender: student.gender || '',
      national_id: student.national_id || '',
      profile_photo_url: student.profile_photo_url || student.profilePhotoUrl || '',
      stream_section: student.stream_section || '',
      enrollment_date: dateInputValue(student.enrollment_date),
      student_type: student.student_type || 'new',
      previous_school: student.previous_school || '',
      status: student.status || 'active',
    })
    setEditOpen(true)
  }

  const handleEditPhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setEditError('')
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setEditError('Use a PNG or JPEG image.')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setEditError('Student photo must be 4MB or smaller.')
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setPendingPhoto({ file_name: file.name, file_type: file.type, data_url: dataUrl })
      setPendingPhotoPreview(dataUrl)
    } catch (err: any) {
      setEditError(err?.message || 'Unable to read image file.')
    }
  }

  const saveEditProfile = async () => {
    if (!token || !studentId) return
    setSavingProfile(true)
    setEditError('')
    try {
      await runAction(async () => {
        let profilePhotoUrl = editForm.profile_photo_url || null
        if (pendingPhoto) {
          const uploaded = await api.uploadStudentPhoto(token, pendingPhoto)
          profilePhotoUrl = uploaded?.profile_photo_url || uploaded?.profilePhotoUrl || profilePhotoUrl
        }
        await api.updateStudent(token, studentId, {
          ...editForm,
          class_id: editForm.class_id || null,
          profile_photo_url: profilePhotoUrl,
        })
        const fresh = await api.getStudent(token, studentId)
        setStudent(fresh?.student || null)
        setEditOpen(false)
        setPendingPhoto(null)
        setPendingPhotoPreview('')
        return fresh
      }, 'Saving student profile...', { refresh: false })
    } catch (err: any) {
      setEditError(err?.message || 'Unable to save student profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  const printProfile = () => window.print()
  const searchQuery = (location.state as any)?.search
  const backPath = (location.state as any)?.fromSearch ? `/search${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : (window.location.search || '')}` : (location.state as any)?.fromClass ? `/classes/${(location.state as any).fromClass}` : '/students'
  const examReports = student?.exam_reports || student?.results || []
  const assessmentRows = useMemo(() => {
    if (student?.assessment_results?.length) return student.assessment_results
    return (student?.recurring_assessments || []).map((row: any) => ({
      ...row,
      source_type: 'recurring_assessment',
      source_label: 'Recurring assessment',
      result_date: row.instance_date || row.last_saved_at,
      percentage: row.score === null || row.score === undefined || !row.total_marks ? null : Number(((Number(row.score) / Number(row.total_marks)) * 100).toFixed(1)),
    }))
  }, [student])
  const canEditProfile = ['school_owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())
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
            {canEditProfile ? (
              <Button type="button" variant="outline" onClick={openEditProfile} className="h-8 rounded-[5px] text-[12px]">
                <PencilLine className="size-3.5" />
                Edit Profile
              </Button>
            ) : null}
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
        { label: 'Results', value: examReports.length + assessmentRows.length, helper: 'reports and assessments', delta: `${subjectGradeCount} report grades` },
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

        <SectionCard title="Official Report Cards" subtitle="Exam sessions with generated report cards">
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

        <SectionCard title="Assessment Results" subtitle="Mid-term, class tests, assignments and recurring classroom checks">
          <PortalTable
            columns={[
              { key: 'result_date', label: 'Date', render: (row) => row.result_date?.slice?.(0, 10) || row.instance_date?.slice?.(0, 10) || row.last_saved_at?.slice?.(0, 10) || '-' },
              { key: 'assessment_name', label: 'Assessment' },
              { key: 'assessment_type', label: 'Type', render: (row) => valueLabel(row.assessment_type) },
              { key: 'subject_name', label: 'Subject' },
              { key: 'source_label', label: 'Source', render: (row) => row.source_label || '-' },
              { key: 'score', label: 'Score', render: (row) => `${row.score ?? '-'} / ${row.total_marks || '-'}` },
              { key: 'percentage', label: 'Result', render: (row) => row.percentage === null || row.percentage === undefined ? (row.grade || '-') : `${row.percentage}%${row.grade ? ` · ${row.grade}` : ''}` },
              { key: 'status', label: 'Status', render: (row) => valueLabel(row.status) },
              { key: 'teacher_name', label: 'Teacher', render: (row) => row.teacher_name || '-' },
            ]}
            rows={assessmentRows}
            emptyMessage="No mid-term or classroom assessment results are available yet."
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

      <EditStudentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        form={editForm}
        setForm={setEditForm}
        classes={classes}
        photoPreviewUrl={pendingPhotoPreview}
        onPhotoChange={handleEditPhotoChange}
        onSave={saveEditProfile}
        saving={savingProfile}
        error={editError}
      />

      <Dialog open={photoPreviewOpen} onOpenChange={setPhotoPreviewOpen}>
        <DialogContent className="max-w-[min(760px,calc(100vw-32px))] rounded-[10px] border-[#dbe1ea] bg-white p-4">
          <DialogTitle className="sr-only">Student photo preview</DialogTitle>
          <StudentPhotoPreview student={student} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
