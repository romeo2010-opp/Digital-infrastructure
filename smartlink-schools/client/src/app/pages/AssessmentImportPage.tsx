import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AlertTriangle, Check, FileUp, LayoutTemplate, Link2, Loader2, Save, ScanText, XCircle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { PageBackButton } from '../components/PageBackButton'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'

const selectClass = 'h-9 w-full rounded-[6px] border border-[#d9dce3] bg-white px-2.5 text-[12px] font-medium outline-none'
const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-[#64748b]'
const human = (value: any) => String(value || '-').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const readPdf = (file: File) => new Promise<string>((resolve, reject) => {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return reject(new Error('Select a PDF file.'))
  if (file.size > 20 * 1024 * 1024) return reject(new Error('PDF files must be 20MB or smaller.'))
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error('Unable to read PDF.'))
  reader.readAsDataURL(file)
})

export function AssessmentImportPage() {
  const { importRef } = useParams()
  return importRef ? <AssessmentImportReview importRef={importRef} /> : <AssessmentImportCreate />
}

function AssessmentImportCreate() {
  const { token, api, runAction } = usePortal()
  const navigate = useNavigate()
  const [setup, setSetup] = useState<any>({ classes: [], subjects: [], session: null })
  const [imports, setImports] = useState<any[]>([])
  const [form, setForm] = useState<any>({ title: '', class_id: '', subject_id: '', term_id: '', assessment_type: 'exam', assessment_date: '', duration_minutes: '', student_pdf_data_url: '', marking_scheme_pdf_data_url: '' })
  const [files, setFiles] = useState<any>({ student: '', marking: '' })
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    if (!token) return
    Promise.all([api.getAssessmentBuilderSetup(token), api.listAssessmentImports(token)])
      .then(([schoolSetup, importList]: any[]) => {
        setSetup(schoolSetup)
        setImports(importList.imports || [])
        setForm((current: any) => ({ ...current, term_id: schoolSetup.session?.term?.id || '' }))
      })
      .catch((err: any) => setError(err.message))
  }, [token])

  const choose = async (kind: 'student' | 'marking', file?: File) => {
    if (!file) return
    try {
      const data = await readPdf(file)
      setFiles((current: any) => ({ ...current, [kind]: file.name }))
      setForm((current: any) => ({ ...current, [kind === 'student' ? 'student_pdf_data_url' : 'marking_scheme_pdf_data_url']: data }))
    } catch (err: any) {
      setError(err.message)
    }
  }

  const submit = async () => {
    setProcessing(true)
    setError('')
    try {
      const created = await runAction(() => api.createAssessmentImport(token, form), 'Uploading assessment PDFs...', { refresh: false })
      const ref = created.import_job.public_ref
      await runAction(() => api.startAssessmentImport(token, ref), 'Visually reading questions, handwriting, covers, and answer spaces...', { refresh: false })
      navigate(`/assessments/imports/${ref}/review`)
    } catch (err: any) {
      setError(err.message || 'Assessment import failed.')
    } finally {
      setProcessing(false)
    }
  }

  return <main className="grid gap-3 p-4">
    <PageBackButton fallback="/exam-builder" label="Back to Assessment Builder" />
    <section className="rounded-[7px] border bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#6d28d9]">Assessment Builder</p>
      <h1 className="mt-1 text-[22px] font-semibold">Import Assessment from PDF</h1>
      <p className="mt-1 text-[13px] text-[#64748b]">SmartLink visually reads the original cover, printed or handwritten content, and the exact learner response layout.</p>
    </section>
    {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error}</div> : null}
    <SectionCard title="Import details" subtitle="Both PDFs are required. Each file may be up to 20MB.">
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>Assessment title<Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className={labelClass}>Class<select className={selectClass} value={form.class_id} onChange={(event) => setForm({ ...form, class_id: event.target.value })}><option value="">Select class</option>{(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={labelClass}>Subject<select className={selectClass} value={form.subject_id} onChange={(event) => setForm({ ...form, subject_id: event.target.value })}><option value="">Select subject</option>{(setup.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={labelClass}>Assessment type<select className={selectClass} value={form.assessment_type} onChange={(event) => setForm({ ...form, assessment_type: event.target.value })}>{['exam', 'test', 'homework', 'quiz', 'daily_drill_source', 'other'].map((value) => <option key={value} value={value}>{human(value)}</option>)}</select></label>
        <label className={labelClass}>Duration (minutes)<Input type="number" min="1" value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })} /></label>
        <label className={labelClass}>Assessment date<Input type="date" value={form.assessment_date} onChange={(event) => setForm({ ...form, assessment_date: event.target.value })} /></label><div />
        <label className="grid gap-2 rounded-[7px] border border-dashed p-4 text-[12px] font-semibold"><span>Student Question Paper PDF</span><Input type="file" accept="application/pdf,.pdf" onChange={(event) => choose('student', event.target.files?.[0])} /><span className="text-[11px] text-[#64748b]">{files.student || 'Original cover and learner answer spaces are preserved'}</span></label>
        <label className="grid gap-2 rounded-[7px] border border-dashed p-4 text-[12px] font-semibold"><span>Marking Scheme PDF</span><Input type="file" accept="application/pdf,.pdf" onChange={(event) => choose('marking', event.target.files?.[0])} /><span className="text-[11px] text-[#64748b]">{files.marking || 'Answers are linked by question number'}</span></label>
        <div className="sm:col-span-2 flex justify-end"><Button disabled={processing || !form.title || !form.class_id || !form.subject_id || !form.term_id || !form.student_pdf_data_url || !form.marking_scheme_pdf_data_url} onClick={submit}>{processing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{processing ? 'Visually extracting documents…' : 'Upload and extract'}</Button></div>
      </div>
    </SectionCard>
    <SectionCard title="Recent imports" subtitle="Uploads and descriptive failure messages remain available after refresh.">
      <div className="divide-y">{imports.map((item: any) => <button key={item.public_ref} className="flex w-full items-center justify-between gap-4 p-3 text-left hover:bg-[#fafafa]" onClick={() => navigate(`/assessments/imports/${item.public_ref}/review`)}><span><span className="block text-[13px] font-semibold">{item.title}</span><span className="text-[11px] text-[#64748b]">{human(item.assessment_type)} · {new Date(item.created_at).toLocaleDateString()}</span>{item.error_message ? <span className="mt-1 block text-[11px] text-red-700">{item.error_message}</span> : null}</span><span className="shrink-0 text-[11px] font-semibold">{human(item.status)} · {item.progress_percentage}%</span></button>)}{!imports.length ? <div className="p-5 text-[12px] text-[#64748b]">No assessment imports have been created.</div> : null}</div>
    </SectionCard>
  </main>
}

function Confidence({ value }: { value: any }) {
  const score = Math.round(Number(value || 0) * 100)
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${score >= 80 ? 'border-green-200 bg-green-50 text-green-700' : score >= 60 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{score}% confidence</span>
}

function ImportedDiagramPreview({ api, token, importRef, asset }: { api: any, token: string, importRef: string, asset: any }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let objectUrl = ''
    setFailed(false)
    api.getAssessmentImportAssetPreview(token, importRef, asset.public_ref)
      .then((blob: Blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [api, token, importRef, asset.public_ref])
  return <figure className="overflow-hidden rounded-[6px] border bg-white p-2">
    {url ? <img src={url} className="mx-auto max-h-72 max-w-full object-contain" alt={asset.alt_text || 'Extracted question diagram'} /> : <div className="grid h-28 place-items-center text-[11px] text-[#64748b]">{failed ? 'Diagram preview could not be loaded.' : 'Loading diagram preview…'}</div>}
    <figcaption className="mt-2 text-[11px] text-[#64748b]">{asset.alt_text || human(asset.asset_type)} · Page {asset.page_number || '-'}</figcaption>
  </figure>
}

function ExtractedImagesSection({ data, api, token, importRef, runAction, refresh }: { data: any, api: any, token: string, importRef: string, runAction: any, refresh: () => Promise<void> }) {
  const job = data.import_job || {}
  const assets = data.assets || []
  const update = async (asset: any, patch: any, message: string) => {
    await runAction(() => api.updateAssessmentImportImage(token, importRef, asset.public_ref, { ...patch, row_version: asset.row_version }), message, { refresh: false })
    await refresh()
  }
  const retry = async () => {
    await runAction(() => api.extractAssessmentImportImages(token, importRef), 'Extracting original PDF images and visual regions…', { refresh: false })
    await refresh()
  }
  return <SectionCard title="Extracted Images" subtitle="Original PDF assets remain separate until you confirm a question assignment.">
    <div className="border-b bg-[#f8fafc] px-3 py-2 text-[11px] text-[#475569]">
      <div className="flex flex-wrap items-center justify-between gap-2"><span><strong>{human(job.image_extraction_status || 'pending')}</strong> · {job.image_extraction_pages_processed || 0}/{job.image_extraction_total_pages || 0} pages · {assets.length} saved · {job.image_extraction_review_count || 0} need review</span><Button className="h-8 text-[11px]" variant="outline" disabled={job.image_extraction_status === 'processing'} onClick={retry}>{job.image_extraction_status === 'processing' ? 'Extracting…' : 'Retry extraction'}</Button></div>
      {job.image_extraction_last_error ? <div className="mt-1 text-amber-800">{job.image_extraction_last_error}</div> : null}
    </div>
    <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
      {assets.map((asset: any) => {
        const linkedQuestion = data.questions.find((question: any) => question.temp_question_id === asset.linked_question_temp_id)
        return <article key={asset.public_ref} className="rounded-[7px] border bg-white p-2">
          <ImportedDiagramPreview api={api} token={token} importRef={importRef} asset={asset} />
          <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-semibold"><span className="rounded-full border bg-[#f8fafc] px-2 py-1">{human(asset.extraction_method)}</span><span className="rounded-full border bg-[#f8fafc] px-2 py-1">{human(asset.asset_type)}</span>{asset.assignment_status === 'confirmed' ? <span className="rounded-full border border-green-200 bg-green-50 px-2 py-1 text-green-700">Confirmed</span> : <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">Needs review</span>}</div>
          <label className={`${labelClass} mt-2`}>Assign to question<select className={selectClass} value={linkedQuestion?.public_ref || ''} onChange={(event) => update(asset, { question_ref: event.target.value || null, assignment_status: event.target.value ? 'suggested' : 'unassigned' }, 'Updating image assignment…')}><option value="">Unassigned</option>{data.questions.map((question: any) => <option key={question.public_ref} value={question.public_ref}>{question.question_number} — {String(question.question_text || '').slice(0, 70)}</option>)}</select></label>
          <div className="mt-2 flex flex-wrap justify-end gap-2"><Button className="h-8 text-[11px]" variant="outline" disabled={!linkedQuestion || asset.assignment_status === 'confirmed'} onClick={() => update(asset, { question_ref: linkedQuestion?.public_ref, assignment_status: 'confirmed', placement: 'after_question_text', requires_review: false }, 'Confirming image placement…')}>Confirm placement</Button><Button className="h-8 text-[11px]" variant="destructive" onClick={async () => { if (!window.confirm('Remove this extracted image from the import review?')) return; await runAction(() => api.deleteAssessmentImportImage(token, importRef, asset.public_ref), 'Removing extracted image…', { refresh: false }); await refresh() }}>Remove</Button></div>
        </article>
      })}
      {!assets.length ? <div className="p-5 text-[12px] text-[#64748b] md:col-span-2 xl:col-span-3">No extracted images are available. Retry extraction to scan embedded images and saved visual regions without affecting the imported questions.</div> : null}
    </div>
  </SectionCard>
}

function AssessmentImportReview({ importRef }: { importRef: string }) {
  const { token, api, runAction } = usePortal()
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [matching, setMatching] = useState<any>(null)

  const refresh = async () => {
    try {
      const payload = await api.getAssessmentImportReview(token, importRef)
      setData(payload)
      const cover = payload.pages.find((page: any) => page.document_type === 'student_paper' && page.page_number === 1 && page.preview_url)
      if (cover) {
        const blob = await api.getAssessmentImportPreview(token, importRef, 'student_paper', 1)
        setCoverUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(blob) })
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  useEffect(() => { refresh(); return () => { if (coverUrl) URL.revokeObjectURL(coverUrl) } }, [token, importRef])
  const warnings = useMemo(() => Array.isArray(data?.import_job?.warnings) ? data.import_job.warnings : [], [data])
  const updateQuestion = (questionRef: string, patch: any) => setData((current: any) => ({ ...current, questions: current.questions.map((question: any) => question.public_ref === questionRef ? { ...question, ...patch } : question) }))
  const updateResponse = (question: any, key: string, value: any) => updateQuestion(question.public_ref, { response_layout: { ...(question.response_layout || {}), [key]: value } })
  const saveQuestion = async (question: any) => {
    await runAction(() => api.updateAssessmentImportQuestion(token, importRef, question.public_ref, { question_text: question.question_text, marks: question.marks, difficulty: question.difficulty, topic_id: question.topic_id, subtopic_id: question.subtopic_id, response_layout: question.response_layout, daily_drill_eligible: question.daily_drill_eligible, review_status: 'edited' }), 'Saving extracted question and response layout...', { refresh: false })
    await refresh()
  }
  const approveHigh = async () => { for (const question of data.questions.filter((row: any) => Number(row.confidence) >= .8 && Number(row.response_layout?.confidence) >= .7)) await api.updateAssessmentImportQuestion(token, importRef, question.public_ref, { review_status: 'approved' }); await refresh() }
  const approve = async () => { if (!window.confirm('Approve this reviewed import? The original cover and every reviewed learner answer space will be applied.')) return; const result = await runAction(() => api.approveAssessmentImport(token, importRef), 'Creating assessment with original cover and response areas...', { refresh: false }); navigate(result.builder_path) }
  const extractCover = async () => { await runAction(() => api.extractAssessmentImportCoverTemplate(token, importRef), 'Saving extracted cover candidate...', { refresh: false }); await refresh() }
  const matchCover = async () => setMatching(await runAction(() => api.matchAssessmentImportCoverTemplate(token, importRef), 'Matching school cover templates...', { refresh: false }))

  if (!data) return <main className="p-4"><PageBackButton fallback="/assessments/imports/new" /><div className="mt-4 text-[13px]">{error || 'Loading import review…'}</div></main>
  const job = data.import_job
  const candidates = data.cover_template_candidates || []
  return <main className="grid gap-3 p-4">
    <PageBackButton fallback="/assessments/imports/new" label="Back to Imports" />
    <section className="rounded-[7px] border bg-white p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#6d28d9]">Import review</p><h1 className="mt-1 text-[22px] font-semibold">{job.title}</h1><p className="text-[12px] text-[#64748b]">{human(job.status)} · {human(job.parser_version)} · Review visual measurements before approval.</p>{job.ai_provider ? <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold"><span className="rounded-full border bg-[#f8fafc] px-2 py-1">Vision: {human(job.ai_provider)} · {job.ai_model}</span><span className={`rounded-full border px-2 py-1 ${Number(job.ai_quality_score) >= 80 ? 'border-green-200 bg-green-50 text-green-700' : Number(job.ai_quality_score) >= 65 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-700'}`}>Quality {Math.round(Number(job.ai_quality_score || 0))}%</span>{job.ai_fallback_used ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">Fallback used</span> : null}</div> : null}</div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={approveHigh}><Check className="size-4" />Approve high confidence</Button>{job.assessment_id ? <Button onClick={() => navigate(`/exam-builder/${job.assessment_id}`)}>Open assessment</Button> : <Button disabled={job.status !== 'review_required'} onClick={approve}>Approve import</Button>}</div></div></section>
    {error || job.error_message ? <div className="rounded border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error || job.error_message}</div> : null}
    <SectionKpiStrip items={[{ label: 'Questions', value: data.questions.length }, { label: 'Response Areas', value: data.questions.filter((question: any) => question.response_layout?.answer_space_type !== 'none').length }, { label: 'Warnings', value: warnings.length, tone: warnings.length ? 'warn' : 'good' }, { label: 'Matched Answers', value: data.questions.filter((question: any) => question.matched_marking_item).length }]} />
    {warnings.length ? <SectionCard title="Review warnings" subtitle="Low-confidence text and layout are never silently accepted."><div className="grid gap-2 p-4">{warnings.map((warning: string, index: number) => <div key={index} className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{warning}</div>)}</div></SectionCard> : null}
    <ExtractedImagesSection data={data} api={api} token={token} importRef={importRef} runAction={runAction} refresh={refresh} />
    <div className="grid gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <SectionCard title="Original imported cover" subtitle="This exact first page is applied to the generated assessment by default."><div className="p-3">{coverUrl ? <img src={coverUrl} className="w-full rounded border" alt="Original imported cover page" /> : <div className="p-6 text-[12px] text-[#64748b]">The original cover preview could not be rendered.</div>}<div className="mt-3 rounded bg-green-50 p-2 text-[11px] font-semibold text-green-800">The exporter uses this page—not a newly invented generic cover.</div></div></SectionCard>
        <SectionCard title="Cover template intelligence" subtitle="Extracted covers remain school-scoped and require review before reuse."><div className="grid gap-2 p-3">{candidates.map((candidate: any) => <div key={candidate.public_ref} className="rounded border p-2 text-[12px]"><div className="font-semibold">{candidate.template_name}</div><div className="mt-1 text-[11px] text-[#64748b]">{human(candidate.review_status)} · <Confidence value={candidate.confidence} /></div>{candidate.review_status === 'pending' ? <Button className="mt-2 h-8 text-[11px]" onClick={async () => { await api.approveAssessmentTemplate(token, candidate.public_ref); await refresh() }}><Check className="size-3" />Approve reusable template</Button> : null}</div>)}{!candidates.length ? <Button variant="outline" onClick={extractCover}><LayoutTemplate className="size-4" />Save extracted cover candidate</Button> : null}<Button variant="outline" onClick={matchCover}><ScanText className="size-4" />Match existing template</Button>{matching ? <div className="rounded bg-[#f8fafc] p-2 text-[11px]">{matching.matches?.[0]?.confident ? `Matches ${matching.matches[0].template.template_name} at ${Math.round(matching.matches[0].match_score * 100)}%.` : 'No existing school template confidently matches this cover. Save it as a new school template after review.'}</div> : null}</div></SectionCard>
      </div>
      <SectionCard title="Questions, answers, and learner response layout" subtitle="Response type, line count, and physical height are editable before approval."><div className="grid gap-3 p-3">{data.questions.map((question: any) => {
        const response = question.response_layout || {}
        const questionAssets = (data.assets || []).filter((asset: any) => asset.linked_question_temp_id === question.temp_question_id && ['diagram', 'image', 'table_image'].includes(asset.asset_type))
        return <article key={question.public_ref} className="rounded-[7px] border bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">Question {question.question_number} · Page {question.page_start || '-'}</div><div className="flex gap-2"><Confidence value={question.confidence} /><Confidence value={response.confidence} />{question.matched_marking_item ? <span className="rounded-full bg-green-50 px-2 py-1 text-[10px] font-bold text-green-700"><Link2 className="mr-1 inline size-3" />Matched</span> : <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700">Unmatched</span>}</div></div>{questionAssets.length ? <div className="mt-3"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.08em] text-[#64748b]">Extracted visual stimulus</div><div className="grid gap-2 md:grid-cols-2">{questionAssets.map((asset: any) => <ImportedDiagramPreview key={asset.public_ref} api={api} token={token} importRef={importRef} asset={asset} />)}</div></div> : null}<div className="mt-3 grid gap-3 lg:grid-cols-2"><label className={labelClass}>Extracted question<Textarea rows={6} value={question.question_text} onChange={(event) => updateQuestion(question.public_ref, { question_text: event.target.value })} /></label><label className={labelClass}>Matched marking scheme<Textarea rows={6} value={question.matched_marking_item?.answer_text || ''} readOnly placeholder="No answer confidently matched." /></label></div><div className="mt-3 grid gap-2 rounded-[6px] border bg-[#f8fafc] p-3 sm:grid-cols-2 lg:grid-cols-5"><label className={labelClass}>Response type<select className={selectClass} value={response.answer_space_type || 'none'} onChange={(event) => updateResponse(question, 'answer_space_type', event.target.value)}><option value="none">No answer space</option><option value="ruled_lines">Ruled lines</option><option value="blank_space">Open blank space</option><option value="blank_box">Blank bordered box</option><option value="graph_grid">Graph grid</option></select></label><label className={labelClass}>Number of lines<Input type="number" min="0" max="40" disabled={response.answer_space_type !== 'ruled_lines'} value={response.answer_lines || 0} onChange={(event) => updateResponse(question, 'answer_lines', event.target.value)} /></label><label className={labelClass}>Height (screen px)<Input type="number" min="0" max="1000" disabled={response.answer_space_type === 'none'} value={response.answer_height || 0} onChange={(event) => updateResponse(question, 'answer_height', event.target.value)} /></label><label className={labelClass}>Original height (PDF pt)<Input readOnly value={response.height_points || 0} /></label><label className={labelClass}>Layout confidence<div className="flex h-9 items-center"><Confidence value={response.confidence} /></div></label><div className="text-[11px] text-[#64748b] sm:col-span-2 lg:col-span-5">{response.evidence || 'No visual evidence note was returned; review against the page preview.'}</div></div><div className="mt-3 flex flex-wrap items-end gap-2"><label className={labelClass}>Marks<Input className="w-24" type="number" value={question.marks || ''} onChange={(event) => updateQuestion(question.public_ref, { marks: event.target.value })} /></label><label className={labelClass}>Difficulty<select className={`${selectClass} w-32`} value={question.difficulty || 'medium'} onChange={(event) => updateQuestion(question.public_ref, { difficulty: event.target.value })}>{['easy', 'medium', 'hard'].map((value) => <option key={value}>{human(value)}</option>)}</select></label><label className="flex h-9 items-center gap-2 text-[11px] font-semibold"><input type="checkbox" checked={Boolean(question.daily_drill_eligible)} onChange={(event) => updateQuestion(question.public_ref, { daily_drill_eligible: event.target.checked })} />Daily Drill eligible</label><Button variant="outline" onClick={() => saveQuestion(question)}><Save className="size-4" />Save review</Button><Button variant="destructive" onClick={async () => { await api.updateAssessmentImportQuestion(token, importRef, question.public_ref, { review_status: 'rejected' }); await refresh() }}><XCircle className="size-4" />Reject</Button></div></article>
      })}{!data.questions.length ? <div className="p-6 text-[12px] text-[#64748b]">No questions were confidently extracted. Review the original pages and create questions manually.</div> : null}</div></SectionCard>
    </div>
  </main>
}
