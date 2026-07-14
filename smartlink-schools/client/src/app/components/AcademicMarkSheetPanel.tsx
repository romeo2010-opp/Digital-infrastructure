import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Cloud, CloudOff, Save, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { SectionCard } from './SectionCard'
import { usePortal } from '../lib/portalContext'

type EntryMode = 'question' | 'topic' | 'overall'

const modeLabels: Record<EntryMode, string> = {
  question: 'Question by question',
  topic: 'Topic totals',
  overall: 'Overall total',
}

function validValue(value: any) {
  return value !== '' && value !== null && value !== undefined
}

function entryTotal(entry: any, mode: EntryMode, columns: any[]) {
  if (['absent', 'excused'].includes(entry.participation_status)) return null
  if (mode === 'overall') return validValue(entry.overall_marks) ? Number(entry.overall_marks) : null
  const source = mode === 'question' ? entry.question_marks : entry.topic_marks
  const values = columns.map((column) => source?.[column.id ?? column.topic_id]).filter(validValue).map(Number)
  return values.length ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(2)) : null
}

function focusCell(row: number, column: number) {
  document.querySelector<HTMLInputElement>(`[data-academic-cell="${row}:${column}"]`)?.focus()
}

export function AcademicMarkSheetPanel({ assessmentId, readOnly = false }: { assessmentId: string | number; readOnly?: boolean }) {
  const { token, api } = usePortal()
  const [mode, setMode] = useState<EntryMode>('question')
  const [data, setData] = useState<any>(null)
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const storageKey = `smartlink:academic-marks:${assessmentId}:${mode}`

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.getAcademicMarkSheet(token, assessmentId, mode)
      const local = localStorage.getItem(storageKey)
      const cached = local ? JSON.parse(local) : null
      setData(response)
      setEntries(cached?.entries?.length && response?.mark_sheet?.status !== 'published' ? cached.entries : response.entries || [])
      setDirty(Boolean(cached?.entries?.length && response?.mark_sheet?.status !== 'published'))
    } catch (error: any) {
      setData(null)
      setEntries([])
      if (!/Map assessment questions|authored assessment questions/i.test(error.message || '')) toast.error(error.message || 'Unable to load academic mark sheet.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [assessmentId, mode, token])
  useEffect(() => {
    const connected = () => setOnline(true)
    const disconnected = () => setOnline(false)
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected) }
  }, [])
  useEffect(() => {
    if (!dirty || !entries.length) return
    const timer = window.setTimeout(() => localStorage.setItem(storageKey, JSON.stringify({ entries, saved_at: new Date().toISOString() })), 250)
    return () => window.clearTimeout(timer)
  }, [dirty, entries, storageKey])

  const columns = mode === 'question' ? data?.questions || [] : mode === 'topic' ? data?.topics || [] : [{ id: 'overall', display_number: 'Total', marks: data?.assessment?.total_marks }]
  const maximumFor = (column: any) => Number(column.marks ?? column.marks_available ?? data?.assessment?.total_marks ?? 0)
  const published = data?.mark_sheet?.status === 'published' || data?.mark_sheet?.status === 'locked'
  const disabled = readOnly || published
  const completion = useMemo(() => {
    const complete = entries.filter((entry) => {
      if (['absent', 'excused'].includes(entry.participation_status)) return true
      const source = mode === 'question' ? entry.question_marks : mode === 'topic' ? entry.topic_marks : { overall: entry.overall_marks }
      return columns.length > 0 && columns.every((column) => validValue(source?.[column.id ?? column.topic_id]))
    }).length
    return { complete, total: entries.length, percentage: entries.length ? Math.round(complete / entries.length * 100) : 0 }
  }, [columns, entries, mode])

  const updateEntry = (rowIndex: number, patch: any) => {
    setEntries((current) => current.map((entry, index) => index === rowIndex ? { ...entry, ...patch } : entry))
    setDirty(true)
  }
  const updateMark = (rowIndex: number, column: any, value: any) => {
    const maximum = maximumFor(column)
    if (value !== '' && (Number(value) < 0 || Number(value) > maximum)) return toast.error(`Marks must be between 0 and ${maximum}.`)
    const key = column.id ?? column.topic_id
    const entry = entries[rowIndex]
    if (mode === 'question') updateEntry(rowIndex, { question_marks: { ...(entry.question_marks || {}), [key]: value }, participation_status: entry.participation_status === 'pending' ? 'present' : entry.participation_status })
    else if (mode === 'topic') updateEntry(rowIndex, { topic_marks: { ...(entry.topic_marks || {}), [key]: value }, participation_status: entry.participation_status === 'pending' ? 'present' : entry.participation_status })
    else updateEntry(rowIndex, { overall_marks: value, participation_status: entry.participation_status === 'pending' ? 'present' : entry.participation_status })
  }
  const pasteGrid = (event: React.ClipboardEvent<HTMLInputElement>, startRow: number, startColumn: number) => {
    const matrix = event.clipboardData.getData('text/plain').trim().split(/\r?\n/).map((row) => row.split('\t'))
    if (!matrix.length || (matrix.length === 1 && matrix[0].length === 1)) return
    event.preventDefault()
    const next = entries.map((entry) => ({ ...entry, question_marks: { ...(entry.question_marks || {}) }, topic_marks: { ...(entry.topic_marks || {}) } }))
    for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) for (let columnOffset = 0; columnOffset < matrix[rowOffset].length; columnOffset += 1) {
      const rowIndex = startRow + rowOffset; const columnIndex = startColumn + columnOffset
      if (!next[rowIndex] || !columns[columnIndex]) continue
      const value = matrix[rowOffset][columnOffset].trim(); const maximum = maximumFor(columns[columnIndex])
      if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > maximum)) continue
      const key = columns[columnIndex].id ?? columns[columnIndex].topic_id
      if (mode === 'question') next[rowIndex].question_marks[key] = value
      else if (mode === 'topic') next[rowIndex].topic_marks[key] = value
      else next[rowIndex].overall_marks = value
      if (next[rowIndex].participation_status === 'pending') next[rowIndex].participation_status = 'present'
    }
    setEntries(next)
    setDirty(true)
  }
  const keyboardMove = (event: React.KeyboardEvent<HTMLInputElement>, row: number, column: number) => {
    const move = event.key === 'Enter' || event.key === 'ArrowDown' ? [1, 0] : event.key === 'ArrowUp' ? [-1, 0] : event.key === 'ArrowRight' ? [0, 1] : event.key === 'ArrowLeft' ? [0, -1] : null
    if (!move) return
    if (event.key.startsWith('Arrow') && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return
    event.preventDefault(); focusCell(Math.max(0, row + move[0]), Math.max(0, column + move[1]))
  }
  const save = async () => {
    setSaving(true)
    try {
      const response = await api.saveAcademicMarkSheetDraft(token, assessmentId, { mode, idempotency_key: `browser:${assessmentId}:${mode}`, entries })
      localStorage.removeItem(storageKey)
      setDirty(false)
      toast.success(`Draft saved · ${response.completion_percentage}% complete.`)
      await load()
    } catch (error: any) { toast.error(error.message || 'Unable to save draft. Your browser copy is preserved.') } finally { setSaving(false) }
  }
  const publish = async () => {
    if (!window.confirm('Publish these marks as official academic evidence? Draft analysis will become visible to authorised intelligence views.')) return
    setSaving(true)
    try {
      if (dirty) await api.saveAcademicMarkSheetDraft(token, assessmentId, { mode, idempotency_key: `browser:${assessmentId}:${mode}`, entries })
      const response = await api.publishAcademicMarkSheet(token, assessmentId, { mode })
      localStorage.removeItem(storageKey)
      setDirty(false)
      toast.success(`Published ${response.learners_published} learner records and recalculated ${response.topics_recalculated} topics.`)
      await load()
    } catch (error: any) { toast.error(error.message || 'Unable to publish academic evidence.') } finally { setSaving(false) }
  }

  return <SectionCard
    title="Live academic evidence"
    subtitle="Marks create provisional evidence while in draft and scoped official evidence only after publication."
    actions={<div className="flex items-center gap-2 text-[11px] font-semibold text-[#64748b]">{online ? <Cloud className="size-4 text-emerald-600" /> : <CloudOff className="size-4 text-amber-600" />}{dirty ? 'Browser draft preserved' : published ? 'Official evidence' : 'Saved'}</div>}
  >
    <div className="grid gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-[6px] border border-[#d9dce3] bg-[#f8fafc] p-1">
          {(Object.keys(modeLabels) as EntryMode[]).map((value) => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-[4px] px-3 py-1.5 text-[11px] font-semibold ${mode === value ? 'bg-white text-[#111827] shadow-sm' : 'text-[#64748b]'}`}>{modeLabels[value]}</button>)}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[#64748b]">{completion.complete}/{completion.total} complete · {completion.percentage}%</span>
          <Button type="button" variant="outline" className="h-8 text-[11px]" disabled={disabled || saving || !entries.length} onClick={save}><Save className="size-3.5" />Save draft</Button>
          <Button type="button" className="h-8 text-[11px]" disabled={disabled || saving || !entries.length} onClick={publish}><Send className="size-3.5" />Publish evidence</Button>
        </div>
      </div>

      {data?.evidence_notice ? <div className={`rounded-[6px] border px-3 py-2 text-[11px] leading-5 ${mode === 'overall' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>{data.evidence_notice}</div> : null}
      {loading ? <div className="p-6 text-center text-[12px] text-[#64748b]">Loading mapped evidence…</div> : !data ? <div className="rounded-[6px] border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-900">This mode is not available until the assessment has valid curriculum mappings. Overall-total entry remains available without topic mappings.</div> : (
        <div className="overflow-x-auto rounded-[6px] border border-[#d9dce3] bg-white">
          <table className="min-w-full text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-[#f8fafc] text-[#64748b]">
              <tr>
                <th className="sticky left-0 min-w-[220px] border-r border-[#e2e8f0] bg-[#f8fafc] px-3 py-2">Learner</th>
                <th className="min-w-[110px] px-2 py-2">Script status</th>
                {columns.map((column: any) => <th key={column.id ?? column.topic_id} className="min-w-[92px] px-2 py-2 text-center"><span className="block font-semibold text-[#334155]">{column.display_number || column.topic_name || 'Total'}</span><span className="font-mono text-[9px]">/{maximumFor(column)}</span></th>)}
                <th className="min-w-[80px] px-2 py-2 text-center">Total</th>
                <th className="min-w-[70px] px-2 py-2 text-center">%</th>
                <th className="min-w-[110px] px-2 py-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, rowIndex) => {
                const total = entryTotal(entry, mode, columns)
                const percentage = total === null ? null : Number((total / Math.max(1, Number(data.assessment.total_marks)) * 100).toFixed(1))
                const unavailable = ['absent', 'excused'].includes(entry.participation_status)
                return <tr key={entry.student_id} className="border-t border-[#eef2f7]">
                  <td className="sticky left-0 border-r border-[#eef2f7] bg-white px-3 py-2"><span className="block font-semibold text-[#0f172a]">{entry.student_name}</span><span className="font-mono text-[9px] text-[#94a3b8]">{entry.student_ref}</span></td>
                  <td className="px-2 py-2"><select disabled={disabled} className="h-8 rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[11px]" value={entry.participation_status || 'pending'} onChange={(event) => updateEntry(rowIndex, { participation_status: event.target.value })}><option value="pending">Pending</option><option value="present">Present</option><option value="incomplete">Incomplete</option><option value="absent">Absent</option><option value="excused">Excused</option></select></td>
                  {columns.map((column: any, columnIndex: number) => {
                    const key = column.id ?? column.topic_id
                    const value = mode === 'question' ? entry.question_marks?.[key] : mode === 'topic' ? entry.topic_marks?.[key] : entry.overall_marks
                    return <td key={key} className="px-2 py-2"><Input data-academic-cell={`${rowIndex}:${columnIndex}`} disabled={disabled || unavailable} type="number" min={0} max={maximumFor(column)} className="mx-auto h-8 w-[76px] text-center text-[11px]" value={unavailable ? '' : value ?? ''} onChange={(event) => updateMark(rowIndex, column, event.target.value)} onPaste={(event) => pasteGrid(event, rowIndex, columnIndex)} onKeyDown={(event) => keyboardMove(event, rowIndex, columnIndex)} /></td>
                  })}
                  <td className="px-2 py-2 text-center font-semibold">{unavailable ? entry.participation_status : total ?? '—'}</td>
                  <td className="px-2 py-2 text-center font-semibold">{percentage === null || unavailable ? '—' : `${percentage}%`}</td>
                  <td className="px-2 py-2"><span className="inline-flex items-center gap-1 rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2 py-1 text-[9px] font-semibold uppercase text-[#1d4ed8]"><CheckCircle2 className="size-3" />{mode}</span></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  </SectionCard>
}

