import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AlignCenter, AlignLeft, AlignRight, Archive, ArrowDown, ArrowUp, Bold, CheckCircle2, ClipboardCheck, Copy, Crop, Download, FileJson, FileText, FilePlus2, GripVertical, Grid3X3, Image as ImageIcon, Italic, Layers, List, ListOrdered, Minus, Move, PanelRight, Plus, Printer, Rows3, Save, Send, Shapes, Square, Trash2, Type, Underline, Undo2, Upload, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { PageBackButton } from '../components/PageBackButton'
import { QuestionCurriculumMapping } from '../components/QuestionCurriculumMapping'
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

const paperTemplateOptions = [
  { value: 'standard', label: 'Standard Paper', curriculum: 'general' },
  { value: 'formal', label: 'Formal Examination', curriculum: 'general' },
  { value: 'primary', label: 'Primary Assessment', curriculum: 'general' },
  { value: 'spelling', label: 'Spelling Test', curriculum: 'general' },
  { value: 'science', label: 'Science Practical', curriculum: 'general' },
  { value: 'mathematics', label: 'Mathematics Paper', curriculum: 'general' },
  { value: 'essay', label: 'Essay Paper', curriculum: 'general' },
  { value: 'mcq', label: 'Multiple Choice Paper', curriculum: 'general' },
  { value: 'blank', label: 'Blank Paper', curriculum: 'general' },
  { value: 'msce', label: 'MSCE Structured Paper', curriculum: 'malawi' },
  { value: 'cambridge', label: 'Cambridge IGCSE Paper', curriculum: 'cambridge' },
  { value: 'cambridge-primary', label: 'Cambridge Primary Checkpoint', curriculum: 'cambridge' },
]

const formalTypes = new Set(['mid_term', 'end_of_term_exam', 'mock_exam', 'final_exam'])
const examSessionRequiredTypes = new Set(['end_of_term_exam', 'mock_exam', 'final_exam'])

const defaultPaperLayout = {
  paper_size: 'A4',
  margins: 'normal',
  question_spacing: 'normal',
  section_spacing: 'normal',
  show_guides: true,
  curriculum_key: '',
  cover_style: 'standard',
  board_name: 'SCHOOL EXAMINATIONS BOARD',
  exam_series: 'MALAWI SCHOOL CERTIFICATE OF EDUCATION MOCK EXAMINATIONS',
  subject_number: '',
  exam_date: '',
  exam_time: '',
  paper_label: 'PAPER I',
  paper_subtitle: 'Theory',
  total_pages: '',
  answer_register_count: 13,
  copyright_label: '',
  footer_note: 'Turn over',
  header: '',
  footer: '',
  page_numbers: 'bottom',
  cover_blocks: [],
}

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
    display_number: String(index),
    number_locked: false,
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
    content_parts: [],
    style_json: { spacing: 'normal', z_index: 0, offset_x: 0, offset_y: 0, answer_space_type: 'none', answer_lines: 0, answer_height: 0 },
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

function questionReferenceKey(value: any) {
  return String(value || '').toLowerCase().replace(/^question\s*/, '').replace(/[\s.()[\]{}_-]+/g, '')
}

function normalizeCurriculumKey(value: any) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return ''
  if (/(cambridge|igcse|checkpoint|cie|international)/.test(text)) return 'cambridge'
  if (/(malawi|msce|maneb|pslce|national curriculum)/.test(text)) return 'malawi'
  if (/(general|standard|school)/.test(text)) return 'general'
  return text.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general'
}

function curriculumLabel(key: any) {
  const value = normalizeCurriculumKey(key) || 'general'
  if (value === 'cambridge') return 'Cambridge'
  if (value === 'malawi') return 'Malawi / MSCE'
  return 'General'
}

function legacyCoverTemplateStorageKey(user: any) {
  return `smartlink.schools.cover-template.${user?.schoolId || user?.school_id || 'default'}`
}

function coverTemplateStorageKey(user: any, curriculumKey = 'general') {
  return `${legacyCoverTemplateStorageKey(user)}.${normalizeCurriculumKey(curriculumKey) || 'general'}`
}

function normalizeCoverBlocks(value: any[] = []) {
  if (!Array.isArray(value)) return []
  return value.map((block, index) => ({
    ...block,
    local_id: block?.local_id || block?.id || uid(block?.block_type || 'cover'),
    content_json: block?.content_json || block?.content || {},
    style_json: { z_index: 0, offset_x: 0, offset_y: 0, ...(block?.style_json || block?.style || {}) },
    metadata_json: { ...(block?.metadata_json || block?.metadata || {}), cover_block: true },
    sort_order: numericStyle(block?.sort_order, 10 + index * 10),
    is_printable: block?.is_printable !== false,
  }))
}

function normalizeQuestionParts(value: any[] = []) {
  if (!Array.isArray(value)) return []
  return value
    .map((part, index) => {
      const type = part?.type === 'image' ? 'image' : 'text'
      return {
        local_id: String(part?.local_id || part?.id || `${type}-${index + 1}`),
        type,
        text: String(part?.text || ''),
        media_id: part?.media_id || part?.mediaId || '',
        url: String(part?.url || ''),
        caption: String(part?.caption || ''),
        alt_text: String(part?.alt_text || part?.altText || ''),
        width: numericStyle(part?.width, 360),
      }
    })
}

function questionPartsToText(parts: any[] = []) {
  return normalizeQuestionParts(parts)
    .map((part) => {
      if (part.type === 'image') return part.caption || part.alt_text ? `[Image: ${part.caption || part.alt_text}]` : '[Image]'
      return part.text
    })
    .filter(Boolean)
    .join('\n\n')
}

function questionDisplayText(question: any) {
  const partsText = questionPartsToText(question?.content_parts || question?.contentParts || [])
  return partsText || String(question?.question_text || question?.questionText || '')
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

function answerRegisterCells(count = 13) {
  const total = Math.max(1, Number(count || 13))
  return [
    ['Question Number', 'Tick if answered', 'Do not write in these columns'],
    ...Array.from({ length: total }).map((_, index) => [String(index + 1), '', '']),
    ['TOTAL', '', ''],
  ]
}

function newAnswerRegisterBlock(count = 13) {
  return {
    ...newDesignBlock('table'),
    content_json: {
      rows: Math.max(1, Number(count || 13)) + 2,
      columns: 3,
      header_row: true,
      cells: answerRegisterCells(count),
    },
    metadata_json: { table_kind: 'answer_register' },
    style_json: { align: 'stretch', z_index: 0, offset_x: 0, offset_y: 0 },
  }
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
  const contentParts = normalizeQuestionParts(question.content_parts || question.contentParts || [])
  return {
    local_id: questionKey(question, index),
    block_type: 'question',
    content_json: {
      question_number: question.display_number || question.question_number || index + 1,
      question_text: questionDisplayText(question),
      content_parts: contentParts,
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

function escapeAttribute(value: any) {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

function textToHtml(value: any) {
  return escapeHtml(value).replace(/\r?\n/g, '<br />')
}

function normalizePaperLayout(value: any = {}) {
  return {
    ...defaultPaperLayout,
    ...(value || {}),
    show_guides: value?.show_guides !== undefined ? Boolean(value.show_guides) : defaultPaperLayout.show_guides,
    curriculum_key: normalizeCurriculumKey(value?.curriculum_key || value?.curriculumKey || value?.curriculum || ''),
    cover_blocks: normalizeCoverBlocks(value?.cover_blocks || value?.coverBlocks || []),
  }
}

function estimateTextHeight(value: any, charsPerLine = 86, lineHeight = 22) {
  const text = String(value || '').trim()
  if (!text) return lineHeight
  const lines = text.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
  return lines * lineHeight
}

function estimateQuestionPartsHeight(content: any = {}) {
  const parts = normalizeQuestionParts(content.content_parts || [])
  if (!parts.length) return estimateTextHeight(content.question_text, 78, 24)
  return parts.reduce((sum, part) => {
    if (part.type === 'image') return sum + Math.max(110, Math.round(numericStyle(part.width, 360) * 0.54)) + (part.caption ? 34 : 16)
    return sum + estimateTextHeight(part.text, 78, 24) + 8
  }, 0)
}

function estimateBlockHeight(block: any, mode: string) {
  const content = block?.content_json || {}
  const style = block?.style_json || {}
  const type = block?.block_type || 'paragraph'
  if (type === 'page_break') return -1
  if (type === 'question') {
    const answerType = style.answer_space_type || 'none'
    const answerHeight = answerType === 'none'
      ? 0
      : numericStyle(style.answer_height, Math.max(96, numericStyle(style.answer_lines, 4) * 32))
    const optionHeight = content.question_type === 'multiple_choice'
      ? Math.max(1, (content.options || []).length) * 30 + 12
      : 0
    const editorHeight = mode === 'builder' || mode === 'review' ? 190 : 0
    const markingHeight = mode === 'marking' ? 120 : 0
    return 72
      + estimateQuestionPartsHeight(content)
      + (content.question_instructions ? estimateTextHeight(content.question_instructions, 82, 18) + 8 : 0)
      + optionHeight
      + (answerHeight ? answerHeight + 22 : 0)
      + editorHeight
      + markingHeight
  }
  if (type === 'section') return 58 + estimateTextHeight(content.title, 72, 22)
  if (type === 'paragraph' || type === 'text_box' || type === 'teacher_note') return 42 + estimateTextHeight(content.text, 82, 22)
  if (type === 'answer_space') return 28 + numericStyle(content.height, 120)
  if (type === 'table') return 42 + Math.max(1, numericStyle(content.rows, 3)) * 36
  if (type === 'image') {
    const width = numericStyle(content.width, 360)
    const height = content.crop_enabled ? numericStyle(content.crop_height, Math.round(width * 0.62)) : Math.round(width * 0.58)
    return Math.min(520, Math.max(120, height + (content.caption ? 36 : 18)))
  }
  if (type === 'shape') return 32 + numericStyle(content.height, 120)
  return 86
}

function paginateDocumentBlocks(blocks: any[], margins: string, mode: string) {
  const capacity = margins === 'wide' ? 820 : margins === 'narrow' ? 1030 : 930
  const pages: any[][] = []
  let page: any[] = []
  let used = 0

  blocks.forEach((block) => {
    const estimate = estimateBlockHeight(block, mode)
    if (estimate < 0) {
      if (page.length) pages.push(page)
      page = []
      used = 0
      return
    }
    const safeEstimate = Math.max(48, Math.min(1120, estimate))
    if (page.length && used + safeEstimate > capacity) {
      pages.push(page)
      page = []
      used = 0
    }
    page.push(block)
    used += safeEstimate
  })

  if (page.length || pages.length === 0) pages.push(page)
  return pages
}

function compactAssessmentPaperBlocks(blocks: any[], hasQuestions: boolean) {
  if (!hasQuestions) return []
  const compact: any[] = []
  blocks.forEach((block) => {
    if (block?.block_type === 'page_break' && (!compact.length || compact[compact.length - 1]?.block_type === 'page_break')) return
    compact.push(block)
  })
  while (compact[compact.length - 1]?.block_type === 'page_break') compact.pop()
  return compact
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
  const [setup, setSetup] = useState<any>({ years: [], terms: [], classes: [], subjects: [], teachers: [], assignments: [], exam_sessions: [], curricula: [], exam_tracks: [], session: null })
  const [form, setForm] = useState<any>(emptyForm)
  const [questions, setQuestions] = useState<any[]>([])
  const [designBlocks, setDesignBlocks] = useState<any[]>([])
  const [media, setMedia] = useState<any[]>([])
  const [selectedBlockId, setSelectedBlockId] = useState('')
  const [outlineDragId, setOutlineDragId] = useState('')
  const [canvasDrag, setCanvasDrag] = useState<any>(null)
  const [editorMode, setEditorMode] = useState<'builder' | 'print' | 'marking' | 'review'>('builder')
  const [showInspector, setShowInspector] = useState(true)
  const [paperLayout, setPaperLayout] = useState<any>(defaultPaperLayout)
  const [textToolbar, setTextToolbar] = useState<any>(null)
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

  const selectedClass = useMemo(() => (setup.classes || []).find((row: any) => String(row.id) === String(form.class_id)) || null, [form.class_id, setup.classes])
  const selectedSubject = useMemo(() => (setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id)) || null, [form.subject_id, setup.subjects])
  const activeCurriculum = useMemo(() => {
    const curricula = setup.curricula || []
    if (!curricula.length) return null
    return curricula.find((row: any) => row.is_active !== false) || curricula[0]
  }, [setup.curricula])
  const currentCurriculumKey = useMemo(() => {
    const explicit = normalizeCurriculumKey(paperLayout.curriculum_key || paperLayout.curriculum)
    if (explicit) return explicit
    const source = [
      selectedClass?.curriculum_name,
      selectedClass?.curriculum_country,
      selectedSubject?.curriculum_name,
      selectedSubject?.curriculum_country,
      activeCurriculum?.name,
      activeCurriculum?.country,
    ].filter(Boolean).join(' ')
    return normalizeCurriculumKey(source) || 'general'
  }, [activeCurriculum, paperLayout.curriculum, paperLayout.curriculum_key, selectedClass, selectedSubject])
  const currentCurriculumLabel = curriculumLabel(currentCurriculumKey)
  const visibleTemplateOptions = useMemo(() => paperTemplateOptions.filter((option) => {
    if (currentCurriculumKey === 'cambridge') return option.curriculum === 'cambridge' || option.curriculum === 'general'
    if (currentCurriculumKey === 'malawi') return option.curriculum === 'malawi' || option.curriculum === 'general'
    return option.curriculum === 'general'
  }), [currentCurriculumKey])
  const selectedTemplateValue = visibleTemplateOptions.some((option) => option.value === template) ? template : 'standard'

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

  const coverBlocks = useMemo(() => normalizeCoverBlocks(paperLayout.cover_blocks || []), [paperLayout.cover_blocks])
  const originalCoverMedia = useMemo(() => media.find((row: any) => String(row.id) === String(paperLayout.original_cover_media_id)) || null, [media, paperLayout.original_cover_media_id])
  const selectedBlock = useMemo(() => coverBlocks.find((block: any) => String(block.local_id || block.id) === String(selectedBlockId)) || allBlocks.find((block: any) => String(block.local_id || block.id) === String(selectedBlockId)) || null, [allBlocks, coverBlocks, selectedBlockId])
  const layeredBlocks = useMemo(() => [...allBlocks].sort((a: any, b: any) => {
    const layerDiff = numericStyle(b.style_json?.z_index, 0) - numericStyle(a.style_json?.z_index, 0)
    return layerDiff || numericStyle(a.sort_order, 0) - numericStyle(b.sort_order, 0)
  }), [allBlocks])
  const layeredCoverBlocks = useMemo(() => [...coverBlocks].sort((a: any, b: any) => {
    const layerDiff = numericStyle(b.style_json?.z_index, 0) - numericStyle(a.style_json?.z_index, 0)
    return layerDiff || numericStyle(a.sort_order, 0) - numericStyle(b.sort_order, 0)
  }), [coverBlocks])

  const applyPaper = (payload: any) => {
    const assessment = payload?.assessment || payload
    const loadedBlocks = payload?.blocks || []
    const layoutBlock = loadedBlocks.find((block: any) => block.metadata_json?.system_block === 'paper_layout')
    setPaperLayout(normalizePaperLayout(layoutBlock?.content_json?.paper_layout || layoutBlock?.content_json || {}))
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
    const usedQuestionBlockIndexes = new Set<number>()
    setQuestions((payload?.questions || []).map((question: any, index: number) => {
      const displayNumber = String(question.display_number || question.question_number || index + 1)
      let questionBlockIndex = questionBlocks.findIndex((block: any, blockIndex: number) => !usedQuestionBlockIndexes.has(blockIndex) && questionReferenceKey(block.content_json?.question_number) === questionReferenceKey(displayNumber))
      if (questionBlockIndex < 0 && !usedQuestionBlockIndexes.has(index) && questionBlocks[index]) questionBlockIndex = index
      if (questionBlockIndex < 0) questionBlockIndex = questionBlocks.findIndex((_: any, blockIndex: number) => !usedQuestionBlockIndexes.has(blockIndex))
      if (questionBlockIndex >= 0) usedQuestionBlockIndexes.add(questionBlockIndex)
      const questionBlock = questionBlocks[questionBlockIndex]
      const contentParts = normalizeQuestionParts(questionBlock?.content_json?.content_parts || question.content_parts || question.contentParts || [])
      return {
        ...newQuestion(index + 1),
        ...question,
        display_number: String(questionBlock?.content_json?.question_number || displayNumber),
        number_locked: Boolean(questionBlock?.metadata_json?.original_question_number || question.display_number),
        local_id: question.local_id || (question.id ? `question-${question.id}` : uid('question')),
        question_text: question.question_text || questionPartsToText(contentParts),
        content_parts: contentParts,
        marks: question.marks ? String(question.marks) : '',
        options: question.options?.length ? question.options : newOptions(),
        style_json: {
          spacing: 'normal',
          z_index: 0,
          offset_x: 0,
          offset_y: 0,
          ...(questionBlock?.style_json || {}),
          ...(question.style_json || {}),
        },
        sort_order: numericStyle(questionBlock?.sort_order, numericStyle(question.sort_order, 100 + index)),
      }
    }))
    setDesignBlocks(loadedBlocks
      .filter((block: any) => block.metadata_json?.system_block !== 'paper_layout')
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
    setPaperLayout(defaultPaperLayout)
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

  const updateQuestionType = (index: number, value: string) => {
    setQuestions((current) => current.map((question, questionIndex) => {
      if (questionIndex !== index) return question
      const nextStyle = { ...(question.style_json || {}) }
      if (value === 'structured' && (!nextStyle.answer_space_type || nextStyle.answer_space_type === 'none')) {
        nextStyle.answer_space_type = 'ruled_lines'
        nextStyle.answer_lines = nextStyle.answer_lines || 4
        nextStyle.answer_height = nextStyle.answer_height || 132
      }
      return { ...question, question_type: value, style_json: nextStyle }
    }))
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

  const baseQuestionParts = (question: any) => {
    const parts = normalizeQuestionParts(question.content_parts || [])
    if (parts.length) return parts
    const text = String(question.question_text || '').trim()
    return text ? [{ local_id: uid('qtext'), type: 'text', text, media_id: '', url: '', caption: '', alt_text: '', width: 360 }] : []
  }

  const setQuestionParts = (questionIndex: number, parts: any[]) => {
    const normalizedParts = normalizeQuestionParts(parts)
    setQuestions((current) => current.map((question, index) => index === questionIndex
      ? { ...question, content_parts: normalizedParts, question_text: questionPartsToText(normalizedParts) }
      : question))
  }

  const addQuestionPart = (questionIndex: number, part: any) => {
    setQuestions((current) => current.map((question, index) => {
      if (index !== questionIndex) return question
      const parts = [
        ...baseQuestionParts(question),
        {
          local_id: uid(part.type === 'image' ? 'qimage' : 'qtext'),
          type: part.type === 'image' ? 'image' : 'text',
          text: part.text || '',
          media_id: part.media_id || '',
          url: part.url || '',
          caption: part.caption || '',
          alt_text: part.alt_text || '',
          width: part.width || 360,
        },
      ]
      return { ...question, content_parts: normalizeQuestionParts(parts), question_text: questionPartsToText(parts) }
    }))
  }

  const updateQuestionPart = (questionIndex: number, partId: string, patch: any) => {
    setQuestions((current) => current.map((question, index) => {
      if (index !== questionIndex) return question
      const parts = baseQuestionParts(question).map((part) => part.local_id === partId ? { ...part, ...patch } : part)
      return { ...question, content_parts: normalizeQuestionParts(parts), question_text: questionPartsToText(parts) }
    }))
  }

  const removeQuestionPart = (questionIndex: number, partId: string) => {
    setQuestions((current) => current.map((question, index) => {
      if (index !== questionIndex) return question
      const parts = baseQuestionParts(question).filter((part) => part.local_id !== partId)
      return { ...question, content_parts: parts, question_text: questionPartsToText(parts) }
    }))
  }

  const moveQuestion = (index: number, direction: -1 | 1) => {
    setQuestions((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next.map((question, questionIndex) => ({ ...question, question_number: questionIndex + 1, display_number: question.number_locked ? question.display_number : String(questionIndex + 1), sort_order: numericStyle(question.sort_order, 100 + questionIndex) }))
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

  const appendQuestionWithAnswerSpace = (patch: any = {}, spacePatch: any = {}) => {
    if (readOnly) return
    const maxOrder = allBlocks.reduce((max, block) => Math.max(max, numericStyle(block.sort_order, 0)), 90)
    const baseQuestion = newQuestion(questions.length + 1)
    const question = {
      ...baseQuestion,
      ...patch,
      style_json: {
        ...baseQuestion.style_json,
        answer_space_type: spacePatch.answer_space_type || 'ruled_lines',
        answer_lines: spacePatch.number_of_lines ?? 4,
        answer_height: spacePatch.height || 132,
        ...(patch.style_json || {}),
      },
      sort_order: maxOrder + 10,
    }
    setQuestions((current) => [...current, question])
    setSelectedBlockId(question.local_id)
    setEditorMode('builder')
  }

  const deleteQuestion = (index: number) => {
    setQuestions((current) => current.filter((_, questionIndex) => questionIndex !== index).map((row, questionIndex) => ({ ...row, question_number: questionIndex + 1, display_number: row.number_locked ? row.display_number : String(questionIndex + 1) })))
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

  const insertCoverBlock = (blockType: string, patch: any = {}) => {
    if (readOnly) return
    const maxOrder = coverBlocks.reduce((max, block) => Math.max(max, numericStyle(block.sort_order, 0)), 0)
    const nextBlock = newDesignBlock(blockType)
    const block = {
      ...nextBlock,
      ...patch,
      content_json: { ...(nextBlock.content_json || {}), ...(patch.content_json || {}) },
      style_json: { ...(nextBlock.style_json || {}), ...(patch.style_json || {}) },
      metadata_json: { ...(nextBlock.metadata_json || {}), ...(patch.metadata_json || {}), cover_block: true },
      sort_order: maxOrder + 10,
      is_printable: patch.is_printable !== false,
    }
    setPaperLayout((current: any) => normalizePaperLayout({ ...current, cover_blocks: [...coverBlocks, block] }))
    setSelectedBlockId(block.local_id)
    setEditorMode('builder')
  }

  const insertAnswerRegister = () => {
    if (readOnly) return
    const maxOrder = allBlocks.reduce((max, block) => Math.max(max, numericStyle(block.sort_order, 0)), 30)
    const count = Number(paperLayout.answer_register_count || 13)
    const block = { ...newAnswerRegisterBlock(count), sort_order: maxOrder + 10 }
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

  const updateCoverBlock = (blockId: any, patch: any) => {
    setPaperLayout((current: any) => normalizePaperLayout({
      ...current,
      cover_blocks: normalizeCoverBlocks(current.cover_blocks || []).map((block) => String(block.local_id || block.id) === String(blockId) ? { ...block, ...patch } : block),
    }))
  }

  const updateCoverBlockContent = (blockId: any, key: string, value: any) => {
    setPaperLayout((current: any) => normalizePaperLayout({
      ...current,
      cover_blocks: normalizeCoverBlocks(current.cover_blocks || []).map((block) => String(block.local_id || block.id) === String(blockId)
        ? { ...block, content_json: { ...(block.content_json || {}), [key]: value } }
        : block),
    }))
  }

  const updateCoverBlockStyle = (blockId: any, key: string, value: any) => {
    setPaperLayout((current: any) => normalizePaperLayout({
      ...current,
      cover_blocks: normalizeCoverBlocks(current.cover_blocks || []).map((block) => String(block.local_id || block.id) === String(blockId)
        ? { ...block, style_json: { ...(block.style_json || {}), [key]: value } }
        : block),
    }))
  }

  const updateBlockStyle = (blockId: any, key: string, value: any) => {
    const selected = allBlocks.find((block: any) => blockKey(block) === String(blockId))
    const coverBlock = coverBlocks.find((block: any) => blockKey(block) === String(blockId))
    if (coverBlock) {
      updateCoverBlockStyle(blockId, key, value)
    } else if (selected?.block_type === 'question') {
      updateQuestionStyle(blockId, key, value)
    } else {
      updateDesignBlockStyle(blockId, key, value)
    }
  }

  const updateBlockContent = (blockId: any, key: string, value: any) => {
    const coverBlock = coverBlocks.find((block: any) => blockKey(block) === String(blockId))
    if (coverBlock) updateCoverBlockContent(blockId, key, value)
    else updateDesignBlockContent(blockId, key, value)
  }

  const updateBlockPatch = (blockId: any, patch: any) => {
    const coverBlock = coverBlocks.find((block: any) => blockKey(block) === String(blockId))
    if (coverBlock) updateCoverBlock(blockId, patch)
    else updateDesignBlock(blockId, patch)
  }

  const removeDesignBlock = (blockId: any) => {
    setDesignBlocks((current) => current.filter((block) => String(block.local_id || block.id) !== String(blockId)))
    if (String(selectedBlockId) === String(blockId)) setSelectedBlockId('')
  }

  const removeCoverBlock = (blockId: any) => {
    setPaperLayout((current: any) => normalizePaperLayout({
      ...current,
      cover_blocks: normalizeCoverBlocks(current.cover_blocks || []).filter((block) => String(block.local_id || block.id) !== String(blockId)),
    }))
    if (String(selectedBlockId) === String(blockId)) setSelectedBlockId('')
  }

  const removeBlock = (blockId: any) => {
    const coverBlock = coverBlocks.find((block: any) => blockKey(block) === String(blockId))
    if (coverBlock) removeCoverBlock(blockId)
    else removeDesignBlock(blockId)
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
        display_number: question.number_locked ? question.display_number : String(index + 1),
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
    const layoutBlock = {
      block_type: 'teacher_note',
      content_json: { paper_layout: normalizePaperLayout(paperLayout) },
      style_json: {},
      metadata_json: { system_block: 'paper_layout' },
      sort_order: -10,
      is_printable: false,
    }
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
      layoutBlock,
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
    questions: questions.map((question, index) => ({
      ...question,
      question_number: index + 1,
      display_number: question.display_number || String(index + 1),
      question_text: questionDisplayText(question),
      content_parts: normalizeQuestionParts(question.content_parts || []),
      sort_order: numericStyle(question.sort_order, 100 + index),
    })),
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

  const deleteDraftPaper = async () => {
    if (!token || !form.id || String(form.status || '') !== 'draft') return
    const confirmed = window.confirm(`Delete draft paper "${documentTitle}"? This cannot be undone.`)
    if (!confirmed) return
    setSaving(true)
    try {
      await api.deleteAssessment(token, form.id)
      toast.success('Draft paper deleted.')
      navigate('/exam-builder', { replace: true })
    } catch (err: any) {
      const message = err?.message || 'Unable to delete draft paper.'
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
      msce: {
        instructions: [
          '1. This paper contains the printed pages shown on the cover. Please check.',
          '2. The paper has two sections, A and B.',
          '3. Answer all questions in the spaces provided.',
          '4. Write your Examination Number on all pages.',
          '5. In the table provided on the cover page tick against the question number you have answered.',
          '6. At the end of the examination, hand in your paper to the invigilator.',
        ].join('\n'),
        assessment_type: 'mock_exam',
        duration_minutes: '120',
        total_marks: '100',
      },
      cambridge: {
        instructions: [
          'There are forty questions on this paper. Answer all questions.',
          'For each question there are four possible answers A, B, C and D. Choose the one you consider correct and record your choice in soft pencil on the multiple choice answer sheet.',
          'Follow the instructions on the multiple choice answer sheet.',
          'Write in soft pencil.',
          'Write your name, centre number and candidate number on the multiple choice answer sheet in the spaces provided unless this has been done for you.',
          'Do not use correction fluid.',
          'Do not write on any bar codes.',
          'You may use a calculator.',
        ].join('\n'),
        assessment_type: 'mock_exam',
        duration_minutes: '45',
        total_marks: '40',
      },
      'cambridge-primary': {
        instructions: [
          'Answer all questions.',
          'Write your answers in the spaces provided on the question paper.',
          'You should show all your working.',
          'Do not write on any bar codes.',
        ].join('\n'),
        assessment_type: 'mock_exam',
        duration_minutes: '60',
        total_marks: '50',
      },
    }
    const patch = templatePatch[value] || templatePatch.standard
    const templateName: Record<string, string> = {
      msce: 'Agriculture',
      formal: 'End of Term Examination',
      primary: 'Primary Assessment Paper',
      spelling: 'Weekly Spelling Test',
      cambridge: 'Chemistry',
      'cambridge-primary': 'Cambridge Primary Checkpoint',
    }
    setForm((current: any) => ({
      ...current,
      ...patch,
      name: current.name || templateName[value] || current.name,
    }))
    if (value === 'msce') {
      setPaperLayout((current: any) => normalizePaperLayout({
        ...current,
        curriculum_key: 'malawi',
        cover_style: 'msce',
        margins: 'normal',
        question_spacing: 'normal',
        board_name: current.board_name || 'MWANZA DISTRICT EXAMINATIONS BOARD',
        exam_series: current.exam_series || '2024 MALAWI SCHOOL CERTIFICATE OF EDUCATION MOCK EXAMINATIONS',
        subject_number: current.subject_number || 'M012/I',
        exam_date: current.exam_date || 'Monday, 18 March',
        exam_time: current.exam_time || '8:00 - 10:00 am',
        paper_label: current.paper_label || 'PAPER I',
        paper_subtitle: current.paper_subtitle || 'Theory',
        total_pages: current.total_pages || '11',
        answer_register_count: current.answer_register_count || 13,
        copyright_label: current.copyright_label || '© 2024',
        footer_note: current.footer_note || 'Turn over',
      }))
      setDesignBlocks([
        {
          ...newDesignBlock('section'),
          content_json: { title: 'Section A (70 marks)' },
          style_json: { align: 'center', bold: true, z_index: 0, offset_x: 0, offset_y: 0 },
          sort_order: 40,
        },
        {
          ...newDesignBlock('paragraph'),
          content_json: { text: 'Answer all the ten questions in this section.' },
          style_json: { align: 'left', z_index: 0, offset_x: 0, offset_y: 0 },
          sort_order: 50,
        },
        {
          ...newDesignBlock('page_break'),
          sort_order: 60,
        },
        {
          ...newDesignBlock('section'),
          content_json: { title: 'SECTION B (30 Marks)' },
          style_json: { align: 'center', bold: true, z_index: 0, offset_x: 0, offset_y: 0 },
          sort_order: 70,
        },
        {
          ...newDesignBlock('paragraph'),
          content_json: { text: 'Answer all three questions in this section.' },
          style_json: { align: 'left', z_index: 0, offset_x: 0, offset_y: 0 },
          sort_order: 80,
        },
      ])
      setQuestions([])
      setEditorMode('builder')
    }
    if (value === 'cambridge' || value === 'cambridge-primary') {
      const isPrimary = value === 'cambridge-primary'
      const year = new Date().getFullYear()
      setPaperLayout((current: any) => normalizePaperLayout({
        ...current,
        curriculum_key: 'cambridge',
        cover_style: 'cambridge',
        margins: 'normal',
        question_spacing: 'normal',
        board_name: 'Cambridge Assessment International Education',
        exam_series: isPrimary ? 'Cambridge Primary Checkpoint' : 'Cambridge IGCSE',
        subject_number: isPrimary ? '0845/01' : '0620/12',
        exam_date: isPrimary ? 'May/June' : 'February/March 2025',
        exam_time: isPrimary ? '1 hour' : '45 minutes',
        paper_label: isPrimary ? 'Paper 1' : 'Paper 1 Multiple Choice (Core)',
        paper_subtitle: isPrimary ? 'Write your answers on the question paper.' : 'You must answer on the multiple choice answer sheet.',
        total_pages: isPrimary ? '12' : '16',
        answer_register_count: 0,
        copyright_label: `\u00a9 UCLES ${year}`,
        footer_note: 'Turn over',
        header: isPrimary ? '*0000000000*' : '*5410013095*',
        footer: isPrimary ? 'Cambridge Primary Checkpoint' : 'IB25 03_0620_12/6RP',
        page_numbers: 'bottom',
      }))
      setEditorMode('builder')
    }
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
                question_text: questionDisplayText(question),
                content_parts: normalizeQuestionParts(question.content_parts || question.contentParts || []),
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

  const uploadAssessmentImage = async (file?: File | null) => {
    if (!file || readOnly || !token) return null
    if (!form.id) {
      toast.error('Save the paper before uploading images.')
      return null
    }
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      toast.error('Only PNG, JPEG, WebP, GIF and SVG images are supported.')
      return null
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
      return result.media
    } catch (err: any) {
      toast.error(err?.message || 'Unable to upload image.')
      return null
    } finally {
      setSaving(false)
    }
  }

  const uploadImageBlock = async (file?: File | null) => {
    const uploaded = await uploadAssessmentImage(file)
    if (!uploaded) return
    try {
      insertBlock('image', {
        content_json: {
          media_id: uploaded.id,
          url: uploaded.storage_path,
          caption: '',
          alt_text: uploaded.alt_text || '',
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
    }
  }

  const uploadCoverLogo = async (file?: File | null) => {
    const uploaded = await uploadAssessmentImage(file)
    if (!uploaded) return
    insertCoverBlock('image', {
      content_json: {
        media_id: uploaded.id,
        url: uploaded.storage_path,
        caption: '',
        alt_text: uploaded.alt_text || 'School logo',
        width: 96,
        crop_enabled: false,
        crop_height: 96,
        crop_x: 50,
        crop_y: 50,
        crop_zoom: 1,
      },
      style_json: { align: 'left', z_index: 1, offset_x: 0, offset_y: 0 },
    })
    toast.success('Logo added to the cover.')
  }

  const uploadQuestionPartImage = async (questionIndex: number, file?: File | null) => {
    const uploaded = await uploadAssessmentImage(file)
    if (!uploaded) return
    addQuestionPart(questionIndex, {
      type: 'image',
      media_id: uploaded.id,
      url: uploaded.storage_path,
      caption: '',
      alt_text: uploaded.alt_text || '',
      width: 360,
    })
    toast.success('Image added to question.')
  }

  const saveCoverTemplate = async () => {
    const templateName = window.prompt('Template name', `${form.name || currentCurriculumLabel} Cover`)
    if (!templateName) return
    const template = {
      version: 1,
      paper_size: paperLayout.paper_size,
      curriculum_key: currentCurriculumKey,
      cover_style: paperLayout.cover_style,
      margins: paperLayout.margins,
      board_name: paperLayout.board_name,
      exam_series: paperLayout.exam_series,
      subject_number: paperLayout.subject_number,
      exam_date: paperLayout.exam_date,
      exam_time: paperLayout.exam_time,
      paper_label: paperLayout.paper_label,
      paper_subtitle: paperLayout.paper_subtitle,
      total_pages: paperLayout.total_pages,
      answer_register_count: paperLayout.answer_register_count,
      copyright_label: paperLayout.copyright_label,
      footer_note: paperLayout.footer_note,
      page_numbers: paperLayout.page_numbers,
      header: paperLayout.header,
      footer: paperLayout.footer,
      cover_blocks: coverBlocks,
      original_cover_media_id: paperLayout.original_cover_media_id || null,
    }
    try {
      await api.createAssessmentTemplate(token, {
        template_name: templateName,
        template_description: `Saved from ${form.name || 'Assessment Builder'}`,
        source_type: 'school_created',
        source_assessment_id: form.id || null,
        subject_id: form.subject_id || null,
        class_id: form.class_id || null,
        assessment_type: form.assessment_type,
        template_category: isFormal ? 'exam' : form.assessment_type === 'quiz' ? 'quiz' : 'general',
        layout_json: template,
        style_json: { curriculum_key: currentCurriculumKey },
      })
      toast.success('Cover saved to the school template library.')
    } catch (err: any) {
      toast.error(err?.message || 'Cover template could not be saved.')
    }
  }

  const applySavedCoverTemplate = () => {
    try {
      const raw = window.localStorage.getItem(coverTemplateStorageKey(user, currentCurriculumKey))
        || window.localStorage.getItem(legacyCoverTemplateStorageKey(user))
      if (!raw) {
        toast.error(`No saved ${currentCurriculumLabel} cover template found.`)
        return
      }
      setPaperLayout((current: any) => normalizePaperLayout({ ...current, ...JSON.parse(raw) }))
      toast.success(`${currentCurriculumLabel} cover template applied.`)
    } catch {
      toast.error('Saved cover template could not be loaded.')
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
        `${question.display_number || question.question_number || index + 1} ${questionDisplayText(question)} (${question.marks || 0} marks)`,
        ...(question.question_type === 'multiple_choice' ? (question.options || []).map((option: any) => `   ${option.option_label}. ${option.option_text}`) : []),
        ...(mode === 'marking' ? [
          question.correct_answer ? `Correct answer: ${question.correct_answer}` : '',
          question.marking_scheme ? `Marking scheme: ${question.marking_scheme}` : '',
          question.explanation ? `Explanation: ${question.explanation}` : '',
        ] : []),
        '',
      ]),
      'End of question paper',
    ]
    return rows.join('\n')
  }

  const absoluteAssetUrl = (value: any) => {
    if (!value) return ''
    const resolved = resolvePortalAssetUrl(value)
    try {
      return new URL(resolved, window.location.origin).href
    } catch {
      return resolved
    }
  }

  const answerSpaceHtml = (content: any = {}) => {
    const type = content.answer_space_type || 'ruled_lines'
    const height = Math.max(24, Number(content.height || 120))
    const lines = Math.max(0, Number(content.number_of_lines || 0))
    const border = content.show_border === false ? '' : 'border:1px solid #111827;'
    if (type === 'graph_grid') {
      return `<div class="answer-space graph-space" style="min-height:${height}px;${border}"></div>`
    }
    if (type === 'blank_box') {
      return `<div class="answer-space" style="min-height:${height}px;${border}"></div>`
    }
    const lineHtml = Array.from({ length: lines || Math.max(1, Math.round(height / 32)) }).map(() => '<div class="answer-line"></div>').join('')
    return `<div class="answer-space" style="min-height:${height}px;${border}">${lineHtml}</div>`
  }

  const questionAnswerSpaceHtml = (style: any = {}) => {
    if (!style.answer_space_type || style.answer_space_type === 'none') return ''
    return answerSpaceHtml({
      answer_space_type: style.answer_space_type,
      height: style.answer_height || 120,
      number_of_lines: style.answer_lines || 4,
      show_border: style.answer_space_type !== 'ruled_lines',
    })
  }

  const blockStyleHtml = (style: any = {}) => {
    const parts = []
    if (style.align) parts.push(`text-align:${style.align === 'stretch' ? 'left' : style.align}`)
    if (style.bold) parts.push('font-weight:700')
    if (style.italic) parts.push('font-style:italic')
    if (style.underline) parts.push('text-decoration:underline')
    if (style.font_size) parts.push(`font-size:${Number(style.font_size)}px`)
    if (style.line_spacing === 'wide') parts.push('line-height:1.8')
    if (style.line_spacing === 'tight') parts.push('line-height:1.2')
    return parts.join(';')
  }

  const designBlockHtml = (block: any) => {
    if (block.metadata_json?.system_block === 'paper_layout') return ''
    if (block.block_type === 'teacher_note') return ''
    if (block.is_printable === false) return ''
    const content = block.content_json || {}
    const style = block.style_json || {}
    const blockStyle = blockStyleHtml(style)
    if (block.block_type === 'section') {
      return `<h2 class="section-title" style="${escapeAttribute(blockStyle)}">${textToHtml(content.title || '')}</h2>`
    }
    if (block.block_type === 'paragraph' || block.block_type === 'text_box' || block.block_type === 'heading') {
      const tag = block.block_type === 'heading' ? 'h2' : 'div'
      return `<${tag} class="paper-block ${block.block_type === 'text_box' ? 'text-box' : ''}" style="${escapeAttribute(blockStyle)}">${textToHtml(content.text || '')}</${tag}>`
    }
    if (block.block_type === 'answer_space') {
      return `<div class="paper-block">${answerSpaceHtml(content)}</div>`
    }
    if (block.block_type === 'image') {
      const url = absoluteAssetUrl(content.url)
      const width = Math.max(80, Number(content.width || 360))
      return `<figure class="paper-block image-block" style="${escapeAttribute(blockStyle)}">${url ? `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(content.alt_text || content.caption || 'Assessment image')}" style="max-width:100%;width:${width}px" />` : '<div class="image-placeholder">Image / diagram placeholder</div>'}${content.caption ? `<figcaption>${textToHtml(content.caption)}</figcaption>` : ''}</figure>`
    }
    if (block.block_type === 'shape') {
      return `<div class="paper-block" style="${escapeAttribute(blockStyle)}"><div class="shape-placeholder" style="width:${Number(content.width || 260)}px;min-height:${Number(content.height || 120)}px">${textToHtml(content.label || String(content.shape_type || 'Diagram').replace(/_/g, ' '))}</div></div>`
    }
    if (block.block_type === 'table') {
      const rows = Number(content.rows || content.cells?.length || 3)
      const columns = Number(content.columns || content.cells?.[0]?.length || 3)
      const cells = content.cells || []
      const tableRows = Array.from({ length: rows }).map((_, rowIndex) => {
        const tag = content.header_row && rowIndex === 0 ? 'th' : 'td'
        const rowCells = Array.from({ length: columns }).map((__, columnIndex) => `<${tag}>${textToHtml(cells[rowIndex]?.[columnIndex] || '')}</${tag}>`).join('')
        return `<tr>${rowCells}</tr>`
      }).join('')
      return `<table class="paper-table ${block.metadata_json?.table_kind === 'answer_register' ? 'answer-register' : ''}">${tableRows}</table>`
    }
    if (block.block_type === 'page_break') return '<div class="page-break"></div>'
    return `<div class="paper-block">${textToHtml(content.text || '')}</div>`
  }

  const questionContentHtml = (question: any) => {
    const parts = normalizeQuestionParts(question.content_parts || [])
    if (!parts.length) return textToHtml(question.question_text || '')
    return parts.map((part) => {
      if (part.type === 'image') {
        const url = absoluteAssetUrl(part.url)
        const width = Math.max(80, Number(part.width || 360))
        return `<figure class="question-part image-block">${url ? `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(part.alt_text || part.caption || 'Question image')}" style="max-width:100%;width:${width}px" />` : '<div class="image-placeholder">Question image</div>'}${part.caption ? `<figcaption>${textToHtml(part.caption)}</figcaption>` : ''}</figure>`
      }
      return `<div class="question-part">${textToHtml(part.text || '')}</div>`
    }).join('')
  }

  const questionHtml = (question: any, index: number, mode: 'student' | 'marking') => {
    const marks = Number(question.marks || 0)
    const markLabel = marks === 1 ? '1 mark' : `${marks || 0} marks`
    const optionsHtml = question.question_type === 'multiple_choice'
      ? `<div class="mcq-options">${(question.options || []).map((option: any) => `<div class="mcq-option"><span>${escapeHtml(option.option_label || '')}.</span><span>${textToHtml(option.option_text || '')}</span></div>`).join('')}</div>`
      : ''
    const schemeHtml = mode === 'marking'
      ? `<div class="marking-panel">${question.correct_answer ? `<p><strong>Answer:</strong> ${textToHtml(question.correct_answer)}</p>` : ''}${question.marking_scheme ? `<p><strong>Marking scheme:</strong> ${textToHtml(question.marking_scheme)}</p>` : ''}${question.explanation ? `<p><strong>Explanation:</strong> ${textToHtml(question.explanation)}</p>` : ''}</div>`
      : ''
    return `<section class="question-block"><div class="question-number">${escapeHtml(question.display_number || question.question_number || index + 1)}</div><div class="question-body"><div class="question-text"><span class="marks">(${markLabel})</span>${questionContentHtml(question)}</div>${question.question_instructions ? `<div class="question-instructions">${textToHtml(question.question_instructions)}</div>` : ''}${optionsHtml}${questionAnswerSpaceHtml(question.style_json || {})}${schemeHtml}${index === questions.length - 1 ? '<div class="end-of-question-paper">End of question paper</div>' : ''}</div></section>`
  }

  const coverBlocksHtml = () => coverBlocks.length
    ? `<div class="cover-freeform">${coverBlocks.map(designBlockHtml).join('\n')}</div>`
    : ''

  const msceCoverHtml = () => {
    const subjectName = (setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id))?.name || form.name || 'Subject'
    const totalMarks = form.total_marks || '100'
    const duration = form.duration_minutes ? `${form.duration_minutes} minutes` : ''
    const count = Number(paperLayout.answer_register_count || 13)
    const rows = answerRegisterCells(count).map((row, rowIndex) => {
      const tag = rowIndex === 0 ? 'th' : 'td'
      return `<tr>${row.map((cell) => `<${tag}>${textToHtml(cell)}</${tag}>`).join('')}</tr>`
    }).join('')
    return `<section class="msce-cover page-break-after">
      <div class="candidate-line"><span>STUDENT NAME __________________________________</span><span>SCHOOL _____________</span></div>
      ${coverBlocksHtml()}
      <div class="cover-heading">
        <div class="board">${textToHtml(paperLayout.board_name)}</div>
        <div class="series">${textToHtml(paperLayout.exam_series)}</div>
        <div class="subject">${textToHtml(subjectName).toUpperCase()}</div>
      </div>
      <div class="cover-meta">
        <div>${textToHtml(paperLayout.exam_date || '')}</div>
        <div><strong>Subject Number:</strong> ${textToHtml(paperLayout.subject_number || '')}</div>
        <div>${textToHtml(duration)}</div>
        <div>${textToHtml(paperLayout.exam_time || '')}</div>
      </div>
      <div class="paper-label">${textToHtml(paperLayout.paper_label || '')}<br /><span>${textToHtml(paperLayout.paper_subtitle || '')}</span><br /><strong>(${textToHtml(totalMarks)} marks)</strong></div>
      <div class="cover-grid">
        <div>
          <h3>Instructions</h3>
          <div class="instructions-text">${textToHtml(form.instructions || '')}</div>
        </div>
        <table class="paper-table answer-register">${rows}</table>
      </div>
      <div class="cover-footer"><span>${textToHtml(paperLayout.copyright_label || '')}</span><span>${textToHtml(paperLayout.footer_note || '')}</span></div>
    </section>`
  }

  const standardCoverHtml = () => {
    const className = (setup.classes || []).find((row: any) => String(row.id) === String(form.class_id))?.name || ''
    const subjectName = (setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id))?.name || ''
    return `<section class="standard-cover">
      <div class="school-name">${textToHtml(user?.schoolName || 'SmartLink Schools')}</div>
      ${coverBlocksHtml()}
      <h1>${textToHtml(documentTitle)}</h1>
      <div class="standard-meta">
        <span>Class: ${textToHtml(className || '-')}</span>
        <span>Subject: ${textToHtml(subjectName || '-')}</span>
        <span>Duration: ${textToHtml(form.duration_minutes || '-')} minutes</span>
        <span>Marks: ${textToHtml(form.total_marks || '-')}</span>
      </div>
      ${form.instructions ? `<div class="instructions-text">${textToHtml(form.instructions)}</div>` : ''}
    </section>`
  }

  const cambridgeCoverHtml = () => {
    const subjectName = (setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id))?.name || form.name || 'Subject'
    const instructionItems = String(form.instructions || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
    const informationItems = [
      `The total mark for this paper is ${form.total_marks || '-'}.`,
      'Each correct answer will score one mark.',
      'Any rough working should be done on this question paper.',
    ]
    return `<section class="cambridge-cover page-break-after">
      <div class="cambridge-brand"><span class="cambridge-crest">CA</span><span>${textToHtml(paperLayout.board_name || 'Cambridge Assessment International Education')}</span></div>
      ${coverBlocksHtml()}
      <div class="cambridge-series">${textToHtml(paperLayout.exam_series || 'Cambridge IGCSE')}<sup>TM</sup></div>
      <div class="cambridge-rule"></div>
      <div class="cambridge-meta">
        <div><strong>${textToHtml(subjectName).toUpperCase()}</strong><span>${textToHtml(paperLayout.paper_label || 'Paper 1')}</span></div>
        <div><strong>${textToHtml(paperLayout.subject_number || '')}</strong><span>${textToHtml(paperLayout.exam_date || '')}</span><span>${textToHtml(paperLayout.exam_time || '')}</span></div>
      </div>
      <div class="cambridge-layout">
        <div class="cambridge-barcode"><span>${textToHtml(paperLayout.header || '*0000000000*')}</span></div>
        <div>
          ${paperLayout.paper_subtitle ? `<p class="cambridge-answer-note">${textToHtml(paperLayout.paper_subtitle)}</p>` : ''}
          <div class="cambridge-needs"><span>You will need:</span><div>Multiple choice answer sheet<br />Soft clean eraser<br />Soft pencil (type B or HB is recommended)</div></div>
          <div class="cambridge-rule"></div>
          <h2>INSTRUCTIONS</h2>
          <ul>${instructionItems.map((item) => `<li>${textToHtml(item)}</li>`).join('')}</ul>
          <h2>INFORMATION</h2>
          <ul>${informationItems.map((item) => `<li>${textToHtml(item)}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="cambridge-document-pages">This document has <strong>${textToHtml(paperLayout.total_pages || '___')}</strong> pages. Any blank pages are indicated.</div>
      <div class="cambridge-footer"><span>${textToHtml(paperLayout.footer || '')}<br />${textToHtml(paperLayout.copyright_label || '')}</span><strong>[${textToHtml(paperLayout.footer_note || 'Turn over')}]</strong></div>
    </section>`
  }

  const documentHtml = (mode: 'student' | 'marking' = 'student') => {
    const baseName = textToHtml(documentTitle)
    const margin = paperLayout.margins === 'narrow' ? '10mm' : paperLayout.margins === 'wide' ? '20mm' : '14mm'
    const coverHtml = paperLayout.cover_style === 'msce'
      ? msceCoverHtml()
      : paperLayout.cover_style === 'cambridge'
        ? cambridgeCoverHtml()
        : standardCoverHtml()
    const content = [
      coverHtml,
      ...strictDocumentBlocks.map((block: any) => block.block_type === 'question'
        ? questionHtml(questions.find((question, index) => questionKey(question, index) === blockKey(block)) || {}, questions.findIndex((question, index) => questionKey(question, index) === blockKey(block)), mode)
        : designBlockHtml(block)),
    ].join('\n')
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${baseName}</title>
  <style>
    @page { size: A4; margin: ${margin}; }
    body { margin: 0; background: #ffffff; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 12pt; line-height: 1.45; }
    .paper { max-width: 190mm; margin: 0 auto; }
    .candidate-line, .cover-meta, .cover-footer { display: flex; justify-content: space-between; gap: 18px; }
    .cover-heading { margin-top: 24px; text-align: center; font-weight: 700; }
    .cover-heading .board { font-size: 15pt; }
    .cover-heading .series { margin-top: 4px; font-size: 12pt; }
    .cover-heading .subject { margin-top: 22px; font-size: 16pt; }
    .paper-label { margin-top: 12px; text-align: center; font-weight: 700; }
    .paper-label span { font-weight: 400; }
    .cover-grid { display: grid; grid-template-columns: minmax(0,1fr) 58mm; gap: 12mm; margin-top: 20px; align-items: start; }
    .instructions-text { white-space: pre-wrap; }
    .standard-cover { border-bottom: 2px solid #111827; padding-bottom: 18px; text-align: center; }
    .standard-cover h1 { margin: 12px 0; font-size: 22pt; }
    .standard-meta { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px 18px; text-align: left; font-weight: 700; }
    .school-name { font-size: 10pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
    .cover-footer { margin-top: 28px; font-size: 10pt; }
    .cover-freeform { margin: 10px 0; }
    .cambridge-cover { position: relative; min-height: calc(297mm - (${margin} * 2)); font-family: Arial, Helvetica, sans-serif; color: #000000; }
    .cambridge-brand { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 16pt; font-weight: 700; line-height: 1.1; }
    .cambridge-crest { display: inline-grid; place-items: center; width: 28px; height: 32px; border: 2px solid #111111; font-size: 8pt; }
    .cambridge-series { margin-top: 30mm; font-size: 22pt; font-weight: 700; }
    .cambridge-rule { border-top: 1px solid #111111; margin: 8px 0 10px; }
    .cambridge-meta { display: grid; grid-template-columns: minmax(0,1fr) 42mm; gap: 10mm; font-size: 11pt; }
    .cambridge-meta div { display: grid; gap: 7px; }
    .cambridge-meta div:last-child { text-align: right; }
    .cambridge-layout { display: grid; grid-template-columns: 12mm minmax(0,1fr); gap: 5mm; margin-top: 12mm; }
    .cambridge-barcode { min-height: 38mm; background: repeating-linear-gradient(90deg,#111 0 1px,#fff 1px 3px,#111 3px 5px,#fff 5px 7px); position: relative; }
    .cambridge-barcode span { position: absolute; left: -8mm; top: 0; writing-mode: vertical-rl; text-orientation: mixed; font-size: 7pt; letter-spacing: 2px; background: #fff; padding: 1mm; }
    .cambridge-answer-note { margin: 0 0 18px; }
    .cambridge-needs { display: grid; grid-template-columns: 28mm minmax(0,1fr); gap: 3mm; margin-bottom: 10px; }
    .cambridge-cover h2 { margin: 8px 0 4px; font-size: 11pt; }
    .cambridge-cover ul { margin: 0 0 24px; padding-left: 18px; }
    .cambridge-cover li { margin: 3px 0; }
    .cambridge-document-pages { position: absolute; left: 0; right: 0; bottom: 22mm; border-top: 1px solid #111111; padding-top: 4px; text-align: center; font-size: 10pt; }
    .cambridge-footer { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; align-items: end; font-size: 9pt; }
    .paper-block { margin: 12px 0; }
    .section-title { margin: 18px 0 8px; text-align: center; font-size: 14pt; }
    .text-box { border: 1px solid #111827; padding: 8px; }
    .question-block { display: grid; grid-template-columns: minmax(28px,max-content) minmax(0,1fr); gap: 8px; margin: 12px 0; break-inside: avoid; }
    .question-number { text-align: right; font-weight: 700; white-space: nowrap; }
    .question-text { white-space: pre-wrap; }
    .question-part { margin: 0 0 8px; }
    .marks { float: right; white-space: nowrap; }
    .question-instructions { margin-top: 4px; color: #374151; font-style: italic; }
    .mcq-options { display: grid; gap: 4px; margin: 8px 0 0 0; }
    .mcq-option { display: grid; grid-template-columns: 24px minmax(0,1fr); gap: 4px; }
    .answer-space { margin-top: 8px; border-radius: 2px; }
    .answer-line { height: 28px; margin: 0 14px; border-bottom: 1px solid #9ca3af; }
    .graph-space { background-image: linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px); background-size: 22px 22px; }
    .paper-table { width: 100%; border-collapse: collapse; margin: 10px 0; break-inside: avoid; }
    .paper-table th, .paper-table td { border: 1px solid #111827; padding: 6px; vertical-align: top; }
    .paper-table th { font-weight: 700; background: #f3f4f6; }
    .answer-register { font-size: 9pt; }
    .image-block { text-align: center; }
    .image-block figcaption { margin-top: 4px; font-size: 10pt; color: #4b5563; }
    .image-placeholder, .shape-placeholder { display: inline-flex; align-items: center; justify-content: center; border: 1px dashed #6b7280; background: #f8fafc; min-height: 90px; padding: 8px; }
    .marking-panel { margin-top: 8px; border: 1px solid #cbd5e1; background: #f8fafc; padding: 8px; font-size: 10pt; }
    .end-of-question-paper { margin-top: 16px; text-align: center; font-size: 10pt; font-weight: 700; break-inside: avoid; page-break-inside: avoid; }
    .page-break, .page-break-after { break-after: page; page-break-after: always; }
  </style>
</head>
<body><main class="paper">${content}</main></body>
</html>`
  }

  const downloadFile = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  const downloadBlob = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportPaper = async (format: 'print' | 'word' | 'html' | 'text' | 'json', mode: 'student' | 'marking' = 'student') => {
    const baseName = documentTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'exam-paper'
    if (format !== 'json' && !quality.ready) {
      const reasons = [
        !questions.length ? 'add at least one question' : '',
        quality.missingText ? `${quality.missingText} question${quality.missingText === 1 ? '' : 's'} need content` : '',
        quality.missingMarks ? `${quality.missingMarks} question${quality.missingMarks === 1 ? '' : 's'} need marks` : '',
        quality.mcqIssues ? `${quality.mcqIssues} multiple-choice question${quality.mcqIssues === 1 ? '' : 's'} need valid options` : '',
        quality.missingSchemes ? `${quality.missingSchemes} formal question${quality.missingSchemes === 1 ? '' : 's'} need marking schemes` : '',
        Math.abs(quality.questionTotal - quality.totalMarks) >= 0.01 ? `question marks total ${quality.questionTotal}, but the paper total is ${quality.totalMarks}` : '',
      ].filter(Boolean)
      toast.error(`Paper is not ready to export: ${reasons.join('; ') || 'complete the required assessment details'}.`)
      return
    }
    if (format === 'print') {
      if (!token) return
      const variant = mode === 'marking' ? 'scheme' : 'student'
      const saved = readOnly ? null : await saveDraft()
      const assessmentId = saved?.assessment?.id || form.id
      if (!assessmentId) {
        toast.error('Save the paper before exporting PDF.')
        return
      }
      setSaving(true)
      try {
        const blob = await api.exportAssessmentPdf(token, assessmentId, variant)
        downloadBlob(`${baseName}-${variant}.pdf`, blob)
        toast.success(`${variant === 'scheme' ? 'Marking scheme' : 'Student paper'} PDF exported.`)
      } catch (err: any) {
        toast.error(err?.message || 'Unable to export PDF.')
      } finally {
        setSaving(false)
      }
      return
    }
    if (format === 'word') {
      downloadFile(`${baseName}-${mode}.doc`, documentHtml(mode), 'application/msword')
      return
    }
    if (format === 'html') {
      downloadFile(`${baseName}-${mode}.html`, documentHtml(mode), 'text/html')
      return
    }
    if (format === 'json') {
      downloadFile(`${baseName}.json`, JSON.stringify({ version: 1, ...buildPayload(), media }, null, 2), 'application/json')
      return
    }
    downloadFile(`${baseName}-${mode}.txt`, documentText(mode), 'text/plain')
  }

  const updateTextSelectionToolbar = (event: any, blockId: string) => {
    if (readOnly || editorMode !== 'builder') return
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement
    const hasTextSelection = typeof target.selectionStart === 'number'
      && typeof target.selectionEnd === 'number'
      && target.selectionEnd > target.selectionStart
    if (!hasTextSelection) {
      setTextToolbar((current: any) => current?.blockId === blockId ? null : current)
      return
    }
    const rect = target.getBoundingClientRect()
    setTextToolbar({
      blockId,
      x: Math.min(window.innerWidth - 260, Math.max(12, rect.left + Math.min(rect.width - 220, 80))),
      y: Math.max(72, rect.top - 44),
    })
  }

  const renderTextToolbar = () => {
    if (!textToolbar || editorMode !== 'builder') return null
    const targetBlock = coverBlocks.find((block: any) => blockKey(block) === textToolbar.blockId) || allBlocks.find((block: any) => blockKey(block) === textToolbar.blockId)
    if (!targetBlock) return null
    const style = targetBlock.style_json || {}
    const fontSize = numericStyle(style.font_size, 14)
    return (
      <div
        className="fixed z-[80] flex items-center gap-1 rounded-[5px] border border-[#cbd5e1] bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.18)] print:hidden"
        style={{ left: textToolbar.x, top: textToolbar.y }}
      >
        <button type="button" className={`grid size-7 place-items-center rounded-[4px] ${style.bold ? 'bg-[#111827] text-white' : 'text-[#374151] hover:bg-[#f3f4f6]'}`} onMouseDown={(event) => event.preventDefault()} onClick={() => updateBlockStyle(textToolbar.blockId, 'bold', !style.bold)} aria-label="Bold"><Bold className="size-3.5" /></button>
        <button type="button" className={`grid size-7 place-items-center rounded-[4px] ${style.italic ? 'bg-[#111827] text-white' : 'text-[#374151] hover:bg-[#f3f4f6]'}`} onMouseDown={(event) => event.preventDefault()} onClick={() => updateBlockStyle(textToolbar.blockId, 'italic', !style.italic)} aria-label="Italic"><Italic className="size-3.5" /></button>
        <button type="button" className={`grid size-7 place-items-center rounded-[4px] ${style.underline ? 'bg-[#111827] text-white' : 'text-[#374151] hover:bg-[#f3f4f6]'}`} onMouseDown={(event) => event.preventDefault()} onClick={() => updateBlockStyle(textToolbar.blockId, 'underline', !style.underline)} aria-label="Underline"><Underline className="size-3.5" /></button>
        <span className="mx-1 h-5 w-px bg-[#e5e7eb]" />
        <button type="button" className="grid size-7 place-items-center rounded-[4px] text-[#374151] hover:bg-[#f3f4f6]" onMouseDown={(event) => event.preventDefault()} onClick={() => updateBlockStyle(textToolbar.blockId, 'align', 'left')} aria-label="Align left"><AlignLeft className="size-3.5" /></button>
        <button type="button" className="grid size-7 place-items-center rounded-[4px] text-[#374151] hover:bg-[#f3f4f6]" onMouseDown={(event) => event.preventDefault()} onClick={() => updateBlockStyle(textToolbar.blockId, 'align', 'center')} aria-label="Align center"><AlignCenter className="size-3.5" /></button>
        <button type="button" className="grid size-7 place-items-center rounded-[4px] text-[#374151] hover:bg-[#f3f4f6]" onMouseDown={(event) => event.preventDefault()} onClick={() => updateBlockStyle(textToolbar.blockId, 'align', 'right')} aria-label="Align right"><AlignRight className="size-3.5" /></button>
        <span className="mx-1 h-5 w-px bg-[#e5e7eb]" />
        <button type="button" className="grid size-7 place-items-center rounded-[4px] text-[#374151] hover:bg-[#f3f4f6]" onMouseDown={(event) => event.preventDefault()} onClick={() => updateBlockStyle(textToolbar.blockId, 'font_size', Math.max(8, fontSize - 1))} aria-label="Decrease font">-</button>
        <button type="button" className="grid size-7 place-items-center rounded-[4px] text-[#374151] hover:bg-[#f3f4f6]" onMouseDown={(event) => event.preventDefault()} onClick={() => updateBlockStyle(textToolbar.blockId, 'font_size', fontSize + 1)} aria-label="Increase font">+</button>
      </div>
    )
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

  const isPrintLikeMode = editorMode === 'print' || editorMode === 'marking'

  const renderStaticText = (value: any, className = '', style: any = {}) => (
    <div className={className} style={{ whiteSpace: 'pre-wrap', ...style }}>{String(value || '')}</div>
  )

  const renderAnswerSpacePreview = (content: any = {}) => {
    const height = Number(content.height || 120)
    const type = content.answer_space_type || 'ruled_lines'
    return (
      <div
        className={`w-full rounded-[3px] ${content.show_border === false ? '' : 'border border-[#111827]'} ${type === 'graph_grid' ? 'bg-[linear-gradient(#e5e7eb_1px,transparent_1px),linear-gradient(90deg,#e5e7eb_1px,transparent_1px)] bg-[size:22px_22px]' : ''}`}
        style={{ minHeight: `${height}px` }}
      >
        {type === 'ruled_lines' ? Array.from({ length: Number(content.number_of_lines || Math.max(1, Math.round(height / 32))) }).map((_, index) => <div key={index} className="mx-4 h-8 border-b border-[#9ca3af]" />) : null}
      </div>
    )
  }

  const renderQuestionAnswerSpace = (style: any = {}) => {
    if (!style.answer_space_type || style.answer_space_type === 'none') return null
    return (
      <div className="mt-3">
        {renderAnswerSpacePreview({
          answer_space_type: style.answer_space_type,
          height: style.answer_height || 120,
          number_of_lines: style.answer_lines || 4,
          show_border: style.answer_space_type !== 'ruled_lines',
        })}
      </div>
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
          {isPrintLikeMode
            ? renderStaticText(content.text, `text-[13px] leading-6 ${block.block_type === 'text_box' ? 'rounded-[3px] border border-[#111827] p-2' : ''}`, textStyle)
            : <Textarea disabled={readOnly || editorMode !== 'builder'} className={`min-h-16 resize-y text-[14px] leading-6 ${block.block_type === 'text_box' ? 'border-[#111827]' : 'border-transparent bg-transparent'}`} style={textStyle} value={content.text || ''} onMouseUp={(event) => updateTextSelectionToolbar(event, String(id))} onKeyUp={(event) => updateTextSelectionToolbar(event, String(id))} onChange={(event) => updateBlockContent(id, 'text', event.target.value)} />}
        </section>
      )
    }
    if (block.block_type === 'section') {
      return (
        <section key={id} className={`${wrapperClass} p-2 ${alignClass}`} style={positionedBlockStyle(style)} {...selectProps}>
          {renderCanvasDragHandle(block)}
          {isPrintLikeMode
            ? <h2 className="text-[18px] font-bold text-[#111827]">{content.title || ''}</h2>
            : <Input disabled={readOnly || editorMode !== 'builder'} className={`h-auto border-0 bg-transparent px-0 text-[18px] font-bold text-[#111827] focus-visible:ring-0 ${alignClass}`} value={content.title || ''} onMouseUp={(event) => updateTextSelectionToolbar(event, String(id))} onKeyUp={(event) => updateTextSelectionToolbar(event, String(id))} onChange={(event) => updateBlockContent(id, 'title', event.target.value)} />}
        </section>
      )
    }
    if (block.block_type === 'answer_space') {
      const height = Number(content.height || 120)
      const type = content.answer_space_type || 'ruled_lines'
      return (
        <section key={id} className={`${wrapperClass} p-2`} style={positionedBlockStyle(style)} {...selectProps}>
          {renderCanvasDragHandle(block)}
          {renderAnswerSpacePreview({ ...content, height, answer_space_type: type })}
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
                      {isPrintLikeMode ? (
                        <span className="whitespace-pre-wrap">{cells[rowIndex]?.[colIndex] || ''}</span>
                      ) : <Input disabled={readOnly || editorMode !== 'builder'} className="h-7 border-0 bg-transparent px-1 text-[12px] focus-visible:ring-0" value={cells[rowIndex]?.[colIndex] || ''} onChange={(event) => {
                        const next = Array.from({ length: Number(content.rows || 3) }).map((_, r) => Array.from({ length: Number(content.columns || 3) }).map((__, c) => cells[r]?.[c] || ''))
                        next[rowIndex][colIndex] = event.target.value
                        updateBlockContent(id, 'cells', next)
                      }} />}
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
        <Textarea disabled={readOnly || editorMode !== 'builder'} className="min-h-14 text-[12px]" value={content.text || ''} onMouseUp={(event) => updateTextSelectionToolbar(event, String(id))} onKeyUp={(event) => updateTextSelectionToolbar(event, String(id))} onChange={(event) => updateBlockContent(id, 'text', event.target.value)} />
      </section>
    )
  }

  const renderQuestionContentPreview = (question: any) => {
    const parts = normalizeQuestionParts(question.content_parts || [])
    if (!parts.length) return <div className="min-w-0 whitespace-pre-wrap">{question.question_text || ''}</div>
    return (
      <div className="grid gap-3">
        {parts.map((part) => part.type === 'image' ? (
          <figure key={part.local_id} className="text-center">
            {part.url ? (
              <img
                src={resolvePortalAssetUrl(part.url)}
                alt={part.alt_text || part.caption || 'Question image'}
                className="mx-auto block max-w-full rounded-[3px] border border-[#e5e7eb]"
                style={{ width: numericStyle(part.width, 360), maxWidth: '100%' }}
              />
            ) : <div className="mx-auto flex h-28 w-56 items-center justify-center rounded-[4px] border border-dashed border-[#9ca3af] bg-[#f8fafc] text-[12px] font-semibold text-[#6b7280]">Question image</div>}
            {part.caption ? <figcaption className="mt-1 text-[11px] font-medium text-[#6b7280]">{part.caption}</figcaption> : null}
          </figure>
        ) : (
          <div key={part.local_id} className="whitespace-pre-wrap">{part.text || ''}</div>
        ))}
      </div>
    )
  }

  const renderQuestionContentEditor = (question: any, questionIndex: number) => {
    const parts = normalizeQuestionParts(question.content_parts || [])
    return (
      <div>
        {parts.length ? (
          <div className="grid gap-2">
            {parts.map((part, partIndex) => (
              <div key={part.local_id} className="rounded-[4px] border border-[#e5e7eb] bg-white p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">{part.type === 'image' ? 'Image Part' : 'Text Part'} {partIndex + 1}</span>
                  <button type="button" className="grid size-6 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c] hover:bg-[#fef2f2]" disabled={readOnly} onClick={() => removeQuestionPart(questionIndex, part.local_id)} aria-label="Remove question part"><Trash2 className="size-3" /></button>
                </div>
                {part.type === 'image' ? (
                  <div className="grid gap-2">
                    {part.url ? (
                      <img
                        src={resolvePortalAssetUrl(part.url)}
                        alt={part.alt_text || part.caption || 'Question image'}
                        className="max-h-64 max-w-full rounded-[3px] border border-[#e5e7eb]"
                        style={{ width: numericStyle(part.width, 360), maxWidth: '100%' }}
                      />
                    ) : <div className="flex h-28 w-56 items-center justify-center rounded-[4px] border border-dashed border-[#9ca3af] bg-[#f8fafc] text-[12px] font-semibold text-[#6b7280]">Question image</div>}
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px]">
                      <Input disabled={readOnly} className="h-8 rounded-[3px] text-[12px]" value={part.caption || ''} onChange={(event) => updateQuestionPart(questionIndex, part.local_id, { caption: event.target.value })} placeholder="Caption or instruction for this image" />
                      <Input disabled={readOnly} type="number" className="h-8 rounded-[3px] text-[12px]" value={part.width || 360} onChange={(event) => updateQuestionPart(questionIndex, part.local_id, { width: event.target.value })} placeholder="Width" />
                    </div>
                  </div>
                ) : (
                  <Textarea
                    disabled={readOnly}
                    className="min-h-16 resize-y rounded-[3px] border-[#e5e7eb] text-[14px] leading-6 text-[#111827]"
                    value={part.text || ''}
                    onMouseUp={(event) => updateTextSelectionToolbar(event, questionKey(question, questionIndex))}
                    onKeyUp={(event) => updateTextSelectionToolbar(event, questionKey(question, questionIndex))}
                    onChange={(event) => updateQuestionPart(questionIndex, part.local_id, { text: event.target.value })}
                    placeholder="Question text part"
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <Textarea
            disabled={readOnly}
            className="min-h-16 resize-y rounded-[3px] border-[#e5e7eb] text-[14px] leading-6 text-[#111827]"
            value={question.question_text}
            onMouseUp={(event) => updateTextSelectionToolbar(event, questionKey(question, questionIndex))}
            onKeyUp={(event) => updateTextSelectionToolbar(event, questionKey(question, questionIndex))}
            onChange={(event) => updateQuestion(questionIndex, 'question_text', event.target.value)}
            placeholder="Question text"
          />
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 print:hidden">
          <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => addQuestionPart(questionIndex, { type: 'text', text: '' })}>
            <Plus className="size-3.5" />
            Text Part
          </Button>
          <label className={`inline-flex h-8 items-center justify-center gap-2 rounded-[5px] border border-[#d9dce3] bg-white px-3 text-[12px] font-semibold text-[#111827] shadow-sm transition ${readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[#f8fafc]'}`}>
            <ImageIcon className="size-3.5" />
            Question Image
            <input disabled={readOnly} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={(event) => { uploadQuestionPartImage(questionIndex, event.target.files?.[0]); event.currentTarget.value = '' }} />
          </label>
        </div>
      </div>
    )
  }

  const renderQuestionBlock = (block: any) => {
    const id = blockKey(block)
    const questionIndex = questions.findIndex((question, index) => questionKey(question, index) === id)
    if (questionIndex < 0) return null
    const question = questions[questionIndex]
    const style = { ...(block.style_json || {}), ...(question.style_json || {}) }
    const active = String(selectedBlockId) === String(id)
    const marksValue = Number(question.marks || 0)
    const marksLabel = marksValue === 1 ? '1 mark' : `${marksValue || 0} marks`
    const editableQuestion = editorMode === 'builder' || editorMode === 'review'
    return (
      <section
        key={id}
        className={`group break-inside-avoid rounded-[4px] border ${active ? 'border-[#2563eb] ring-2 ring-[#2563eb]' : 'border-transparent hover:border-[#d9dce3]'} print:border-transparent`}
        style={positionedBlockStyle(style)}
        onClick={() => setSelectedBlockId(id)}
      >
        {renderCanvasDragHandle({ ...block, style_json: style })}
        <div className="flex items-start gap-3 p-1">
          <div className="min-w-14 shrink-0 whitespace-nowrap pt-2 text-right text-[15px] font-bold text-[#111827]">{question.display_number || question.question_number || questionIndex + 1}</div>
          <div className="min-w-0 flex-1">
            {editableQuestion ? (
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_90px]">
                {renderQuestionContentEditor(question, questionIndex)}
                <Input
                  disabled={readOnly}
                  type="number"
                  className="h-9 rounded-[3px] text-[12px]"
                  value={question.marks}
                  onChange={(event) => updateQuestion(questionIndex, 'marks', event.target.value)}
                  placeholder="Marks"
                />
              </div>
            ) : (
              <div className="relative text-[14px] leading-6 text-[#111827]">
                <span className="float-right ml-3 whitespace-nowrap text-[12px] font-semibold text-[#111827]">({marksLabel})</span>
                {renderQuestionContentPreview(question)}
              </div>
            )}

            {editableQuestion ? <div className="mt-2 grid gap-2 rounded-[4px] bg-[#f8fafc] p-2 text-[12px] print:hidden md:grid-cols-4">
              <select disabled={readOnly} className={selectClassName()} value={question.question_type} onChange={(event) => updateQuestionType(questionIndex, event.target.value)}>
                {questionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <div className="flex h-8 min-w-0 items-center rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[11px] text-[#475569]" title={[question.topic_text, question.subtopic_text].filter(Boolean).join(' → ')}>{question.topic_text ? [question.topic_text, question.subtopic_text].filter(Boolean).join(' → ') : 'Map syllabus in Inspector'}</div>
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

            {editableQuestion ? <Input
              disabled={readOnly}
              className="mt-2 h-8 rounded-[3px] text-[12px] print:hidden"
              value={question.question_instructions}
              onChange={(event) => updateQuestion(questionIndex, 'question_instructions', event.target.value)}
              placeholder="Question instructions"
            /> : question.question_instructions ? <div className="mt-1 text-[12px] italic text-[#4b5563]">{question.question_instructions}</div> : null}

            {question.question_type === 'multiple_choice' ? (
              <div className="mt-3 grid gap-2">
                {(question.options || newOptions()).map((option: any, optionIndex: number) => (
                  editableQuestion ? (
                    <div key={option.option_label || optionIndex} className="grid items-center gap-2 md:grid-cols-[48px_minmax(0,1fr)_92px]">
                      <Input disabled={readOnly} className="h-8 rounded-[3px] text-[12px]" value={option.option_label} onChange={(event) => updateOption(questionIndex, optionIndex, 'option_label', event.target.value)} />
                      <Input disabled={readOnly} className="h-8 rounded-[3px] text-[12px]" value={option.option_text} onChange={(event) => updateOption(questionIndex, optionIndex, 'option_text', event.target.value)} />
                      <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151] print:hidden">
                        <input disabled={readOnly} type="checkbox" checked={Boolean(option.is_correct)} onChange={(event) => updateOption(questionIndex, optionIndex, 'is_correct', event.target.checked)} />
                        Correct
                      </label>
                    </div>
                  ) : (
                    <div key={option.option_label || optionIndex} className="grid grid-cols-[32px_minmax(0,1fr)] gap-2 text-[13px]">
                      <span className="font-semibold">{option.option_label}.</span>
                      <span>{option.option_text}</span>
                    </div>
                  )
                ))}
              </div>
            ) : null}

            {renderQuestionAnswerSpace(style)}

            {editableQuestion ? <div className="mt-3 grid gap-2 rounded-[4px] border border-[#e5e7eb] bg-[#fbfcfe] p-2 print:hidden md:grid-cols-2">
              <Textarea disabled={readOnly} className="min-h-16 text-[12px]" value={question.correct_answer} onChange={(event) => updateQuestion(questionIndex, 'correct_answer', event.target.value)} placeholder="Answer / correct answer" />
              <Textarea disabled={readOnly} className="min-h-16 text-[12px]" value={question.marking_scheme} onChange={(event) => updateQuestion(questionIndex, 'marking_scheme', event.target.value)} placeholder="Marking scheme / rubric" />
              <Textarea disabled={readOnly} className="min-h-14 text-[12px] md:col-span-2" value={question.explanation} onChange={(event) => updateQuestion(questionIndex, 'explanation', event.target.value)} placeholder="Explanation / feedback" />
            </div> : null}
            {editorMode === 'marking' ? (
              <div className="mt-3 grid gap-2 rounded-[4px] border border-[#cbd5e1] bg-[#f8fafc] p-3 text-[12px] leading-5 text-[#111827]">
                {question.correct_answer ? <div><strong>Answer:</strong> <span className="whitespace-pre-wrap">{question.correct_answer}</span></div> : null}
                {question.marking_scheme ? <div><strong>Marking scheme:</strong> <span className="whitespace-pre-wrap">{question.marking_scheme}</span></div> : null}
                {question.explanation ? <div><strong>Explanation:</strong> <span className="whitespace-pre-wrap">{question.explanation}</span></div> : null}
              </div>
            ) : null}
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
      <aside className="w-full shrink-0 rounded-[6px] border border-[#d9dce3] bg-white p-3 shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:w-[310px] xl:overflow-auto print:hidden">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-bold text-[#111827]">Inspector</div>
            <div className="text-[11px] font-semibold text-[#6b7280]">{selectedBlock ? blockTitle(selectedBlock) : 'Select a block'}</div>
          </div>
          {selectedBlock && !['question'].includes(selectedBlock.block_type) ? <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" disabled={readOnly} onClick={() => removeBlock(selectedBlock.local_id || selectedBlock.id)}><Trash2 className="size-3.5" /></button> : null}
        </div>
            {selectedBlock ? (
          <div className="mt-3 grid gap-3">
            {selectedBlock.block_type === 'question' ? (() => {
              const questionIndex = questions.findIndex((question, index) => questionKey(question, index) === blockKey(selectedBlock))
              const question = questions[questionIndex] || {}
              return (
                <>
                  <Field label="Question Type">
                    <select disabled={readOnly} className={selectClassName()} value={question.question_type || 'short_answer'} onChange={(event) => updateQuestionType(questionIndex, event.target.value)}>
                      {questionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>
                  <Field label="Marks">
                    <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={question.marks || ''} onChange={(event) => updateQuestion(questionIndex, 'marks', event.target.value)} />
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
                  <QuestionCurriculumMapping
                    assessmentId={form.id || assessmentId}
                    question={question}
                    classId={form.class_id}
                    subjectId={form.subject_id}
                    termId={form.term_id}
                    readOnly={readOnly}
                    onMapped={(result) => setQuestions((current) => current.map((item, index) => index === questionIndex ? { ...item, topic_id: result.topic_id, topic_text: result.topic_text, subtopic_id: result.subtopic_id, subtopic_text: result.subtopic_text, topic_mappings: result.topic_mappings, objective_mappings: result.objective_mappings, mapping_status: result.mapping_status } : item))}
                  />
                  <div className="rounded-[5px] border border-[#e2e8f0] bg-white p-2">
                    <div className="mb-2 text-[12px] font-bold text-[#111827]">Student Answer Space</div>
                    <Field label="Type">
                      <select disabled={readOnly} className={selectClassName()} value={question.style_json?.answer_space_type || 'none'} onChange={(event) => updateQuestionStyle(blockKey(selectedBlock), 'answer_space_type', event.target.value)}>
                        <option value="none">None</option>
                        <option value="ruled_lines">Ruled Lines</option>
                        <option value="blank_box">Blank Box</option>
                        <option value="graph_grid">Graph/Grid</option>
                      </select>
                    </Field>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field label="Lines">
                        <Input disabled={readOnly || (question.style_json?.answer_space_type || 'none') === 'none'} type="number" className="h-8 text-[12px]" value={question.style_json?.answer_lines ?? 0} onChange={(event) => updateQuestionStyle(blockKey(selectedBlock), 'answer_lines', event.target.value)} />
                      </Field>
                      <Field label="Height">
                        <Input disabled={readOnly || (question.style_json?.answer_space_type || 'none') === 'none'} type="number" className="h-8 text-[12px]" value={question.style_json?.answer_height ?? 0} onChange={(event) => updateQuestionStyle(blockKey(selectedBlock), 'answer_height', event.target.value)} />
                      </Field>
                    </div>
                  </div>
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
            {['paragraph', 'text_box', 'heading', 'section', 'teacher_note'].includes(selectedBlock.block_type) ? (() => {
              const blockId = selectedBlock.local_id || selectedBlock.id
              const isSection = selectedBlock.block_type === 'section'
              return (
                <div className="rounded-[5px] border border-[#e2e8f0] bg-white p-2">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-[#111827]">
                    <Type className="size-3.5" />
                    Text
                  </div>
                  <Field label={isSection ? 'Title' : 'Content'}>
                    {isSection ? (
                      <Input
                        disabled={readOnly}
                        className="h-8 text-[12px]"
                        value={selectedBlock.content_json?.title || ''}
                        onMouseUp={(event) => updateTextSelectionToolbar(event, String(blockId))}
                        onKeyUp={(event) => updateTextSelectionToolbar(event, String(blockId))}
                        onChange={(event) => updateBlockContent(blockId, 'title', event.target.value)}
                      />
                    ) : (
                      <Textarea
                        disabled={readOnly}
                        className="min-h-24 text-[12px]"
                        value={selectedBlock.content_json?.text || ''}
                        onMouseUp={(event) => updateTextSelectionToolbar(event, String(blockId))}
                        onKeyUp={(event) => updateTextSelectionToolbar(event, String(blockId))}
                        onChange={(event) => updateBlockContent(blockId, 'text', event.target.value)}
                      />
                    )}
                  </Field>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <button type="button" className={`grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] ${selectedBlock.style_json?.bold ? 'bg-[#111827] text-white' : 'bg-white text-[#374151]'}`} disabled={readOnly} onClick={() => updateBlockStyle(blockId, 'bold', !selectedBlock.style_json?.bold)} aria-label="Bold"><Bold className="size-3.5" /></button>
                    <button type="button" className={`grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] ${selectedBlock.style_json?.italic ? 'bg-[#111827] text-white' : 'bg-white text-[#374151]'}`} disabled={readOnly} onClick={() => updateBlockStyle(blockId, 'italic', !selectedBlock.style_json?.italic)} aria-label="Italic"><Italic className="size-3.5" /></button>
                    <button type="button" className={`grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] ${selectedBlock.style_json?.underline ? 'bg-[#111827] text-white' : 'bg-white text-[#374151]'}`} disabled={readOnly} onClick={() => updateBlockStyle(blockId, 'underline', !selectedBlock.style_json?.underline)} aria-label="Underline"><Underline className="size-3.5" /></button>
                    <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151]" disabled={readOnly} onClick={() => updateBlockStyle(blockId, 'align', 'left')} aria-label="Align left"><AlignLeft className="size-3.5" /></button>
                    <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151]" disabled={readOnly} onClick={() => updateBlockStyle(blockId, 'align', 'center')} aria-label="Align center"><AlignCenter className="size-3.5" /></button>
                    <button type="button" className="grid size-8 place-items-center rounded-[4px] border border-[#d9dce3] bg-white text-[#374151]" disabled={readOnly} onClick={() => updateBlockStyle(blockId, 'align', 'right')} aria-label="Align right"><AlignRight className="size-3.5" /></button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field label="Font Size">
                      <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.style_json?.font_size || 14} onChange={(event) => updateBlockStyle(blockId, 'font_size', event.target.value)} />
                    </Field>
                    <Field label="Line Spacing">
                      <select disabled={readOnly} className={selectClassName()} value={selectedBlock.style_json?.line_spacing || 'normal'} onChange={(event) => updateBlockStyle(blockId, 'line_spacing', event.target.value)}>
                        <option value="tight">Tight</option>
                        <option value="normal">Normal</option>
                        <option value="wide">Wide</option>
                      </select>
                    </Field>
                  </div>
                </div>
              )
            })() : null}
            {selectedBlock.block_type === 'answer_space' ? (
              <>
                <Field label="Answer Space Type">
                  <select disabled={readOnly} className={selectClassName()} value={selectedBlock.content_json?.answer_space_type || 'ruled_lines'} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'answer_space_type', event.target.value)}>
                    <option value="ruled_lines">Ruled Lines</option>
                    <option value="blank_box">Blank Box</option>
                    <option value="graph_grid">Graph/Grid</option>
                  </select>
                </Field>
                <Field label="Height">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.height || 120} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'height', event.target.value)} />
                </Field>
                <Field label="Lines">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.number_of_lines || ''} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'number_of_lines', event.target.value)} />
                </Field>
                <label className="flex items-center gap-2 text-[12px] font-semibold text-[#374151]"><input disabled={readOnly} type="checkbox" checked={selectedBlock.content_json?.show_border !== false} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'show_border', event.target.checked)} /> Border</label>
              </>
            ) : null}
            {selectedBlock.block_type === 'image' ? (
              <>
                <Field label="Image URL">
                  <Input disabled={readOnly} className="h-8 text-[12px]" value={selectedBlock.content_json?.url || ''} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'url', event.target.value)} />
                </Field>
                <Field label="Width">
                  <Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.width || 360} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'width', event.target.value)} />
                </Field>
                <Field label="Caption">
                  <Input disabled={readOnly} className="h-8 text-[12px]" value={selectedBlock.content_json?.caption || ''} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'caption', event.target.value)} />
                </Field>
                <div className="rounded-[5px] border border-[#e2e8f0] bg-[#f8fafc] p-2">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-[#111827]"><Crop className="size-3.5" /> Crop</div>
                  <label className="flex items-center gap-2 text-[12px] font-semibold text-[#374151]">
                    <input disabled={readOnly} type="checkbox" checked={Boolean(selectedBlock.content_json?.crop_enabled)} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_enabled', event.target.checked)} />
                    Enable crop frame
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field label="Crop Height">
                      <Input disabled={readOnly || !selectedBlock.content_json?.crop_enabled} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.crop_height || 220} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_height', event.target.value)} />
                    </Field>
                    <Field label="Zoom">
                      <Input disabled={readOnly || !selectedBlock.content_json?.crop_enabled} type="number" min="1" max="3" step="0.05" className="h-8 text-[12px]" value={selectedBlock.content_json?.crop_zoom || 1} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_zoom', event.target.value)} />
                    </Field>
                  </div>
                  <Field label="Horizontal Focus">
                    <input disabled={readOnly || !selectedBlock.content_json?.crop_enabled} type="range" min="0" max="100" className="h-8 w-full" value={selectedBlock.content_json?.crop_x ?? 50} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_x', event.target.value)} />
                  </Field>
                  <Field label="Vertical Focus">
                    <input disabled={readOnly || !selectedBlock.content_json?.crop_enabled} type="range" min="0" max="100" className="h-8 w-full" value={selectedBlock.content_json?.crop_y ?? 50} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'crop_y', event.target.value)} />
                  </Field>
                  <Button type="button" variant="outline" className="mt-1 h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => {
                    const id = selectedBlock.local_id || selectedBlock.id
                    updateBlockContent(id, 'crop_height', 220)
                    updateBlockContent(id, 'crop_x', 50)
                    updateBlockContent(id, 'crop_y', 50)
                    updateBlockContent(id, 'crop_zoom', 1)
                  }}>
                    Reset Crop
                  </Button>
                </div>
              </>
            ) : null}
            {selectedBlock.block_type === 'shape' ? (
              <>
                <Field label="Shape Type">
                  <select disabled={readOnly} className={selectClassName()} value={selectedBlock.content_json?.shape_type || 'rectangle'} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'shape_type', event.target.value)}>
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
                  <Input disabled={readOnly} className="h-8 text-[12px]" value={selectedBlock.content_json?.label || ''} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'label', event.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Width"><Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.width || 260} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'width', event.target.value)} /></Field>
                  <Field label="Height"><Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.height || 120} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'height', event.target.value)} /></Field>
                </div>
              </>
            ) : null}
            {selectedBlock.block_type === 'table' ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Rows"><Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.rows || 3} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'rows', event.target.value)} /></Field>
                  <Field label="Columns"><Input disabled={readOnly} type="number" className="h-8 text-[12px]" value={selectedBlock.content_json?.columns || 3} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'columns', event.target.value)} /></Field>
                </div>
                <label className="flex items-center gap-2 text-[12px] font-semibold text-[#374151]"><input disabled={readOnly} type="checkbox" checked={Boolean(selectedBlock.content_json?.header_row)} onChange={(event) => updateBlockContent(selectedBlock.local_id || selectedBlock.id, 'header_row', event.target.checked)} /> Header row</label>
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
            {selectedBlock.block_type !== 'question' ? <label className="flex items-center gap-2 text-[12px] font-semibold text-[#374151]"><input disabled={readOnly} type="checkbox" checked={selectedBlock.is_printable !== false} onChange={(event) => updateBlockPatch(selectedBlock.local_id || selectedBlock.id, { is_printable: event.target.checked })} /> Printable</label> : null}
          </div>
        ) : (
          <div className="mt-4 rounded-[5px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-3 text-[12px] font-semibold text-[#64748b]">Click a design block, question, image, table, shape, or answer space to edit its settings.</div>
        )}
      </aside>
    )
  }

  const coverYearLabel = String(paperLayout.copyright_label || '').match(/\d{4}/)?.[0] || new Date().getFullYear()

  const renderContinuationHeader = (pageNumber: number) => {
    if (paperLayout.cover_style === 'cambridge') {
      return <div className="mb-6 text-center text-[16px] font-semibold leading-6 text-[#111827]">{pageNumber}</div>
    }
    if (paperLayout.cover_style !== 'msce') return null
    return (
      <div className="mb-5 text-[15px] font-bold leading-6 text-[#111827]">
        <div className="flex flex-wrap justify-between gap-4">
          <span>STUDENT NAME __________________________________</span>
          <span>SCHOOL _____________</span>
        </div>
        <div className="mt-3 grid grid-cols-3 items-center text-[13px]">
          <span>{coverYearLabel}</span>
          <span className="text-center">Page {pageNumber} of {paperLayout.total_pages || totalPreviewPages}</span>
          <span className="text-right">{paperLayout.subject_number || ''}</span>
        </div>
      </div>
    )
  }

  const renderCoverBlocks = () => coverBlocks.length ? (
    <div className="my-3 grid gap-2">
      {coverBlocks.map(renderDesignBlock)}
    </div>
  ) : null

  const renderOriginalImportedCover = () => originalCoverMedia ? (
    <div className="-m-10 overflow-hidden bg-white print:-m-[14mm]">
      <img src={resolvePortalAssetUrl(originalCoverMedia.storage_path)} alt="Original imported assessment cover" className="block aspect-[210/297] h-auto w-full object-fill" />
    </div>
  ) : renderStandardCover()

  const renderStandardCover = () => (
    <>
      <div className="border-b-2 border-[#111827] pb-5 text-center">
        <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#374151]">{user?.schoolName || 'SmartLink Schools'}</div>
        {renderCoverBlocks()}
        {isPrintLikeMode ? (
          <h1 className="mx-auto mt-3 text-center text-[24px] font-bold tracking-normal text-[#111827] md:text-[30px]">{form.name || 'Exam paper title'}</h1>
        ) : (
          <Input
            disabled={readOnly}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Exam paper title"
            className="mx-auto mt-3 h-auto border-0 bg-transparent px-0 text-center text-[24px] font-bold tracking-normal text-[#111827] shadow-none focus-visible:ring-0 md:text-[30px]"
          />
        )}
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
        {isPrintLikeMode ? (
          <div className="min-h-20 rounded-[4px] text-[13px] leading-6 text-[#111827] whitespace-pre-wrap">{form.instructions}</div>
        ) : (
          <Textarea
            disabled={readOnly}
            value={form.instructions}
            onChange={(event) => setForm({ ...form, instructions: event.target.value })}
            placeholder="Instructions"
            className="min-h-20 resize-none rounded-[4px] border-[#d9dce3] bg-[#fbfcfe] text-[13px] leading-6 text-[#111827]"
          />
        )}
      </div>
    </>
  )

  const renderMsceCover = () => {
    const subjectName = (setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id))?.name || form.name || 'Subject'
    const registerRows = answerRegisterCells(paperLayout.answer_register_count || 13)
    return (
      <section className="flex min-h-[980px] flex-col pb-2 text-[#111827] print:min-h-0">
        <div className="flex flex-wrap justify-between gap-4 text-[16px] font-bold leading-7">
          <span>STUDENT NAME __________________________________</span>
          <span>SCHOOL _____________</span>
        </div>
        {renderCoverBlocks()}
        <div className="mt-5 text-center">
          <div className="text-[27px] font-bold tracking-normal">{paperLayout.board_name || 'SCHOOL EXAMINATIONS BOARD'}</div>
          <div className="mt-1 text-[17px] font-bold uppercase">{paperLayout.exam_series || 'MALAWI SCHOOL CERTIFICATE OF EDUCATION MOCK EXAMINATIONS'}</div>
          <div className="mt-7 text-[32px] font-bold uppercase">{subjectName}</div>
          <div className="mt-16 text-[24px] font-bold">{paperLayout.paper_label || 'PAPER I'}</div>
          <div className="text-[18px] font-bold">{paperLayout.paper_subtitle || 'Theory'}</div>
          <div className="mt-1 text-[18px]">({form.total_marks || 100} marks)</div>
        </div>
        <div className="mt-8 grid gap-2 text-[18px] font-bold leading-7 sm:grid-cols-2">
          <div>{paperLayout.exam_date || 'Exam date'}</div>
          <div className="sm:text-right">Subject Number: {paperLayout.subject_number || '-'}</div>
          <div>Time Allowed: {form.duration_minutes || '-'} minutes</div>
          <div className="sm:text-right">{paperLayout.exam_time || ''}</div>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-[minmax(0,1fr)_325px]">
          <div>
            <div className="mb-3 text-[20px] font-bold">Instructions</div>
            {isPrintLikeMode ? (
              <div className="whitespace-pre-wrap text-[18px] leading-7">{form.instructions}</div>
            ) : (
              <Textarea
                disabled={readOnly}
                value={form.instructions}
                onChange={(event) => setForm({ ...form, instructions: event.target.value })}
                placeholder="Instructions"
                className="min-h-[260px] resize-y rounded-[4px] border-[#d9dce3] bg-[#fbfcfe] text-[16px] leading-7 text-[#111827]"
              />
            )}
            {paperLayout.total_pages ? <div className="mt-4 text-[16px] font-bold">This paper contains {paperLayout.total_pages} printed pages.</div> : null}
          </div>
          <table className="w-full border-collapse text-[15px]">
            <tbody>
              {registerRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, columnIndex) => rowIndex === 0 ? (
                    <th key={columnIndex} className="border border-[#111827] bg-[#f3f4f6] p-1.5 text-left font-bold">{cell}</th>
                  ) : (
                    <td key={columnIndex} className="h-7 border border-[#111827] p-1.5">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-auto flex items-center justify-between pt-8 text-[12px] font-semibold">
          <span>{paperLayout.copyright_label || ''}</span>
          <span>{paperLayout.footer_note || 'Turn over'}</span>
        </div>
      </section>
    )
  }

  const renderCambridgeCover = () => {
    const subjectName = (setup.subjects || []).find((row: any) => String(row.id) === String(form.subject_id))?.name || form.name || 'Subject'
    const instructionItems = String(form.instructions || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean)
    const informationItems = [
      `The total mark for this paper is ${form.total_marks || '-'}.`,
      'Each correct answer will score one mark.',
      'Any rough working should be done on this question paper.',
    ]
    return (
      <section className="relative flex min-h-[980px] flex-col pb-2 text-[#050505] print:min-h-0" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div className="flex items-start justify-center gap-3 text-center">
          <div className="grid size-10 shrink-0 place-items-center border-2 border-[#111827] text-[10px] font-black leading-none">CA</div>
          <div className="text-left text-[24px] font-bold leading-[1.05]">
            <div>Cambridge Assessment</div>
            <div>International Education</div>
          </div>
        </div>
        {renderCoverBlocks()}
        <div className="mt-20 text-[30px] font-bold leading-tight">
          {paperLayout.exam_series || 'Cambridge IGCSE'}<sup className="ml-0.5 align-super text-[11px]">TM</sup>
        </div>
        <div className="mt-5 border-t border-[#111827] pt-3">
          <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-5 text-[16px]">
            <div className="grid gap-2">
              <div className="font-bold uppercase">{subjectName}</div>
              <div>{paperLayout.paper_label || 'Paper 1 Multiple Choice (Core)'}</div>
            </div>
            <div className="grid gap-2 text-right font-bold">
              <div>{paperLayout.subject_number || '0620/12'}</div>
              <div>{paperLayout.exam_date || 'February/March 2025'}</div>
              <div>{paperLayout.exam_time || `${form.duration_minutes || 45} minutes`}</div>
            </div>
          </div>
        </div>
        <div className="mt-7 grid grid-cols-[42px_minmax(0,1fr)] gap-5">
          <div className="relative mt-5 h-40" style={{ background: 'repeating-linear-gradient(90deg,#111 0 1px,#fff 1px 3px,#111 3px 5px,#fff 5px 7px)' }}>
            <div className="absolute -left-8 top-0 bg-white px-1 text-[10px] tracking-[0.22em]" style={{ writingMode: 'vertical-rl' }}>{paperLayout.header || '*5410013095*'}</div>
          </div>
          <div className="min-w-0 text-[15px] leading-6">
            {paperLayout.paper_subtitle ? <div className="mb-5">{paperLayout.paper_subtitle}</div> : null}
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
              <span>You will need:</span>
              <span>Multiple choice answer sheet<br />Soft clean eraser<br />Soft pencil (type B or HB is recommended)</span>
            </div>
            <div className="mt-4 border-t border-[#111827] pt-2">
              <div className="font-bold uppercase">Instructions</div>
              <ul className="mt-1 grid gap-1.5 pl-5">
                {instructionItems.length ? instructionItems.map((item, index) => <li key={index} className="list-disc">{item}</li>) : <li className="list-disc">Answer all questions.</li>}
              </ul>
            </div>
            <div className="mt-8">
              <div className="font-bold uppercase">Information</div>
              <ul className="mt-1 grid gap-1.5 pl-5">
                {informationItems.map((item, index) => <li key={index} className="list-disc">{item}</li>)}
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-auto border-t border-[#111827] pt-2 text-center text-[14px]">
          This document has <strong>{paperLayout.total_pages || '___'}</strong> pages. Any blank pages are indicated.
        </div>
        <div className="mt-8 flex items-end justify-between text-[12px]">
          <span>{paperLayout.footer || ''}<br />{paperLayout.copyright_label || ''}</span>
          <span className="font-bold">[{paperLayout.footer_note || 'Turn over'}]</span>
        </div>
      </section>
    )
  }

  const pagePaddingClass = paperLayout.margins === 'narrow'
    ? 'px-6 py-7'
    : paperLayout.margins === 'wide'
      ? 'px-8 py-10 sm:px-14 lg:px-20 lg:py-16'
      : 'px-6 py-8 sm:px-10 lg:px-16 lg:py-14'
  const paperPageClass = `mx-auto min-h-[1120px] w-full max-w-[850px] bg-white text-[15px] leading-7 shadow-[0_14px_45px_rgba(15,23,42,0.18)] print:min-h-0 print:max-w-none print:p-0 print:shadow-none ${pagePaddingClass}`
  const strictDocumentBlocks = useMemo(() => compactAssessmentPaperBlocks(allBlocks, questions.length > 0), [allBlocks, questions.length])
  const visibleDocumentBlocks = strictDocumentBlocks.filter((block) => editorMode !== 'print' || block.block_type === 'question' || block.is_printable !== false)
  const documentPages = paginateDocumentBlocks(visibleDocumentBlocks, paperLayout.margins, editorMode)
  const renderDocumentBlock = (block: any) => block.block_type === 'question' ? renderQuestionBlock(block) : renderDesignBlock(block)
  const totalPreviewPages = documentPages.length + 1

  const renderPageBadge = (pageNumber: number) => (
    <div className="mb-4 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8] print:hidden">
      <span>Page {pageNumber}</span>
      <span>{totalPreviewPages} pages</span>
    </div>
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#eef1f5] text-[#111827] print:h-auto print:overflow-visible print:bg-white">
      <style>{`
        @media print {
          @page { size: A4; margin: ${paperLayout.margins === 'narrow' ? '10mm' : paperLayout.margins === 'wide' ? '20mm' : '14mm'}; }
          body { background: #ffffff !important; }
          textarea, input { border: 0 !important; box-shadow: none !important; }
          .break-after-page { break-after: page; page-break-after: always; }
        }
      `}</style>
      {renderTextToolbar()}
      <header className="shrink-0 border-b border-[#d7dce4] bg-white shadow-[0_1px_8px_rgba(15,23,42,0.08)] print:hidden">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <PageBackButton fallback="/exam-builder" label="Back to exam papers" iconOnly />
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
                <select disabled={readOnly} className={`${selectClassName()} min-w-[210px]`} value={selectedTemplateValue} onChange={(event) => applyTemplate(event.target.value)}>
                  {visibleTemplateOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <div className="grid min-w-[240px] gap-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">File Actions</div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={saving || readOnly} onClick={saveDraft}><Save className="size-3.5" /> Draft</Button>
                  <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={!form.id} onClick={() => toast.info('Duplicate paper is coming soon.') }><Copy className="size-3.5" /> Duplicate</Button>
                  {form.id && String(form.status || '') === 'draft' ? <Button type="button" variant="outline" className="h-8 rounded-[5px] border-[#fecaca] text-[12px] text-[#b91c1c] hover:bg-[#fef2f2]" disabled={saving} onClick={deleteDraftPaper}><Trash2 className="size-3.5" /> Delete Draft</Button> : null}
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
                Cover Logo
                <input disabled={readOnly} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={(event) => { uploadCoverLogo(event.target.files?.[0]); event.currentTarget.value = '' }} />
              </label>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertCoverBlock('paragraph', { content_json: { text: 'Cover note or school motto' }, style_json: { align: 'center', bold: true, font_size: 15, z_index: 0, offset_x: 0, offset_y: 0 } })}>
                <Type className="size-3.5" />
                Cover Text
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertCoverBlock('shape', { content_json: { shape_type: 'rectangle', label: 'Cover frame', width: 360, height: 80 }, style_json: { align: 'center', z_index: 0, offset_x: 0, offset_y: 0 } })}>
                <Shapes className="size-3.5" />
                Cover Shape
              </Button>
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
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('paragraph', { content_json: { text: 'STUDENT NAME __________________________________   SCHOOL _____________' }, style_json: { align: 'left', z_index: 0, offset_x: 0, offset_y: 0 } })}>
                Candidate Header
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={insertAnswerRegister}>
                Tick Table
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => insertBlock('paragraph', { content_json: { text: 'Date: __________________   Signature: __________________' } })}>
                Date / Signature
              </Button>
            </div>
          ) : null}

          {activeTab === 'layout' ? (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Curriculum">
                <select className={`${selectClassName()} w-44`} value={paperLayout.curriculum_key || ''} onChange={(event) => setPaperLayout(normalizePaperLayout({ ...paperLayout, curriculum_key: event.target.value }))}>
                  <option value="">Auto ({currentCurriculumLabel})</option>
                  <option value="cambridge">Cambridge</option>
                  <option value="malawi">Malawi / MSCE</option>
                  <option value="general">General</option>
                </select>
              </Field>
              <Field label="Paper Size">
                <select className={`${selectClassName()} w-28`} value={paperLayout.paper_size} onChange={(event) => setPaperLayout({ ...paperLayout, paper_size: event.target.value })}>
                  <option value="A4">A4</option>
                </select>
              </Field>
              <Field label="Cover">
                <select className={`${selectClassName()} w-36`} value={paperLayout.cover_style || 'standard'} onChange={(event) => setPaperLayout(normalizePaperLayout({ ...paperLayout, cover_style: event.target.value }))}>
                  {paperLayout.original_cover_media_id ? <option value="original_imported">Original Imported</option> : null}
                  <option value="standard">Standard</option>
                  <option value="msce">MSCE</option>
                  <option value="cambridge">Cambridge</option>
                </select>
              </Field>
              <Field label="Margins">
                <select className={`${selectClassName()} w-32`} value={paperLayout.margins} onChange={(event) => setPaperLayout({ ...paperLayout, margins: event.target.value })}>
                  <option value="narrow">Narrow</option>
                  <option value="normal">Normal</option>
                  <option value="wide">Wide</option>
                </select>
              </Field>
              <Field label="Board">
                <Input className="h-8 w-64 text-[12px]" value={paperLayout.board_name || ''} onChange={(event) => setPaperLayout({ ...paperLayout, board_name: event.target.value })} />
              </Field>
              <Field label="Exam Series">
                <Input className="h-8 w-72 text-[12px]" value={paperLayout.exam_series || ''} onChange={(event) => setPaperLayout({ ...paperLayout, exam_series: event.target.value })} />
              </Field>
              <Field label="Subject No.">
                <Input className="h-8 w-32 text-[12px]" value={paperLayout.subject_number || ''} onChange={(event) => setPaperLayout({ ...paperLayout, subject_number: event.target.value })} />
              </Field>
              <Field label="Exam Date">
                <Input className="h-8 w-40 text-[12px]" value={paperLayout.exam_date || ''} onChange={(event) => setPaperLayout({ ...paperLayout, exam_date: event.target.value })} />
              </Field>
              <Field label="Exam Time">
                <Input className="h-8 w-40 text-[12px]" value={paperLayout.exam_time || ''} onChange={(event) => setPaperLayout({ ...paperLayout, exam_time: event.target.value })} />
              </Field>
              <Field label="Paper">
                <Input className="h-8 w-28 text-[12px]" value={paperLayout.paper_label || ''} onChange={(event) => setPaperLayout({ ...paperLayout, paper_label: event.target.value })} />
              </Field>
              <Field label="Paper Type">
                <Input className="h-8 w-32 text-[12px]" value={paperLayout.paper_subtitle || ''} onChange={(event) => setPaperLayout({ ...paperLayout, paper_subtitle: event.target.value })} />
              </Field>
              <Field label="Pages">
                <Input type="number" className="h-8 w-24 text-[12px]" value={paperLayout.total_pages || ''} onChange={(event) => setPaperLayout({ ...paperLayout, total_pages: event.target.value })} />
              </Field>
              <Field label="Tick Rows">
                <Input type="number" className="h-8 w-24 text-[12px]" value={paperLayout.answer_register_count || 13} onChange={(event) => setPaperLayout({ ...paperLayout, answer_register_count: event.target.value })} />
              </Field>
              <Field label="Copyright">
                <Input className="h-8 w-36 text-[12px]" value={paperLayout.copyright_label || ''} onChange={(event) => setPaperLayout({ ...paperLayout, copyright_label: event.target.value })} placeholder="© 2026" />
              </Field>
              <Field label="Cover Footer">
                <Input className="h-8 w-36 text-[12px]" value={paperLayout.footer_note || ''} onChange={(event) => setPaperLayout({ ...paperLayout, footer_note: event.target.value })} placeholder="Turn over" />
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
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate(`/assessments/templates${form.id ? `?assessment_id=${form.id}` : ''}`)}>
                Change Cover Template
              </Button>
              <Button type="button" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={saveCoverTemplate}>
                Save Current Cover as Template
              </Button>
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
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestionWithAnswerSpace({ question_type: 'structured', marks: '5' }, { answer_space_type: 'ruled_lines', number_of_lines: 4, height: 132 })}>
                Structured
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestionWithAnswerSpace({ question_type: 'structured', marks: '5', question_text: 'State and explain your answer.' }, { answer_space_type: 'ruled_lines', number_of_lines: 4, height: 132 })}>
                Structured + Lines
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion({ question_type: 'essay', marks: '10' })}>
                Essay
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestionWithAnswerSpace({ question_type: 'essay', marks: '10', question_text: 'Describe the procedure.' }, { answer_space_type: 'ruled_lines', number_of_lines: 10, height: 300 })}>
                Essay + Page
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion({ question_type: 'calculation', marks: '4' })}>
                Calculation
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestionWithAnswerSpace({ question_type: 'calculation', marks: '4', question_text: 'Calculate and show your working.' }, { answer_space_type: 'blank_box', height: 150, number_of_lines: 0 })}>
                Working Space
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => {
                appendQuestionWithAnswerSpace({ question_type: 'structured', question_text: 'Study the diagram and answer the questions that follow.', marks: '5' }, { answer_space_type: 'ruled_lines', number_of_lines: 4, height: 132 })
                insertBlock('shape', { content_json: { shape_type: 'diagram_placeholder', label: 'Diagram Placeholder', width: 360, height: 180 } })
              }}>
                Diagram Question
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => {
                insertBlock('table', { content_json: { rows: 4, columns: 4, header_row: true, cells: [['Item', 'Yield', 'Price', 'Cost'], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']] } })
                appendQuestionWithAnswerSpace({ question_type: 'calculation', question_text: 'Use the table to prepare a complete budget.', marks: '5' }, { answer_space_type: 'blank_box', height: 180, number_of_lines: 0 })
              }}>
                Budget Table
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
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('word', 'student')}>
                <FileText className="size-3.5" />
                Student Word
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('word', 'marking')}>
                <ClipboardCheck className="size-3.5" />
                Scheme Word
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('html', 'student')}>
                <Download className="size-3.5" />
                HTML
              </Button>
              <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => exportPaper('json')}>
                <FileJson className="size-3.5" />
                JSON Backup
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
          <SmartLinkLoadingState className="mx-auto w-full max-w-[850px] print:hidden" label="Loading paper" detail="Preparing assessment sections and layout." />
        ) : null}

        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 xl:flex-row xl:items-start print:block print:max-w-none">
          <aside className="w-full shrink-0 overflow-auto rounded-[6px] border border-[#d9dce3] bg-white p-3 shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:w-[250px] print:hidden">
            <div className="text-[13px] font-bold text-[#111827]">Outline</div>
            <div className="mt-3 grid gap-1.5">
              <button type="button" className="w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] font-semibold leading-4 text-[#4b5563] hover:bg-[#f8fafc]" onClick={() => setSelectedBlockId('cover')}>Cover Page</button>
              {coverBlocks.map((block: any, index: number) => (
                <button
                  key={`cover-outline-${block.local_id || block.id}-${index}`}
                  type="button"
                  className={`w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] font-semibold leading-4 ${String(selectedBlockId) === blockKey(block) ? 'bg-[#111827] text-white' : 'text-[#4b5563] hover:bg-[#f8fafc]'}`}
                  onClick={() => setSelectedBlockId(blockKey(block))}
                >
                  Cover · {blockTitle(block)}
                </button>
              ))}
              <button type="button" className="w-full rounded-[4px] px-2 py-1.5 text-left text-[12px] font-semibold leading-4 text-[#4b5563] hover:bg-[#f8fafc]" onClick={() => setSelectedBlockId('instructions')}>Instructions</button>
              {allBlocks.map((block: any, index: number) => (
                <div
                  key={`${block.local_id || block.id}-${index}`}
                  draggable={!readOnly}
                  className={`group grid grid-cols-[24px_minmax(0,1fr)_40px] items-start gap-1 rounded-[4px] px-1.5 py-1 text-[12px] font-semibold ${String(selectedBlockId) === String(block.local_id || block.id) ? 'bg-[#111827] text-white' : outlineDragId === blockKey(block) ? 'bg-[#e0ecff] text-[#1d4ed8]' : 'text-[#4b5563] hover:bg-[#f8fafc]'}`}
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
                  <button type="button" className="min-w-0 whitespace-normal break-words py-0.5 text-left leading-4" onClick={() => setSelectedBlockId(blockKey(block))}>
                    {blockTitle(block)}
                  </button>
                  <div className="flex shrink-0 items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
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
                {layeredCoverBlocks.map((block: any, index: number) => (
                  <button
                    key={`cover-layer-${block.local_id || block.id}-${index}`}
                    type="button"
                    className={`flex items-start justify-between gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12px] font-semibold ${String(selectedBlockId) === blockKey(block) ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'text-[#4b5563] hover:bg-[#f8fafc]'}`}
                    onClick={() => setSelectedBlockId(blockKey(block))}
                  >
                    <span className="min-w-0 whitespace-normal break-words leading-4">Cover · {blockTitle(block)}</span>
                    <span className="shrink-0 rounded-[3px] bg-[#e5e7eb] px-1.5 py-0.5 text-[10px] text-[#374151]">{numericStyle(block.style_json?.z_index, 0)}</span>
                  </button>
                ))}
                {layeredBlocks.map((block: any, index: number) => (
                  <button
                    key={`layer-${block.local_id || block.id}-${index}`}
                    type="button"
                    className={`flex items-start justify-between gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12px] font-semibold ${String(selectedBlockId) === blockKey(block) ? 'bg-[#eff6ff] text-[#1d4ed8]' : 'text-[#4b5563] hover:bg-[#f8fafc]'}`}
                    onClick={() => setSelectedBlockId(blockKey(block))}
                  >
                    <span className="min-w-0 whitespace-normal break-words leading-4">{blockTitle(block)}</span>
                    <span className="shrink-0 rounded-[3px] bg-[#e5e7eb] px-1.5 py-0.5 text-[10px] text-[#374151]">{numericStyle(block.style_json?.z_index, 0)}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

        <div className="mx-auto grid w-full max-w-[850px] gap-6 print:block print:max-w-none">
          <article className={`${paperPageClass} break-after-page`}>
            {form.return_reason ? (
              <div className="mb-6 rounded-[5px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-semibold text-[#9a3412] print:hidden">{form.return_reason}</div>
            ) : null}
            {renderPageBadge(1)}
            {paperLayout.cover_style === 'original_imported' ? renderOriginalImportedCover() : paperLayout.cover_style === 'msce' ? renderMsceCover() : paperLayout.cover_style === 'cambridge' ? renderCambridgeCover() : renderStandardCover()}
          </article>

          {documentPages.map((pageBlocks, pageIndex) => (
            <article key={`paper-page-${pageIndex}`} className={`${paperPageClass} ${pageIndex < documentPages.length - 1 ? 'break-after-page' : ''}`}>
              {renderPageBadge(pageIndex + 2)}
              {renderContinuationHeader(pageIndex + 2)}
              <div className="grid gap-7">
                {pageBlocks.length
                  ? pageBlocks.map(renderDocumentBlock)
                  : (
                    <div className="rounded-[6px] border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-12 text-center print:hidden">
                      <div className="text-[13px] font-semibold text-[#64748b]">No questions yet.</div>
                      <Button type="button" className="mt-4 h-8 rounded-[5px] text-[12px]" disabled={readOnly} onClick={() => appendQuestion()}>
                        <Plus className="size-3.5" />
                        Add Question
                      </Button>
                    </div>
                  )}
                {pageIndex === documentPages.length - 1 && questions.length ? <div className="pt-2 text-center text-[12px] font-bold text-[#111827]">End of question paper</div> : null}
              </div>
            </article>
          ))}
        </div>
        {renderInspector()}
        </div>
      </main>
    </div>
  )
}
