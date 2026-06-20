import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AlignCenter, AlignLeft, AlignRight, Archive, ArrowDown, ArrowLeft, ArrowUp, Bold, CheckCircle2, ClipboardCheck, Copy, Crop, Download, FileJson, FileText, FilePlus2, GripVertical, Grid3X3, Image as ImageIcon, Italic, Layers, List, ListOrdered, Minus, Move, PanelRight, Plus, Printer, Rows3, Save, Send, Shapes, Square, Trash2, Type, Underline, Undo2, Upload, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { resolvePortalAssetUrl } from '../lib/portalApi'
import { usePortal } from '../lib/portalContext'

const assessmentTypes = [
  ['class_test', 'Class Test'],
  ['quiz', 'Quiz'],
  ['assignment', 'Assignment'],
  ['mid_term', 'Mid Term'],
  ['end_of_term_exam', 'End Of Term Exam'],
  ['mock_exam', 'Mock Exam'],
  ['final_exam', 'Final Exam'],
]

const questionTypes = [
  ['multiple_choice', 'Multiple Choice'],
  ['true_false', 'True / False'],
  ['short_answer', 'Short Answer'],
  ['structured', 'Structured'],
  ['essay', 'Essay'],
  ['calculation', 'Calculation'],
  ['fill_blank', 'Fill Blank'],
]

const formalTypes = new Set(['mid_term', 'end_of_term_exam', 'mock_exam', 'final_exam'])
const examSessionRequiredTypes = new Set(['end_of_term_exam', 'mock_exam', 'final_exam'])

const emptyForm = {
  id: '',
  name: '',
  assessment_type: 'class_test',
  academic_year_id: '',
  term_id: '',
  exam_session_id: '',
  class_id: '',
  stream_section: '',
  subject_id: '',
  teacher_id: '',
  total_marks: '100',
  duration_minutes: '60',
  instructions: '',
  expected_difficulty: 'Medium',
  status: 'draft',
  return_reason: '',
}

function selectClassName() {
  return 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
}

function statusLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function newOptions() {
  return ['A', 'B', 'C', 'D'].map((label) => ({ option_label: label, option_text: '', is_correct: label === 'A' }))
}

function newQuestion(index: number) {
  return {
    local_id: uid('question'),
    question_number: index,
    sort_order: 100 + index,
    question_text: '',
    question_type: 'short_answer',
    marks: '',
    topic_text: '',
    subtopic_text: '',
    difficulty: 'medium',
    cognitive_skill: '',
    question_instructions: '',
    correct_answer: '',
    marking_scheme: '',
    explanation: '',
    options: newOptions(),
    style_json: { spacing: 'normal', z_index: 0, offset_x: 0, offset_y: 0 },
  }
}

function uid(prefix = 'block') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function blockKey(block: any) {
  return String(block?.local_id || block?.id || '')
}

function questionKey(question: any, index: number) {
  return String(question?.local_id || (question?.id ? `question-${question.id}` : `question-${index + 1}`))
}

function numericStyle(value: any, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function positionedBlockStyle(style: any = {}) {
  const x = numericStyle(style.offset_x, 0)
  const y = numericStyle(style.offset_y, 0)
  return {
    position: 'relative',
    zIndex: numericStyle(style.z_index, 0),
    transform: x || y ? `translate(${x}px, ${y}px)` : undefined,
  } as any
}

function newDesignBlock(blockType: string) {
  const id = uid(blockType)
  const baseStyle = { align: 'left', z_index: 0, offset_x: 0, offset_y: 0 }
  const base = { local_id: id, block_type: blockType, sort_order: Date.now(), is_printable: true, content_json: {}, style_json: baseStyle, metadata_json: {} }
  if (blockType === 'answer_space') {
    return {
      ...base,
      content_json: { answer_space_type: 'ruled_lines', height: 120, number_of_lines: 5, show_border: true },
      style_json: { ...baseStyle, align: 'stretch' },
    }
  }
  if (blockType === 'image') {
    return {
      ...base,
      content_json: { media_id: '', url: '', caption: '', alt_text: '', width: 360, crop_enabled: false, crop_height: 220, crop_x: 50, crop_y: 50, crop_zoom: 1 },
      style_json: { ...baseStyle, align: 'center' },
    }
  }
  if (blockType === 'shape') {
    return {
      ...base,
      content_json: { shape_type: 'rectangle', label: 'Diagram label', width: 260, height: 120 },
      style_json: { ...baseStyle, align: 'center' },
    }
  }
  if (blockType === 'table') {
    return {
      ...base,
      content_json: { rows: 3, columns: 3, header_row: true, cells: [['Heading 1', 'Heading 2', 'Heading 3'], ['', '', ''], ['', '', '']] },
      style_json: { ...baseStyle, borders: true },
    }
  }
  if (blockType === 'page_break') return { ...base, content_json: { label: 'Page Break' } }
  if (blockType === 'text_box') return { ...base, content_json: { text: 'Text box' }, style_json: { ...baseStyle, align: 'left', border: true } }
  if (blockType === 'section') return { ...base, content_json: { title: 'Section A' }, style_json: { ...baseStyle, align: 'left' } }
  if (blockType === 'teacher_note') return { ...base, is_printable: false, content_json: { text: 'Teacher note' } }
  return { ...base, content_json: { text: '' } }
}

function buildCoverBlocks(form: any, setup: any, user: any, assignedTeacher: any, teacherOptions: any[]) {
  const className = (setup.classes || []).find((row: any) => String(row.id) === String(form.class_id))?.name || ''
  const subjectName = (setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id))?.name || ''
  const yearName = (setup.years || []).find((row: any) => String(row.id) === String(form.academic_year_id))?.name || setup.session?.academic_year?.name || ''
  const termName = (setup.terms || []).find((row: any) => String(row.id) === String(form.term_id))?.name || setup.session?.term?.name || ''
  const examSession = (setup.exam_sessions || []).find((row: any) => String(row.id) === String(form.exam_session_id))?.name || ''
  const teacherName = assignedTeacher?.teacher_name || teacherOptions.find((row: any) => String(row.id) === String(form.teacher_id))?.full_name || user?.fullName || ''
  return [
    { label: 'School', value: user?.schoolName || '' },
    { label: 'Class', value: className },
    { label: 'Subject', value: subjectName },
    { label: 'Duration', value: form.duration_minutes ? `${form.duration_minutes} minutes` : '' },
    { label: 'Total Marks', value: form.total_marks || '' },
    { label: 'Teacher', value: teacherName },
    { label: 'Academic Year', value: yearName },
    { label: 'Term', value: termName },
    { label: 'Exam Session', value: examSession },
    { label: 'Status', value: statusLabel(form.status) },
  ]
}

function questionToBlock(question: any, index: number) {
  return {
    local_id: questionKey(question, index),
    block_type: 'question',
    content_json: {
      question_number: index + 1,
      question_text: question.question_text || '',
      question_type: question.question_type || 'short_answer',
      marks: question.marks || '',
      question_instructions: question.question_instructions || '',
      options: question.options || [],
    },
    style_json: { spacing: 'normal', z_index: 0, offset_x: 0, offset_y: 0, ...(question.style_json || {}) },
    metadata_json: {
      topic_text: question.topic_text || '',
      subtopic_text: question.subtopic_text || '',
      difficulty: question.difficulty || 'medium',
      cognitive_skill: question.cognitive_skill || '',
      correct_answer: question.correct_answer || '',
      marking_scheme: question.marking_scheme || '',
      explanation: question.explanation || '',
      teacher_note: question.teacher_note || '',
    },
    sort_order: numericStyle(question.sort_order, 100 + index),
    is_printable: true,
  }
}

function blockTitle(block: any) {
  const type = String(block?.block_type || 'block').replace(/_/g, ' ')
  const text = block?.content_json?.title || block?.content_json?.label || block?.content_json?.text || block?.content_json?.question_text || ''
  return `${type.replace(/\b\w/g, (letter) => letter.toUpperCase())}${text ? ` · ${String(text).slice(0, 28)}` : ''}`
}

function escapeHtml(value: any) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char))
}

function Field({ label, children }: { label: string; children: any }) {
  return (
    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
      {label}
      {children}
    </label>
  )
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: any; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const toneClass = tone === 'good' ? 'text-[#047857]' : tone === 'warn' ? 'text-[#b45309]' : tone === 'bad' ? 'text-[#b91c1c]' : 'text-[#111827]'
  return (
    <div className="rounded-[5px] border border-[#e2e8f0] bg-white px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7280]">{label}</div>
      <div className={`mt-1 text-[15px] font-bold ${toneClass}`}>{value}</div>
    </div>
  )
}

export function ExamPaperDocumentPage() {
  const navigate = useNavigate()
  const { assessmentId } = useParams()
  const { token, api, user } = usePortal()
  const role = String(user?.role || '').toLowerCase()
  const canApprove = ['school_owner', 'headteacher', 'super_admin'].includes(role)
  const [setup, setSetup] = useState<any>({ years: [], terms: [], classes: [], subjects: [], teachers: [], assignments: [], exam_sessions: [], session: null })
  const [form, setForm] = useState<any>(emptyForm)
  const [questions, setQuestions] = useState<any[]>([])
  const [designBlocks, setDesignBlocks] = useState<any[]>([])
  const [media, setMedia] = useState<any[]>([])
  const [selectedBlockId, setSelectedBlockId] = useState('')
  const [outlineDragId, setOutlineDragId] = useState('')
  const [canvasDrag, setCanvasDrag] = useState<any>(null)
  const [editorMode, setEditorMode] = useState<'builder' | 'print' | 'marking' | 'review'>('builder')
  const [showInspector, setShowInspector] = useState(true)
  const [paperLayout, setPaperLayout] = useState<any>({ paper_size: 'A4', margins: 'normal', question_spacing: 'normal', section_spacing: 'normal', show_guides: true })
  const [returnReason, setReturnReason] = useState('')
  const [activeTab, setActiveTab] = useState('file')
  const [template, setTemplate] = useState('standard')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState('')
  const isNewPaper = !assessmentId || assessmentId === 'new'

  const isFormal = formalTypes.has(form.assessment_type)
  const needsExamSession = examSessionRequiredTypes.has(form.assessment_type)
  const selectedExamSession = (setup.exam_sessions || []).find((row: any) => String(row.id) === String(form.exam_session_id))
  const currentStatus = String(form.status || 'draft')
  const readOnly = currentStatus === 'locked'
    || currentStatus === 'archived'
    || (role === 'teacher' && !['draft', 'open', 'returned'].includes(currentStatus))

  const currentAssignments = useMemo(() => setup.assignments || [], [setup.assignments])
  const classSubjects = useMemo(() => {
    if (canApprove) return setup.subjects || []
    if (!form.class_id) return setup.subjects || []
    const subjectIds = new Set(
      currentAssignments
        .filter((row: any) => String(row.class_id) === String(form.class_id))
        .map((row: any) => Number(row.subject_id)),
    )
    return (setup.subjects || []).filter((row: any) => subjectIds.has(Number(row.id)))
  }, [canApprove, currentAssignments, form.class_id, setup.subjects])

  const teacherOptions = useMemo(() => {
    if (!canApprove) return setup.teachers || []
    if (!form.class_id || !form.subject_id) return setup.teachers || []
    const teacherIds = new Set(
      currentAssignments
        .filter((row: any) => String(row.class_id) === String(form.class_id) && String(row.subject_id) === String(form.subject_id))
        .map((row: any) => Number(row.teacher_id)),
    )
    const scoped = (setup.teachers || []).filter((row: any) => teacherIds.has(Number(row.id)))
    return scoped.length ? scoped : setup.teachers || []
  }, [canApprove, currentAssignments, form.class_id, form.subject_id, setup.teachers])

  const assignedTeacher = useMemo(() => {
    if (!form.class_id || !form.subject_id) return null
    const assignment = currentAssignments.find((row: any) =>
      String(row.class_id) === String(form.class_id)
      && String(row.subject_id) === String(form.subject_id)
      && (!form.teacher_id || String(row.teacher_id) === String(form.teacher_id)),
    )
    return assignment || null
  }, [currentAssignments, form.class_id, form.subject_id, form.teacher_id])

  const quality = useMemo(() => {
    const totalMarks = Number(form.total_marks || 0)
    const questionTotal = questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
    const missingText = questions.filter((question) => !String(question.question_text || '').trim()).length
    const missingMarks = questions.filter((question) => Number(question.marks || 0) <= 0).length
    const missingSchemes = questions.filter((question) => isFormal && !String(question.marking_scheme || '').trim()).length
    const hardQuestions = questions.filter((question) => question.difficulty === 'hard').length
    const recallQuestions = questions.filter((question) => question.cognitive_skill === 'recall').length
    const mcqIssues = questions.filter((question) => {
      if (question.question_type !== 'multiple_choice') return false
      const options = (question.options || []).filter((option: any) => String(option.option_text || '').trim())
      return options.length < 2 || options.filter((option: any) => option.is_correct).length !== 1
    }).length
    const ready = Boolean(
      form.name
      && form.assessment_type
      && form.academic_year_id
      && form.term_id
      && (!needsExamSession || form.exam_session_id)
      && form.class_id
      && form.subject_id
      && assignedTeacher
      && totalMarks > 0
      && Number(form.duration_minutes || 0) > 0
      && questions.length
      && !missingText
      && !missingMarks
      && !missingSchemes
      && !mcqIssues
      && Math.abs(questionTotal - totalMarks) < 0.01
    )
    return { totalMarks, questionTotal, missingText, missingMarks, missingSchemes, hardQuestions, recallQuestions, mcqIssues, ready }
  }, [assignedTeacher, form, isFormal, needsExamSession, questions])

  const reviewChecks = useMemo(() => {
    const missingTopics = questions.filter((question) => !String(question.topic_text || '').trim()).length
    const missingDifficulty = questions.filter((question) => !String(question.difficulty || '').trim()).length
    const missingSkill = questions.filter((question) => !String(question.cognitive_skill || '').trim()).length
    const missingInstructions = !String(form.instructions || '').trim() ? 1 : 0
    const teacherAssignmentValid = Boolean(assignedTeacher || canApprove)
    return {
      ...quality,
      missingTopics,
      missingDifficulty,
      missingSkill,
      missingInstructions,
      examSessionMissing: needsExamSession && !selectedExamSession,
      teacherAssignmentValid,
      ready: quality.ready && teacherAssignmentValid,
    }
  }, [assignedTeacher, canApprove, form.instructions, needsExamSession, quality, questions, selectedExamSession])

  const allBlocks = useMemo(() => [
    ...designBlocks,
    ...questions.map(questionToBlock),
  ].sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0)), [designBlocks, questions])

  const selectedBlock = useMemo(() => allBlocks.find((block: any) => String(block.local_id || block.id) === String(selectedBlockId)) || null, [allBlocks, selectedBlockId])
  const layeredBlocks = useMemo(() => [...allBlocks].sort((a: any, b: any) => {
    const layerDiff = numericStyle(b.style_json?.z_index, 0) - numericStyle(a.style_json?.z_index, 0)
    return layerDiff || numericStyle(a.sort_order, 0) - numericStyle(b.sort_order, 0)
  }), [allBlocks])

  const applyPaper = (payload: any) => {
    const assessment = payload?.assessment || payload
    const loadedBlocks = payload?.blocks || []
    const questionBlocks = loadedBlocks.filter((block: any) => block.block_type === 'question')
    setForm({
      ...emptyForm,
      ...assessment,
      id: assessment?.id ? String(assessment.id) : '',
      academic_year_id: assessment?.academic_year_id ? String(assessment.academic_year_id) : '',
      term_id: assessment?.term_id ? String(assessment.term_id) : '',
      exam_session_id: assessment?.exam_session_id ? String(assessment.exam_session_id) : '',
      class_id: assessment?.class_id ? String(assessment.class_id) : '',
      subject_id: assessment?.subject_id ? String(assessment.subject_id) : '',
      teacher_id: assessment?.teacher_id ? String(assessment.teacher_id) : '',
      total_marks: assessment?.total_marks ? String(assessment.total_marks) : '',
      duration_minutes: assessment?.duration_minutes ? String(assessment.duration_minutes) : '',
      stream_section: assessment?.stream_section || '',
      instructions: assessment?.instructions || '',
      return_reason: assessment?.return_reason || '',
      status: assessment?.status || 'draft',
    })
    setQuestions((payload?.questions || []).map((question: any, index: number) => ({
      ...newQuestion(index + 1),
      ...question,
      local_id: question.local_id || (question.id ? `question-${question.id}` : uid('question')),
      marks: question.marks ? String(question.marks) : '',
      options: question.options?.length ? question.options : newOptions(),
      style_json: {
        spacing: 'normal',
        z_index: 0,
        offset_x: 0,
        offset_y: 0,
        ...((questionBlocks.find((block: any) => Number(block.content_json?.question_number || 0) === index + 1) || questionBlocks[index])?.style_json || {}),
        ...(question.style_json || {}),
      },
      sort_order: numericStyle((questionBlocks.find((block: any) => Number(block.content_json?.question_number || 0) === index + 1) || questionBlocks[index])?.sort_order, numericStyle(question.sort_order, 100 + index)),
    })))
    setDesignBlocks(loadedBlocks
      .filter((block: any) => !['cover_field', 'instructions', 'question', 'sub_question', 'mcq_options'].includes(block.block_type))
      .map((block: any, index: number) => ({
        ...block,
        local_id: block.local_id || block.id || uid(block.block_type || 'block'),
        content_json: block.content_json || block.content || {},
        style_json: { z_index: 0, offset_x: 0, offset_y: 0, ...(block.style_json || block.style || {}) },
        metadata_json: block.metadata_json || block.metadata || {},
        sort_order: numericStyle(block.sort_order, 40 + index),
      })))
    setMedia(payload?.media || [])
    setReturnReason('')
  }

  const startNew = (sourceSetup = setup) => {
    const session = sourceSetup.session || {}
    const firstAssignment = (sourceSetup.assignments || [])[0]
    setForm({
      ...emptyForm,
      academic_year_id: session.academic_year_id ? String(session.academic_year_id) : '',
      term_id: session.term_id ? String(session.term_id) : '',
      class_id: firstAssignment && !canApprove ? String(firstAssignment.class_id) : '',
      subject_id: firstAssignment && !canApprove ? String(firstAssignment.subject_id) : '',
      teacher_id: role === 'teacher' ? String(user?.id || '') : '',
    })
    setQuestions([])
    setDesignBlocks([])
    setMedia([])
    setSelectedBlockId('')
    setReturnReason('')
    setLastSavedAt('')
  }

  const refresh = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const setupPayload = await api.getAssessmentBuilderSetup(token)
      setSetup(setupPayload || {})
      if (isNewPaper) {
        startNew(setupPayload || {})
      } else if (assessmentId) {
        const payload = await api.getAssessment(token, assessmentId)
        applyPaper(payload)
      }
      if (setupPayload?.setup_required) setError('No active academic term found. Ask an admin to open a term.')
    } catch (err: any) {
      setError(err?.message || 'Unable to load assessment paper.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, assessmentId])

  useEffect(() => {
    if (!canApprove && role === 'teacher' && user?.id && !form.teacher_id) {
      setForm((current: any) => ({ ...current, teacher_id: String(user.id) }))
    }
  }, [canApprove, form.teacher_id, role, user?.id])

  useEffect(() => {
    if (!canApprove || !form.class_id || !form.subject_id) return
    const match = currentAssignments.find((row: any) => String(row.class_id) === String(form.class_id) && String(row.subject_id) === String(form.subject_id))
    if (match && !teacherOptions.some((row: any) => String(row.id) === String(form.teacher_id))) {
      setForm((current: any) => ({ ...current, teacher_id: String(match.teacher_id) }))
    }
  }, [canApprove, currentAssignments, form.class_id, form.subject_id, form.teacher_id, teacherOptions])

  const updateQuestion = (index: number, key: string, value: any) => {
    setQuestions((current) => current.map((question, questionIndex) => questionIndex === index ? { ...question, [key]: value } : question))
  }

  const updateQuestionStyle = (blockId: any, key: string, value: any) => {
    setQuestions((current) => current.map((question, index) => questionKey(question, index) === String(blockId)
      ? { ...question, style_json: { ...(question.style_json || {}), [key]: value } }
      : question))
  }

  const updateOption = (questionIndex: number, optionIndex: number, key: string, value: any) => {
    setQuestions((current) => current.map((question, currentIndex) => {
      if (currentIndex !== questionIndex) return question
      const options = (question.options || newOptions()).map((option: any, currentOptionIndex: number) => {
        if (currentOptionIndex !== optionIndex) return key === 'is_correct' && value ? { ...option, is_correct: false } : option
        return { ...option, [key]: value }
      })
      return { ...question, options }
    }))
  }

  const moveQuestion = (index: number, direction: -1 | 1) => {
    setQuestions((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next.map((question, questionIndex) => ({ ...question, question_number: questionIndex + 1, sort_order: numericStyle(question.sort_order, 100 + questionIndex) }))
    })
  }

  const appendQuestion = (patch: any = {}) => {
    if (readOnly) return
    const maxOrder = allBlocks.reduce((max, block) => Math.max(max, numericStyle(block.sort_order, 0)), 90)
    const question = { ...newQuestion(questions.length + 1), ...patch, sort_order: maxOrder + 10 }
    setQuestions((current) => [...current, question])
    setSelectedBlockId(question.local_id)
    setEditorMode('builder')
  }

  const deleteQuestion = (index: number) => {
    setQuestions((current) => current.filter((_, questionIndex) => questionIndex !== index).map((row, questionIndex) => ({ ...row, question_number: questionIndex + 1 })))
  }

  const insertBlock = (blockType: string, patch: any = {}) => {
    if (readOnly) return
    const maxOrder = allBlocks.reduce((max, block) => Math.max(max, numericStyle(block.sort_order, 0)), 30)
    const nextBlock = newDesignBlock(blockType)
    const block = {
      ...nextBlock,
      ...patch,
      content_json: { ...(nextBlock.content_json || {}), ...(patch.content_json || {}) },
      style_json: { ...(nextBlock.style_json || {}), ...(patch.style_json || {}) },
      metadata_json: { ...(nextBlock.metadata_json || {}), ...(patch.metadata_json || {}) },
      sort_order: maxOrder + 10,
    }
    setDesignBlocks((current) => [...current, block])
    setSelectedBlockId(block.local_id)
    setEditorMode('builder')
  }

  const updateDesignBlock = (blockId: any, patch: any) => {
    setDesignBlocks((current) => current.map((block) => String(block.local_id || block.id) === String(blockId) ? { ...block, ...patch } : block))
  }

  const updateDesignBlockContent = (blockId: any, key: string, value: any) => {
    setDesignBlocks((current) => current.map((block) => String(block.local_id || block.id) === String(blockId)
      ? { ...block, content_json: { ...(block.content_json || {}), [key]: value } }
      : block))
  }

  const updateDesignBlockStyle = (blockId: any, key: string, value: any) => {
    setDesignBlocks((current) => current.map((block) => String(block.local_id || block.id) === String(blockId)
      ? { ...block, style_json: { ...(block.style_json || {}), [key]: value } }
      : block))
  }

  const updateBlockStyle = (blockId: any, key: string, value: any) => {
    const selected = allBlocks.find((block: any) => blockKey(block) === String(blockId))
    if (selected?.block_type === 'question') {
      updateQuestionStyle(blockId, key, value)
    } else {
      updateDesignBlockStyle(blockId, key, value)
    }
  }

  const removeDesignBlock = (blockId: any) => {
    setDesignBlocks((current) => current.filter((block) => String(block.local_id || block.id) !== String(blockId)))
    if (String(selectedBlockId) === String(blockId)) setSelectedBlockId('')
  }

  const applyOutlineOrder = (orderedBlocks: any[]) => {
    const orderValue = (index: number) => 40 + index * 10
    const positions = new Map(orderedBlocks.map((block, index) => [blockKey(block), orderValue(index)]))
    setDesignBlocks((current) => current.map((block, index) => ({
      ...block,
      sort_order: positions.get(blockKey(block)) ?? orderValue(index),
    })))
    setQuestions((current) => {
      const byId = new Map(current.map((question, index) => [questionKey(question, index), question]))
      const orderedQuestions = orderedBlocks
        .filter((block) => block.block_type === 'question')
        .map((block) => byId.get(blockKey(block)))
        .filter(Boolean) as any[]
      const orderedIds = new Set(orderedQuestions.map((question, index) => questionKey(question, index)))
      const remaining = current.filter((question, index) => !orderedIds.has(questionKey(question, index)))
      return [...orderedQuestions, ...remaining].map((question, index) => ({
        ...question,
        question_number: index + 1,
        sort_order: positions.get(questionKey(question, index)) ?? numericStyle(question.sort_order, 100 + index),
      }))
    })
  }

  const moveOutlineBlock = (sourceId: string, targetId: string) => {
    if (readOnly || !sourceId || !targetId || sourceId === targetId) return
    const sourceIndex = allBlocks.findIndex((block: any) => blockKey(block) === sourceId)
    const targetIndex = allBlocks.findIndex((block: any) => blockKey(block) === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...allBlocks]
    const [item] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, item)
    applyOutlineOrder(next)
  }

  const moveOutlineBlockBy = (blockId: string, direction: -1 | 1) => {
    if (readOnly) return
    const index = allBlocks.findIndex((block: any) => blockKey(block) === blockId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= allBlocks.length) return
    const next = [...allBlocks]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    applyOutlineOrder(next)
  }

  const moveLayer = (blockId: string, mode: 'front' | 'back' | 'forward' | 'backward') => {
    if (readOnly || !blockId) return
    const current = allBlocks.find((block: any) => blockKey(block) === blockId)
    if (!current) return
    const layers = allBlocks.map((block: any) => numericStyle(block.style_json?.z_index, 0))
    const currentZ = numericStyle(current.style_json?.z_index, 0)
    const nextZ = mode === 'front'
      ? Math.max(0, ...layers) + 1
      : mode === 'back'
        ? Math.min(0, ...layers) - 1
        : mode === 'forward'
          ? currentZ + 1
          : currentZ - 1
    updateBlockStyle(blockId, 'z_index', nextZ)
  }

  const startCanvasDrag = (event: any, block: any) => {
    if (readOnly || editorMode !== 'builder') return
    event.preventDefault()
    event.stopPropagation()
    const id = blockKey(block)
    const style = block.style_json || {}
    setSelectedBlockId(id)
    setCanvasDrag({
      id,
      startX: event.clientX,
      startY: event.clientY,
      originX: numericStyle(style.offset_x, 0),
      originY: numericStyle(style.offset_y, 0),
    })
  }

  useEffect(() => {
    if (!canvasDrag) return
    const move = (event: PointerEvent) => {
      updateBlockStyle(canvasDrag.id, 'offset_x', Math.round(canvasDrag.originX + event.clientX - canvasDrag.startX))
      updateBlockStyle(canvasDrag.id, 'offset_y', Math.round(canvasDrag.originY + event.clientY - canvasDrag.startY))
    }
    const stop = () => setCanvasDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasDrag])

  const structuredBlocks = () => {
    const coverBlocks = buildCoverBlocks(form, setup, user, assignedTeacher, teacherOptions).map((field, index) => ({
      block_type: 'cover_field',
      content_json: field,
      style_json: { align: index < 2 ? 'center' : 'left' },
      metadata_json: { auto: true },
      sort_order: index + 1,
      is_printable: true,
    }))
    const instructionsBlock = {
      block_type: 'instructions',
      content_json: { text: form.instructions || '' },
      style_json: {},
      metadata_json: {},
      sort_order: 20,
      is_printable: true,
    }
    return [
      ...coverBlocks,
      instructionsBlock,
      ...designBlocks.map((block, index) => ({
        block_type: block.block_type,
        content_json: block.content_json || {},
        style_json: block.style_json || {},
        metadata_json: block.metadata_json || {},
        sort_order: numericStyle(block.sort_order, 40 + index),
        is_printable: block.is_printable !== false,
      })),
      ...questions.map(questionToBlock),
    ]
  }

  const buildPayload = () => ({
    ...form,
    questions: questions.map((question, index) => ({ ...question, question_number: index + 1, sort_order: numericStyle(question.sort_order, 100 + index) })),
    blocks: structuredBlocks(),
  })

  const saveDraft = async () => {
    if (!token || readOnly) return null
    setSaving(true)
    setError('')
    try {
      const result = await api.saveAssessmentDraft(token, form.id, buildPayload())
      applyPaper(result)
      setLastSavedAt(new Date().toLocaleTimeString())
      toast.success('Assessment draft saved.')
      if (!form.id && result?.assessment?.id) navigate(`/exam-builder/${result.assessment.id}`, { replace: true })
      return result
    } catch (err: any) {
      const message = err?.message || 'Unable to save assessment draft.'
      setError(message)
      toast.error(message)
      return null
    } finally {
      setSaving(false)
    }
  }

  const submitForReview = async () => {
    if (!token || readOnly) return
    const saved = await saveDraft()
    const id = saved?.assessment?.id || form.id
    if (!id) return
    setSaving(true)
    try {
      const result = await api.updateAssessmentStatus(token, id, { status: 'ready_for_review' })
      applyPaper(result)
      toast.success('Paper submitted for review.')
    } catch (err: any) {
      const message = err?.message || 'Unable to submit paper for review.'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (status: string) => {
    if (!token || !form.id) return
    setSaving(true)
    try {
      const payload: any = { status }
      if (status === 'returned') payload.return_reason = returnReason
      const result = await api.updateAssessmentStatus(token, form.id, payload)
      applyPaper(result)
      toast.success(status === 'returned' ? 'Paper returned for correction.' : `Paper moved to ${statusLabel(status)}.`)
    } catch (err: any) {
      const message = err?.message || 'Unable to update paper status.'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const handleExamSessionChange = (value: string) => {
    const session = (setup.exam_sessions || []).find((row: any) => String(row.id) === String(value))
    setForm((current: any) => ({
      ...current,
      exam_session_id: value,
      academic_year_id: session?.academic_year_id ? String(session.academic_year_id) : current.academic_year_id,
      term_id: session?.term_id ? String(session.term_id) : current.term_id,
    }))
  }

  const applyTemplate = (value: string) => {
    setTemplate(value)
    const templatePatch: Record<string, any> = {
      standard: {
        instructions: 'Answer all questions. Show all working where applicable.',
      },
      spelling: {
        instructions: 'Write each word clearly. Listen carefully before writing your answer.',
        duration_minutes: '30',
        total_marks: '20',
      },
      science: {
        instructions: 'Answer all questions. Use diagrams and tables where required.',
        duration_minutes: '90',
        total_marks: '80',
      },
      mathematics: {
        instructions: 'Answer all questions. Show all working. Calculators may only be used where allowed.',
        duration_minutes: '120',
        total_marks: '100',
      },
      essay: {
        instructions: 'Choose the required question and write a clear, well-organized response.',
        duration_minutes: '90',
        total_marks: '50',
      },
      mcq: {
        instructions: 'Choose the best answer for each question.',
        duration_minutes: '60',
        total_marks: '40',
      },
      blank: {
        instructions: '',
      },
      primary: {
        instructions: 'Answer all questions in the spaces provided. Write neatly and show your working.',
        duration_minutes: '90',
        total_marks: '100',
      },
      formal: {
        instructions: 'Answer all questions. Marks are shown in brackets. Calculators may only be used where allowed.',
        duration_minutes: '120',
        total_marks: '100',
      },
    }
    const patch = templatePatch[value] || templatePatch.standard
    setForm((current: any) => ({
      ...current,
      ...patch,
      name: current.name || (value === 'formal' ? 'End of Term Examination' : value === 'primary' ? 'Primary Assessment Paper' : value === 'spelling' ? 'Weekly Spelling Test' : current.name),
    }))
    if (value === 'spelling') {
      setQuestions([{ ...newQuestion(1), question_text: 'Write the words dictated by your teacher.', marks: '20', topic_text: 'Spelling', marking_scheme: 'Award 1 mark for each correctly spelled word.' }])
      setDesignBlocks([newDesignBlock('answer_space')])
    }
    if (value === 'science') insertBlock('table')
    if (value === 'mathematics') insertBlock('answer_space', { content_json: { answer_space_type: 'graph_grid', height: 180, number_of_lines: null, show_border: true } })
  }

  const importExamFile = async (file?: File | null) => {
    if (!file || readOnly) return
    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const payload = JSON.parse(await file.text())
        if (payload.assessment || payload.questions || payload.blocks) {
          if (payload.assessment) applyPaper(payload)
          else {
            if (Array.isArray(payload.questions)) {
              setQuestions(payload.questions.map((question: any, index: number) => ({
                ...newQuestion(index + 1),
                ...question,
                local_id: question.local_id || (question.id ? `question-${question.id}` : uid('question')),
                marks: question.marks ? String(question.marks) : '',
                style_json: { spacing: 'normal', z_index: 0, offset_x: 0, offset_y: 0, ...(question.style_json || {}) },
                sort_order: numericStyle(question.sort_order, 100 + index),
              })))
            }
            if (Array.isArray(payload.blocks)) {
              setDesignBlocks(payload.blocks.filter((block: any) => !['cover_field', 'instructions', 'question', 'sub_question', 'mcq_options'].includes(block.block_type)).map((block: any, index: number) => ({
                ...block,
                local_id: block.local_id || block.id || uid(block.block_type || 'block'),
                style_json: { z_index: 0, offset_x: 0, offset_y: 0, ...(block.style_json || block.style || {}) },
                sort_order: numericStyle(block.sort_order, 40 + index),
              })))
            }
          }
          toast.success('JSON exam imported.')
          return
        }
      } catch {
        toast.error('JSON import failed. Check the exported file format.')
        return
      }
    }
    const text = await file.text()
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const importedQuestions = lines.map((line, index) => ({
      ...newQuestion(index + 1),
      question_text: line.replace(/^\d+[\).]\s*/, ''),
      marks: '1',
      topic_text: 'Imported',
      marking_scheme: 'Award 1 mark for a correct response.',
    }))
    setQuestions(importedQuestions.length ? importedQuestions : [newQuestion(1)])
    setForm((current: any) => ({
      ...current,
      name: current.name || file.name.replace(/\.[^.]+$/, ''),
      total_marks: importedQuestions.length ? String(importedQuestions.length) : current.total_marks,
      instructions: current.instructions || 'Imported paper. Review questions, marks and marking scheme before submission.',
    }))
    toast.success('Exam imported into the document.')
  }

  const uploadImageBlock = async (file?: File | null) => {
    if (!file || readOnly || !token) return
    if (!form.id) {
      toast.error('Save the paper before uploading images.')
      return
    }
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      toast.error('Only PNG, JPEG, WebP, GIF and SVG images are supported.')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    setSaving(true)
    try {
      const result = await api.uploadAssessmentMedia(token, form.id, {
        file_name: file.name,
        file_type: file.type,
        data_url: dataUrl,
        alt_text: file.name.replace(/\.[^.]+$/, ''),
      })
      setMedia((current) => [result.media, ...current])
      insertBlock('image', {
        content_json: {
          media_id: result.media.id,
          url: result.media.storage_path,
          caption: '',
          alt_text: result.media.alt_text || '',
          width: 360,
          crop_enabled: false,
          crop_height: 220,
          crop_x: 50,
          crop_y: 50,
          crop_zoom: 1,
        },
        style_json: { align: 'center', z_index: 0, offset_x: 0, offset_y: 0 },
      })
      toast.success('Image inserted.')
    } catch (err: any) {
      toast.error(err?.message || 'Unable to upload image.')
    } finally {
      setSaving(false)
    }
  }

  const documentTitle = form.name || 'Untitled Exam Paper'
  const documentText = (mode: 'student' | 'marking' = 'student') => {
    const className = (setup.classes || []).find((row: any) => String(row.id) === String(form.class_id))?.name || ''
    const subjectName = (setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id))?.name || ''
    const rows = [
      documentTitle,
      `${className}${className && subjectName ? ' · ' : ''}${subjectName}`,
      `Duration: ${form.duration_minutes || '-'} minutes · Total Marks: ${form.total_marks || '-'}`,
      '',
      form.instructions || '',
      '',
      ...questions.flatMap((question, index) => [
        `${index + 1}. ${question.question_text || ''} (${question.marks || 0} marks)`,
        ...(question.question_type === 'multiple_choice' ? (question.options || []).map((option: any) => `   ${option.option_label}. ${option.option_text}`) : []),
        ...(mode === 'marking' ? [
          question.correct_answer ? `Correct answer: ${question.correct_answer}` : '',
          question.marking_scheme ? `Marking scheme: ${question.marking_scheme}` : '',
          question.explanation ? `Explanation: ${question.explanation}` : '',
        ] : []),
        '',
      ]),
    ]
    return rows.join('\n')
  }

  const downloadFile = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportPaper = (format: 'print' | 'word' | 'text' | 'json', mode: 'student' | 'marking' = 'student') => {
    const baseName = documentTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'exam-paper'
    if (format === 'print') {
      setEditorMode(mode === 'marking' ? 'marking' : 'print')
      setTimeout(() => window.print(), 50)
      return
    }
    if (format === 'word') {
      toast.info('Full .docx export is coming soon. Use PDF/Print, Text or JSON for now.')
      return
    }
    if (format === 'json') {
      downloadFile(`${baseName}.json`, JSON.stringify({ version: 1, ...buildPayload(), media }, null, 2), 'application/json')
      return
    }
    downloadFile(`${baseName}-${mode}.txt`, documentText(mode), 'text/plain')
  }

  const printCurrentMode = () => {
      window.print()
      return
  }

  const renderCanvasDragHandle = (block: any) => {
    if (readOnly || editorMode !== 'builder') return null
    const active = String(selectedBlockId) === blockKey(block)
    return (
      <button
        type="button"
        className={`absolute right-1 top-1 z-20 size-7 cursor-grab place-items-center rounded-[4px] border border-[#cbd5e1] bg-white/95 text-[#475569] shadow-sm active:cursor-grabbing print:hidden ${active ? 'grid' : 'hidden group-hover:grid'}`}
        onPointerDown={(event) => startCanvasDrag(event, block)}
        aria-label="Drag element"
        title="Drag element"
      >
        <Move className="size-3.5" />
      </button>
    )
  }

  const renderDesignBlock = (block: any) => {
    const id = block.local_id || block.id
    const content = block.content_json || {}
    const style = block.style_json || {}
    const active = String(selectedBlockId) === String(id)
    const wrapperClass = `group rounded-[4px] ${editorMode === 'builder' && paperLayout.show_guides ? 'border border-dashed border-[#d9dce3] hover:border-[#111827]/40' : 'border border-transparent'} ${active ? 'ring-2 ring-[#2563eb]' : ''}`
    const alignClass = style.align === 'center' ? 'text-center' : style.align === 'right' ? 'text-right' : 'text-left'
    const textStyle = {
      fontWeight: style.bold ? 700 : undefined,
      fontStyle: style.italic ? 'italic' : undefined,
      textDecoration: style.underline ? 'underline' : undefined,
      fontSize: style.font_size ? `${style.font_size}px` : undefined,
      lineHeight: style.line_spacing === 'wide' ? 1.8 : style.line_spacing === 'tight' ? 1.2 : 1.5,
    } as any
    const selectProps = { onClick: () => setSelectedBlockId(String(id)) }
    if (block.block_type === 'paragraph' || block.block_type === 'text_box') {
      return (
        <section key={id} className={`${wrapperClass} p-2 ${alignClass}`} style={positionedBlockStyle(style)} {...selectProps}>
          {renderCanvasDragHandle(block)}
          <Textarea disabled={readOnly || editorMode !== 'builder'} className={`min-h-16 resize-y text-[13px] ${block.block_type === 'text_box' ? 'border-[#111827]' : 'border-transparent bg-transparent'}`} style={textStyle} value={content.text || ''} onChange={(event) => updateDesignBlockContent(id, 'text', event.target.value)} />
        </section>
      )
    }
    if (block.block_type === 'section') {
      return (
        <section key={id} className={`${wrapperClass} p-2`} style={positionedBlockStyle(style)} {...selectProps}>
          {renderCanvasDragHandle(block)}
          <Input disabled={readOnly || editorMode !== 'builder'} className="h-auto border-0 bg-transparent px-0 text-[18px] font-bold text-[#111827] focus-visible:ring-0" value={content.title || ''} onChange={(event) => updateDesignBlockContent(id, 'title', event.target.value)} />
        </section>
      )
    }
    if (block.block_type === 'answer_space') {
      const height = Number(content.height || 120)
      const type = content.answer_space_type || 'ruled_lines'
      return (
        <section key={id} className={`${wrapperClass} p-2`} style={positionedBlockStyle(style)} {...selectProps}>
          {renderCanvasDragHandle(block)}
          <div
            className={`w-full rounded-[3px] ${content.show_border === false ? '' : 'border border-[#111827]'} ${type === 'graph_grid' ? 'bg-[linear-gradient(#e5e7eb_1px,transparent_1px),linear-gradient(90deg,#e5e7eb_1px,transparent_1px)] bg-[size:22px_22px]' : ''}`}
            style={{ minHeight: `${height}px` }}
          >
            {type === 'ruled_lines' ? Array.from({ length: Number(content.number_of_lines || 5) }).map((_, index) => <div key={index} className="mx-4 h-8 border-b border-[#9ca3af]" />) : null}
          </div>
        </section>
      )
    }
    if (block.block_type === 'image') {
      const url = content.url ? resolvePortalAssetUrl(content.url) : ''
      const imageWidth = numericStyle(content.width, 360)
      const cropEnabled = Boolean(content.crop_enabled)
      const cropHeight = numericStyle(content.crop_height, Math.round(imageWidth * 0.62))
      const cropX = Math.min(100, Math.max(0, numericStyle(content.crop_x, 50)))
      const cropY = Math.min(100, Math.max(0, numericStyle(content.crop_y, 50)))
      const cropZoom = Math.min(3, Math.max(1, numericStyle(content.crop_zoom, 1)))
      return (
        <section key={id} className={`${wrapperClass} p-2 ${alignClass}`} style={positionedBlockStyle(style)} {...selectProps}>
          {renderCanvasDragHandle(block)}
          {url ? (
            <span
              className={`inline-block max-w-full overflow-hidden rounded-[3px] border border-[#e5e7eb] bg-white ${cropEnabled ? '' : 'align-top'}`}
              style={{ width: imageWidth, height: cropEnabled ? cropHeight : undefined }}
            >
              <img
                src={url}
                alt={content.alt_text || content.caption || 'Assessment image'}
                className="block max-w-full"
                style={cropEnabled
                  ? { width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${cropX}% ${cropY}%`, transform: `scale(${cropZoom})`, transformOrigin: `${cropX}% ${cropY}%` }
                  : { width: imageWidth, maxWidth: '100%' }}
              />
            </span>
          ) : <div className="inline-flex h-28 w-56 items-center justify-center rounded-[4px] border border-dashed border-[#9ca3af] bg-[#f8fafc] text-[12px] font-semibold text-[#6b7280]">Image / Logo Placeholder</div>}
          {content.caption ? <div className="mt-1 text-[11px] font-medium text-[#6b7280]">{content.caption}</div> : null}
        </section>
      )
    }
    if (block.block_type === 'shape') {
      const shapeType = content.shape_type || 'rectangle'
      return (
        <section key={id} className={`${wrapperClass} p-2 ${alignClass}`} style={positionedBlockStyle(style)} {...selectProps}>
          {renderCanvasDragHandle(block)}
          <div className={`inline-flex items-center justify-center border-2 border-[#111827] bg-[#f8fafc] text-[12px] font-semibold text-[#374151] ${shapeType === 'circle' ? 'rounded-full' : shapeType === 'triangle' ? '[clip-path:polygon(50%_0,100%_100%,0_100%)]' : 'rounded-[3px]'}`} style={{ width: Number(content.width || 260), height: Number(content.height || 120) }}>
            {shapeType === 'triangle' ? '' : (content.label || labelize(shapeType))}
          </div>
        </section>
      )
    }
    if (block.block_type === 'table') {
      const cells = content.cells || []
      return (
        <section key={id} className={`${wrapperClass} overflow-x-auto p-2`} style={positionedBlockStyle(style)} {...selectProps}>
          {renderCanvasDragHandle(block)}
          <table className="w-full border-collapse text-[12px]">
            <tbody>
              {Array.from({ length: Number(content.rows || 3) }).map((_, rowIndex) => (
                <tr key={rowIndex}>
                  {Array.from({ length: Number(content.columns || 3) }).map((__, colIndex) => (
                    <td key={colIndex} className={`${content.header_row && rowIndex === 0 ? 'bg-[#f3f4f6] font-bold' : ''} border border-[#111827] p-2`}>
                      <Input disabled={readOnly || editorMode !== 'builder'} className="h-7 border-0 bg-transparent px-1 text-[12px] focus-visible:ring-0" value={cells[rowIndex]?.[colIndex] || ''} onChange={(event) => {
                        const next = Array.from({ length: Number(content.rows || 3) }).map((_, r) => Array.from({ length: Number(content.columns || 3) }).map((__, c) => cells[r]?.[c] || ''))
                        next[rowIndex][colIndex] = event.target.value
                        updateDesignBlockContent(id, 'cells', next)
                      }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )
    }
    if (block.block_type === 'page_break') {
      return <div key={id} className="group my-7 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#9ca3af] print:break-after-page" style={positionedBlockStyle(style)} {...selectProps}>{renderCanvasDragHandle(block)}<span className="h-px flex-1 bg-[#d9dce3]" /> Page Break <span className="h-px flex-1 bg-[#d9dce3]" /></div>
    }
    if (block.block_type === 'teacher_note' && editorMode !== 'marking' && editorMode !== 'builder') return null
    return (
      <section key={id} className={`${wrapperClass} p-2`} style={positionedBlockStyle(style)} {...selectProps}>
        {renderCanvasDragHandle(block)}
        <Textarea disabled={readOnly || editorMode !== 'builder'} className="min-h-14 text-[12px]" value={content.text || ''} onChange={(event) => updateDesignBlockContent(id, 'text', event.target.value)} />
      </section>
    )
  }

  const renderQuestionBlock = (block: any) => {
    const id = blockKey(block)
    const questionIndex = questions.findIndex((question, index) => questionKey(question, index) === id)
    if (questionIndex < 0) return null
    const question = questions[questionIndex]
    const style = { ...(block.style_json || {}), ...(question.style_json || {}) }
    const active = String(selectedBlockId) === String(id)
    return (
      <section
        key={id}
        className={`group break-inside-avoid rounded-[4px] border ${active ? 'border-[#2563eb] ring-2 ring-[#2563eb]' : 'border-transparent hover:border-[#d9dce3]'} print:border-transparent`}
        style={positionedBlockStyle(style)}
        onClick={() => setSelectedBlockId(id)}
      >
        {renderCanvasDragHandle({ ...block, style_json: style })}
        <div className="flex items-start gap-3 p-1">
          <div className="w-8 shrink-0 pt-2 text-right text-[15px] font-bold text-[#111827]">{questionIndex + 1}.</div>
          <div className="min-w-0 flex-1">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_90px]">
              <Textarea
                disabled={readOnly}
                className="min-h-16 resize-y rounded-[3px] border-[#e5e7eb] text-[14px] leading-6 text-[#111827]"
                value={question.question_text}
                onChange={(event) => updateQuestion(questionIndex, 'question_text', event.target.value)}
                placeholder="Question text"
              />
              <Input
                disabled={readOnly}
                type="number"
                className="h-9 rounded-[3px] text-[12px]"
                value={question.marks}
                onChange={(event) => updateQuestion(questionIndex, 'marks', event.target.value)}
                placeholder="Marks"
              />
            </div>

            {editorMode === 'builder' || editorMode === 'review' ? <div className="mt-2 grid gap-2 rounded-[4px] bg-[#f8fafc] p-2 text-[12px] print:hidden md:grid-cols-4">
              <select disabled={readOnly} className={selectClassName()} value={question.question_type} onChange={(event) => updateQuestion(questionIndex, 'question_type', event.target.value)}>
                {questionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <Input disabled={readOnly} className="h-8 text-[12px]" value={question.topic_text} onChange={(event) => updateQuestion(questionIndex, 'topic_text', event.target.value)} placeholder="Topic" />
              <select disabled={readOnly} className={selectClassName()} value={question.difficulty} onChange={(event) => updateQuestion(questionIndex, 'difficulty', event.target.value)}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
              <select disabled={readOnly} className={selectClassName()} value={question.cognitive_skill} onChange={(event) => updateQuestion(questionIndex, 'cognitive_skill', event.target.value)}>
                <option value="">Skill</option>
                <option value="recall">Recall</option>
                <option value="understanding">Understanding</option>
                <option value="application">Application</option>
                <option value="analysis">Analysis</option>
              </select>
            </div> : null}

            {editorMode === 'builder' || editorMode === 'review' ? <Input
              disabled={readOnly}
              className="mt-2 h-8 rounded-[3px] text-[12px] print:hidden"
              value={question.question_instructions}
              onChange={(event) => updateQuestion(questionIndex, 'question_instructions', event.target.value)}
              placeholder="Question instructions"
            /> : null}

            {question.question_type === 'multiple_choice' ? (
              <div className="mt-3 grid gap-2">
                {(question.options || newOptions()).map((option: any, optionIndex: number) => (
                  <div key={option.option_label || optionIndex} className="grid items-center gap-2 md:grid-cols-[48px_minmax(0,1fr)_92px]">
                    <Input disabled={readOnly} className="h-8 rounded-[3px] text-[12px]" value={option.option_label} onChange={(event) => updateOption(questionIndex, optionIndex, 'option_label', event.target.value)} />
                    <Input disabled={readOnly} className="h-8 rounded-[3px] text-[12px]" value={option.option_text} onChange={(event) => updateOption(questionIndex, optionIndex, 'option_text', event.target.value)} />
                    <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151] print:hidden">
                      <input disabled={readOnly} type="checkbox" checked={Boolean(option.is_correct)} onChange={(event) => updateOption(questionIndex, optionIndex, 'is_correct', event.target.checked)} />
                      Correct
                    </label>
                  </div>
                ))}
              </div>
            ) : null}

            {editorMode === 'builder' || editorMode === 'marking' || editorMode === 'review' ? <div className="mt-3 grid gap-2 rounded-[4px] border border-[#e5e7eb] bg-[#fbfcfe] p-2 print:hidden md:grid-cols-2">
              <Textarea disabled={readOnly} className="min-h-16 text-[12px]" value={question.correct_answer} onChange={(event) => updateQuestion(questionIndex, 'correct_answer', event.target.value)} placeholder="Answer / correct answer" />
              <Textarea disabled={readOnly} className="min-h-16 text-[12px]" value={question.marking_scheme} onChange={(event) => updateQuestion(questionIndex, 'marking_scheme', event.target.value)} placeholder="Marking scheme / rubric" />
              <Textarea disabled={readOnly} className="min-h-14 text-[12px] md:col-span-2" value={question.explanation} onChange={(event) => updateQuestion(questionIndex, 'explanation', event.target.value)} placeholder="Explanation / feedback" />
            </div> : null}
          </div>
          {!readOnly ? (
            <div className="flex shrink-0 flex-col gap-1 opacity-100 print:hidden md:opacity-0 md:transition md:group-hover:opacity-100">
              <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#4b5563] hover:bg-[#f3f4f6]" onClick={() => moveOutlineBlockBy(id, -1)} aria-label="Move question up"><ArrowUp className="size-3.5" /></button>
              <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#4b5563] hover:bg-[#f3f4f6]" onClick={() => moveOutlineBlockBy(id, 1)} aria-label="Move question down"><ArrowDown className="size-3.5" /></button>
              <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] bg-white text-[#b91c1c] hover:bg-[#fef2f2]" onClick={() => deleteQuestion(questionIndex)} aria-label="Delete question"><Trash2 className="size-3.5" /></button>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  const renderInspector = () => {
    if (!showInspector || editorMode === 'print') return null
    return (
      <aside className="w-full shrink-0 rounded-[6px] border border-[#d9dce3] bg-white p-3 shadow-sm xl:w-[310px] print:hidden">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-bold text-[#111827]">Inspector</div>
            <div className="text-[11px] font-semibold text-[#6b7280]">{selectedBlock ? blockTitle(selectedBlock) : 'Select a block'}</div>
          </div>
          {selectedBlock && !['question'].includes(selectedBlock.block_type) ? <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" disabled={readOnly} onClick={() => removeDesignBlock(selectedBlock.local_id || selectedBlock.id)}><Trash2 className="size-3.5" /></button> : null}
        </div>
            {selectedBlock ? (
          <div className="mt-3 grid gap-3">
            {selectedBlock.block_type === 'question' ? (() => {
              const questionIndex = questions.findIndex((question, index) => questionKey(question, index) === blockKey(selectedBlock))
              const question = questions[questionIndex] || {}
              return (
                <>
                  <Field label="Question Type">
                    <select disabled={readOnly} className={selectClassName()} value={question.question_type || 'short_answer'} onChange={(event) => updateQuestion(questionIndex, 'question_type', event.target.value)}>
                      {questionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label="Marks">
                    <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={question.marks || ''} onChange={(event) => updateQuestion(questionIndex, 'marks', event.target.value)} />
                  </Field>
                  <Field label="Topic">
                    <Input disabled={readOnly} className="h-8 text-[12px]" value={question.topic_text || ''} onChange={(event) => updateQuestion(questionIndex, 'topic_text', event.target.value)} />
                  </Field>
                  <Field label="Subtopic">
                    <Input disabled={readOnly} className="h-8 text-[12px]" value={question.subtopic_text || ''} onChange={(event) => updateQuestion(questionIndex, 'subtopic_text', event.target.value)} />
                  </Field>
                  <Field label="Difficulty">
                    <select disabled={readOnly} className={selectClassName()} value={question.difficulty || 'medium'} onChange={(event) => updateQuestion(questionIndex, 'difficulty', event.target.value)}>
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </Field>
                  <Field label="Cognitive Skill">
                    <select disabled={readOnly} className={selectClassName()} value={question.cognitive_skill || ''} onChange={(event) => updateQuestion(questionIndex, 'cognitive_skill', event.target.value)}>
                      <option value="">None</option>
                      <option value="recall">Recall</option>
                      <option value="understanding">Understanding</option>
                      <option value="application">Application</option>
                      <option value="analysis">Analysis</option>
                    </select>
                  </Field>
                  <Field label="Correct Answer">
                    <Textarea disabled={readOnly} className="min-h-16 text-[12px]" value={question.correct_answer || ''} onChange={(event) => updateQuestion(questionIndex, 'correct_answer', event.target.value)} />
                  </Field>
                  <Field label="Marking Scheme">
                    <Textarea disabled={readOnly} className="min-h-20 text-[12px]" value={question.marking_scheme || ''} onChange={(event) => updateQuestion(questionIndex, 'marking_scheme', event.target.value)} />
                  </Field>
                  <Field label="Explanation">
                    <Textarea disabled={readOnly} className="min-h-16 text-[12px]" value={question.explanation || ''} onChange={(event) => updateQuestion(questionIndex, 'explanation', event.target.value)} />
                  </Field>
                </>
              )
            })() : null}
            {selectedBlock.block_type === 'answer_space' ? (
              <>
                <Field label="Answer Space Type">
                  <select disabled={readOnly} className={selectClassName()} value={selectedBlock.content_json?.answer_space_type || 'ruled_lines'} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'answer_space_type', event.target.value)}>
                    <option value="ruled_lines">Ruled Lines</option>
                    <option value="blank_box">Blank Box</option>
                    <option value="graph_grid">Graph/Grid</option>
                  </select>
                </Field>
                <Field label="Height">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.height || 120} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'height', event.target.value)} />
                </Field>
                <Field label="Lines">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.number_of_lines || ''} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'number_of_lines', event.target.value)} />
                </Field>
                <label className="flex items-center gap-2 text-[12px] font-semibold text-[#374151]"><input disabled={readOnly} type="checkbox" checked={selectedBlock.content_json?.show_border !== false} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'show_border', event.target.checked)} /> Border</label>
              </>
            ) : null}
            {selectedBlock.block_type === 'image' ? (
              <>
                <Field label="Image URL">
                  <Input disabled={readOnly} className="h-8 text-[12px]" value={selectedBlock.content_json?.url || ''} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'url', event.target.value)} />
                </Field>
                <Field label="Width">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.width || 360} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'width', event.target.value)} />
                </Field>
                <Field label="Caption">
                  <Input disabled={readOnly} className="h-8 text-[12px]" value={selectedBlock.content_json?.caption || ''} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'caption', event.target.value)} />
                </Field>
                <div className="rounded-[5px] border border-[#e2e8f0] bg-[#f8fafc] p-2">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-[#111827]"><Crop className="size-3.5" /> Crop</div>
                  <label className="flex items-center gap-2 text-[12px] font-semibold text-[#374151]">
                    <input disabled={readOnly} type="checkbox" checked={Boolean(selectedBlock.content_json?.crop_enabled)} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_enabled', event.target.checked)} />
                    Enable crop frame
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field label="Crop Height">
                      <Input disabled={readOnly || !selectedBlock.content_json?.crop_enabled} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.crop_height || 220} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_height', event.target.value)} />
                    </Field>
                    <Field label="Zoom">
                      <Input disabled={readOnly || !selectedBlock.content_json?.crop_enabled} type="number" min="1" max="3" step="0.05" className="h-8 text-[12px]" value={selectedBlock.content_json?.crop_zoom || 1} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_zoom', event.target.value)} />
                    </Field>
                  </div>
                  <Field label="Horizontal Focus">
                    <input disabled={readOnly || !selectedBlock.content_json?.crop_enabled} type="range" min="0" max="100" className="h-8 w-full" value={selectedBlock.content_json?.crop_x ?? 50} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_x', event.target.value)} />
                  </Field>
                  <Field label="Vertical Focus">
                    <input disabled={readOnly || !selectedBlock.content_json?.crop_enabled} type="range" min="0" max="100" className="h-8 w-full" value={selectedBlock.content_json?.crop_y ?? 50} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_y', event.target.value)} />
                  </Field>
                  <Button type="button" variant="outline" className="mt-1 h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => {
                    const id = selectedBlock.local_id || selectedBlock.id
                    updateDesignBlockContent(id, 'crop_height', 220)
                    updateDesignBlockContent(id, 'crop_x', 50)
                    updateDesignBlockContent(id, 'crop_y', 50)
                    updateDesignBlockContent(id, 'crop_zoom', 1)
                  }}>
                    Reset Crop
                  </Button>
                </div>
              </>
            ) : null}
            {selectedBlock.block_type === 'shape' ? (
              <>
                <Field label="Shape Type">
                  <select disabled={readOnly} className={selectClassName()} value={selectedBlock.content_json?.shape_type || 'rectangle'} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'shape_type', event.target.value)}>
                    <option value="line">Line</option>
                    <option value="arrow">Arrow</option>
                    <option value="rectangle">Rectangle</option>
                    <option value="circle">Circle</option>
                    <option value="triangle">Triangle</option>
                    <option value="label_box">Label Box</option>
                    <option value="flowchart_box">Flowchart Box</option>
                    <option value="graph_axis">Graph Axis</option>
                    <option value="number_line">Number Line</option>
                    <option value="diagram_placeholder">Diagram Placeholder</option>
                  </select>
                </Field>
                <Field label="Label">
                  <Input disabled={readOnly} className="h-8 text-[12px]" value={selectedBlock.content_json?.label || ''} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'label', event.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Width"><Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.width || 260} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'width', event.target.value)} /></Field>
                  <Field label="Height"><Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.height || 120} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'height', event.target.value)} /></Field>
                </div>
              </>
            ) : null}
            {selectedBlock.block_type === 'table' ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Rows"><Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.rows || 3} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'rows', event.target.value)} /></Field>
                  <Field label="Columns"><Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.columns || 3} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'columns', event.target.value)} /></Field>
                </div>
                <label className="flex items-center gap-2 text-[12px] font-semibold text-[#374151]"><input disabled={readOnly} type="checkbox" checked={Boolean(selectedBlock.content_json?.header_row)} onChange={(event) => updateDesignBlockContent(selectedBlock.local_id || selectedBlock.id, 'header_row', event.target.checked)} /> Header row</label>
              </>
            ) : null}
            <Field label="Alignment">
              <select disabled={readOnly} className={selectClassName()} value={selectedBlock.style_json?.align || 'left'} onChange={(event) => updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'align', event.target.value)}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
                <option value="stretch">Stretch</option>
              </select>
            </Field>
            <div className="rounded-[5px] border border-[#e2e8f0] bg-white p-2">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-[#111827]"><Layers className="size-3.5" /> Layer & Position</div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Layer">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.style_json?.z_index ?? 0} onChange={(event) => updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'z_index', event.target.value)} />
                </Field>
                <Field label="X">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.style_json?.offset_x ?? 0} onChange={(event) => updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'offset_x', event.target.value)} />
                </Field>
                <Field label="Y">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.style_json?.offset_y ?? 0} onChange={(event) => updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'offset_y', event.target.value)} />
                </Field>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => moveLayer(selectedBlock.local_id || selectedBlock.id, 'forward')}>Forward</Button>
                <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => moveLayer(selectedBlock.local_id || selectedBlock.id, 'backward')}>Backward</Button>
                <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => moveLayer(selectedBlock.local_id || selectedBlock.id, 'front')}>To Front</Button>
                <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => moveLayer(selectedBlock.local_id || selectedBlock.id, 'back')}>To Back</Button>
              </div>
            </div>
            {selectedBlock.block_type !== 'question' ? <label className="flex items-center gap-2 text-[12px] font-semibold text-[#374151]"><input disabled={readOnly} type="checkbox" checked={selectedBlock.is_printable !== false} onChange={(event) => updateDesignBlock(selectedBlock.local_id || selectedBlock.id, { is_printable: event.target.checked })} /> Printable</label> : null}
          </div>
        ) : (
          <div className="mt-4 rounded-[5px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-3 text-[12px] font-semibold text-[#64748b]">Click a design block, question, image, table, shape, or answer space to edit its settings.</div>
        )}
      </aside>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#eef1f5] text-[#111827] print:h-auto print:overflow-visible print:bg-white">
      <header className="shrink-0 border-b border-[#d7dce4] bg-white shadow-[0_1px_8px_rgba(15,23,42,0.08)] print:hidden">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] text-[#4b5563] transition hover:bg-[#f3f4f6] hover:text-[#111827]"
              onClick={() => navigate('/exam-builder')}
              aria-label="Back to exam papers"
            >
              <ArrowLeft className="size-4" />
            </button>
            <span className="grid size-8 place-items-center rounded-[4px] bg-[#2563eb] text-white">
              <FileText className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[#111827]">{documentTitle}</div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#6b7280]">
                <span>{form.id ? `Paper #${form.id}` : 'New paper'}</span>
                <span className="size-1 rounded-full bg-[#cbd5e1]" />
                <span>{statusLabel(form.status)}</span>
                {lastSavedAt ? <span>Saved {lastSavedAt}</span> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {error ? <span className="rounded-[4px] border border-[#fecaca] bg-[#fef2f2] px-2 py-1 text-[11px] font-semibold text-[#b91c1c]">{error}</span> : null}
            <div className="flex rounded-[5px] border border-[#d9dce3] bg-white p-0.5">
              {[
                ['builder', 'Builder'],
                ['print', 'Print'],
                ['marking', 'Scheme'],
                ['review', 'Review'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`h-7 rounded-[4px] px-2.5 text-[11px] font-semibold ${editorMode === id ? 'bg-[#111827] text-white' : 'text-[#4b5563] hover:bg-[#f3f4f6] hover:text-[#111827]'}`}
                  onClick={() => setEditorMode(id as any)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className={`grid size-8 place-items-center rounded-[5px] border border-[#d9dce3] ${showInspector ? 'bg-[#111827] text-white' : 'bg-white text-[#4b5563]'}`} onClick={() => setShowInspector((open) => !open)} aria-label="Toggle inspector">
              <PanelRight className="size-4" />
            </button>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/exam-builder/new')}>
              <FilePlus2 className="size-3.5" />
              New
            </Button>
            <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={saving || readOnly} onClick={saveDraft}>
              <Save className="size-3.5" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving || readOnly || !reviewChecks.ready} onClick={submitForReview}>
              <Send className="size-3.5" />
              Submit
            </Button>
          </div>
        </div>

        <div className="flex h-9 items-end overflow-x-auto border-t border-[#eef1f5] px-3">
          {['file', 'home', 'insert', 'layout', 'questions', 'review', 'export'].map((tab) => (
            <button
              key={tab}
              type="button"
              className={`h-9 min-w-16 border-b-2 px-4 text-[12px] font-semibold capitalize transition ${
                activeTab === tab
                  ? 'border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8]'
                  : 'border-transparent text-[#4b5563] hover:bg-[#f8fafc] hover:text-[#111827]'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="min-h-20 border-t border-[#eef1f5] px-3 py-3">
          {activeTab === 'file' ? (
            <div className="flex flex-wrap items-start gap-3">
              <div className="grid min-w-[210px] gap-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Import</div>
                <label className={`inline-flex h-8 w-fit items-center justify-center gap-2 rounded-[5px] border border-[#d9dce3] bg-white px-3 text-[12px] font-semibold text-[#111827] shadow-sm transition ${readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[#f8fafc]'}`}>
                  <Upload className="size-3.5" />
                  Import Exam
                  <input
                    disabled={readOnly}
                    type="file"
                    accept=".json,.txt,.md,.csv"
                    className="hidden"
                    onChange={(event) => {
                      importExamFile(event.target.files?.[0])
                      event.currentTarget.value = ''
                    }}
                  />
                </label>
              </div>
              <div className="grid min-w-[190px] gap-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Unavailable</div>
                <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled>
                  Word/PDF Import Coming Soon
                </Button>
              </div>
              <Field label="Template">
                <select disabled={readOnly} className={`${selectClassName()} min-w-[190px]`} value={template} onChange={(event) => applyTemplate(event.target.value)}>
                  <option value="standard">Standard Paper</option>
                  <option value="primary">Primary Assessment</option>
                  <option value="formal">Formal Examination</option>
                  <option value="spelling">Spelling Test</option>
                  <option value="science">Science Practical</option>
                  <option value="mathematics">Mathematics Paper</option>
                  <option value="essay">Essay Paper</option>
                  <option value="mcq">Multiple Choice Paper</option>
                  <option value="blank">Blank Paper</option>
                </select>
              </Field>
              <div className="grid min-w-[240px] gap-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">File Actions</div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving || readOnly} onClick={saveDraft}><Save className="size-3.5" /> Draft</Button>
                  <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={!form.id} onClick={() => toast.info('Duplicate paper is coming soon.') }><Copy className="size-3.5" /> Duplicate</Button>
                  {canApprove && form.id ? <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving} onClick={() => updateStatus('archived')}><Archive className="size-3.5" /> Archive</Button> : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'home' ? (
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              <div className="flex flex-wrap items-end gap-1 md:col-span-3 xl:col-span-6">
                <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151] hover:bg-[#f8fafc]" disabled={!selectedBlock || readOnly} onClick={() => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'bold', !selectedBlock.style_json?.bold)} aria-label="Bold"><Bold className="size-3.5" /></button>
                <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151] hover:bg-[#f8fafc]" disabled={!selectedBlock || readOnly} onClick={() => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'italic', !selectedBlock.style_json?.italic)} aria-label="Italic"><Italic className="size-3.5" /></button>
                <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151] hover:bg-[#f8fafc]" disabled={!selectedBlock || readOnly} onClick={() => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'underline', !selectedBlock.style_json?.underline)} aria-label="Underline"><Underline className="size-3.5" /></button>
                <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151] hover:bg-[#f8fafc]" disabled={!selectedBlock || readOnly} onClick={() => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'align', 'left')} aria-label="Align left"><AlignLeft className="size-3.5" /></button>
                <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151] hover:bg-[#f8fafc]" disabled={!selectedBlock || readOnly} onClick={() => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'align', 'center')} aria-label="Align center"><AlignCenter className="size-3.5" /></button>
                <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151] hover:bg-[#f8fafc]" disabled={!selectedBlock || readOnly} onClick={() => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'align', 'right')} aria-label="Align right"><AlignRight className="size-3.5" /></button>
                <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151] hover:bg-[#f8fafc]" disabled={!selectedBlock || readOnly} onClick={() => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'list', 'bullet')} aria-label="Bullet list"><List className="size-3.5" /></button>
                <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151] hover:bg-[#f8fafc]" disabled={!selectedBlock || readOnly} onClick={() => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'list', 'numbered')} aria-label="Numbered list"><ListOrdered className="size-3.5" /></button>
                <Field label="Font Size">
                  <Input disabled={!selectedBlock || readOnly} type="number" className="h-8 w-24 text-[12px]" value={selectedBlock?.style_json?.font_size || 14} onChange={(event) => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'font_size', event.target.value)} />
                </Field>
                <Field label="Line Spacing">
                  <select disabled={!selectedBlock || readOnly} className={`${selectClassName()} w-32`} value={selectedBlock?.style_json?.line_spacing || 'normal'} onChange={(event) => selectedBlock && updateBlockStyle(selectedBlock.local_id || selectedBlock.id, 'line_spacing', event.target.value)}>
                    <option value="tight">Tight</option>
                    <option value="normal">Normal</option>
                    <option value="wide">Wide</option>
                  </select>
                </Field>
              </div>
              <Field label="Title">
                <Input disabled={readOnly} className="h-8 text-[12px]" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="Type">
                <select disabled={readOnly} className={selectClassName()} value={form.assessment_type} onChange={(event) => setForm({ ...form, assessment_type: event.target.value, exam_session_id: examSessionRequiredTypes.has(event.target.value) ? form.exam_session_id : '' })}>
                  {assessmentTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Class">
                <select disabled={readOnly} className={selectClassName()} value={form.class_id} onChange={(event) => setForm({ ...form, class_id: event.target.value, subject_id: '', teacher_id: role === 'teacher' ? form.teacher_id : '' })}>
                  <option value="">Select class</option>
                  {(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Subject">
                <select disabled={readOnly} className={selectClassName()} value={form.subject_id} onChange={(event) => setForm({ ...form, subject_id: event.target.value, teacher_id: role === 'teacher' ? form.teacher_id : '' })}>
                  <option value="">Select subject</option>
                  {classSubjects.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Teacher">
                {canApprove ? (
                  <select disabled={readOnly} className={selectClassName()} value={form.teacher_id} onChange={(event) => setForm({ ...form, teacher_id: event.target.value })}>
                    <option value="">Subject teacher</option>
                    {teacherOptions.map((row: any) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}
                  </select>
                ) : (
                  <Input readOnly className="h-8 text-[12px]" value={assignedTeacher?.teacher_name || user?.fullName || 'Assigned teacher'} />
                )}
              </Field>
              {needsExamSession ? (
                <Field label="Exam Session">
                  <select disabled={readOnly} className={selectClassName()} value={form.exam_session_id} onChange={(event) => handleExamSessionChange(event.target.value)}>
                    <option value="">Select exam session</option>
                    {(setup.exam_sessions || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Section">
                  <Input disabled={readOnly} className="h-8 text-[12px]" value={form.stream_section} onChange={(event) => setForm({ ...form, stream_section: event.target.value })} />
                </Field>
              )}
            </div>
          ) : null}

          {activeTab === 'insert' ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className={`inline-flex h-8 items-center justify-center gap-2 rounded-[5px] border border-[#d9dce3] bg-white px-3 text-[12px] font-semibold text-[#111827] shadow-sm transition ${readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[#f8fafc]'}`}>
                <ImageIcon className="size-3.5" />
                Image
                <input disabled={readOnly} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={(event) => { uploadImageBlock(event.target.files?.[0]); event.currentTarget.value = '' }} />
              </label>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('image')}>
                <ImageIcon className="size-3.5" />
                Logo Placeholder
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('shape')}>
                <Shapes className="size-3.5" />
                Shape
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('table')}>
                <Grid3X3 className="size-3.5" />
                Table
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('text_box')}>
                <Type className="size-3.5" />
                Text Box
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('page_break')}>
                <Minus className="size-3.5" />
                Page Break
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('answer_space')}>
                <Rows3 className="size-3.5" />
                Answer Space
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('answer_space', { content_json: { answer_space_type: 'blank_box', height: 160, number_of_lines: null, show_border: true } })}>
                <Square className="size-3.5" />
                Blank Box
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('answer_space', { content_json: { answer_space_type: 'graph_grid', height: 180, number_of_lines: null, show_border: true } })}>
                <Grid3X3 className="size-3.5" />
                Graph Space
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('paragraph', { content_json: { text: 'Name: ______________________________   Student No: __________________' } })}>
                Student Lines
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('paragraph', { content_json: { text: 'Date: __________________   Signature: __________________' } })}>
                Date / Signature
              </Button>
            </div>
          ) : null}

          {activeTab === 'layout' ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Paper Size">
                <select className={`${selectClassName()} w-28`} value={paperLayout.paper_size} onChange={(event) => setPaperLayout({ ...paperLayout, paper_size: event.target.value })}>
                  <option value="A4">A4</option>
                </select>
              </Field>
              <Field label="Margins">
                <select className={`${selectClassName()} w-32`} value={paperLayout.margins} onChange={(event) => setPaperLayout({ ...paperLayout, margins: event.target.value })}>
                  <option value="narrow">Narrow</option>
                  <option value="normal">Normal</option>
                  <option value="wide">Wide</option>
                </select>
              </Field>
              <Field label="Header">
                <Input className="h-8 w-44 text-[12px]" value={paperLayout.header || ''} onChange={(event) => setPaperLayout({ ...paperLayout, header: event.target.value })} />
              </Field>
              <Field label="Footer">
                <Input className="h-8 w-44 text-[12px]" value={paperLayout.footer || ''} onChange={(event) => setPaperLayout({ ...paperLayout, footer: event.target.value })} />
              </Field>
              <Field label="Page Numbers">
                <select className={`${selectClassName()} w-32`} value={paperLayout.page_numbers || 'bottom'} onChange={(event) => setPaperLayout({ ...paperLayout, page_numbers: event.target.value })}>
                  <option value="none">None</option>
                  <option value="bottom">Bottom</option>
                </select>
              </Field>
              <Field label="Question Spacing">
                <select className={`${selectClassName()} w-32`} value={paperLayout.question_spacing} onChange={(event) => setPaperLayout({ ...paperLayout, question_spacing: event.target.value })}>
                  <option value="tight">Tight</option>
                  <option value="normal">Normal</option>
                  <option value="wide">Wide</option>
                </select>
              </Field>
              <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151]">
                <input type="checkbox" checked={paperLayout.show_guides} onChange={(event) => setPaperLayout({ ...paperLayout, show_guides: event.target.checked })} />
                Metadata guides
              </label>
            </div>
          ) : null}

          {activeTab === 'questions' ? (
            <div className="flex flex-wrap items-end gap-3">
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('section')}>
                <Plus className="size-3.5" />
                Section
              </Button>
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion()}>
                <Plus className="size-3.5" />
                Question
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion({ question_type: 'multiple_choice' })}>
                MCQ
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion({ question_type: 'true_false', marks: '1' })}>
                True/False
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion({ question_type: 'short_answer', marks: '2' })}>
                Short Answer
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion({ question_type: 'structured', marks: '5' })}>
                Structured
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion({ question_type: 'essay', marks: '10' })}>
                Essay
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion({ question_type: 'calculation', marks: '4' })}>
                Calculation
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => {
                appendQuestion({ question_type: 'structured', question_text: 'Study the diagram and answer the questions that follow.', marks: '5' })
                insertBlock('shape', { content_json: { shape_type: 'diagram_placeholder', label: 'Diagram Placeholder', width: 360, height: 180 } })
              }}>
                Diagram Question
              </Button>
              <Field label="Marks">
                <Input disabled={readOnly} type="number" className="h-8 w-28 text-[12px]" value={form.total_marks} onChange={(event) => setForm({ ...form, total_marks: event.target.value })} />
              </Field>
              <Field label="Minutes">
                <Input disabled={readOnly} type="number" className="h-8 w-28 text-[12px]" value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })} />
              </Field>
            </div>
          ) : null}

          {activeTab === 'export' ? (
            <div className="flex flex-wrap items-end gap-3">
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('print', 'student')}>
                <Printer className="size-3.5" />
                Student PDF
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('print', 'marking')}>
                <ClipboardCheck className="size-3.5" />
                Marking PDF
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('text', 'student')}>
                <Download className="size-3.5" />
                Student Text
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('text', 'marking')}>
                <Download className="size-3.5" />
                Scheme Text
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('json')}>
                <FileJson className="size-3.5" />
                JSON Backup
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('word')} disabled>
                Word .docx Coming Soon
              </Button>
            </div>
          ) : null}

          {activeTab === 'review' ? (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                <Metric label="Marks" value={`${quality.questionTotal} / ${quality.totalMarks || 0}`} tone={Math.abs(quality.questionTotal - quality.totalMarks) < 0.01 ? 'good' : 'warn'} />
                <Metric label="Missing Text" value={quality.missingText} tone={quality.missingText ? 'bad' : 'good'} />
                <Metric label="Missing Marks" value={quality.missingMarks} tone={quality.missingMarks ? 'bad' : 'good'} />
                <Metric label="Schemes" value={quality.missingSchemes} tone={quality.missingSchemes ? 'bad' : 'good'} />
                <Metric label="Topics" value={reviewChecks.missingTopics} tone={reviewChecks.missingTopics ? 'warn' : 'good'} />
                <Metric label="Skills" value={reviewChecks.missingSkill} tone={reviewChecks.missingSkill ? 'warn' : 'good'} />
                <Metric label="Session" value={needsExamSession ? (selectedExamSession?.name || 'Missing') : 'Ready'} tone={needsExamSession && !selectedExamSession ? 'bad' : 'good'} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className={`flex h-8 items-center gap-2 rounded-[5px] border px-3 text-[12px] font-bold ${quality.ready ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#047857]' : 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'}`}>
                  {reviewChecks.ready ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                  {reviewChecks.ready ? 'Ready' : 'Not ready'}
                </div>
                {canApprove && form.id ? (
                  <>
                    <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={saving || !reviewChecks.ready} onClick={() => updateStatus('approved')}>
                      <ClipboardCheck className="size-3.5" />
                      Approve
                    </Button>
                    <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving || !returnReason.trim()} onClick={() => updateStatus('returned')}>
                      <Undo2 className="size-3.5" />
                      Return
                    </Button>
                    <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving || !['approved', 'scheduled'].includes(form.status)} onClick={() => updateStatus('scheduled')}>Schedule</Button>
                    <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving} onClick={() => updateStatus('locked')}>Lock</Button>
                    <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving} onClick={() => updateStatus('archived')}>Archive</Button>
                  </>
                ) : null}
              </div>
              {canApprove && form.id ? (
                <Textarea className="min-h-16 text-[12px] xl:col-span-2" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Return reason" />
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto px-4 py-8 print:overflow-visible print:p-0">
        {loading ? (
          <div className="mx-auto w-full max-w-[850px] rounded-[6px] border border-[#d9dce3] bg-white px-4 py-3 text-[13px] font-semibold text-[#4b5563] print:hidden">Loading paper...</div>
        ) : null}

        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 xl:flex-row xl:items-start print:block print:max-w-none">
          <aside className="w-full shrink-0 rounded-[6px] border border-[#d9dce3] bg-white p-3 shadow-sm xl:w-[230px] print:hidden">
            <div className="text-[13px] font-bold text-[#111827]">Outline</div>
            <div className="mt-3 grid gap-1.5">
              <button type="button" className="rounded-[4px] px-2 py-1.5 text-left text-[12px] font-semibold text-[#4b5563] hover:bg-[#f8fafc]" onClick={() => setSelectedBlockId('cover')}>Cover Page</button>
              <button type="button" className="rounded-[4px] px-2 py-1.5 text-left text-[12px] font-semibold text-[#4b5563] hover:bg-[#f8fafc]" onClick={() => setSelectedBlockId('instructions')}>Instructions</button>
              {allBlocks.map((block: any, index: number) => (
                <div
                  key={`${block.local_id || block.id}-${index}`}
                  draggable={!readOnly}
                  className={`group grid grid-cols-[24px_minmax(0,1fr)_46px] items-center gap-1 rounded-[4px] px-1.5 py-1 text-[12px] font-semibold ${String(selectedBlockId) === String(block.local_id || block.id) ? 'bg-[#111827] text-white' : outlineDragId === blockKey(block) ? 'bg-[#e0ecff] text-[#1d4ed8]' : 'text-[#4b5563] hover:bg-[#f8fafc]'}`}
                  onDragStart={(event) => {
                    if (readOnly) return
                    setOutlineDragId(blockKey(block))
                    event.dataTransfer.setData('text/plain', blockKey(block))
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(event) => {
                    if (!readOnly) {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    moveOutlineBlock(event.dataTransfer.getData('text/plain') || outlineDragId, blockKey(block))
                    setOutlineDragId('')
                  }}
                  onDragEnd={() => setOutlineDragId('')}
                >
                  <button type="button" className="grid size-6 cursor-grab place-items-center rounded-[3px] text-current opacity-75 hover:bg-white/20 active:cursor-grabbing" disabled={readOnly} aria-label="Drag from outline" title="Drag from outline">
                    <GripVertical className="size-3.5" />
                  </button>
                  <button type="button" className="min-w-0 truncate text-left" onClick={() => setSelectedBlockId(blockKey(block))}>
                    {blockTitle(block)}
                  </button>
                  <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button type="button" className="grid size-5 place-items-center rounded-[3px] hover:bg-white/20" disabled={readOnly} onClick={() => moveOutlineBlockBy(blockKey(block), -1)} aria-label="Move up"><ArrowUp className="size-3" /></button>
                    <button type="button" className="grid size-5 place-items-center rounded-[3px] hover:bg-white/20" disabled={readOnly} onClick={() => moveOutlineBlockBy(blockKey(block), 1)} aria-label="Move down"><ArrowDown className="size-3" /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-[#e2e8f0] pt-3">
              <div className="flex items-center gap-2 text-[13px] font-bold text-[#111827]">
                <Layers className="size-3.5" />
                Layers
              </div>
              <div className="mt-2 grid gap-1">
                {layeredBlocks.map((block: any, index: number) => (
                  <button
                    key={`layer-${block.local_id || block.id}-${index}`}
                    type="button"
                    className={`flex items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12px] font-semibold ${String(selectedBlockId) === blockKey(block) ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'text-[#4b5563] hover:bg-[#f8fafc]'}`}
                    onClick={() => setSelectedBlockId(blockKey(block))}
                  >
                    <span className="min-w-0 truncate">{blockTitle(block)}</span>
                    <span className="shrink-0 rounded-[3px] bg-[#e5e7eb] px-1.5 py-0.5 text-[10px] text-[#374151]">{numericStyle(block.style_json?.z_index, 0)}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

        <article className={`mx-auto min-h-[1120px] w-full max-w-[850px] bg-white shadow-[0_14px_45px_rgba(15,23,42,0.18)] print:min-h-0 print:max-w-none print:p-0 print:shadow-none ${paperLayout.margins === 'narrow' ? 'px-6 py-7' : paperLayout.margins === 'wide' ? 'px-8 py-10 sm:px-14 lg:px-20 lg:py-16' : 'px-6 py-8 sm:px-10 lg:px-16 lg:py-14'}`}>
          {form.return_reason ? (
            <div className="mb-6 rounded-[5px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-semibold text-[#9a3412] print:hidden">{form.return_reason}</div>
          ) : null}

          <div className="border-b-2 border-[#111827] pb-5 text-center">
            <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#374151]">{user?.schoolName || 'SmartLink Schools'}</div>
            <Input
              disabled={readOnly}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Exam paper title"
              className="mx-auto mt-3 h-auto border-0 bg-transparent px-0 text-center text-[24px] font-bold tracking-normal text-[#111827] shadow-none focus-visible:ring-0 md:text-[30px]"
            />
            <div className="mt-4 grid gap-2 text-left text-[12px] font-semibold text-[#111827] sm:grid-cols-2">
              <div className="flex justify-between gap-3 border-b border-[#d9dce3] pb-1">
                <span className="text-[#6b7280]">Class</span>
                <span>{(setup.classes || []).find((row: any) => String(row.id) === String(form.class_id))?.name || '-'}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#d9dce3] pb-1">
                <span className="text-[#6b7280]">Subject</span>
                <span>{(setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id))?.name || '-'}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#d9dce3] pb-1">
                <span className="text-[#6b7280]">Duration</span>
                <span>{form.duration_minutes || '-'} minutes</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#d9dce3] pb-1">
                <span className="text-[#6b7280]">Marks</span>
                <span>{form.total_marks || '-'}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#d9dce3] pb-1">
                <span className="text-[#6b7280]">Teacher</span>
                <span>{assignedTeacher?.teacher_name || teacherOptions.find((row: any) => String(row.id) === String(form.teacher_id))?.full_name || user?.fullName || '-'}</span>
              </div>
              <div className="flex justify-between gap-3 border-b border-[#d9dce3] pb-1">
                <span className="text-[#6b7280]">Status</span>
                <span>{statusLabel(form.status)}</span>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <Textarea
              disabled={readOnly}
              value={form.instructions}
              onChange={(event) => setForm({ ...form, instructions: event.target.value })}
              placeholder="Instructions"
              className="min-h-20 resize-none rounded-[4px] border-[#d9dce3] bg-[#fbfcfe] text-[13px] leading-6 text-[#111827]"
            />
          </div>

          <div className="mt-8 grid gap-7">
            {allBlocks.filter((block) => editorMode !== 'print' || block.block_type === 'question' || block.is_printable !== false).length
              ? allBlocks
                .filter((block) => editorMode !== 'print' || block.block_type === 'question' || block.is_printable !== false)
                .map((block) => block.block_type === 'question' ? renderQuestionBlock(block) : renderDesignBlock(block))
              : (
              <div className="rounded-[6px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-12 text-center print:hidden">
                <div className="text-[13px] font-semibold text-[#64748b]">No questions yet.</div>
                <Button type="button" className="mt-4 h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion()}>
                  <Plus className="size-3.5" />
                  Add Question
                </Button>
              </div>
            )}
          </div>
        </article>
        {renderInspector()}
        </div>
      </main>
    </div>
  )
}
