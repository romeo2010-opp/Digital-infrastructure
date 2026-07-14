import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { BookOpen, CheckCircle2, Download, FileCheck2, RefreshCw, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { usePortal } from '../lib/portalContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SectionCard } from '../components/SectionCard'
import { PortalTable } from '../components/PortalTable'

const inputClassName = 'h-9 rounded-[5px] border border-[#d9dee7] bg-white px-3 text-[12px] text-[#111827]'

function Pill({ value }: { value: any }) {
  const text = String(value ?? '—').replaceAll('_', ' ')
  const risk = /overdue|lost|damaged|rejected|changes|unavailable/i.test(text)
  const good = /approved|available|ready|active|collected|returned/i.test(text)
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] ${risk ? 'border-red-200 bg-red-50 text-red-700' : good ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{text}</span>
}

function Metric({ label, value, detail }: { label: string; value: any; detail: string }) {
  return <article className="rounded-[8px] border border-[#e2e8f0] bg-white p-4"><div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#64748b]">{label}</div><div className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-[#111827]">{Number(value || 0).toLocaleString()}</div><p className="mt-1 text-[11px] leading-5 text-[#64748b]">{detail}</p></article>
}

function Dashboard({ data, onOpen }: { data: any; onOpen: (path: string) => void }) {
  const dashboard = data?.dashboard || {}
  const actions = [
    ['Overdue loans', dashboard.loans?.overdue, 'Contact borrowers or record returns.', '/library/loans'],
    ['Teaching resources awaiting review', dashboard.reviews?.awaiting_review, 'Check file quality and archive metadata.', '/library/resources/review'],
    ['Teacher resource requests', dashboard.resource_requests?.open_requests, 'Locate or prepare material requested for lessons.', '/library/resource-requests'],
    ['Print requests awaiting processing', dashboard.printing?.pending, 'Approve, queue and complete paper materials.', '/library/print-requests'],
    ['Archive metadata warnings', dashboard.archive?.metadata_warnings, 'Classify historical records without changing official data.', '/library/archive'],
  ]
  return <div className="grid gap-3">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Borrowed" value={dashboard.loans?.borrowed} detail={`${dashboard.loans?.overdue || 0} overdue for action`} /><Metric label="Resource review" value={dashboard.reviews?.awaiting_review} detail={`${dashboard.reviews?.metadata_issues || 0} need changes`} /><Metric label="Print queue" value={dashboard.printing?.pending} detail={`${dashboard.printing?.confidential || 0} confidential jobs`} /><Metric label="Archive warnings" value={(dashboard.archive?.missing || 0) + (dashboard.archive?.metadata_warnings || 0)} detail={`${dashboard.archive?.archived_terms || 0} archived terms available`} /></div>
    <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
      <SectionCard title="Librarian action queue" subtitle="The work requiring attention now, ordered by operational urgency."><div className="divide-y divide-[#e2e8f0]">{actions.map(([title, value, detail, path]) => <button key={String(title)} type="button" onClick={() => onOpen(String(path))} className="grid w-full grid-cols-[1fr_auto] gap-4 px-4 py-3 text-left hover:bg-[#f8fafc]"><span><span className="block text-[13px] font-semibold text-[#111827]">{title}</span><span className="mt-1 block text-[11px] text-[#64748b]">{detail}</span></span><span className="font-mono text-[13px] font-semibold text-[#111827]">{Number(value || 0)}</span></button>)}</div></SectionCard>
      <SectionCard title="Recently added" subtitle="Latest institutional teaching materials."><div className="divide-y divide-[#e2e8f0]">{(dashboard.recent_resources || []).map((row: any) => <button key={row.public_ref} type="button" onClick={() => onOpen(`/library/resources/${row.public_ref}`)} className="block w-full px-4 py-3 text-left hover:bg-[#f8fafc]"><div className="flex items-center justify-between gap-2"><span className="truncate text-[12px] font-semibold text-[#111827]">{row.title}</span><Pill value={row.approval_status} /></div><div className="mt-1 text-[11px] text-[#64748b]">{row.resource_type} · used {row.usage_count || 0} times</div></button>)}</div></SectionCard>
    </div>
  </div>
}

async function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function ResourceUpload({ onSaved }: { onSaved: () => void }) {
  const { token, api } = usePortal()
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({ title: '', resource_type: 'worksheet', description: '' })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!file || !form.title.trim()) return
    setSaving(true)
    try {
      await api.createTeachingResource(token, { ...form, original_filename: file.name, file_data_url: await fileDataUrl(file), submit: true })
      toast.success('Resource submitted for review.')
      setFile(null)
      setForm({ title: '', resource_type: 'worksheet', description: '' })
      onSaved()
    } catch (error: any) { toast.error(error.message) } finally { setSaving(false) }
  }
  return <SectionCard title="Upload and classify" subtitle="Files remain drafts or enter the existing librarian and academic approval workflow."><div className="grid gap-3 p-4 md:grid-cols-2"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Resource title" /><select className={inputClassName} value={form.resource_type} onChange={(event) => setForm({ ...form, resource_type: event.target.value })}>{['lesson_notes', 'lesson_plan', 'scheme_of_work', 'worksheet', 'homework_sheet', 'revision_sheet', 'remedial_material', 'teacher_guide', 'student_handout', 'diagram', 'presentation', 'past_paper', 'assessment_paper', 'marking_scheme', 'worked_solution', 'exit_ticket'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select><Input className="md:col-span-2" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Description and intended use" /><input className="text-[12px]" type="file" accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.mp3,.mp4" onChange={(event) => setFile(event.target.files?.[0] || null)} /><Button disabled={saving || !file || !form.title.trim()} onClick={submit}><Upload className="size-4" />{saving ? 'Uploading…' : 'Submit for review'}</Button></div></SectionCard>
}

function CatalogueCreate({ onSaved }: { onSaved: () => void }) {
  const { token, api } = usePortal()
  const initial = { title: '', author: '', category: '', shelf_location: '', number_of_copies: '1', barcode_prefix: '' }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await api.createLibraryResource(token, { ...form, number_of_copies: Number(form.number_of_copies || 0) })
      toast.success('Physical resource and copies registered.')
      setForm(initial)
      onSaved()
    } catch (error: any) { toast.error(error.message) } finally { setSaving(false) }
  }
  return <SectionCard title="Register physical resource" subtitle="Create the catalogue record and its traceable copies together."><div className="grid gap-3 p-4 md:grid-cols-3"><Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Title" /><Input value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} placeholder="Author" /><Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Category" /><Input value={form.shelf_location} onChange={(event) => setForm({ ...form, shelf_location: event.target.value })} placeholder="Shelf location" /><Input type="number" min={0} value={form.number_of_copies} onChange={(event) => setForm({ ...form, number_of_copies: event.target.value })} placeholder="Copies" /><Input value={form.barcode_prefix} onChange={(event) => setForm({ ...form, barcode_prefix: event.target.value })} placeholder="Barcode prefix" /><Button className="md:col-start-3" disabled={saving || !form.title.trim()} onClick={submit}><BookOpen className="size-4" />{saving ? 'Registering…' : 'Register resource'}</Button></div></SectionCard>
}

function ComputerCreate({ onSaved }: { onSaved: () => void }) {
  const { token, api } = usePortal()
  const initial = { device_name: '', library_location: '', operating_system: '', assigned_purpose: '', working_status: 'active', internet_available: false, printer_connected: false }
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!form.device_name.trim()) return
    setSaving(true)
    try {
      await api.createLibraryComputer(token, form)
      toast.success('Library computer registered.')
      setForm(initial)
      onSaved()
    } catch (error: any) { toast.error(error.message) } finally { setSaving(false) }
  }
  return <SectionCard title="Register library computer" subtitle="Track availability, connectivity and assigned purpose without exposing device internals."><div className="grid gap-3 p-4 md:grid-cols-3"><Input value={form.device_name} onChange={(event) => setForm({ ...form, device_name: event.target.value })} placeholder="Device name" /><Input value={form.library_location} onChange={(event) => setForm({ ...form, library_location: event.target.value })} placeholder="Location" /><Input value={form.operating_system} onChange={(event) => setForm({ ...form, operating_system: event.target.value })} placeholder="Operating system" /><Input value={form.assigned_purpose} onChange={(event) => setForm({ ...form, assigned_purpose: event.target.value })} placeholder="Assigned purpose" /><select className={inputClassName} value={form.working_status} onChange={(event) => setForm({ ...form, working_status: event.target.value })}>{['active', 'unavailable', 'maintenance', 'retired'].map((value) => <option key={value}>{value}</option>)}</select><div className="flex items-center gap-4 text-[11px] text-[#475569]"><label className="flex items-center gap-2"><input type="checkbox" checked={form.internet_available} onChange={(event) => setForm({ ...form, internet_available: event.target.checked })} />Internet</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.printer_connected} onChange={(event) => setForm({ ...form, printer_connected: event.target.checked })} />Printer</label></div><Button className="md:col-start-3" disabled={saving || !form.device_name.trim()} onClick={submit}>{saving ? 'Saving…' : 'Add computer'}</Button></div></SectionCard>
}

const nextPrintStatus: Record<string, string> = { DRAFT: 'SUBMITTED', SUBMITTED: 'APPROVED', APPROVED: 'QUEUED', QUEUED: 'PRINTING', PRINTING: 'READY', READY: 'COLLECTED' }

export function LibrarianPortalPage() {
  const { token, api, user } = usePortal()
  const location = useLocation()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const section = location.pathname.split('/')[2] || 'dashboard'
  const hasPermission = (code: string) => (user?.permissions || []).includes(code)
  const load = async () => {
    setLoading(true)
    try {
      if (section === 'dashboard') setData(await api.getLibrarianDashboard(token))
      else if (section === 'catalogue') setData(await api.listLibraryResources(token, { q: query }))
      else if (section === 'loans') setData(await api.listLibraryLoans(token))
      else if (section === 'computers') setData(await api.listLibraryComputers(token))
      else if (section === 'resource-requests') setData(await api.listTeachingResourceRequests(token))
      else if (section === 'print-requests') setData(await api.listPrintRequests(token))
      else if (section === 'archive') setData(await api.browseInstitutionalArchive(token, { q: query }))
      else setData(await api.listTeachingResources(token, { q: query, status: section === 'resources' && location.pathname.endsWith('/review') ? 'SUBMITTED' : undefined }))
    } catch (error: any) { toast.error(error.message); setData({}) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [section, location.pathname])
  const rows = useMemo(() => data?.resources || data?.loans || data?.computers || data?.requests || data?.records || [], [data])
  const receiveLoan = async (row: any, condition: 'good' | 'damaged' | 'lost') => {
    try { await api.returnLibraryLoan(token, row.public_ref, { condition_on_return: condition }); toast.success(condition === 'good' ? 'Return recorded.' : `Copy recorded as ${condition}.`); await load() } catch (error: any) { toast.error(error.message) }
  }
  const advancePrint = async (row: any, status: string) => {
    try { await api.transitionPrintRequest(token, row.public_ref, { status }); toast.success(`Print request moved to ${status.toLowerCase()}.`); await load() } catch (error: any) { toast.error(error.message) }
  }
  const updateComputerStatus = async (row: any, status: string) => {
    try { await api.updateLibraryComputer(token, row.public_ref, { ...row, working_status: status }); toast.success('Computer status updated.'); await load() } catch (error: any) { toast.error(error.message) }
  }
  const updateResourceRequest = async (row: any, status: string) => {
    try { await api.updateTeachingResourceRequest(token, row.public_ref, { status }); toast.success(`Resource request moved to ${status.replaceAll('_', ' ')}.`); await load() } catch (error: any) { toast.error(error.message) }
  }
  if (loading) return <div className="grid min-h-[360px] place-items-center text-[13px] text-[#64748b]"><span><RefreshCw className="mx-auto mb-2 size-5 animate-spin" />Loading librarian workspace…</span></div>
  if (section === 'dashboard') return <Dashboard data={data} onOpen={navigate} />

  const title = section === 'catalogue' ? 'Physical library catalogue' : section === 'loans' ? 'Loans and returns' : section === 'computers' ? 'Library computers' : section === 'resource-requests' ? 'Teacher resource requests' : section === 'print-requests' ? 'Print requests' : section === 'archive' ? 'Institutional archive' : location.pathname.endsWith('/review') ? 'Resource review queue' : 'Teaching resources'
  const columns = section === 'catalogue' ? [
    { key: 'title', label: 'Title' }, { key: 'author', label: 'Author' }, { key: 'category', label: 'Category' }, { key: 'subject_name', label: 'Subject' }, { key: 'copies', label: 'Copies' }, { key: 'available_copies', label: 'Available' }, { key: 'status', label: 'Status', render: (row: any) => <Pill value={row.status} /> },
  ] : section === 'loans' ? [
    { key: 'title', label: 'Resource' }, { key: 'borrower_name', label: 'Borrower' }, { key: 'issue_date', label: 'Issued' }, { key: 'expected_return_date', label: 'Due' }, { key: 'status', label: 'Status', render: (row: any) => <Pill value={row.status} /> }, { key: 'actions', label: 'Receive', render: (row: any) => ['borrowed', 'overdue', 'damaged'].includes(row.status) && hasPermission('LIBRARY_LOAN_RETURN') ? <div className="flex gap-1"><Button size="sm" onClick={() => receiveLoan(row, 'good')}>Return</Button><Button size="sm" variant="outline" onClick={() => receiveLoan(row, 'damaged')}>Damaged</Button><Button size="sm" variant="outline" onClick={() => receiveLoan(row, 'lost')}>Lost</Button></div> : '—' },
  ] : section === 'computers' ? [
    { key: 'device_name', label: 'Device' }, { key: 'library_location', label: 'Location' }, { key: 'operating_system', label: 'Operating system' }, { key: 'assigned_purpose', label: 'Purpose' }, { key: 'internet_available', label: 'Internet', render: (row: any) => row.internet_available ? 'Yes' : 'No' }, { key: 'printer_connected', label: 'Printer', render: (row: any) => row.printer_connected ? 'Connected' : 'No' }, { key: 'working_status', label: 'Status', render: (row: any) => <Pill value={row.working_status} /> }, { key: 'actions', label: 'Update', render: (row: any) => hasPermission('LIBRARY_COMPUTER_MANAGE') ? <select className={inputClassName} value={row.working_status} onChange={(event) => updateComputerStatus(row, event.target.value)}>{['active', 'unavailable', 'maintenance', 'retired'].map((value) => <option key={value}>{value}</option>)}</select> : '—' },
  ] : section === 'resource-requests' ? [
    { key: 'request_text', label: 'Requested material' }, { key: 'requested_by_name', label: 'Teacher' }, { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' }, { key: 'topic_name', label: 'Topic' }, { key: 'priority', label: 'Priority', render: (row: any) => <Pill value={row.priority} /> }, { key: 'status', label: 'Status', render: (row: any) => <Pill value={row.status} /> }, { key: 'actions', label: 'Action', render: (row: any) => <select className={inputClassName} value={row.status} onChange={(event) => updateResourceRequest(row, event.target.value)}>{['submitted', 'accepted', 'locating', 'fulfilled', 'not_available', 'cancelled'].map((value) => <option key={value}>{value.replaceAll('_', ' ')}</option>)}</select> },
  ] : section === 'print-requests' ? [
    { key: 'title', label: 'Resource' }, { key: 'requested_by_name', label: 'Requested by' }, { key: 'copies', label: 'Copies' }, { key: 'required_at', label: 'Required' }, { key: 'confidentiality', label: 'Security', render: (row: any) => <Pill value={row.confidentiality} /> }, { key: 'status', label: 'Status', render: (row: any) => <Pill value={row.status} /> }, { key: 'actions', label: 'Action', render: (row: any) => { const next = nextPrintStatus[row.status]; if (!next || !hasPermission(next === 'READY' || next === 'COLLECTED' ? 'PRINT_REQUEST_COMPLETE' : 'PRINT_REQUEST_PROCESS')) return '—'; return <div className="flex gap-1"><Button size="sm" onClick={() => advancePrint(row, next)}>{next === 'APPROVED' ? 'Approve' : next === 'QUEUED' ? 'Queue' : next === 'PRINTING' ? 'Start printing' : next === 'READY' ? 'Mark ready' : next === 'COLLECTED' ? 'Collected' : 'Submit'}</Button>{row.status === 'SUBMITTED' ? <Button size="sm" variant="outline" onClick={() => advancePrint(row, 'REJECTED')}>Reject</Button> : null}</div> } },
  ] : section === 'archive' ? [
    { key: 'academic_year', label: 'Academic year' }, { key: 'term_name', label: 'Term' }, { key: 'record_type', label: 'Record type' }, { key: 'title', label: 'Title' }, { key: 'confidentiality', label: 'Visibility', render: (row: any) => <Pill value={row.confidentiality} /> }, { key: 'archive_status', label: 'Status', render: (row: any) => <Pill value={row.archive_status} /> },
  ] : [
    { key: 'title', label: 'Resource' }, { key: 'resource_type', label: 'Type' }, { key: 'subject_name', label: 'Subject' }, { key: 'class_name', label: 'Class' }, { key: 'topic_name', label: 'Topic' }, { key: 'version_number', label: 'Version' }, { key: 'approval_status', label: 'Status', render: (row: any) => <Pill value={row.approval_status} /> },
  ]

  return <div className="grid gap-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e2e8f0] bg-white p-4"><div><h1 className="text-[22px] font-semibold tracking-[-0.04em] text-[#111827]">{title}</h1><p className="mt-1 text-[12px] text-[#64748b]">School-scoped, permission-aware institutional records.</p></div><div className="flex gap-2"><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-[#94a3b8]" /><Input className="w-64 pl-8" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load()} placeholder="Search records" /></div><Button variant="outline" onClick={load}><RefreshCw className="size-4" />Refresh</Button></div></div>
    {section === 'catalogue' && hasPermission('LIBRARY_BOOK_CREATE') ? <CatalogueCreate onSaved={load} /> : null}
    {section === 'computers' && hasPermission('LIBRARY_COMPUTER_MANAGE') ? <ComputerCreate onSaved={load} /> : null}
    {section === 'resources' && !location.pathname.endsWith('/review') && hasPermission('TEACHING_RESOURCE_CREATE') ? <ResourceUpload onSaved={load} /> : null}
    <SectionCard title={title} subtitle={`${rows.length} records in the current school scope.`}><PortalTable rows={rows} columns={columns as any} onRowClick={section === 'resources' ? (row) => navigate(`/library/resources/${row.public_ref}`) : undefined} /></SectionCard>
  </div>
}

function VersionUpload({ resourceRef, onSaved }: { resourceRef: string; onSaved: () => void }) {
  const { token, api } = usePortal()
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!file) return
    setSaving(true)
    try {
      await api.createTeachingResourceVersion(token, resourceRef, { original_filename: file.name, file_data_url: await fileDataUrl(file), change_description: description || 'New resource version' })
      toast.success('New immutable version uploaded for review.')
      setFile(null)
      setDescription('')
      onSaved()
    } catch (error: any) { toast.error(error.message) } finally { setSaving(false) }
  }
  return <SectionCard title="Upload a new version" subtitle="The approved file remains in history; the replacement enters review separately."><div className="grid gap-3 p-4"><input className="text-[12px]" type="file" accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.mp3,.mp4" onChange={(event) => setFile(event.target.files?.[0] || null)} /><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What changed in this version?" /><Button disabled={!file || saving} onClick={submit}><Upload className="size-4" />{saving ? 'Uploading…' : 'Upload version'}</Button></div></SectionCard>
}

export function TeachingResourceDetailPage() {
  const { resourceRef = '' } = useParams()
  const { token, api, user } = usePortal()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const load = async () => { try { setData(await api.getTeachingResource(token, resourceRef)) } catch (error: any) { toast.error(error.message) } }
  useEffect(() => { void load() }, [resourceRef])
  if (!data) return <div className="grid min-h-[360px] place-items-center text-[13px] text-[#64748b]">Loading resource…</div>
  const resource = data.resource
  const permission = (code: string) => (user?.permissions || []).includes(code)
  const action = async (status: string) => { try { await api.transitionTeachingResource(token, resourceRef, { status }); toast.success(`Resource moved to ${status.toLowerCase().replaceAll('_', ' ')}.`); await load() } catch (error: any) { toast.error(error.message) } }
  const review = async (type: string, decision = 'approved') => { try { await api.reviewTeachingResource(token, resourceRef, { review_type: type, decision, quality_flags: [], notes: `${type.replace('_', ' ')} reviewed in SmartLink.` }); toast.success('Review recorded.'); await load() } catch (error: any) { toast.error(error.message) } }
  const download = async () => { try { const blob = await api.downloadTeachingResource(token, resourceRef); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = data.versions?.[0]?.original_filename || resource.title; anchor.click(); URL.revokeObjectURL(url) } catch (error: any) { toast.error(error.message) } }
  return <div className="grid gap-3 p-4">
    <button onClick={() => navigate(-1)} className="w-fit rounded-full border border-[#e2e8f0] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#475569] shadow-sm hover:bg-[#f8fafc]">← Back</button>
    <section className="rounded-[8px] border border-[#e2e8f0] bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex gap-2"><Pill value={resource.approval_status} /><Pill value={resource.confidentiality} /></div><h1 className="text-[24px] font-semibold tracking-[-0.04em] text-[#111827]">{resource.title}</h1><p className="mt-2 max-w-3xl text-[13px] leading-6 text-[#64748b]">{resource.description || 'No description has been added.'}</p><div className="mt-3 text-[11px] text-[#64748b]">{resource.resource_type} · {resource.subject_name || 'School-wide'} · {resource.class_name || 'All classes'} · {resource.topic_name || 'No topic mapping'}</div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={download}><Download className="size-4" />Download</Button>{resource.approval_status === 'DRAFT' ? <Button onClick={() => action('SUBMITTED')}>Submit</Button> : null}{permission('TEACHING_RESOURCE_REVIEW') && ['SUBMITTED', 'UNDER_REVIEW'].includes(resource.approval_status) ? <Button variant="outline" onClick={() => review('file_quality')}><FileCheck2 className="size-4" />Approve file quality</Button> : null}{permission('TEACHING_RESOURCE_APPROVE') && ['SUBMITTED', 'UNDER_REVIEW'].includes(resource.approval_status) ? <Button variant="outline" onClick={() => review('academic_content')}><CheckCircle2 className="size-4" />Approve academic review</Button> : null}{permission('TEACHING_RESOURCE_APPROVE') && resource.approval_status === 'UNDER_REVIEW' ? <Button onClick={() => action('APPROVED')}>Publish approved version</Button> : null}</div></div></section>
    {permission('TEACHING_RESOURCE_UPDATE') ? <VersionUpload resourceRef={resourceRef} onSaved={load} /> : null}
    <div className="grid gap-3 lg:grid-cols-2"><SectionCard title="Version history" subtitle="Approved files are never silently overwritten."><PortalTable rows={data.versions || []} columns={[{ key: 'version_number', label: 'Version' }, { key: 'original_filename', label: 'File' }, { key: 'change_description', label: 'Change' }, { key: 'approval_status', label: 'Status', render: (row: any) => <Pill value={row.approval_status} /> }]} /></SectionCard><SectionCard title="Review history" subtitle="File-quality and academic-content review remain separate."><PortalTable rows={data.reviews || []} columns={[{ key: 'review_type', label: 'Review' }, { key: 'reviewer_name', label: 'Reviewer' }, { key: 'decision', label: 'Decision', render: (row: any) => <Pill value={row.decision} /> }, { key: 'notes', label: 'Notes' }]} /></SectionCard></div>
  </div>
}
