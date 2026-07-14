import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

const selectClass = 'h-9 w-full rounded-[7px] border border-[#d8dee8] bg-white px-3 text-[12px] font-semibold text-[#334155] outline-none focus:border-[#94a3b8]'
const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]'

export function DirectorTaskModal({ open, onOpenChange, staff, initial, onSubmit }: any) {
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) setForm({ title: '', category: 'general', priority: 'medium', assigned_to_user_id: '', due_date: '', description: '', ...initial })
  }, [open, initial])
  const save = async () => {
    setSaving(true); setError('')
    try { await onSubmit({ ...form, assigned_to_user_id: form.assigned_to_user_id || null }); onOpenChange(false) }
    catch (err: any) { setError(err?.message || 'Unable to create task.') }
    finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-[620px] rounded-[10px]">
      <DialogHeader><DialogTitle>Create Director follow-up</DialogTitle><DialogDescription>Assign a real internal action linked to the record you are reviewing.</DialogDescription></DialogHeader>
      <div className="grid gap-3 py-2">
        <label className={labelClass}>Title<Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="What needs to be done?" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>Category<select className={selectClass} value={form.category || 'general'} onChange={(e) => setForm({ ...form, category: e.target.value })}>{['finance','academics','staff','admissions','operations','general'].map((v) => <option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label>
          <label className={labelClass}>Priority<select className={selectClass} value={form.priority || 'medium'} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{['low','medium','high','urgent'].map((v) => <option key={v} value={v}>{v[0].toUpperCase()+v.slice(1)}</option>)}</select></label>
          <label className={labelClass}>Assign to<select className={selectClass} value={form.assigned_to_user_id || ''} onChange={(e) => setForm({ ...form, assigned_to_user_id: e.target.value })}><option value="">Unassigned</option>{staff.map((u: any) => <option key={u.id} value={u.id}>{u.full_name} · {String(u.role).replace(/_/g,' ')}</option>)}</select></label>
          <label className={labelClass}>Due date<Input type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
        </div>
        <label className={labelClass}>Description<Textarea rows={4} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Evidence, expected outcome, and follow-up context" /></label>
        {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={saving || !String(form.title || '').trim()} onClick={save}>{saving ? 'Creating…' : 'Create task'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
