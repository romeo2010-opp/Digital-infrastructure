import { useEffect, useMemo, useState } from 'react'
import { Link2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { usePortal } from '../lib/portalContext'

export function QuestionCurriculumMapping({ assessmentId, question, classId, subjectId, termId, readOnly = false, onMapped }: { assessmentId: any; question: any; classId: any; subjectId: any; termId?: any; readOnly?: boolean; onMapped?: (value: any) => void }) {
  const { token, api } = usePortal()
  const [topics, setTopics] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [mappings, setMappings] = useState<any[]>([])
  const [objectiveRef, setObjectiveRef] = useState('')
  const [saving, setSaving] = useState(false)
  const marks = Number(question?.marks || 0)

  useEffect(() => {
    if (!question?.id || !subjectId || !classId) return
    api.listAcademicAuthoringTopics(token, { class_id: classId, subject_id: subjectId, term_id: termId || undefined })
      .then((response: any) => setTopics(response.topics || []))
      .catch(() => setTopics([]))
  }, [api, classId, question?.id, subjectId, termId, token])
  useEffect(() => {
    if (!question?.id) return
    const existing = Array.isArray(question.topic_mappings) ? question.topic_mappings : []
    setMappings(existing.length ? existing.map((mapping: any) => {
      const selected = topics.find((topic) => topic.public_ref === mapping.topic_ref)
      return { topic_ref: selected?.parent_ref || selected?.public_ref || mapping.broad_topic_ref || '', subtopic_ref: selected?.parent_ref ? selected.public_ref : mapping.subtopic_ref || '', allocated_marks: String(mapping.allocated_marks ?? ''), allocation_type: 'marks', is_primary: Boolean(mapping.is_primary) }
    }) : [{ topic_ref: '', subtopic_ref: '', allocated_marks: marks ? String(marks) : '', allocation_type: 'marks', is_primary: true }])
    setObjectiveRef(question.objective_mappings?.find((objective: any) => objective.mapping_role === 'primary')?.objective_ref || '')
  }, [marks, question?.id, topics])

  const allocated = mappings.reduce((sum, mapping) => sum + Number(mapping.allocated_marks || 0), 0)
  const primaryMapping = mappings.find((mapping) => mapping.is_primary) || mappings[0]
  const selectedPrimary = topics.find((topic) => topic.public_ref === (primaryMapping?.subtopic_ref || primaryMapping?.topic_ref))
  const rootTopics = useMemo(() => {
    const known = new Set(topics.map((topic) => topic.public_ref))
    return topics.filter((topic) => !topic.parent_ref || !known.has(topic.parent_ref))
  }, [topics])
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query ? rootTopics.filter((topic) => {
      const children = topics.filter((child) => child.parent_ref === topic.public_ref)
      return [topic, ...children].some((item) => `${item.hierarchy_label} ${item.description || ''}`.toLowerCase().includes(query))
    }) : rootTopics
  }, [rootTopics, search, topics])
  const patchMapping = (index: number, patch: any) => setMappings((current) => current.map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, ...patch } : mapping))
  const addMapping = () => setMappings((current) => [...current, { topic_ref: '', subtopic_ref: '', allocated_marks: '', allocation_type: 'marks', is_primary: false }])
  const save = async () => {
    if (!mappings.length || mappings.some((mapping) => !mapping.topic_ref)) return toast.error('Select a valid syllabus topic for every allocation.')
    if (Math.abs(allocated - marks) > 0.01) return toast.error(`Topic allocations must equal the question's ${marks} marks.`)
    setSaving(true)
    try {
      const result = await api.saveAssessmentQuestionMappings(token, assessmentId, question.id, { topic_mappings: mappings.map((mapping, index) => ({ ...mapping, topic_ref: mapping.subtopic_ref || mapping.topic_ref, broad_topic_ref: mapping.topic_ref, subtopic_ref: mapping.subtopic_ref || null, allocated_marks: Number(mapping.allocated_marks), is_primary: index === 0 })), objective_mappings: objectiveRef ? [{ objective_ref: objectiveRef, mapping_role: 'primary' }] : [] })
      toast.success('Curriculum mapping saved.')
      onMapped?.(result)
    } catch (error: any) { toast.error(error.message || 'Unable to save curriculum mapping.') } finally { setSaving(false) }
  }

  if (!question?.id) return <div className="rounded-[5px] border border-dashed border-[#cbd5e1] bg-white p-2 text-[10px] leading-4 text-[#64748b]">Save the assessment draft first, then map this question to the approved syllabus.</div>
  return <div className="grid gap-2 rounded-[5px] border border-[#dbeafe] bg-[#f8fbff] p-2">
    <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#1d4ed8]"><Link2 className="size-3" />Curriculum evidence mapping</span><span className={`font-mono text-[10px] font-semibold ${Math.abs(allocated - marks) < .01 ? 'text-emerald-700' : 'text-amber-700'}`}>{allocated}/{marks} marks</span></div>
    <Input disabled={readOnly} className="h-8 bg-white text-[11px]" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search valid topics…" />
    {mappings.map((mapping, index) => {
      const children = topics.filter((topic) => topic.parent_ref === mapping.topic_ref)
      return <div key={index} className="grid gap-1.5 rounded-[4px] border border-[#e2e8f0] bg-white p-2">
        <div className="grid grid-cols-[1fr_68px_28px] gap-1.5">
          <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Topic<select disabled={readOnly} className="h-8 min-w-0 rounded-[4px] border border-[#d9dce3] bg-white px-2 text-[11px] font-normal normal-case tracking-normal" value={mapping.topic_ref} onChange={(event) => { patchMapping(index, { topic_ref: event.target.value, subtopic_ref: '' }); if (index === 0) setObjectiveRef('') }}><option value="">Select topic</option>{filtered.map((topic) => <option key={topic.public_ref} value={topic.public_ref}>{topic.topic_name}</option>)}</select></label>
          <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Marks<Input disabled={readOnly} type="number" min={0} max={marks} className="h-8 bg-white text-center text-[11px] font-normal normal-case" value={mapping.allocated_marks} onChange={(event) => patchMapping(index, { allocated_marks: event.target.value })} /></label>
          <button disabled={readOnly || mappings.length === 1} type="button" className="mt-[17px] grid size-8 place-items-center rounded-[4px] border border-[#fecaca] bg-white text-[#b91c1c] disabled:opacity-40" onClick={() => setMappings((current) => current.filter((_, mappingIndex) => mappingIndex !== index))} aria-label="Remove topic mapping"><Trash2 className="size-3" /></button>
        </div>
        <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Subtopic<select disabled={readOnly || !mapping.topic_ref || !children.length} className="h-8 rounded-[4px] border border-[#d9dce3] bg-white px-2 text-[11px] font-normal normal-case tracking-normal" value={mapping.subtopic_ref} onChange={(event) => { patchMapping(index, { subtopic_ref: event.target.value }); if (index === 0) setObjectiveRef('') }}><option value="">{children.length ? 'Select syllabus subtopic' : 'No subtopics for this topic'}</option>{children.map((topic) => <option key={topic.public_ref} value={topic.public_ref}>{topic.topic_name}</option>)}</select></label>
      </div>
    })}
    <label className="grid gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Learning objective<select disabled={readOnly || !selectedPrimary} className="h-8 rounded-[4px] border border-[#d9dce3] bg-white px-2 text-[11px] font-normal normal-case tracking-normal" value={objectiveRef} onChange={(event) => setObjectiveRef(event.target.value)}><option value="">Recommended: select objective</option>{(selectedPrimary?.objectives || []).map((objective: any) => <option key={objective.public_ref} value={objective.public_ref}>{objective.objective_text}</option>)}</select></label>
    <div className="flex justify-between gap-2"><Button disabled={readOnly || mappings.length >= 3} type="button" variant="outline" className="h-7 px-2 text-[10px]" onClick={addMapping}><Plus className="size-3" />Add topic</Button><Button disabled={readOnly || saving || Math.abs(allocated - marks) > .01} type="button" className="h-7 px-2 text-[10px]" onClick={save}>{saving ? 'Saving…' : 'Save mapping'}</Button></div>
  </div>
}
