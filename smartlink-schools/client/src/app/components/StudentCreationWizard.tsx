import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router'
import { Check, ChevronLeft, ChevronRight, Printer, RotateCcw, UserRound } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { usePortal } from '../lib/portalContext'
import { resolvePortalAssetUrl } from '../lib/portalApi'

type WizardStep = 0 | 1 | 2 | 3 | 4

const steps = ['Student Identity', 'Academic Placement', 'Guardian / Parent Info', 'Fee Profile', 'Review & Confirm']

const initialForm = {
  first_name: '',
  last_name: '',
  date_of_birth: '',
  gender: '',
  national_id: '',
  profile_photo_name: '',
  profile_photo_url: '',
  class_id: '',
  stream_section: '',
  enrollment_date: new Date().toISOString().slice(0, 10),
  student_type: 'new',
  previous_school: '',
  guardian1: {
    full_name: '',
    relationship: '',
    primary_phone: '',
    secondary_phone: '',
    email: '',
    national_id: '',
  },
  guardian2_enabled: false,
  guardian2: {
    full_name: '',
    relationship: '',
    primary_phone: '',
    email: '',
    national_id: '',
  },
  fee_profile: {
    fee_category: 'standard',
    payment_plan: 'termly',
    discount_percent: '0',
    discount_reason: '',
  },
}

function selectClassName() {
  return 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
}

function labelClass() {
  return 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'
}

function valueLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function emailLooksOk(value: string) {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function phoneLooksOk(value: string) {
  if (!value) return true
  return /^[+0-9\s-]{7,20}$/.test(value)
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read image file.'))
    reader.readAsDataURL(file)
  })
}

function buildPrintHtml(created: any) {
  const student = created?.student || {}
  const guardian = student.guardian1 || {}
  const fee = student.fee_profile || {}
  const photoUrl = String(student.profile_photo_url || student.profilePhotoUrl || '')
  const generatedDate = new Date().toLocaleDateString()
  return `<!doctype html>
<html>
<head>
  <title>Admission Card ${student.student_id || ''}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
    .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 24px; max-width: 720px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .08em; color: #4b5563; }
    .id { font-size: 18px; font-weight: 700; margin-top: 16px; }
    .grid { display: grid; grid-template-columns: 180px 1fr; gap: 8px; font-size: 13px; }
    .label { color: #6b7280; font-weight: 700; }
    .head { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; }
    .photo { width:82px; height:82px; border:1px solid #d1d5db; border-radius:8px; object-fit:cover; background:#f3f4f6; }
    .placeholder { width:82px; height:82px; border:1px solid #d1d5db; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#6b7280; font-weight:700; background:#f3f4f6; }
    @media print { body { margin: 0; } .card { border: 0; } }
  </style>
</head>
<body>
  <section class="card">
    <div class="head">
      <div>
        <h1>${student.school_name || 'SmartLink Schools'}</h1>
        <div>Admission Card</div>
      </div>
      ${photoUrl ? `<img class="photo" src="${photoUrl}" alt="">` : `<div class="placeholder">${[student.first_name, student.last_name].filter(Boolean).map((part: string) => part[0]).join('').toUpperCase() || 'ST'}</div>`}
    </div>
    <div class="id">Student ID: ${student.student_id || '-'}</div>
    <h2>Student</h2>
    <div class="grid">
      <div class="label">Full name</div><div>${student.first_name || ''} ${student.last_name || ''}</div>
      <div class="label">Class / Grade</div><div>${student.class_name || '-'}</div>
      <div class="label">Stream / Section</div><div>${student.stream_section || '-'}</div>
      <div class="label">Enrollment date</div><div>${student.enrollment_date || '-'}</div>
    </div>
    <h2>Guardian</h2>
    <div class="grid">
      <div class="label">Guardian 1</div><div>${guardian.fullName || guardian.full_name || '-'}</div>
      <div class="label">Primary phone</div><div>${guardian.primaryPhone || guardian.primary_phone || '-'}</div>
    </div>
    <h2>Fee Profile</h2>
    <div class="grid">
      <div class="label">Fee category</div><div>${valueLabel(fee.feeCategory || fee.fee_category || '-')}</div>
      <div class="label">Payment plan</div><div>${valueLabel(fee.paymentPlan || fee.payment_plan || '-')}</div>
      <div class="label">Generated date</div><div>${generatedDate}</div>
    </div>
  </section>
  <script>window.print()</script>
</body>
</html>`
}

export function StudentCreationWizard({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const navigate = useNavigate()
  const { token, api, runAction, user } = usePortal()
  const [step, setStep] = useState<WizardStep>(0)
  const [form, setForm] = useState<any>(initialForm)
  const [classes, setClasses] = useState<any[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [created, setCreated] = useState<any>(null)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')
  const [photoError, setPhotoError] = useState('')

  useEffect(() => {
    if (!token) return
    api.listClasses(token).then((payload: any) => setClasses(payload?.classes || [])).catch(() => setClasses([]))
  }, [api, token])

  const selectedClass = useMemo(() => classes.find((row) => String(row.id) === String(form.class_id)), [classes, form.class_id])

  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }))
  const updateNested = (section: string, key: string, value: any) => setForm((current: any) => ({ ...current, [section]: { ...current[section], [key]: value } }))

  const handlePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setPhotoError('')
    update('profile_photo_name', file?.name || '')
    update('profile_photo_url', '')
    setPhotoPreviewUrl('')
    if (!file) return

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setPhotoError('Use a PNG or JPEG image.')
      event.target.value = ''
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setPhotoError('Photo must be 4MB or smaller.')
      event.target.value = ''
      return
    }
    if (!token) {
      setPhotoError('Sign in again before uploading a student photo.')
      event.target.value = ''
      return
    }

    setPhotoUploading(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setPhotoPreviewUrl(dataUrl)
      const uploaded = await api.uploadStudentPhoto(token, {
        file_name: file.name,
        file_type: file.type,
        data_url: dataUrl,
      })
      const uploadedUrl = uploaded?.profile_photo_url || uploaded?.profilePhotoUrl || ''
      update('profile_photo_url', uploadedUrl)
      setPhotoPreviewUrl(resolvePortalAssetUrl(uploadedUrl) || dataUrl)
    } catch (error: any) {
      update('profile_photo_name', '')
      update('profile_photo_url', '')
      setPhotoPreviewUrl('')
      setPhotoError(error?.message || 'Unable to upload student photo.')
      event.target.value = ''
    } finally {
      setPhotoUploading(false)
    }
  }

  const validateStep = (targetStep = step) => {
    const next: Record<string, string> = {}
    if (targetStep === 0) {
      if (!form.first_name.trim()) next.first_name = 'First name is required'
      if (!form.last_name.trim()) next.last_name = 'Last name is required'
      if (!form.date_of_birth) next.date_of_birth = 'Date of birth is required'
      if (!form.gender) next.gender = 'Gender is required'
    }
    if (targetStep === 1) {
      if (!form.class_id) next.class_id = 'Class / Grade is required'
      if (!form.enrollment_date) next.enrollment_date = 'Enrollment date is required'
      if (form.student_type === 'transfer' && !form.previous_school.trim()) next.previous_school = 'Previous school is required for transfers'
    }
    if (targetStep === 2) {
      if (!form.guardian1.full_name.trim()) next.guardian1_full_name = 'Guardian 1 name is required'
      if (!form.guardian1.relationship.trim()) next.guardian1_relationship = 'Relationship is required'
      if (!form.guardian1.primary_phone.trim()) next.guardian1_primary_phone = 'Primary phone is required'
      if (!phoneLooksOk(form.guardian1.primary_phone)) next.guardian1_primary_phone = 'Enter a valid phone number'
      if (!emailLooksOk(form.guardian1.email)) next.guardian1_email = 'Enter a valid email address'
      if (form.guardian2_enabled && !emailLooksOk(form.guardian2.email)) next.guardian2_email = 'Enter a valid email address'
    }
    if (targetStep === 3) {
      const discount = Number(form.fee_profile.discount_percent || 0)
      if (!form.fee_profile.fee_category) next.fee_category = 'Fee category is required'
      if (!form.fee_profile.payment_plan) next.payment_plan = 'Payment plan is required'
      if (!Number.isFinite(discount) || discount < 0 || discount > 100) next.discount_percent = 'Discount must be between 0 and 100'
      if (discount > 0 && !form.fee_profile.discount_reason.trim()) next.discount_reason = 'Discount reason is required'
    }
    setErrors(next)
    return !Object.keys(next).length
  }

  const next = () => {
    if (!validateStep()) return
    setStep((current) => Math.min(4, current + 1) as WizardStep)
  }

  const back = () => {
    setErrors({})
    setStep((current) => Math.max(0, current - 1) as WizardStep)
  }

  const submit = async () => {
    for (let index = 0; index <= 3; index += 1) {
      if (!validateStep(index as WizardStep)) {
        setStep(index as WizardStep)
        return
      }
    }
    if (!token) return
    const payload = {
      ...form,
      profile_photo_url: form.profile_photo_url || null,
      guardian2: form.guardian2_enabled ? form.guardian2 : null,
    }
    const result = await runAction(() => api.createStudent(token, payload), 'Creating student...', { refresh: false })
    setCreated(result)
    onSaved?.()
  }

  const reset = () => {
    setForm(initialForm)
    setStep(0)
    setErrors({})
    setCreated(null)
    setPhotoUploading(false)
    setPhotoPreviewUrl('')
    setPhotoError('')
  }

  const printAdmissionCard = () => {
    const popup = window.open('', '_blank', 'width=840,height=720')
    if (!popup) return
    popup.document.write(buildPrintHtml({
      ...created,
      student: {
        ...created?.student,
        profile_photo_url: resolvePortalAssetUrl(created?.student?.profile_photo_url || created?.student?.profilePhotoUrl || ''),
        school_name: user?.schoolName || user?.school_name,
      },
    }))
    popup.document.close()
  }

  if (created?.student) {
    const student = created.student
    return (
      <div className="grid gap-4">
        <div className="rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] p-4 text-[#166534]">
          <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.08em]">
            <Check className="size-4" />
            Student Created
          </div>
          <div className="mt-2 text-[24px] font-bold tracking-[-0.04em] text-[#111827]">ID: {student.student_id}</div>
          <div className="mt-1 text-[12px] font-medium">{student.first_name} {student.last_name} was added to {student.class_name}.</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={reset}><RotateCcw className="size-3.5" /> Add Another Student</Button>
          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={!student.public_ref} onClick={() => navigate(`/students/${student.public_ref}`)}><UserRound className="size-3.5" /> View Student Profile</Button>
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={printAdmissionCard}><Printer className="size-3.5" /> Print Admission Card</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="grid grid-cols-5 gap-1">
          {steps.map((item, index) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                if (index < step || validateStep()) setStep(index as WizardStep)
              }}
              className={`h-1.5 rounded-full ${index <= step ? 'bg-[#111827]' : 'bg-[#e5e7eb]'}`}
              aria-label={item}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
          <span>Step {step + 1} of 5</span>
          <span>{steps[step]}</span>
        </div>
      </div>

      {step === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First Name" error={errors.first_name}><Input value={form.first_name} onChange={(event) => update('first_name', event.target.value)} className="h-8 text-[12px]" /></Field>
          <Field label="Last Name" error={errors.last_name}><Input value={form.last_name} onChange={(event) => update('last_name', event.target.value)} className="h-8 text-[12px]" /></Field>
          <Field label="Date of Birth" error={errors.date_of_birth}><Input type="date" value={form.date_of_birth} onChange={(event) => update('date_of_birth', event.target.value)} className="h-8 text-[12px]" /></Field>
          <Field label="Gender" error={errors.gender}>
            <select className={selectClassName()} value={form.gender} onChange={(event) => update('gender', event.target.value)}>
              <option value="">Select gender</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
            </select>
          </Field>
          <Field label="National ID"><Input value={form.national_id} onChange={(event) => update('national_id', event.target.value)} className="h-8 text-[12px]" /></Field>
          <Field label="Profile Photo">
            <Input type="file" accept="image/png,image/jpeg" onChange={handlePhotoChange} className="h-8 text-[12px]" />
            <div className="flex items-center gap-2 normal-case tracking-normal">
              <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-[#e2e8f0] bg-[#f3f4f6] text-[11px] font-bold text-[#6b7280]">
                {photoPreviewUrl ? <img src={photoPreviewUrl} alt="" className="h-full w-full object-cover" /> : 'ST'}
              </div>
              <span className={`text-[10px] font-medium ${photoError ? 'text-[#dc2626]' : 'text-[#6b7280]'}`}>
                {photoUploading ? 'Uploading photo...' : photoError || (form.profile_photo_url ? 'Photo uploaded and will appear on reports.' : 'Optional. A placeholder appears when no photo is uploaded.')}
              </span>
            </div>
          </Field>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Class / Grade" error={errors.class_id}>
            <select className={selectClassName()} value={form.class_id} onChange={(event) => update('class_id', event.target.value)}>
              <option value="">Select class</option>
              {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Stream / Section"><Input value={form.stream_section} onChange={(event) => update('stream_section', event.target.value)} className="h-8 text-[12px]" /></Field>
          <Field label="Enrollment Date" error={errors.enrollment_date}><Input type="date" value={form.enrollment_date} onChange={(event) => update('enrollment_date', event.target.value)} className="h-8 text-[12px]" /></Field>
          <Field label="Student Type">
            <select className={selectClassName()} value={form.student_type} onChange={(event) => update('student_type', event.target.value)}>
              <option value="new">New</option>
              <option value="returning">Returning</option>
              <option value="transfer">Transfer</option>
            </select>
          </Field>
          {form.student_type === 'transfer' ? <Field label="Previous School" error={errors.previous_school}><Input value={form.previous_school} onChange={(event) => update('previous_school', event.target.value)} className="h-8 text-[12px]" /></Field> : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Guardian 1 Name" error={errors.guardian1_full_name}><Input value={form.guardian1.full_name} onChange={(event) => updateNested('guardian1', 'full_name', event.target.value)} className="h-8 text-[12px]" /></Field>
            <Field label="Relationship" error={errors.guardian1_relationship}><Input value={form.guardian1.relationship} onChange={(event) => updateNested('guardian1', 'relationship', event.target.value)} className="h-8 text-[12px]" /></Field>
            <Field label="Primary Phone" error={errors.guardian1_primary_phone}><Input value={form.guardian1.primary_phone} onChange={(event) => updateNested('guardian1', 'primary_phone', event.target.value)} className="h-8 text-[12px]" /></Field>
            <Field label="Secondary Phone"><Input value={form.guardian1.secondary_phone} onChange={(event) => updateNested('guardian1', 'secondary_phone', event.target.value)} className="h-8 text-[12px]" /></Field>
            <Field label="Email" error={errors.guardian1_email}><Input type="email" value={form.guardian1.email} onChange={(event) => updateNested('guardian1', 'email', event.target.value)} className="h-8 text-[12px]" /></Field>
            <Field label="National ID"><Input value={form.guardian1.national_id} onChange={(event) => updateNested('guardian1', 'national_id', event.target.value)} className="h-8 text-[12px]" /></Field>
          </div>
          <button type="button" className="h-8 justify-self-start rounded-[5px] border border-[#e2e8f0] px-3 text-[12px] font-semibold text-[#374151]" onClick={() => update('guardian2_enabled', !form.guardian2_enabled)}>
            {form.guardian2_enabled ? 'Remove second guardian' : 'Add second guardian'}
          </button>
          {form.guardian2_enabled ? (
            <div className="grid gap-3 rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-3 sm:grid-cols-2">
              <Field label="Guardian 2 Name"><Input value={form.guardian2.full_name} onChange={(event) => updateNested('guardian2', 'full_name', event.target.value)} className="h-8 text-[12px]" /></Field>
              <Field label="Relationship"><Input value={form.guardian2.relationship} onChange={(event) => updateNested('guardian2', 'relationship', event.target.value)} className="h-8 text-[12px]" /></Field>
              <Field label="Phone"><Input value={form.guardian2.primary_phone} onChange={(event) => updateNested('guardian2', 'primary_phone', event.target.value)} className="h-8 text-[12px]" /></Field>
              <Field label="Email" error={errors.guardian2_email}><Input type="email" value={form.guardian2.email} onChange={(event) => updateNested('guardian2', 'email', event.target.value)} className="h-8 text-[12px]" /></Field>
              <Field label="National ID"><Input value={form.guardian2.national_id} onChange={(event) => updateNested('guardian2', 'national_id', event.target.value)} className="h-8 text-[12px]" /></Field>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fee Category" error={errors.fee_category}>
            <select className={selectClassName()} value={form.fee_profile.fee_category} onChange={(event) => updateNested('fee_profile', 'fee_category', event.target.value)}>
              <option value="standard">Standard</option>
              <option value="bursary">Bursary</option>
              <option value="scholarship">Scholarship</option>
              <option value="staff_child">Staff Child</option>
            </select>
          </Field>
          <Field label="Payment Plan" error={errors.payment_plan}>
            <select className={selectClassName()} value={form.fee_profile.payment_plan} onChange={(event) => updateNested('fee_profile', 'payment_plan', event.target.value)}>
              <option value="monthly">Monthly</option>
              <option value="termly">Termly</option>
              <option value="annual">Annual</option>
            </select>
          </Field>
          <Field label="Discount (%)" error={errors.discount_percent}><Input type="number" min="0" max="100" value={form.fee_profile.discount_percent} onChange={(event) => updateNested('fee_profile', 'discount_percent', event.target.value)} className="h-8 text-[12px]" /></Field>
          <Field label="Discount Reason" error={errors.discount_reason}><Input value={form.fee_profile.discount_reason} onChange={(event) => updateNested('fee_profile', 'discount_reason', event.target.value)} className="h-8 text-[12px]" /></Field>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <SummaryBlock title="Student Identity" onEdit={() => setStep(0)} rows={[['Name', `${form.first_name} ${form.last_name}`], ['Date of birth', form.date_of_birth], ['Gender', form.gender], ['National ID', form.national_id || '-'], ['Photo', form.profile_photo_url ? form.profile_photo_name || 'Uploaded' : 'Placeholder will be used']]} />
          <SummaryBlock title="Academic Placement" onEdit={() => setStep(1)} rows={[['Class', selectedClass?.name || '-'], ['Stream / Section', form.stream_section || '-'], ['Enrollment date', form.enrollment_date], ['Student type', valueLabel(form.student_type)], ['Previous school', form.previous_school || '-']]} />
          <SummaryBlock title="Guardian / Parent Info" onEdit={() => setStep(2)} rows={[['Guardian 1', form.guardian1.full_name], ['Relationship', form.guardian1.relationship], ['Primary phone', form.guardian1.primary_phone], ['Email', form.guardian1.email || '-'], ['Guardian 2', form.guardian2_enabled ? form.guardian2.full_name || '-' : 'Not added']]} />
          <SummaryBlock title="Fee Profile" onEdit={() => setStep(3)} rows={[['Fee category', valueLabel(form.fee_profile.fee_category)], ['Payment plan', valueLabel(form.fee_profile.payment_plan)], ['Discount', `${Number(form.fee_profile.discount_percent || 0)}%`], ['Reason', form.fee_profile.discount_reason || '-']]} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e2e8f0] pt-3">
        <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={step === 0 ? onClose : back}>
          <ChevronLeft className="size-3.5" />
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < 4 ? (
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={next}>
            Next
            <ChevronRight className="size-3.5" />
          </Button>
        ) : (
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={submit} disabled={photoUploading}>
            {photoUploading ? 'Uploading Photo...' : 'Create Student'}
          </Button>
        )}
      </div>
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: any }) {
  return (
    <label className={labelClass()}>
      {label}
      {children}
      {error ? <span className="text-[10px] font-semibold normal-case tracking-normal text-[#dc2626]">{error}</span> : null}
    </label>
  )
}

function SummaryBlock({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  return (
    <article className="rounded-[6px] border border-[#e2e8f0] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#111827]">{title}</h3>
        <button type="button" onClick={onEdit} className="text-[11px] font-semibold text-[#1557dc]">Edit Section</button>
      </div>
      <div className="mt-2 grid gap-1.5 text-[12px]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
            <span className="font-semibold text-[#6b7280]">{label}</span>
            <span className="min-w-0 break-words text-[#111827]">{value || '-'}</span>
          </div>
        ))}
      </div>
    </article>
  )
}
