import { useEffect, useMemo, useState } from 'react'
import { Edit3, Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { PortalTable } from './PortalTable'
import { SectionCard } from './SectionCard'
import { ModalShell } from './ModalShell'
import { usePortal } from '../lib/portalContext'

const initialForm = {
  teacher_id: '',
  class_id: '',
  subject_id: '',
  stream_section: '',
  academic_year_id: '',
  term_id: '',
  academic_year: String(new Date().getFullYear()),
  term: '',
  role: 'subject_teacher',
  is_active: true,
  notes: '',
}

function selectClassName() {
  return 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
}

export function TeacherAssignmentsPanel({ onChanged }: { onChanged?: () => void }) {
  const { token, api, user } = usePortal()
  const [classes, setClasses] = useState<any[]>([])
  const [subjects, setSubjects] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [assignments, setAssignments] = useState<any[]>([])
  const [session, setSession] = useState<any>(null)
  const [form, setForm] = useState<any>(initialForm)
  const [editingId, setEditingId] = useState<any>(null)
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const canManage = ['school_owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())

  const refresh = async () => {
    if (!token) return
    const [classPayload, subjectPayload, userPayload, assignmentPayload, sessionPayload] = await Promise.all([
      api.listClasses(token).catch(() => ({ classes: [] })),
      api.listSubjects(token).catch(() => ({ subjects: [] })),
      api.listUsers(token).catch(() => ({ users: [] })),
      api.listTeacherAssignments(token).catch(() => ({ assignments: [] })),
      api.getAcademicSession(token).catch(() => ({ years: [], terms: [] })),
    ])
    setClasses(classPayload?.classes || [])
    setSubjects(subjectPayload?.subjects || [])
    setUsers(userPayload?.users || [])
    setAssignments(assignmentPayload?.assignments || [])
    setSession(sessionPayload)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const teachers = useMemo(() => users.filter((row) => row.role === 'teacher'), [users])
  const grouped = useMemo(() => {
    return classes.map((classRow) => ({
      ...classRow,
      activeAssignments: assignments.filter((row) => Number(row.class_id) === Number(classRow.id) && row.is_active),
    }))
  }, [assignments, classes])

  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }))

  const reset = () => {
    setForm(initialForm)
    setEditingId(null)
    setError('')
  }

  const openCreate = () => {
    reset()
    setAssignmentModalOpen(true)
  }

  const submit = async () => {
    if (!token || !canManage) return
    setError('')
    setLoading(true)
    const payload = {
      ...form,
      subject_id: form.role === 'class_teacher' ? null : form.subject_id,
      is_active: Boolean(form.is_active),
    }
    try {
      if (editingId) await api.updateTeacherAssignment(token, editingId, payload)
      else await api.createTeacherAssignment(token, payload)
      reset()
      setAssignmentModalOpen(false)
      await refresh()
      onChanged?.()
    } catch (err: any) {
      setError(err?.message || 'Unable to save teacher assignment.')
    } finally {
      setLoading(false)
    }
  }

  const edit = (row: any) => {
    setEditingId(row.id)
    setForm({
      teacher_id: String(row.teacher_id || ''),
      class_id: String(row.class_id || ''),
      subject_id: row.subject_id ? String(row.subject_id) : '',
      stream_section: row.stream_section || '',
      academic_year_id: row.academic_year_id ? String(row.academic_year_id) : '',
      term_id: row.term_id ? String(row.term_id) : '',
      academic_year: row.academic_year || String(new Date().getFullYear()),
      term: row.term || '',
      role: row.role || 'subject_teacher',
      is_active: Boolean(row.is_active),
      notes: row.notes || '',
    })
    setAssignmentModalOpen(true)
  }

  const deactivate = async (row: any) => {
    if (!token || !canManage) return
    setError('')
    try {
      await api.deactivateTeacherAssignment(token, row.id)
      await refresh()
      onChanged?.()
    } catch (err: any) {
      setError(err?.message || 'Unable to remove assignment.')
    }
  }

  return (
    <div className="grid gap-3">
      {canManage ? (
        <SectionCard title="Teacher assignments" subtitle="Add or edit assignments in a focused dialog so the class overview stays readable.">
          <div className="flex items-center justify-between gap-3 p-4">
            <p className="text-[12px] leading-5 text-[#64748b]">Assign a class teacher or subject teacher for the active academic context.</p>
            <Button type="button" className="h-8 shrink-0 rounded-[5px] text-[12px]" onClick={openCreate}><Plus className="size-3.5" />Assign teacher</Button>
          </div>
        </SectionCard>
      ) : null}

      {canManage ? (
        <ModalShell
          open={assignmentModalOpen}
          onOpenChange={(open) => { setAssignmentModalOpen(open); if (!open) reset() }}
          title={editingId ? 'Edit teacher assignment' : 'Assign teacher'}
          description="Choose the class, role and academic context for this assignment."
          className="max-w-3xl"
          footer={<><Button type="button" variant="outline" onClick={() => { setAssignmentModalOpen(false); reset() }}>Cancel</Button><Button type="button" onClick={submit} disabled={loading || !form.teacher_id || !form.class_id}><Plus className="size-3.5" />{loading ? 'Saving…' : editingId ? 'Save assignment' : 'Add assignment'}</Button></>}
        >
          <div className="grid gap-3 p-1 md:grid-cols-2">
            <select className={selectClassName()} value={form.teacher_id} onChange={(event) => update('teacher_id', event.target.value)}>
              <option value="">Select teacher</option>
              {teachers.map((row) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}
            </select>
            <select className={selectClassName()} value={form.class_id} onChange={(event) => update('class_id', event.target.value)}>
              <option value="">Select class</option>
              {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
            <select className={selectClassName()} value={form.role} onChange={(event) => update('role', event.target.value)}>
              <option value="subject_teacher">Subject Teacher</option>
              <option value="class_teacher">Class Teacher</option>
            </select>
            {form.role === 'subject_teacher' ? (
              <select className={selectClassName()} value={form.subject_id} onChange={(event) => update('subject_id', event.target.value)}>
                <option value="">Select subject</option>
                {subjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            ) : (
              <Input value="Class teacher" readOnly className="h-8 text-[12px]" />
            )}
            <Input placeholder="Stream / Section" value={form.stream_section} onChange={(event) => update('stream_section', event.target.value)} className="h-8 text-[12px]" />
            {session?.years?.length ? (
              <select
                className={selectClassName()}
                value={form.academic_year_id}
                onChange={(event) => {
                  const year = session.years.find((row: any) => String(row.id) === event.target.value)
                  setForm((current: any) => ({ ...current, academic_year_id: event.target.value, academic_year: year?.name || current.academic_year }))
                }}
              >
                <option value="">Select academic year</option>
                {session.years.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            ) : (
              <Input placeholder="Academic year" value={form.academic_year} onChange={(event) => update('academic_year', event.target.value)} className="h-8 text-[12px]" />
            )}
            {session?.terms?.length ? (
              <select
                className={selectClassName()}
                value={form.term_id}
                onChange={(event) => {
                  const term = session.terms.find((row: any) => String(row.id) === event.target.value)
                  setForm((current: any) => ({ ...current, term_id: event.target.value, term: term?.name || current.term }))
                }}
              >
                <option value="">Year-level assignment</option>
                {session.terms.map((row: any) => <option key={row.id} value={row.id}>{row.academic_year_name} · {row.name}</option>)}
              </select>
            ) : (
              <Input placeholder="Term" value={form.term} onChange={(event) => update('term', event.target.value)} className="h-8 text-[12px]" />
            )}
            <Input placeholder="Notes" value={form.notes} onChange={(event) => update('notes', event.target.value)} className="h-8 text-[12px]" />
            <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151]">
              <input type="checkbox" checked={form.is_active} onChange={(event) => update('is_active', event.target.checked)} />
              Active
            </label>
            {error ? <div className="rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c] md:col-span-2">{error}</div> : null}
          </div>
        </ModalShell>
      ) : null}

      <SectionCard title="Class Teacher & Subject Teachers" subtitle="Current active teacher assignments by class">
        <div className="grid gap-3 p-4">
          {grouped.length ? grouped.map((classRow) => {
            const active = classRow.activeAssignments || []
            const classTeacher = active.find((row: any) => row.role === 'class_teacher')?.teacher_name || classRow.class_teacher || classRow.teacher_name
            const subjectRows = active.filter((row: any) => row.role === 'subject_teacher')
            return (
              <article key={classRow.id} className="rounded-[6px] border border-[#e2e8f0] bg-white">
                <div className="border-b border-[#e2e8f0] px-3 py-2">
                  <div className="text-[13px] font-bold text-[#111827]">{classRow.name}</div>
                  <div className="mt-0.5 text-[11px] font-medium text-[#6b7280]">Class Teacher: {classTeacher || 'Unassigned'}</div>
                </div>
                <PortalTable
                  columns={[
                    { key: 'subject_name', label: 'Subject' },
                    { key: 'teacher_name', label: 'Teacher' },
                    { key: 'academic_year_name', label: 'Year', render: (row) => row.academic_year_name || row.academic_year },
                    { key: 'term_name', label: 'Term', render: (row) => row.term_name || row.term || 'Year' },
                    {
                      key: 'actions',
                      label: 'Actions',
                      render: (row) => canManage ? (
                        <span className="inline-flex gap-1">
                          <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" onClick={() => edit(row)} aria-label="Edit assignment"><Edit3 className="size-3.5" /></button>
                          <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#fee2e2] text-[#dc2626]" onClick={() => deactivate(row)} aria-label="Remove assignment"><Trash2 className="size-3.5" /></button>
                        </span>
                      ) : '-',
                    },
                  ]}
                  rows={subjectRows}
                  emptyMessage="No subject teachers assigned yet."
                />
              </article>
            )
          }) : <div className="rounded-[6px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-6 text-center text-[12px] font-semibold text-[#6b7280]">No classes are available for assignment.</div>}
        </div>
      </SectionCard>
    </div>
  )
}
