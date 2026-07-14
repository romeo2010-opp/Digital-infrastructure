import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { FileText, ImagePlus, PencilLine, Printer, Save, UserX } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { PageBackButton } from '../components/PageBackButton'
import { usePortal } from '../lib/portalContext'
import { resolvePortalAssetUrl } from '../lib/portalApi'

const inputClassName = 'h-10 min-w-0 rounded-[7px] border-[#d9dce3] bg-white text-[13px] font-medium text-[#111827]'
const selectClassName = 'h-10 min-w-0 w-full rounded-[7px] border border-[#d9dce3] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const fieldLabelClassName = 'grid min-w-0 gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'

const withdrawalReasons = [
  'Transferred to another school',
  'Medical leave',
  'Disciplinary suspension',
  'Financial hold',
  'Family relocation',
  'Temporary absence',
  'Other',
]

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

function money(value: any) {
  return `MWK ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
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

function isAbsentResult(row: any) {
  return Boolean(row?.absent) || String(row?.status || row?.entry_status || '').toLowerCase() === 'absent'
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

function WithdrawalDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSubmit,
  saving,
  error,
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  form: any
  setForm: (updater: any) => void
  onSubmit: () => void
  saving: boolean
  error: string
}) {
  const update = (key: string, value: any) => setForm((current: any) => ({ ...(current || {}), [key]: value }))
  const temporary = String(form?.withdrawal_type || 'temporary') === 'temporary'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex !w-[min(760px,calc(100vw-32px))] !max-w-[min(760px,calc(100vw-32px))] max-h-[calc(100vh-32px)] flex-col overflow-hidden rounded-[10px] border-[#dbe1ea] bg-white p-0 sm:!max-w-[min(760px,calc(100vw-32px))]">
        <DialogHeader className="shrink-0 border-b border-[#e2e8f0] px-6 py-4">
          <DialogTitle className="text-[18px] font-bold tracking-[-0.025em] text-[#111827]">Withdraw Student</DialogTitle>
          <DialogDescription className="text-[12px] font-medium text-[#64748b]">Create a temporary or permanent withdrawal record for this learner.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 overflow-y-auto px-6 py-5">
          {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

          <EditField label="Withdrawal Reason">
            <Input list="withdrawal-reasons" value={form?.reason || ''} onChange={(event) => update('reason', event.target.value)} className={inputClassName} placeholder="Reason is required" />
            <datalist id="withdrawal-reasons">
              {withdrawalReasons.map((reason) => <option key={reason} value={reason} />)}
            </datalist>
          </EditField>

          <div className="grid gap-4 md:grid-cols-3">
            <EditField label="Duration Type">
              <select value={form?.withdrawal_type || 'temporary'} onChange={(event) => update('withdrawal_type', event.target.value)} className={selectClassName}>
                <option value="temporary">Temporary</option>
                <option value="permanent">Permanent</option>
              </select>
            </EditField>
            <EditField label="Start Date">
              <Input type="date" value={form?.start_date || ''} onChange={(event) => update('start_date', event.target.value)} className={inputClassName} />
            </EditField>
            <EditField label="End Date">
              <Input type="date" value={form?.end_date || ''} onChange={(event) => update('end_date', event.target.value)} className={inputClassName} disabled={!temporary} required={temporary} />
            </EditField>
          </div>

          <EditField label="Notes">
            <Textarea value={form?.notes || ''} onChange={(event) => update('notes', event.target.value)} className="min-h-[96px] rounded-[7px] border-[#d9dce3] bg-white text-[13px] font-medium text-[#111827]" placeholder="Optional internal note" />
          </EditField>

          <label className="flex items-start gap-3 rounded-[7px] border border-[#e2e8f0] bg-[#f8fafc] p-3 text-[12px] font-medium leading-5 text-[#475569]">
            <input type="checkbox" checked={Boolean(form?.confirmed)} onChange={(event) => update('confirmed', event.target.checked)} className="mt-1 size-4 rounded border-[#cbd5e1]" />
            <span>I confirm this withdrawal record is correct and should affect marks entry for overlapping exam dates.</span>
          </label>
        </div>

        <DialogFooter className="shrink-0 border-t border-[#e2e8f0] bg-[#f8fafc] px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-9 rounded-[7px] text-[12px]" disabled={saving}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={onSubmit} className="h-9 rounded-[7px] text-[12px]" disabled={saving || !form?.confirmed}>
            <UserX className="size-3.5" />
            {saving ? 'Withdrawing...' : 'Withdraw Student'}
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
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawForm, setWithdrawForm] = useState<any>({})
  const [withdrawError, setWithdrawError] = useState('')
  const [savingWithdrawal, setSavingWithdrawal] = useState(false)
  const [cancellingWithdrawalId, setCancellingWithdrawalId] = useState<any>(null)
  const [trendSelection, setTrendSelection] = useState('exam_sessions')
  const [academicIntelligence, setAcademicIntelligence] = useState<any>(null)
  const [parentInsightBusy, setParentInsightBusy] = useState('')

  useEffect(() => {
    if (!token || !studentId) return
    api.getStudent(token, studentId)
      .then((payload: any) => setStudent(payload?.student || null))
      .catch((err: any) => setError(err?.message || 'Unable to load student profile.'))
  }, [api, studentId, token])

  useEffect(() => {
    if (!token || !studentId || !(user?.permissions || []).includes('ACADEMIC_INTELLIGENCE_VIEW')) return
    api.getStudentAcademicIntelligence(token, studentId)
      .then((payload: any) => setAcademicIntelligence(payload))
      .catch(() => setAcademicIntelligence(null))
  }, [api, studentId, token, user?.permissions])

  const refreshAcademicIntelligence = async () => {
    if (!token || !studentId) return
    const payload = await api.getStudentAcademicIntelligence(token, studentId)
    setAcademicIntelligence(payload)
  }

  const prepareParentInsight = async () => {
    if (!token || !studentId) return
    setParentInsightBusy('create')
    setError('')
    try {
      await api.createParentAcademicInsight(token, { student_ref: studentId })
      await refreshAcademicIntelligence()
    } catch (err: any) {
      setError(err?.message || 'Unable to prepare the parent-safe progress update.')
    } finally {
      setParentInsightBusy('')
    }
  }

  const changeParentInsightStatus = async (insightRef: string, status: string) => {
    if (!token) return
    setParentInsightBusy(`${insightRef}:${status}`)
    setError('')
    try {
      await api.updateParentAcademicInsight(token, insightRef, { status })
      await refreshAcademicIntelligence()
    } catch (err: any) {
      setError(err?.message || `Unable to ${status} the parent-safe progress update.`)
    } finally {
      setParentInsightBusy('')
    }
  }

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

  const openWithdrawStudent = () => {
    const today = new Date().toISOString().slice(0, 10)
    setWithdrawError('')
    setWithdrawForm({
      reason: '',
      withdrawal_type: 'temporary',
      start_date: today,
      end_date: '',
      notes: '',
      confirmed: false,
    })
    setWithdrawOpen(true)
  }

  const submitWithdrawal = async () => {
    if (!token || !studentId) return
    setWithdrawError('')
    const type = String(withdrawForm.withdrawal_type || 'temporary')
    if (!String(withdrawForm.reason || '').trim()) {
      setWithdrawError('Withdrawal reason is required.')
      return
    }
    if (!withdrawForm.start_date) {
      setWithdrawError('Withdrawal start date is required.')
      return
    }
    if (type === 'temporary' && !withdrawForm.end_date) {
      setWithdrawError('Temporary withdrawals require an end date.')
      return
    }
    if (type === 'temporary' && withdrawForm.end_date < withdrawForm.start_date) {
      setWithdrawError('End date cannot be before start date.')
      return
    }
    if (!withdrawForm.confirmed) {
      setWithdrawError('Confirm the withdrawal before saving.')
      return
    }

    setSavingWithdrawal(true)
    try {
      await runAction(async () => {
        await api.createStudentWithdrawal(token, studentId, {
          reason: withdrawForm.reason,
          withdrawal_type: type,
          start_date: withdrawForm.start_date,
          end_date: type === 'temporary' ? withdrawForm.end_date : null,
          notes: withdrawForm.notes,
        })
        const fresh = await api.getStudent(token, studentId)
        setStudent(fresh?.student || null)
        setWithdrawOpen(false)
        return fresh
      }, 'Withdrawing student...', { refresh: false })
    } catch (err: any) {
      setWithdrawError(err?.message || 'Unable to withdraw student.')
    } finally {
      setSavingWithdrawal(false)
    }
  }

  const cancelWithdrawal = async (withdrawal: any) => {
    if (!token || !studentId || !withdrawal?.id) return
    if (!window.confirm('Cancel this withdrawal record? Cancelled withdrawals will no longer affect result entry.')) return
    setCancellingWithdrawalId(withdrawal.id)
    setError('')
    try {
      await runAction(async () => {
        await api.cancelStudentWithdrawal(token, studentId, withdrawal.id, { reason: 'Cancelled from student profile' })
        const fresh = await api.getStudent(token, studentId)
        setStudent(fresh?.student || null)
        return fresh
      }, 'Cancelling withdrawal...', { refresh: false })
    } catch (err: any) {
      setError(err?.message || 'Unable to cancel withdrawal.')
    } finally {
      setCancellingWithdrawalId(null)
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
  const trendSubjects = useMemo(() => [...new Set(assessmentRows.map((row: any) => row.subject_name).filter(Boolean))].sort(), [assessmentRows])
  const performanceTrend = useMemo(() => {
    if (trendSelection === 'exam_sessions') {
      return examReports
        .filter((report: any) => Number.isFinite(Number(report.average_score)))
        .map((report: any) => ({
          date: String(report.generated_at || report.updated_at || report.created_at || '').slice(0, 10),
          label: report.exam_session_name || `${report.term_name || 'Term'} exam`,
          assessment: report.exam_session_name || 'Exam session',
          average: Number(Number(report.average_score).toFixed(1)),
          results: Number(report.subject_count || report.subjects?.length || 0),
        }))
        .sort((a: any, b: any) => a.date.localeCompare(b.date))
    }
    const subjectName = trendSelection.replace(/^subject:/, '')
    return assessmentRows
      .filter((row: any) => row.subject_name === subjectName && !isAbsentResult(row))
      .map((row: any) => {
        const percentage = row.percentage === null || row.percentage === undefined
          ? (row.score === null || row.score === undefined || !Number(row.total_marks) ? null : (Number(row.score) / Number(row.total_marks)) * 100)
          : Number(row.percentage)
        const date = String(row.result_date || row.instance_date || row.last_saved_at || '').slice(0, 10)
        const assessment = row.assessment_name || row.source_label || 'Assessment'
        return percentage === null || !Number.isFinite(percentage) ? null : { date, label: assessment, assessment, average: Number(percentage.toFixed(1)), results: 1 }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.date.localeCompare(b.date))
  }, [assessmentRows, examReports, trendSelection])
  const canEditProfile = ['school_owner', 'director', 'owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())
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
            <PageBackButton fallback={backPath} className="mb-3" />
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
            {canEditProfile ? (
              <Button type="button" variant="outline" onClick={openWithdrawStudent} className="h-8 rounded-[5px] text-[12px]">
                <UserX className="size-3.5" />
                Withdraw Student
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

      {academicIntelligence ? (
        <div className="order-[99] grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          <SectionCard title="Academic Intelligence" subtitle="Mastery is confidence-aware and distinguishes missing evidence from low performance.">
            <PortalTable
              columns={[
                { key: 'subject_name', label: 'Subject' },
                { key: 'topic_name', label: 'Topic', render: (row) => row.topic_name || 'Subject overview' },
                { key: 'mastery_score', label: 'Mastery', render: (row) => row.mastery_score === null ? 'Not assessed' : `${Number(row.mastery_score).toFixed(1)}%` },
                { key: 'confidence_score', label: 'Confidence', render: (row) => `${Number(row.confidence_score || 0).toFixed(0)}%` },
                { key: 'mastery_status', label: 'Status', render: (row) => valueLabel(row.mastery_status) },
                { key: 'trend', label: 'Trend', render: (row) => valueLabel(row.trend) },
                { key: 'evidence_count', label: 'Evidence' },
              ]}
              rows={academicIntelligence.mastery || []}
              emptyMessage="No mastery evidence is available yet. This does not mean low mastery."
            />
          </SectionCard>
          <SectionCard title="Recommended next actions" subtitle="Evidence-based support and active intervention history.">
            <div className="divide-y divide-[#e2e8f0]">
              {(academicIntelligence.recommendations || []).map((row: any) => (
                <article key={row.public_ref} className="p-4">
                  <div className="text-[12px] font-semibold text-[#111827]">{row.title}</div>
                  <div className="mt-1 text-[11px] leading-5 text-[#64748b]">{row.reason}</div>
                  <div className="mt-2 text-[11px] font-medium text-[#334155]">Next: {row.suggested_action}</div>
                </article>
              ))}
              {!(academicIntelligence.recommendations || []).length ? <div className="p-6 text-center text-[12px] text-[#64748b]">No active recommendation for this student.</div> : null}
            </div>
          </SectionCard>

          <SectionCard title="Exam-readiness forecast" subtitle="A forecast from available evidence, not a guaranteed examination result.">
            <div className="divide-y divide-[#e2e8f0]">
              {(academicIntelligence.exam_readiness || []).map((row: any) => (
                <article key={row.public_ref} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[12px] font-semibold text-[#111827]">{row.subject_name || 'Overall readiness'}</div>
                      <div className="mt-1 text-[11px] text-[#64748b]">Updated {row.calculated_at ? new Date(row.calculated_at).toLocaleDateString() : 'from current evidence'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[20px] font-semibold tracking-[-0.04em] text-[#6d28d9]">{Number(row.readiness_score || 0).toFixed(0)}%</div>
                      <div className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#94a3b8]">{Number(row.confidence_score || 0).toFixed(0)}% confidence</div>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#ede9fe]" role="progressbar" aria-label={`${row.subject_name || 'Overall'} exam readiness`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(row.readiness_score || 0))}>
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#6d28d9,#db2777)]" style={{ width: `${Math.max(0, Math.min(100, Number(row.readiness_score || 0)))}%` }} />
                  </div>
                  {row.missing_data?.length ? <p className="mt-2 text-[10px] leading-5 text-[#92400e]">Confidence is limited because {row.missing_data.map((item: string) => valueLabel(item).toLowerCase()).join(', ')} data is missing.</p> : null}
                  {row.recommendations?.length ? <p className="mt-2 text-[11px] leading-5 text-[#475569]">Next: {row.recommendations[0]}</p> : null}
                </article>
              ))}
              {!(academicIntelligence.exam_readiness || []).length ? <div className="p-6 text-center text-[12px] text-[#64748b]">Readiness will appear after sufficient curriculum and assessment evidence is available.</div> : null}
            </div>
          </SectionCard>

          <SectionCard title="Academic interventions" subtitle="Assigned support, review dates and completed outcomes.">
            <div className="divide-y divide-[#e2e8f0]">
              {(academicIntelligence.interventions || []).map((row: any) => (
                <article key={row.public_ref} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[12px] font-semibold text-[#111827]">{valueLabel(row.intervention_type)}</div>
                    <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#475569]">{valueLabel(row.status)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-[#64748b]">{row.issue}</p>
                  <div className="mt-2 text-[10px] font-semibold text-[#475569]">{row.subject_name}{row.topic_name ? ` · ${row.topic_name}` : ''}{row.review_date ? ` · Review ${String(row.review_date).slice(0, 10)}` : ''}</div>
                  {row.outcome ? <p className="mt-2 rounded-[6px] bg-[#f0fdf4] px-3 py-2 text-[11px] leading-5 text-[#166534]">Outcome: {row.outcome}</p> : null}
                </article>
              ))}
              {!(academicIntelligence.interventions || []).length ? <div className="p-6 text-center text-[12px] text-[#64748b]">No academic intervention has been recorded for this student.</div> : null}
            </div>
          </SectionCard>

          {(user?.permissions || []).includes('ACADEMIC_INTERVENTION_MANAGE') || (user?.permissions || []).includes('ACADEMIC_INTELLIGENCE_MANAGE') ? (
            <SectionCard
              className="xl:col-span-2"
              title="Parent-safe academic updates"
              subtitle="Prepare a plain-language summary from school evidence. Parents only see it after academic approval and publication."
              actions={(user?.permissions || []).includes('ACADEMIC_INTERVENTION_MANAGE') ? (
                <Button type="button" onClick={prepareParentInsight} disabled={Boolean(parentInsightBusy)} className="h-8 rounded-[6px] text-[11px]">
                  {parentInsightBusy === 'create' ? 'Preparing...' : 'Prepare update'}
                </Button>
              ) : null}
            >
              <div className="divide-y divide-[#e2e8f0]">
                {(academicIntelligence.parent_insights || []).map((insight: any) => (
                  <article key={insight.public_ref} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-[#111827]">{insight.headline}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${insight.status === 'published' ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]' : insight.status === 'approved' ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]' : 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'}`}>{valueLabel(insight.status)}</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-[#64748b]">{insight.summary_text}</p>
                      <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#94a3b8]">{insight.subject_name || 'Overall learning'} · {insight.reporting_period || 'Current period'}</div>
                    </div>
                    {(user?.permissions || []).includes('ACADEMIC_INTELLIGENCE_MANAGE') ? (
                      <div className="flex flex-wrap gap-2">
                        {insight.status === 'draft' ? <Button type="button" variant="outline" onClick={() => changeParentInsightStatus(insight.public_ref, 'approved')} disabled={Boolean(parentInsightBusy)} className="h-8 rounded-[6px] text-[11px]">{parentInsightBusy === `${insight.public_ref}:approved` ? 'Approving...' : 'Approve'}</Button> : null}
                        {insight.status === 'approved' ? <Button type="button" onClick={() => changeParentInsightStatus(insight.public_ref, 'published')} disabled={Boolean(parentInsightBusy)} className="h-8 rounded-[6px] text-[11px]">{parentInsightBusy === `${insight.public_ref}:published` ? 'Publishing...' : 'Publish to parent'}</Button> : null}
                        {insight.status === 'published' ? <Button type="button" variant="outline" onClick={() => changeParentInsightStatus(insight.public_ref, 'withdrawn')} disabled={Boolean(parentInsightBusy)} className="h-8 rounded-[6px] text-[11px]">Withdraw</Button> : null}
                      </div>
                    ) : null}
                  </article>
                ))}
                {!(academicIntelligence.parent_insights || []).length ? <div className="p-6 text-center text-[12px] text-[#64748b]">No parent-safe academic update has been prepared for this student.</div> : null}
              </div>
            </SectionCard>
          ) : null}
        </div>
      ) : null}

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

        <SectionCard title="Fee Profile" subtitle="Live fee accounts, payments, approved discounts and payment-plan records">
          <div className="grid gap-4 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Row label="Fee Category" value={valueLabel(student?.fee_profile?.category || student?.fee_category)} />
              <Row label="Payment Plan" value={valueLabel(student?.fee_profile?.active_payment_plan?.status ? 'active installment plan' : student?.fee_profile?.configured_payment_plan)} />
              <Row label="Total Billed" value={money(student?.fee_profile?.summary?.billed)} />
              <Row label="Discounts Applied" value={money(student?.fee_profile?.summary?.discounts)} />
              <Row label="Total Paid" value={money(student?.fee_profile?.summary?.paid)} />
              <Row label="Outstanding Balance" value={money(student?.fee_profile?.summary?.outstanding)} />
            </div>
            <PortalTable
              columns={[
                { key: 'term_name', label: 'Account' },
                { key: 'amount_due', label: 'Due', render: (row) => money(row.amount_due) },
                { key: 'discount_amount', label: 'Discount', render: (row) => money(row.discount_amount) },
                { key: 'amount_paid', label: 'Paid', render: (row) => money(row.amount_paid) },
                { key: 'balance', label: 'Balance', render: (row) => money(row.balance) },
                { key: 'status', label: 'Status', render: (row) => valueLabel(row.status) },
              ]}
              rows={student?.fee_profile?.accounts || []}
              emptyMessage="No fee-account records have been generated for this student."
            />
            {(student?.fee_profile?.discounts || []).length ? (
              <div className="border-t border-[#e5e7eb] pt-3 text-[12px] text-[#475569]">
                <span className="font-semibold text-[#111827]">Latest discount:</span>{' '}
                {valueLabel(student.fee_profile.discounts[0].discount_type)} · {valueLabel(student.fee_profile.discounts[0].status)} · {student.fee_profile.discounts[0].reason || 'No reason recorded'}
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Withdrawals" subtitle="Temporary and permanent withdrawal history">
          <PortalTable
            columns={[
              { key: 'start_date', label: 'Start', render: (row) => row.start_date?.slice?.(0, 10) || row.start_date || '-' },
              { key: 'end_date', label: 'End', render: (row) => row.withdrawal_type === 'permanent' ? 'Permanent' : row.end_date?.slice?.(0, 10) || '-' },
              { key: 'withdrawal_type', label: 'Type', render: (row) => valueLabel(row.withdrawal_type) },
              { key: 'computed_status', label: 'Status', render: (row) => valueLabel(row.computed_status || row.status) },
              { key: 'reason', label: 'Reason' },
              { key: 'created_by_name', label: 'Created By', render: (row) => row.created_by_name || '-' },
              { key: 'created_at', label: 'Created', render: (row) => row.created_at ? new Date(row.created_at).toLocaleString() : '-' },
              {
                key: 'actions',
                label: 'Actions',
                render: (row) => canEditProfile && String(row.status) !== 'cancelled' ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-[#b91c1c] disabled:text-[#94a3b8]"
                    disabled={String(cancellingWithdrawalId || '') === String(row.id)}
                    onClick={(event) => {
                      event.stopPropagation()
                      cancelWithdrawal(row)
                    }}
                  >
                    {String(cancellingWithdrawalId || '') === String(row.id) ? 'Cancelling...' : 'Cancel'}
                  </button>
                ) : '-',
              },
            ]}
            rows={student?.withdrawals || []}
            emptyMessage="No withdrawal records are available."
          />
        </SectionCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <SectionCard title="Performance Trend" subtitle={trendSelection === 'exam_sessions' ? 'Average performance across official exam sessions' : `${trendSelection.replace(/^subject:/, '')} performance across recorded assessments`}>
          <div className="border-b border-[#eef0f3] px-4 py-3">
            <label className="grid max-w-[320px] gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
              Trend view
              <select value={trendSelection} onChange={(event) => setTrendSelection(event.target.value)} className="h-9 rounded-[7px] border border-[#d8dee8] bg-white px-3 text-[12px] font-semibold normal-case tracking-normal text-[#334155] outline-none focus:border-[#94a3b8]">
                <option value="exam_sessions">Exam session averages</option>
                {trendSubjects.map((subject) => <option key={subject} value={`subject:${subject}`}>{subject}</option>)}
              </select>
            </label>
          </div>
          {performanceTrend.length ? (
            <div className="h-[310px] px-3 pb-3 pt-5">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceTrend} margin={{ top: 8, right: 22, left: 0, bottom: 34 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="2 4" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} interval="preserveStartEnd" angle={-12} textAnchor="end" height={54} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} width={42} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(value) => `${value}%`} />
                  <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', boxShadow: '0 10px 30px rgba(15,23,42,.10)', fontSize: 12 }} formatter={(value: any) => [`${Number(value).toFixed(1)}%`, trendSelection === 'exam_sessions' ? 'Session average' : 'Score']} labelFormatter={(_, payload) => payload?.[0]?.payload ? `${payload[0].payload.assessment}${payload[0].payload.date ? ` · ${payload[0].payload.date}` : ''}` : ''} />
                  <Line type="monotone" dataKey="average" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3.5, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="grid min-h-[260px] place-items-center p-5 text-center text-[12px] text-[#64748b]">No scored results are available for this trend selection.</div>}
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
              { key: 'score', label: 'Score', render: (row) => isAbsentResult(row) ? 'Absent' : `${row.score ?? '-'} / ${row.total_marks || '-'}` },
              { key: 'percentage', label: 'Result', render: (row) => isAbsentResult(row) ? 'Absent' : row.percentage === null || row.percentage === undefined ? (row.grade || '-') : `${row.percentage}%${row.grade ? ` · ${row.grade}` : ''}` },
              { key: 'status', label: 'Status', render: (row) => valueLabel(row.status) },
              { key: 'teacher_name', label: 'Teacher', render: (row) => row.teacher_name || '-' },
            ]}
            rows={assessmentRows}
            emptyMessage="No mid-term or classroom assessment results are available yet."
          />
        </SectionCard>

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

      <WithdrawalDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        form={withdrawForm}
        setForm={setWithdrawForm}
        onSubmit={submitWithdrawal}
        saving={savingWithdrawal}
        error={withdrawError}
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
