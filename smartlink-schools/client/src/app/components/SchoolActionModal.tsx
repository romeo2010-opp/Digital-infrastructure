import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ModalShell } from './ModalShell'
import { StudentCreationWizard } from './StudentCreationWizard'
import { usePortal } from '../lib/portalContext'
import { resolvePortalAssetUrl } from '../lib/portalApi'

export type SchoolActionKind =
  | 'class'
  | 'student'
  | 'parent'
  | 'payment'
  | 'attendance'
  | 'homework'
  | 'message'
  | 'assessment'
  | 'insights'
  | 'report'
  | 'filters'

const actionMeta: Record<SchoolActionKind, { title: string; description: string; submit: string }> = {
  class: { title: 'Create Class', description: 'Add a class and optionally assign a teacher.', submit: 'Create class' },
  student: { title: 'Add Student', description: 'Create a learner record linked to a class.', submit: 'Save student' },
  parent: { title: 'Activate Guardian Parent Access', description: 'Use the guardian already recorded on the learner. This adds login access; it does not create a separate parent record.', submit: 'Activate parent access' },
  payment: { title: 'Record Payment', description: 'Post a fee payment and generate a receipt.', submit: 'Record payment' },
  attendance: { title: 'Mark Attendance', description: 'Update one learner attendance state for today.', submit: 'Save attendance' },
  homework: { title: 'Create Homework', description: 'Publish homework to a class and subject.', submit: 'Create homework' },
  message: { title: 'Compose Message', description: 'Send a parent or class communication.', submit: 'Queue message' },
  assessment: { title: 'Create Assessment', description: 'Create an assessment with one starter topic.', submit: 'Create assessment' },
  insights: { title: 'Generate Insights', description: 'Select the scope for academic support insight.', submit: 'Generate view' },
  report: { title: 'Create Report', description: 'Prepare a school report export request.', submit: 'Prepare report' },
  filters: { title: 'Filters', description: 'Filter the visible school records.', submit: 'Apply filters' },
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function selectClassName() {
  return 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
}

function labelClassName() {
  return 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read image file.'))
    reader.readAsDataURL(file)
  })
}

export function SchoolActionModal({
  open,
  action,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  action: SchoolActionKind
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const { token, api, runAction } = usePortal()
  const meta = actionMeta[action]
  const [classes, setClasses] = useState<any[]>([])
  const [subjects, setSubjects] = useState<any[]>([])
  const [feeAccounts, setFeeAccounts] = useState<any[]>([])
  const [financeInvoices, setFinanceInvoices] = useState<any[]>([])
  const [attendanceRows, setAttendanceRows] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [guardianRows, setGuardianRows] = useState<any[]>([])
  const [createdParent, setCreatedParent] = useState<any>(null)
  const [messageImageUploading, setMessageImageUploading] = useState(false)
  const [messageImageError, setMessageImageError] = useState('')
  const [form, setForm] = useState<any>({
    class_name: '',
    grade_level: '',
    teacher_user_id: '',
    admission_no: '',
    first_name: '',
    last_name: '',
    class_id: '',
    date_of_birth: '',
    gender: '',
    fee_account_id: '',
    invoice_id: '',
    invoice_no: '',
    amount: '',
    payment_method: 'cash',
    payment_date: today(),
    allow_overpayment: false,
    reference: '',
    student_id: '',
    status: 'present',
    attendance_date: today(),
    subject_id: '',
    title: '',
    instructions: '',
    due_date: today(),
    message_type: 'announcement',
    subject: '',
    body: '',
    channel: 'sms_ready',
    audience_type: 'school',
    class_ids: [],
    image_url: '',
    image_name: '',
    poll_question: '',
    poll_options: '',
    responsible_teacher_id: '',
    name: '',
    term_name: 'Term 2 2026',
    total_marks: '100',
    topic_name: '',
    marks_allocated: '20',
    report_type: 'Term summary',
    date_from: today(),
    date_to: today(),
    parent_mode: 'create',
    guardian_key: '',
    parent_user_ref: '',
    parent_full_name: '',
    parent_email: '',
    parent_phone: '',
    parent_relationship: 'guardian',
  })

  useEffect(() => {
    if (!open || !token) return
    let cancelled = false
    Promise.all([
      api.listClasses?.(token).catch(() => ({ classes: [] })),
      api.listSubjects?.(token).catch(() => ({ subjects: [] })),
      api.listFeeAccounts?.(token).catch(() => ({ feeAccounts: [] })),
      api.listFinanceInvoices?.(token).catch(() => ({ invoices: [] })),
      api.listAttendance?.(token).catch(() => ({ attendance: [] })),
      api.listUsers?.(token).catch(() => ({ users: [] })),
      api.listParents?.(token).catch(() => ({ parents: [] })),
    ]).then(([classPayload, subjectPayload, feePayload, invoicePayload, attendancePayload, userPayload, parentPayload]) => {
      if (cancelled) return
      setClasses(classPayload?.classes || [])
      setSubjects(subjectPayload?.subjects || [])
      setFeeAccounts(feePayload?.feeAccounts || [])
      setFinanceInvoices(invoicePayload?.invoices || [])
      setAttendanceRows(attendancePayload?.attendance || [])
      setStaff(userPayload?.users || [])
      setGuardianRows(parentPayload?.parents || [])
    })
    return () => {
      cancelled = true
    }
  }, [api, open, token])

  useEffect(() => {
    if (!open) return
    setCreatedParent(null)
    if (action === 'parent') {
      setForm((current: any) => ({
        ...current,
        parent_mode: 'create',
        guardian_key: '',
        parent_user_ref: '',
        parent_full_name: '',
        parent_email: '',
        parent_phone: '',
        parent_relationship: 'guardian',
      }))
    }
  }, [action, open])

  const selectedAttendanceStudent = useMemo(
    () => attendanceRows.find((row) => String(row.student_id) === String(form.student_id)),
    [attendanceRows, form.student_id],
  )
  const selectedInvoice = useMemo(
    () => financeInvoices.find((row) => String(row.id) === String(form.invoice_id) || String(row.invoice_no || '').toLowerCase() === String(form.invoice_no || '').trim().toLowerCase()),
    [financeInvoices, form.invoice_id, form.invoice_no],
  )
  const selectedFeeAccount = useMemo(
    () => feeAccounts.find((row) => String(row.id) === String(form.fee_account_id)),
    [feeAccounts, form.fee_account_id],
  )
  const selectedClass = useMemo(
    () => classes.find((row) => String(row.id) === String(form.class_id)),
    [classes, form.class_id],
  )
  const homeworkSubjectOptions = useMemo(() => {
    const assignments = Array.isArray(selectedClass?.subject_assignments) ? selectedClass.subject_assignments : []
    const assignedSubjects = assignments
      .filter((row: any) => row.subject_id && row.subject_name)
      .map((row: any) => ({ id: row.subject_id, name: row.subject_name }))
    const source = assignedSubjects.length ? assignedSubjects : subjects
    const seen = new Set<string>()
    return source.filter((row: any) => {
      const key = String(row.id)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [selectedClass, subjects])
  const homeworkSubjectHint = selectedClass?.subject_assignments?.length
    ? 'Showing subjects assigned to this class.'
    : 'Showing all school subjects for this class.'
  const selectedGuardian = useMemo(
    () => guardianRows.find((row) => `${row.student_ref}:${row.guardian_number}` === form.guardian_key),
    [form.guardian_key, guardianRows],
  )
  const parentAccounts = useMemo(
    () => staff.filter((row) => row.role === 'parent' && row.is_active),
    [staff],
  )

  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }))
  const selectHomeworkClass = (value: string) => {
    setForm((current: any) => ({ ...current, class_id: value, subject_id: '' }))
  }
  const selectGuardianRecord = (value: string) => {
    const guardian = guardianRows.find((row) => `${row.student_ref}:${row.guardian_number}` === value)
    setForm((current: any) => ({
      ...current,
      guardian_key: value,
      parent_mode: guardian?.guardian_missing ? 'create' : current.parent_mode,
      parent_full_name: guardian?.guardian_name || current.parent_full_name,
      parent_email: guardian?.guardian_email || current.parent_email,
      parent_phone: guardian?.guardian_phone || current.parent_phone,
      parent_relationship: guardian?.relationship || current.parent_relationship || 'guardian',
    }))
  }

  const selectInvoiceNumber = (value: string) => {
    const invoice = financeInvoices.find((row) => String(row.invoice_no || '').toLowerCase() === value.trim().toLowerCase())
    setForm((current: any) => ({
      ...current,
      invoice_no: value,
      invoice_id: invoice?.id || '',
      fee_account_id: invoice?.fee_account_id || current.fee_account_id,
      amount: invoice && !current.amount
        ? String(Math.max(0, Number(invoice.total_amount || 0) - Number(invoice.amount_paid || 0)))
        : current.amount,
      reference: invoice && !current.reference ? invoice.invoice_no : current.reference,
    }))
  }

  const toggleClassId = (classId: any) => {
    const value = String(classId)
    setForm((current: any) => {
      const currentIds = (current.class_ids || []).map(String)
      const nextIds = currentIds.includes(value) ? currentIds.filter((id: string) => id !== value) : [...currentIds, value]
      return { ...current, class_ids: nextIds }
    })
  }

  const handleMessageImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setMessageImageError('')
    update('image_name', file?.name || '')
    update('image_url', '')
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setMessageImageError('Use a PNG, JPEG, or WebP image.')
      event.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessageImageError('Image must be 5MB or smaller.')
      event.target.value = ''
      return
    }
    if (!token) return

    setMessageImageUploading(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const uploaded = await api.uploadMessageImage(token, {
        file_name: file.name,
        file_type: file.type,
        data_url: dataUrl,
      })
      update('image_url', uploaded?.image_url || uploaded?.imageUrl || '')
    } catch (error: any) {
      update('image_name', '')
      update('image_url', '')
      setMessageImageError(error?.message || 'Unable to upload announcement image.')
      event.target.value = ''
    } finally {
      setMessageImageUploading(false)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return

    const run = async () => {
      if (action === 'class') {
        return api.createClass(token, {
          name: form.class_name,
          grade_level: form.grade_level || null,
          teacher_user_id: form.teacher_user_id || null,
        })
      }
      if (action === 'student') {
        return api.createStudent(token, {
          admission_no: form.admission_no,
          first_name: form.first_name,
          last_name: form.last_name,
          class_id: form.class_id || null,
          date_of_birth: form.date_of_birth || null,
          gender: form.gender || null,
        })
      }
      if (action === 'parent') {
        if (!selectedGuardian) throw new Error('Select the learner and guardian record to link.')
        const link = {
          student_ref: selectedGuardian.student_ref,
          guardian_number: Number(selectedGuardian.guardian_number),
        }
        if (form.parent_mode === 'link_existing') {
          return api.linkParentGuardian(token, form.parent_user_ref, link)
        }
        return api.createSchoolUser(token, {
          role: 'parent',
          full_name: form.parent_full_name,
          email: form.parent_email,
          phone: form.parent_phone || null,
          relationship: form.parent_relationship || 'guardian',
          ...link,
        })
      }
      if (action === 'payment') {
        return api.recordPayment(token, {
          fee_account_id: form.fee_account_id,
          invoice_id: form.invoice_id || null,
          invoice_no: form.invoice_no || null,
          amount: Number(form.amount || 0),
          payment_method: form.payment_method,
          payment_date: form.payment_date || today(),
          allow_overpayment: Boolean(form.allow_overpayment),
          reference: form.reference || null,
        })
      }
      if (action === 'attendance') {
        return api.markAttendance(token, {
          attendance_date: form.attendance_date || today(),
          class_id: selectedAttendanceStudent?.class_id || form.class_id,
          records: [{ student_id: form.student_id, status: form.status }],
        })
      }
      if (action === 'homework') {
        return api.createHomework(token, {
          class_id: form.class_id,
          subject_id: form.subject_id,
          title: form.title,
          instructions: form.instructions,
          due_date: form.due_date,
        })
      }
      if (action === 'message') {
        const selectedTeacher = staff.find((row) => String(row.id) === String(form.responsible_teacher_id))
        const pollOptions = String(form.poll_options || '')
          .split('\n')
          .map((option: string) => option.trim())
          .filter(Boolean)
          .slice(0, 6)
          .map((text: string, index: number) => ({ id: `option-${index + 1}`, text }))
        return api.createMessage(token, {
          message_type: form.message_type,
          subject: form.subject,
          body: form.body,
          recipient_scope: {
            type: form.audience_type === 'classes' ? 'classes' : 'school',
            class_ids: form.audience_type === 'classes' ? form.class_ids : [],
            image_url: form.image_url || null,
            poll: form.poll_question && pollOptions.length
              ? { question: form.poll_question, options: pollOptions }
              : null,
            responsible_teacher_id: form.responsible_teacher_id || null,
            responsible_teacher_name: selectedTeacher?.full_name || selectedTeacher?.name || null,
            reactions: ['Like', 'Love', 'Seen'],
          },
          channel: form.channel || 'in_app',
        })
      }
      if (action === 'assessment') {
        return api.createAssessment(token, {
          name: form.name,
          class_id: form.class_id,
          subject_id: form.subject_id,
          term_name: form.term_name,
          total_marks: Number(form.total_marks || 0),
          expected_difficulty: 'Medium',
          topics: form.topic_name
            ? [{ topic_name: form.topic_name, marks_allocated: Number(form.marks_allocated || 0), expected_difficulty: 'Medium' }]
            : [],
        })
      }
      return { ok: true }
    }

    const result = await runAction(run, `${meta.submit}...`, { refresh: false })
    onSaved?.()
    if (action === 'parent' && form.parent_mode === 'create' && result?.temporary_password) {
      setCreatedParent(result)
      return
    }
    onOpenChange(false)
  }

  const classSelect = (
    <select className={selectClassName()} value={form.class_id} onChange={(event) => update('class_id', event.target.value)}>
      <option value="">Select class</option>
      {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select>
  )

  const subjectSelect = (
    <select className={selectClassName()} value={form.subject_id} onChange={(event) => update('subject_id', event.target.value)}>
      <option value="">Select subject</option>
      {subjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select>
  )

  if (action === 'student') {
    return (
      <ModalShell
        open={open}
        onOpenChange={onOpenChange}
        title="Add Student"
        description="Create a learner through a validated school admission wizard."
        className="max-w-5xl"
        footer={<></>}
      >
        <StudentCreationWizard onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </ModalShell>
    )
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title={meta.title}
      description={meta.description}
      className={action === 'message' ? 'max-w-4xl' : ''}
      footer={(
        <>
          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => onOpenChange(false)}>{createdParent ? 'Done' : 'Cancel'}</Button>
          {!createdParent ? (
            <Button type="submit" form="school-action-form" disabled={messageImageUploading} className="h-8 rounded-[5px] text-[12px]">
              {messageImageUploading ? 'Uploading image...' : meta.submit}
            </Button>
          ) : null}
        </>
      )}
    >
      {createdParent ? (
        <div className="grid gap-3 rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] p-4 text-[12px] text-[#166534]">
          <div className="font-semibold">Parent login created and linked to {selectedGuardian?.first_name} {selectedGuardian?.last_name}.</div>
          <div className="grid gap-1 rounded-[5px] border border-[#dcfce7] bg-white p-3 text-[#111827]">
            <span><strong>Email:</strong> {createdParent.user?.email}</span>
            <span><strong>Temporary password:</strong> <code className="font-mono">{createdParent.temporary_password}</code></span>
          </div>
          <p>Share this password securely once. The parent must change it at first login.</p>
        </div>
      ) : (
      <form id="school-action-form" className="grid gap-3" onSubmit={submit}>
        {action === 'class' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input required placeholder="Class name, e.g. Year 5A" value={form.class_name} onChange={(event) => update('class_name', event.target.value)} className="h-8 text-[12px]" />
            <Input placeholder="Grade level, e.g. Year 5" value={form.grade_level} onChange={(event) => update('grade_level', event.target.value)} className="h-8 text-[12px]" />
            <select className={`${selectClassName()} sm:col-span-2`} value={form.teacher_user_id} onChange={(event) => update('teacher_user_id', event.target.value)}>
              <option value="">Assign teacher later</option>
              {staff.filter((row) => row.role === 'teacher').map((row) => (
                <option key={row.id} value={row.id}>{row.full_name || row.name || row.email}</option>
              ))}
            </select>
          </div>
        ) : null}

        {action === 'parent' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`${labelClassName()} sm:col-span-2`}>
              Access method
              <select className={selectClassName()} value={form.parent_mode} onChange={(event) => update('parent_mode', event.target.value)}>
                <option value="create">Activate login for this guardian</option>
                <option value="link_existing" disabled={Boolean(selectedGuardian?.guardian_missing)}>Use this guardian’s existing login</option>
              </select>
            </label>
            <label className={`${labelClassName()} sm:col-span-2`}>
              Learner and guardian
              <select required className={selectClassName()} value={form.guardian_key} onChange={(event) => selectGuardianRecord(event.target.value)}>
                <option value="">Select guardian record</option>
                {guardianRows.map((row) => (
                  <option key={row.guardian_ref || `${row.student_ref}:${row.guardian_number}`} value={`${row.student_ref}:${row.guardian_number}`} disabled={Boolean(row.parent_ref)}>
                    {row.first_name} {row.last_name} · {row.class_name} · {row.guardian_missing ? 'guardian not recorded' : `${row.guardian_name} (${row.relationship})`}{row.parent_ref ? ` · ${row.account_status.replaceAll('_', ' ')}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {form.parent_mode === 'link_existing' ? (
              <label className={`${labelClassName()} sm:col-span-2`}>
                Existing parent login
                <select required className={selectClassName()} value={form.parent_user_ref} onChange={(event) => update('parent_user_ref', event.target.value)}>
                  <option value="">Select parent account</option>
                  {parentAccounts.map((row) => <option key={row.public_ref} value={row.public_ref}>{row.full_name} · {row.email}</option>)}
                </select>
              </label>
            ) : (
              <>
                <Input required readOnly={!selectedGuardian?.guardian_missing} aria-label="Guardian name" placeholder="Guardian full name" value={form.parent_full_name} onChange={(event) => update('parent_full_name', event.target.value)} className={`h-8 text-[12px] sm:col-span-2 ${selectedGuardian?.guardian_missing ? '' : 'bg-[#f8fafc]'}`} />
                {selectedGuardian?.guardian_missing ? <select required className={selectClassName()} value={form.parent_relationship} onChange={(event) => update('parent_relationship', event.target.value)}><option value="guardian">Guardian</option><option value="mother">Mother</option><option value="father">Father</option><option value="grandparent">Grandparent</option><option value="aunt">Aunt</option><option value="uncle">Uncle</option><option value="other">Other</option></select> : null}
                <Input required type="email" placeholder="Login email" value={form.parent_email} onChange={(event) => update('parent_email', event.target.value)} className="h-8 text-[12px]" />
                <Input placeholder="Phone number" value={form.parent_phone} onChange={(event) => update('parent_phone', event.target.value)} className="h-8 text-[12px]" />
              </>
            )}
            {selectedGuardian ? <div className="sm:col-span-2 rounded-[6px] border border-[#dce3ed] bg-[#f8fafc] px-3 py-2 text-[12px] text-[#475569]">{selectedGuardian.guardian_missing ? <><strong>No guardian has been recorded for this learner yet.</strong> Saving will create the guardian as the canonical parent record and activate that same person’s login.</> : <><strong>{selectedGuardian.guardian_name} is already the parent/guardian record.</strong> This step only activates their Parent Portal login for {selectedGuardian.first_name} {selectedGuardian.last_name}.</>}</div> : null}
          </div>
        ) : null}

        {action === 'student' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input required placeholder="Admission number" value={form.admission_no} onChange={(event) => update('admission_no', event.target.value)} className="h-8 text-[12px]" />
            {classSelect}
            <Input required placeholder="First name" value={form.first_name} onChange={(event) => update('first_name', event.target.value)} className="h-8 text-[12px]" />
            <Input required placeholder="Last name" value={form.last_name} onChange={(event) => update('last_name', event.target.value)} className="h-8 text-[12px]" />
            <Input type="date" value={form.date_of_birth} onChange={(event) => update('date_of_birth', event.target.value)} className="h-8 text-[12px]" />
            <select className={selectClassName()} value={form.gender} onChange={(event) => update('gender', event.target.value)}>
              <option value="">Gender</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
            </select>
          </div>
        ) : null}

        {action === 'payment' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`${labelClassName()} sm:col-span-2`}>
              Invoice number
              <Input
                list="finance-invoice-number-options"
                placeholder="Type invoice number, e.g. INV-2026-T1-000125"
                value={form.invoice_no}
                onChange={(event) => selectInvoiceNumber(event.target.value)}
                className="h-8 text-[12px]"
              />
              <datalist id="finance-invoice-number-options">
                {financeInvoices.slice(0, 120).map((row) => (
                  <option key={row.id} value={row.invoice_no}>
                    {row.first_name} {row.last_name} - MWK {Number(Number(row.total_amount || 0) - Number(row.amount_paid || 0)).toLocaleString()}
                  </option>
                ))}
              </datalist>
            </label>
            {selectedInvoice ? (
              <div className="sm:col-span-2 rounded-[6px] border border-[#dce3ed] bg-[#f8fafc] px-3 py-2 text-[12px] font-medium text-[#475569]">
                <span className="font-semibold text-[#0f172a]">{selectedInvoice.invoice_no}</span>
                {' '}for {selectedInvoice.first_name} {selectedInvoice.last_name}
                {' '}has MWK {Number(Number(selectedInvoice.total_amount || 0) - Number(selectedInvoice.amount_paid || 0)).toLocaleString()} remaining.
              </div>
            ) : null}
            <select required={!form.invoice_no} className={selectClassName()} value={form.fee_account_id} onChange={(event) => update('fee_account_id', event.target.value)}>
              <option value="">Select fee account</option>
              {feeAccounts.map((row) => (
                <option key={row.id} value={row.id}>{row.first_name} {row.last_name} - MWK {Number(row.balance || 0).toLocaleString()}</option>
              ))}
            </select>
            {selectedFeeAccount && !selectedInvoice ? (
              <div className="sm:col-span-2 rounded-[6px] border border-[#dce3ed] bg-[#f8fafc] px-3 py-2 text-[12px] font-medium text-[#475569]">
                {selectedFeeAccount.first_name} {selectedFeeAccount.last_name}
                {' '}has MWK {Number(selectedFeeAccount.balance || 0).toLocaleString()} outstanding.
              </div>
            ) : null}
            <Input required type="number" min="1" step="0.01" placeholder="Amount" value={form.amount} onChange={(event) => update('amount', event.target.value)} className="h-8 text-[12px]" />
            <Input required type="date" value={form.payment_date} onChange={(event) => update('payment_date', event.target.value)} className="h-8 text-[12px]" />
            <select className={selectClassName()} value={form.payment_method} onChange={(event) => update('payment_method', event.target.value)}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mobile_money">Mobile money</option>
              <option value="cheque">Cheque</option>
              <option value="pos_card">POS card</option>
              <option value="other">Other</option>
            </select>
            <Input placeholder="Reference" value={form.reference} onChange={(event) => update('reference', event.target.value)} className="h-8 text-[12px]" />
            <label className="sm:col-span-2 flex items-start gap-2 rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[12px] font-medium text-[#475569]">
              <input
                type="checkbox"
                checked={Boolean(form.allow_overpayment)}
                onChange={(event) => update('allow_overpayment', event.target.checked)}
                className="mt-0.5 size-3.5"
              />
              <span>Allow overpayment only when intentionally recording a credit on this learner account.</span>
            </label>
          </div>
        ) : null}

        {action === 'attendance' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input type="date" value={form.attendance_date} onChange={(event) => update('attendance_date', event.target.value)} className="h-8 text-[12px]" />
            <select required className={selectClassName()} value={form.student_id} onChange={(event) => update('student_id', event.target.value)}>
              <option value="">Select learner</option>
              {attendanceRows.map((row) => <option key={row.student_id} value={row.student_id}>{row.first_name} {row.last_name} - {row.class_name}</option>)}
            </select>
            <select className={selectClassName()} value={form.status} onChange={(event) => update('status', event.target.value)}>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="sick">Sick</option>
            </select>
          </div>
        ) : null}

        {action === 'homework' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClassName()}>
              Class
              <select required className={selectClassName()} value={form.class_id} onChange={(event) => selectHomeworkClass(event.target.value)}>
                <option value="">Select class</option>
                {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label className={labelClassName()}>
              Subject
              <select required className={selectClassName()} value={form.subject_id} onChange={(event) => update('subject_id', event.target.value)} disabled={!form.class_id}>
                <option value="">{form.class_id ? 'Select subject' : 'Select class first'}</option>
                {homeworkSubjectOptions.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2 rounded-[6px] border border-[#dce3ed] bg-[#f8fafc] px-3 py-2 text-[12px] font-medium text-[#475569]">
              {form.class_id ? homeworkSubjectHint : 'Choose a class first so the assignment can be linked to the right learners.'}
            </div>
            <Input required placeholder="Homework title" value={form.title} onChange={(event) => update('title', event.target.value)} className="h-8 text-[12px] sm:col-span-2" />
            <label className={labelClassName()}>
              Due date
              <Input required type="date" value={form.due_date} onChange={(event) => update('due_date', event.target.value)} className="h-8 text-[12px]" />
            </label>
            <label className={labelClassName()}>
              Instructions
              <Input placeholder="Instructions" value={form.instructions} onChange={(event) => update('instructions', event.target.value)} className="h-8 text-[12px]" />
            </label>
          </div>
        ) : null}

        {action === 'message' ? (
          <div className="grid max-h-[68vh] gap-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClassName()}>
                Message type
                <select className={selectClassName()} value={form.message_type} onChange={(event) => update('message_type', event.target.value)}>
                  <option value="announcement">Announcement</option>
                  <option value="fee_reminder">Fee reminder</option>
                  <option value="homework_reminder">Homework reminder</option>
                  <option value="attendance_alert">Attendance alert</option>
                </select>
              </label>
              <label className={labelClassName()}>
                Channel
                <select className={selectClassName()} value={form.channel} onChange={(event) => update('channel', event.target.value)}>
                  <option value="in_app">In app</option>
                  <option value="sms_ready">SMS ready</option>
                  <option value="whatsapp_ready">WhatsApp ready</option>
                </select>
              </label>
              <label className={`${labelClassName()} sm:col-span-2`}>
                Subject
                <Input required placeholder="Announcement title" value={form.subject} onChange={(event) => update('subject', event.target.value)} className="h-8 text-[12px]" />
              </label>
              <label className={`${labelClassName()} sm:col-span-2`}>
                Message body
                <textarea
                  required
                  placeholder="Write the announcement parents and students should see."
                  value={form.body}
                  onChange={(event) => update('body', event.target.value)}
                  className="min-h-24 rounded-[5px] border border-[#d9dce3] bg-white px-2 py-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35"
                />
              </label>
            </div>

            <div className="grid gap-2 rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Audience</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-[5px] border border-[#e2e8f0] bg-white px-3 py-2 text-[12px] font-semibold text-[#111827]">
                  <input type="radio" checked={form.audience_type === 'school'} onChange={() => update('audience_type', 'school')} />
                  Whole school
                </label>
                <label className="flex items-center gap-2 rounded-[5px] border border-[#e2e8f0] bg-white px-3 py-2 text-[12px] font-semibold text-[#111827]">
                  <input type="radio" checked={form.audience_type === 'classes'} onChange={() => update('audience_type', 'classes')} />
                  Selected classes
                </label>
              </div>
              {form.audience_type === 'classes' ? (
                <div className="grid max-h-40 gap-2 overflow-y-auto rounded-[5px] border border-[#e2e8f0] bg-white p-2 sm:grid-cols-2">
                  {classes.map((row) => (
                    <label key={row.id} className="flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12px] font-medium text-[#111827] hover:bg-[#f1f5f9]">
                      <input type="checkbox" checked={(form.class_ids || []).map(String).includes(String(row.id))} onChange={() => toggleClassId(row.id)} />
                      {row.name}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClassName()}>
                Responsible teacher
                <select className={selectClassName()} value={form.responsible_teacher_id} onChange={(event) => update('responsible_teacher_id', event.target.value)}>
                  <option value="">No specific teacher</option>
                  {staff.filter((row) => ['teacher', 'headteacher'].includes(row.role)).map((row) => (
                    <option key={row.id} value={row.id}>{row.full_name || row.email}</option>
                  ))}
                </select>
              </label>
              <label className={labelClassName()}>
                Image
                <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleMessageImageChange} className="h-8 text-[12px]" />
              </label>
              {form.image_url || messageImageUploading || messageImageError ? (
                <div className="sm:col-span-2">
                  {form.image_url ? (
                    <div className="flex items-center gap-3 rounded-[6px] border border-[#e2e8f0] bg-white p-2">
                      <img src={resolvePortalAssetUrl(form.image_url)} alt="" className="h-14 w-20 rounded-[5px] object-cover" />
                      <div className="min-w-0 text-[12px] font-semibold text-[#111827]">
                        <div className="truncate">{form.image_name || 'Announcement image'}</div>
                        <button type="button" onClick={() => { update('image_url', ''); update('image_name', '') }} className="mt-1 text-[11px] font-semibold text-[#b91c1c]">Remove image</button>
                      </div>
                    </div>
                  ) : (
                    <div className={`text-[11px] font-semibold ${messageImageError ? 'text-[#b91c1c]' : 'text-[#64748b]'}`}>{messageImageUploading ? 'Uploading image...' : messageImageError}</div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 rounded-[6px] border border-[#e2e8f0] bg-white p-3">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Poll</div>
              <Input placeholder="Poll question, e.g. Which day works best for open day?" value={form.poll_question} onChange={(event) => update('poll_question', event.target.value)} className="h-8 text-[12px]" />
              <textarea
                placeholder="Poll options, one per line"
                value={form.poll_options}
                onChange={(event) => update('poll_options', event.target.value)}
                className="min-h-20 rounded-[5px] border border-[#d9dce3] bg-white px-2 py-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35"
              />
            </div>
          </div>
        ) : null}

        {action === 'assessment' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input required placeholder="Assessment name" value={form.name} onChange={(event) => update('name', event.target.value)} className="h-8 text-[12px]" />
            <Input placeholder="Term" value={form.term_name} onChange={(event) => update('term_name', event.target.value)} className="h-8 text-[12px]" />
            {classSelect}
            {subjectSelect}
            <Input type="number" placeholder="Total marks" value={form.total_marks} onChange={(event) => update('total_marks', event.target.value)} className="h-8 text-[12px]" />
            <Input placeholder="Starter topic" value={form.topic_name} onChange={(event) => update('topic_name', event.target.value)} className="h-8 text-[12px]" />
          </div>
        ) : null}

        {['insights', 'report', 'filters'].includes(action) ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {classSelect}
            <Input type="date" value={form.date_from} onChange={(event) => update('date_from', event.target.value)} className="h-8 text-[12px]" />
            <Input type="date" value={form.date_to} onChange={(event) => update('date_to', event.target.value)} className="h-8 text-[12px]" />
            <select className={selectClassName()} value={form.report_type} onChange={(event) => update('report_type', event.target.value)}>
              <option value="Term summary">Term summary</option>
              <option value="Attendance">Attendance</option>
              <option value="Fee arrears">Fee arrears</option>
              <option value="Academic support">Academic support</option>
            </select>
          </div>
        ) : null}
      </form>
      )}
    </ModalShell>
  )
}
