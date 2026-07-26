import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Plus, X } from 'lucide-react'
import { teamRequest, titleCase } from './teamApi'

export function useTeamData(path: string, token: string, dependency = '') {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await teamRequest(path, {}, token)) }
    catch (incoming: any) { setError(incoming?.message || 'Could not load Team Suite data.') }
    finally { setLoading(false) }
  }, [path, token, dependency])
  useEffect(() => { void load() }, [load])
  return { data, loading, error, reload: load, setData }
}

export function TeamPageHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[#142333]">{title}</h1><p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">{subtitle}</p></div>{action && onAction ? <button type="button" onClick={onAction} className="inline-flex h-9 items-center gap-2 rounded-[7px] bg-[#175f91] px-3.5 text-[11px] font-semibold text-white shadow-sm hover:bg-[#124f7a]"><Plus className="size-4" />{action}</button> : null}</div>
}

export function TeamCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[9px] border border-[#dce3ec] bg-white shadow-[0_2px_10px_rgba(15,30,46,0.035)] ${className}`}>{children}</section>
}

export function TeamCardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h2 className="text-[13px] font-semibold text-[#142333]">{title}</h2>{subtitle ? <p className="mt-0.5 text-[10px] text-slate-500">{subtitle}</p> : null}</div>{action}</div>
}

export function TeamBadge({ value }: { value: any }) {
  const normalized = String(value || 'unknown').toLowerCase()
  const tone = normalized.includes('critical') || normalized.includes('overdue') || normalized.includes('lost') || normalized.includes('blocked') || normalized.includes('rejected') ? 'border-rose-200 bg-rose-50 text-rose-700' : normalized.includes('won') || normalized.includes('active') || normalized.includes('complete') || normalized.includes('approved') || normalized.includes('live') || normalized.includes('resolved') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : normalized.includes('high') || normalized.includes('pending') || normalized.includes('awaiting') || normalized.includes('watch') || normalized.includes('negotiation') ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-600'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-semibold ${tone}`}>{titleCase(value || 'unknown')}</span>
}

export function TeamLoading({ label = 'Loading operational records…' }: { label?: string }) {
  return <div className="grid min-h-[260px] place-items-center rounded-[9px] border border-slate-200 bg-white"><div className="text-center"><Loader2 className="mx-auto size-6 animate-spin text-[#175f91]" /><p className="mt-3 text-[11px] text-slate-500">{label}</p></div></div>
}

export function TeamError({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[9px] border border-rose-200 bg-rose-50 p-6 text-center"><AlertCircle className="size-6 text-rose-600" /><p className="mt-3 max-w-lg text-[12px] text-rose-800">{message}</p>{retry ? <button type="button" onClick={retry} className="mt-4 rounded-[6px] border border-rose-300 bg-white px-3 py-2 text-[10px] font-semibold text-rose-700">Try again</button> : null}</div>
}

export function TeamEmpty({ title, detail }: { title: string; detail: string }) {
  return <div className="px-5 py-12 text-center"><div className="text-[12px] font-semibold text-slate-700">{title}</div><p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-slate-500">{detail}</p></div>
}

export function TeamPagination({ pagination, onPage }: { pagination?: any; onPage: (page: number) => void }) {
  if (!pagination || Number(pagination.total_pages || 1) <= 1) return null
  return <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-[10px] text-slate-500"><span>Page {pagination.page} of {pagination.total_pages} · {pagination.total} records</span><div className="flex gap-1"><button type="button" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} className="grid size-7 place-items-center rounded border border-slate-200 disabled:opacity-40"><ChevronLeft className="size-3.5" /></button><button type="button" disabled={pagination.page >= pagination.total_pages} onClick={() => onPage(pagination.page + 1)} className="grid size-7 place-items-center rounded border border-slate-200 disabled:opacity-40"><ChevronRight className="size-3.5" /></button></div></div>
}

export type TeamFormField = { name: string; label: string; type?: 'text' | 'email' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'select' | 'checkbox'; required?: boolean; placeholder?: string; options?: Array<{ value: string; label: string }> }

export function TeamFormModal({ open, title, description, fields, initial = {}, submitLabel = 'Save', onClose, onSubmit }: { open: boolean; title: string; description?: string; fields: TeamFormField[]; initial?: Record<string, any>; submitLabel?: string; onClose: () => void; onSubmit: (values: Record<string, any>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, any>>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setValues(initial); setError('') } }, [open])
  if (!open) return null
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); try { await onSubmit(values); onClose() } catch (incoming: any) { setError(incoming?.message || 'Could not save this record.') } finally { setSaving(false) } }
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-3" role="dialog" aria-modal="true" aria-label={title}><form onSubmit={submit} className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[12px] border border-slate-200 bg-white shadow-2xl"><div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-[15px] font-semibold">{title}</h2>{description ? <p className="mt-1 text-[11px] leading-5 text-slate-500">{description}</p> : null}</div><button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full hover:bg-slate-100"><X className="size-4" /></button></div><div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">{fields.map((field) => <label key={field.name} className={`${field.type === 'textarea' ? 'sm:col-span-2' : ''} ${field.type === 'checkbox' ? 'flex items-center gap-2' : 'block'}`}>{field.type !== 'checkbox' ? <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{field.label}{field.required ? ' *' : ''}</span> : null}{field.type === 'select' ? <select required={field.required} value={values[field.name] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} className="h-9 w-full rounded-[6px] border border-slate-200 bg-white px-2.5 text-[11px] outline-none focus:border-[#175f91]"><option value="">Select…</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'textarea' ? <textarea required={field.required} value={values[field.name] ?? ''} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} rows={4} className="w-full rounded-[6px] border border-slate-200 px-2.5 py-2 text-[11px] outline-none focus:border-[#175f91]" /> : field.type === 'checkbox' ? <><input type="checkbox" checked={Boolean(values[field.name])} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))} /><span className="text-[11px] font-medium">{field.label}</span></> : <input required={field.required} type={field.type || 'text'} value={values[field.name] ?? ''} placeholder={field.placeholder} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} className="h-9 w-full rounded-[6px] border border-slate-200 px-2.5 text-[11px] outline-none focus:border-[#175f91]" />}</label>)}</div>{error ? <div className="border-t border-rose-100 bg-rose-50 px-5 py-2.5 text-[11px] text-rose-700">{error}</div> : null}<div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3"><button type="button" onClick={onClose} className="h-9 rounded-[6px] border border-slate-200 px-3 text-[11px] font-semibold">Cancel</button><button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-[6px] bg-[#175f91] px-4 text-[11px] font-semibold text-white disabled:opacity-60">{saving ? <Loader2 className="size-3.5 animate-spin" /> : null}{saving ? 'Saving…' : submitLabel}</button></div></form></div>
}

export function TeamTable({ columns, rows, onRow }: { columns: Array<{ key: string; label: string; render?: (row: any) => ReactNode }>; rows: any[]; onRow?: (row: any) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-slate-200 bg-slate-50/70">{columns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-500">{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.public_ref || row.id || index} onClick={onRow ? () => onRow(row) : undefined} className={`border-b border-slate-100 last:border-0 ${onRow ? 'cursor-pointer hover:bg-blue-50/30' : ''}`}>{columns.map((column) => <td key={column.key} className="whitespace-nowrap px-4 py-3 text-[11px] text-slate-700">{column.render ? column.render(row) : row[column.key] ?? '—'}</td>)}</tr>)}</tbody></table></div>
}
