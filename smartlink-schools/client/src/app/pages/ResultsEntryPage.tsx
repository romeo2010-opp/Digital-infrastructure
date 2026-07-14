import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, Eye, PencilLine, Printer, RotateCcw, Search, Send } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { PageBackButton } from '../components/PageBackButton'
import { AcademicMarkSheetPanel } from '../components/AcademicMarkSheetPanel'
import { AssessmentOperationalIntelligence } from '../components/AssessmentOperationalIntelligence'
import { usePortal } from '../lib/portalContext'

const selectClassName = 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'

function Field({ label, children }: { label: string; children: any }) {
  return <label className={labelClass}>{label}{children}</label>
}

function statusLabel(value: any) {
  return String(value || 'draft').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function hasScore(value: any) {
  return value !== '' && value !== null && value !== undefined
}

function gradeForPercentage(value: any) {
  const percentage = Number(value)
  if (!Number.isFinite(percentage)) return ''
  if (percentage >= 80) return 'A'
  if (percentage >= 70) return 'B'
  if (percentage >= 60) return 'C'
  if (percentage >= 50) return 'D'
  return 'E'
}

function aggregatePointForPercentage(value: any) {
  const percentage = Number(value)
  if (!Number.isFinite(percentage)) return ''
  if (percentage >= 80) return 1
  if (percentage >= 70) return 2
  if (percentage >= 60) return 3
  if (percentage >= 55) return 4
  if (percentage >= 50) return 5
  if (percentage >= 45) return 6
  if (percentage >= 40) return 7
  if (percentage >= 34) return 8
  return 9
}

function percentageForScore(score: any, totalMarks: any) {
  const numericScore = validScoreValue(score, totalMarks)
  const numericTotal = Number(totalMarks || 0)
  if (numericScore === null || !Number.isFinite(numericTotal) || numericTotal <= 0) return null
  return Number(((numericScore / numericTotal) * 100).toFixed(1))
}

function validScoreValue(score: any, totalMarks: any) {
  if (!hasScore(score)) return null
  const numericScore = Number(score)
  const numericTotal = Number(totalMarks || 0)
  if (!Number.isFinite(numericScore) || !Number.isFinite(numericTotal) || numericTotal <= 0) return null
  if (numericScore < 0 || numericScore > numericTotal) return null
  return numericScore
}

function StatusPill({ value }: { value: any }) {
  const status = String(value || 'not_started').toLowerCase()
  const tone = ['approved', 'results_approved', 'locked'].includes(status)
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
    : status === 'absent'
      ? 'border-[#cbd5e1] bg-[#f8fafc] text-[#475569]'
    : ['submitted', 'results_submitted', 'marking'].includes(status)
      ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
      : ['returned', 'draft'].includes(status)
        ? 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
        : 'border-[#e5e7eb] bg-[#f9fafb] text-[#4b5563]'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{statusLabel(status)}</span>
}

function assessmentBatch(row: any) {
  return row?.batch || null
}

function assessmentHasSavedResults(row: any) {
  const batch = assessmentBatch(row)
  return Boolean(batch?.id || Number(batch?.completed_marks || batch?.saved_marks || 0) > 0)
}

function assessmentSubmittedLike(row: any) {
  const batchStatus = String(assessmentBatch(row)?.status || '').toLowerCase()
  const assessmentStatus = String(row?.status || '').toLowerCase()
  return ['submitted', 'approved', 'locked'].includes(batchStatus) || ['results_submitted', 'results_approved', 'locked'].includes(assessmentStatus)
}

function assessmentActionLabel(row: any) {
  const batchStatus = String(assessmentBatch(row)?.status || '').toLowerCase()
  if (assessmentSubmittedLike(row)) return 'View'
  if (batchStatus === 'returned') return 'Correct'
  if (assessmentHasSavedResults(row)) return 'Continue'
  return 'Enter'
}

function latestAssessmentTime(row: any) {
  const batch = assessmentBatch(row) || {}
  const raw = batch.updated_at || batch.submitted_at || batch.approved_at || row.updated_at || row.created_at
  const parsed = raw ? Date.parse(raw) : NaN
  return Number.isFinite(parsed) ? parsed : Number(row.id || 0)
}

function studentName(row: any) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || '-'
}

function isAbsentRow(row: any) {
  return Boolean(row?.absent || row?.withdrawal_status?.withdrawn) || String(row?.status || '').toLowerCase() === 'absent'
}

function surnameFirstName(row: any) {
  return [row.last_name, row.first_name].filter(Boolean).join(' ') || studentName(row)
}

function subjectCode(value: any) {
  const words = String(value || 'SUB')
    .replace(/[^a-z0-9\s/]/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return 'SUB'
  if (words.length > 1) return words.map((word) => word[0]).join('/').toUpperCase().slice(0, 5)
  return words[0].slice(0, 3).toUpperCase()
}

function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function printableRows(rows: any[], totalMarks: any) {
  const computed = rows.map((row) => {
    const absent = isAbsentRow(row)
    const score = validScoreValue(row.score, totalMarks)
    const percentage = score === null ? null : percentageForScore(score, totalMarks)
    return {
      row,
      absent,
      score,
      percentage,
      grade: absent ? 'Absent' : percentage === null ? '' : gradeForPercentage(percentage),
      aggregate: percentage === null ? '' : aggregatePointForPercentage(percentage),
      remark: absent ? 'Absent' : percentage === null ? '' : Number(percentage) >= 50 ? 'PASS' : 'FAIL',
    }
  })
  const ranked = [...computed].sort((a, b) => {
    const aScore = a.percentage === null ? -1 : Number(a.percentage)
    const bScore = b.percentage === null ? -1 : Number(b.percentage)
    return bScore - aScore || surnameFirstName(a.row).localeCompare(surnameFirstName(b.row))
  })
  let previousScore: number | null = null
  let previousPosition = 0
  ranked.forEach((entry, index) => {
    if (entry.percentage === null) {
      ;(entry as any).position = ''
      return
    }
    const rounded = Math.round(Number(entry.percentage))
    if (previousScore === rounded) {
      ;(entry as any).position = previousPosition
    } else {
      previousScore = rounded
      previousPosition = index + 1
      ;(entry as any).position = previousPosition
    }
  })
  return ranked
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'marksheet'
}

function buildMarksheetHtml({
  logoSrc,
  schoolName,
  rows,
  totalMarks,
  subjectName,
  className,
  paperName,
  termName,
  examSessionName,
}: {
  logoSrc: string
  schoolName: string
  rows: any[]
  totalMarks: number
  subjectName: string
  className: string
  paperName: string
  termName: string
  examSessionName: string
}) {
  const code = subjectCode(subjectName)
  const ranked = printableRows(rows, totalMarks)
  const totalTookExam = ranked.filter((entry) => entry.score !== null).length
  const totalAbsent = ranked.filter((entry) => entry.absent).length
  const passed = ranked.filter((entry) => entry.remark === 'PASS').length
  const failed = ranked.filter((entry) => entry.remark === 'FAIL').length
  const passRate = totalTookExam ? Math.round((passed / totalTookExam) * 100) : 0
  const title = `${className} ${paperName} Results`
  const subtitle = [examSessionName, termName].filter(Boolean).join(' - ')
  const bodyRows = ranked.map((entry, index) => `
    <tr>
      <td class="center">${index + 1}</td>
      <td class="center">${escapeHtml(entry.row.student_id || entry.row.admission_no || '')}</td>
      <td>${escapeHtml(surnameFirstName(entry.row).toUpperCase())}</td>
      <td class="center">${entry.absent ? 'Absent' : entry.score === null ? '' : escapeHtml(entry.score)}</td>
      <td class="center strong">${entry.absent ? 'Absent' : entry.score === null ? '' : escapeHtml(entry.score)}</td>
      <td class="center strong">${entry.percentage === null ? '' : Math.round(Number(entry.percentage))}</td>
      <td class="center strong">${escapeHtml(entry.aggregate)}</td>
      <td class="center strong">${escapeHtml((entry as any).position)}</td>
      <td class="strong">${escapeHtml(entry.remark)}</td>
    </tr>
  `).join('')

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
    .sheet { width: 100%; min-height: 100vh; padding: 18px 22px 14px; }
    .heading { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 26px; border: 3px solid #000; border-radius: 18px; padding: 18px 24px; margin-bottom: 32px; }
    .heading img { width: 82px; height: 82px; object-fit: contain; }
    h1 { margin: 0 0 22px; font-size: 31px; line-height: 1; letter-spacing: 0.02em; font-weight: 900; }
    h2 { margin: 0; font-size: 28px; line-height: 1.05; letter-spacing: 0.02em; font-weight: 900; }
    .meta { margin-top: 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.05; }
    th, td { border: 1px solid #000; padding: 5px 5px; vertical-align: middle; }
    th { background: #cfcfcf; text-align: center; font-size: 15px; font-weight: 900; }
    tbody tr:nth-child(even) td { background: #dedede; }
    .center { text-align: center; }
    .strong { font-weight: 900; }
    .name { width: 290px; text-align: left; }
    .footer { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-top: 16px; border-top: 1px solid #000; padding-top: 7px; font-size: 12px; font-style: italic; font-weight: 700; }
    .footer span:nth-child(2) { font-size: 13px; }
    .summary { margin-top: 26px; width: 360px; font-size: 13px; font-weight: 800; }
    .summary div { display: grid; grid-template-columns: 1fr 80px; gap: 24px; padding: 3px 0; }
  </style>
</head>
<body>
  <main class="sheet">
    <section class="heading">
      ${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(schoolName)} logo" />` : `<div style="display:grid;width:82px;height:82px;place-items:center;border:2px solid #000;border-radius:50%;font-size:28px;font-weight:900">${escapeHtml(schoolName.slice(0, 2).toUpperCase())}</div>`}
      <div>
        <h1>${escapeHtml(schoolName.toUpperCase())}</h1>
        <h2>${escapeHtml(title.toUpperCase())}</h2>
        ${subtitle ? `<div class="meta">${escapeHtml(subtitle)}</div>` : ''}
      </div>
    </section>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>ID</th>
          <th class="name">NAME (SURNAME FIRST)</th>
          <th>${escapeHtml(code)}</th>
          <th>TOTAL</th>
          <th>AVG</th>
          <th>AGGR</th>
          <th>POS</th>
          <th>REMARK</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <section class="summary">
      <div><span>TOTAL TOOK EXAM:</span><span>${totalTookExam}</span></div>
      <div><span>TOTAL ABSENT:</span><span>${totalAbsent}</span></div>
      <div><span>TOTAL PASSED:</span><span>${passed}</span></div>
      <div><span>TOTAL FAILED:</span><span>${failed}</span></div>
      <div><span>PASS RATE:</span><span>${passRate}%</span></div>
    </section>
    <footer class="footer">
      <span>${escapeHtml(title)}</span>
      <span>Page 1 of 1</span>
      <span></span>
    </footer>
  </main>
</body>
</html>`
}

function MarksheetPrintPreview({
  logoSrc,
  schoolName,
  rows,
  totalMarks,
  subjectName,
  className,
  paperName,
  termName,
  examSessionName,
}: {
  logoSrc: string
  schoolName: string
  rows: any[]
  totalMarks: number
  subjectName: string
  className: string
  paperName: string
  termName: string
  examSessionName: string
}) {
  const code = subjectCode(subjectName)
  const ranked = printableRows(rows, totalMarks)
  const title = `${className} ${paperName} Results`
  const subtitle = [examSessionName, termName].filter(Boolean).join(' - ')
  const totalTookExam = ranked.filter((entry) => entry.score !== null).length
  const totalAbsent = ranked.filter((entry) => entry.absent).length
  const passed = ranked.filter((entry) => entry.remark === 'PASS').length
  const failed = ranked.filter((entry) => entry.remark === 'FAIL').length
  const passRate = totalTookExam ? Math.round((passed / totalTookExam) * 100) : 0

  return (
    <section id="school-marksheet-print-area" className="hidden rounded-[8px] border border-[#d1d5db] bg-white p-4 shadow-[var(--mera-shadow-card)] print:block print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <style>{`
        #school-marksheet-print-area .school-report-table { width: 100%; border-collapse: collapse; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.05; }
        #school-marksheet-print-area .school-report-table th,
        #school-marksheet-print-area .school-report-table td { border: 1px solid #000; padding: 5px 5px; vertical-align: middle; }
        #school-marksheet-print-area .school-report-table th { background: #cfcfcf; text-align: center; font-weight: 900; font-size: 14px; }
        #school-marksheet-print-area .school-report-table tbody tr:nth-child(even) td { background: #dedede; }
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body * { visibility: hidden !important; }
          #school-marksheet-print-area, #school-marksheet-print-area * { visibility: visible !important; }
          #school-marksheet-print-area { position: absolute; inset: 0 auto auto 0; width: 100%; background: #fff; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="mx-auto max-w-[1180px] bg-white text-[#000] print:max-w-none">
        <header className="mb-7 grid grid-cols-[80px_1fr] items-center gap-6 rounded-[18px] border-[3px] border-[#000] px-6 py-5">
          {logoSrc ? <img src={logoSrc} alt={`${schoolName} logo`} className="size-20 object-contain" /> : <div className="grid size-20 place-items-center rounded-full border-2 border-black text-[26px] font-black">{schoolName.slice(0, 2).toUpperCase()}</div>}
          <div>
            <h2 className="m-0 text-[30px] font-black uppercase leading-none tracking-[0.02em] text-[#000]">{schoolName}</h2>
            <h3 className="m-0 mt-5 text-[26px] font-black uppercase leading-none tracking-[0.02em] text-[#000]">{title}</h3>
            {subtitle ? <p className="m-0 mt-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#111]">{subtitle}</p> : null}
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="school-report-table min-w-[880px]">
            <thead>
              <tr>
                <th className="w-10"></th>
                <th>ID</th>
                <th className="min-w-[280px]">NAME (SURNAME FIRST)</th>
                <th>{code}</th>
                <th>TOTAL</th>
                <th>AVG</th>
                <th>AGGR</th>
                <th>POS</th>
                <th>REMARK</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length ? ranked.map((entry, index) => (
                <tr key={entry.row.id || index}>
                  <td className="text-center">{index + 1}</td>
                  <td className="text-center">{entry.row.student_id || entry.row.admission_no || ''}</td>
                  <td>{surnameFirstName(entry.row).toUpperCase()}</td>
                  <td className="text-center">{entry.absent ? 'Absent' : entry.score ?? ''}</td>
                  <td className="text-center font-black">{entry.absent ? 'Absent' : entry.score ?? ''}</td>
                  <td className="text-center font-black">{entry.percentage === null ? '' : Math.round(Number(entry.percentage))}</td>
                  <td className="text-center font-black">{entry.aggregate}</td>
                  <td className="text-center font-black">{(entry as any).position}</td>
                  <td className="font-black">{entry.remark}</td>
                </tr>
              )) : (
                <tr><td colSpan={9} className="py-8 text-center">No marks entered yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <section className="mt-6 grid w-full max-w-[360px] gap-1 text-[12px] font-black uppercase">
          <div className="grid grid-cols-[1fr_90px]"><span>Total took exam:</span><span>{totalTookExam}</span></div>
          <div className="grid grid-cols-[1fr_90px]"><span>Total absent:</span><span>{totalAbsent}</span></div>
          <div className="grid grid-cols-[1fr_90px]"><span>Total passed:</span><span>{passed}</span></div>
          <div className="grid grid-cols-[1fr_90px]"><span>Total failed:</span><span>{failed}</span></div>
          <div className="grid grid-cols-[1fr_90px]"><span>Pass rate:</span><span>{passRate}%</span></div>
        </section>

        <footer className="mt-4 grid grid-cols-[1fr_auto_1fr] border-t border-[#000] pt-2 text-[12px] font-bold italic text-[#333]">
          <span>{title}</span>
          <span>Page 1 of 1</span>
          <span />
        </footer>
      </div>
    </section>
  )
}

export function ResultsEntryPage() {
  const { token, api, user } = usePortal()
  const navigate = useNavigate()
  const { assessmentId: routeAssessmentId } = useParams()
  const isSheetPage = Boolean(routeAssessmentId)
  const [setup, setSetup] = useState<any>({})
  const [filters, setFilters] = useState<any>({ exam_session_id: '', class_id: '', subject_id: '' })
  const [assessmentQuery, setAssessmentQuery] = useState('')
  const [selectedAssessmentId, setSelectedAssessmentId] = useState(routeAssessmentId ? String(routeAssessmentId) : '')
  const [sheet, setSheet] = useState<any>(null)
  const [rows, setRows] = useState<any[]>([])
  const [academicEvidenceState, setAcademicEvidenceState] = useState<any>({ loading: true, overall_ready: false, completion_percentage: 0 })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [returnReason, setReturnReason] = useState('')

  const role = String(user?.role || '').toLowerCase()
  const canApprove = ['school_owner', 'headteacher'].includes(role)
  const session = setup?.session || {}
  const activeYearId = String(session.academic_year_id || '')
  const activeTermId = String(session.term_id || '')
  const activeAcademicLabel = [session.academic_year?.name, session.term?.name].filter(Boolean).join(' - ') || 'Active academic session'

  const batchByAssessmentId = useMemo(() => {
    const map = new Map<string, any>()
    ;(setup.batches || []).forEach((batch: any) => {
      const key = String(batch.assessment_id || '')
      if (!key) return
      const current = map.get(key)
      if (!current || latestAssessmentTime({ id: key, batch }) >= latestAssessmentTime({ id: key, batch: current })) {
        map.set(key, batch)
      }
    })
    return map
  }, [setup.batches])

  const assessmentRows = useMemo(() => {
    return (setup.assessments || [])
      .map((row: any) => ({
        ...row,
        batch: batchByAssessmentId.get(String(row.id)) || null,
      }))
      .filter((row: any) => {
        if (activeYearId && String(row.academic_year_id || '') !== activeYearId) return false
        if (activeTermId && String(row.term_id || '') !== activeTermId) return false
        return true
      })
      .sort((a: any, b: any) => {
        const activeDiff = Number(String(b.term_id || '') === activeTermId) - Number(String(a.term_id || '') === activeTermId)
        if (activeDiff) return activeDiff
        const savedDiff = Number(assessmentHasSavedResults(b)) - Number(assessmentHasSavedResults(a))
        if (savedDiff) return savedDiff
        const timeDiff = latestAssessmentTime(b) - latestAssessmentTime(a)
        if (timeDiff) return timeDiff
        return Number(b.id || 0) - Number(a.id || 0)
      })
  }, [activeTermId, activeYearId, batchByAssessmentId, setup.assessments])

  const filteredAssessments = useMemo(() => {
    const query = assessmentQuery.trim().toLowerCase()
    return assessmentRows.filter((row: any) => {
      if (filters.exam_session_id && String(row.exam_session_id || '') !== String(filters.exam_session_id)) return false
      if (filters.class_id && String(row.class_id || '') !== String(filters.class_id)) return false
      if (filters.subject_id && String(row.subject_id || '') !== String(filters.subject_id)) return false
      if (!query) return true
      const searchable = [
        row.name,
        row.assessment_name,
        row.class_name,
        row.subject_name,
        row.term_label,
        row.term_name,
        row.exam_session_name,
        row.status,
        assessmentBatch(row)?.status,
      ].join(' ').toLowerCase()
      return searchable.includes(query)
    })
  }, [assessmentQuery, assessmentRows, filters])

  const selectedAssessment = useMemo(
    () => assessmentRows.find((row: any) => String(row.id) === selectedAssessmentId) || sheet?.assessment || null,
    [assessmentRows, selectedAssessmentId, sheet?.assessment],
  )
  const batch = sheet?.batch || selectedAssessment?.batch || null
  const totalMarks = Number(selectedAssessment?.total_marks || sheet?.assessment?.total_marks || 0)
  const sheetAssessment = selectedAssessment || sheet?.assessment || {}
  const subjectName = sheetAssessment?.subject_name || sheet?.assessment?.subject_name || '-'
  const className = sheetAssessment?.class_name || sheet?.assessment?.class_name || '-'
  const paperName = sheetAssessment?.name || sheetAssessment?.assessment_name || sheet?.assessment?.name || '-'
  const examSessionName = sheetAssessment?.exam_session_name || sheet?.assessment?.exam_session_name || ''
  const termName = sheetAssessment?.term_label || sheetAssessment?.term_name || sheet?.assessment?.term_name || '-'
  const schoolName = user?.schoolName || user?.school_name || sheet?.assessment?.school_name || 'SmartLink School'
  const sheetReadOnly = assessmentSubmittedLike({ ...sheetAssessment, batch }) || ['locked', 'archived'].includes(String(sheetAssessment?.status || '').toLowerCase())
  const overallReady = Boolean(academicEvidenceState.overall_ready)
  const handleAcademicStateChange = useCallback((next: any) => {
    setAcademicEvidenceState((current: any) => current.overall_ready === next.overall_ready && current.loading === next.loading && current.completion_percentage === next.completion_percentage ? current : next)
  }, [])

  const absentRows = rows.filter(isAbsentRow)
  const validScoredRows = rows.filter((row) => !isAbsentRow(row) && validScoreValue(row.score, totalMarks) !== null)
  const completed = rows.filter((row) => !isAbsentRow(row) && hasScore(row.score)).length
  const completedOrAbsent = completed + absentRows.length
  const percentages = validScoredRows
    .map((row) => percentageForScore(row.score, totalMarks))
    .filter((value): value is number => value !== null)
  const totalTookExam = percentages.length
  const classAverage = percentages.length ? Number((percentages.reduce((sum, value) => sum + value, 0) / percentages.length).toFixed(0)) : 0
  const passCount = percentages.filter((value) => value >= 50).length
  const passRate = totalTookExam ? Math.round((passCount / totalTookExam) * 100) : 0
  const atRiskCount = percentages.filter((value) => value < 50).length
  const submittedCount = assessmentRows.filter((row: any) => assessmentSubmittedLike(row)).length
  const openEntryCount = assessmentRows.filter((row: any) => !assessmentSubmittedLike(row)).length

  const kpiItems = [
    {
      label: 'Assessments',
      value: assessmentRows.length,
      helper: role === 'teacher' ? 'assigned to you' : 'role visible',
      delta: activeAcademicLabel,
    },
    {
      label: 'Submitted',
      value: submittedCount,
      helper: 'viewable results',
      delta: 'latest first',
      tone: submittedCount ? ('good' as const) : ('neutral' as const),
    },
    {
      label: 'Open Entry',
      value: openEntryCount,
      helper: 'enter or continue',
      delta: openEntryCount ? 'needs marks' : 'clear',
      tone: openEntryCount ? ('warn' as const) : ('good' as const),
    },
    {
      label: 'Selected Sheet',
      value: selectedAssessmentId ? `${completedOrAbsent}/${rows.length}` : 'None',
      helper: selectedAssessmentId ? paperName : 'choose an assessment',
      delta: selectedAssessmentId ? (sheetReadOnly ? 'view only' : 'editable') : 'not opened',
    },
  ]

  const sheetKpis = [
    { label: 'Class average', value: `${classAverage}%`, helper: `${totalTookExam}/${rows.length} took exam`, delta: absentRows.length ? `${absentRows.length} absent` : 'updates as you type' },
    { label: 'Pass rate', value: `${passRate}%`, helper: `${passCount}/${totalTookExam} passing students`, delta: 'passing / took exam', tone: passRate >= 70 ? ('good' as const) : passRate >= 50 ? ('warn' as const) : ('bad' as const) },
    { label: 'Students at risk', value: atRiskCount, helper: 'valid scores below pass mark', delta: 'review before submit', tone: atRiskCount ? ('warn' as const) : ('good' as const) },
    { label: 'Absent', value: absentRows.length, helper: 'withdrawal overlap', delta: 'not counted as zero', tone: absentRows.length ? ('warn' as const) : ('good' as const) },
  ]

  const refreshSetup = async () => {
    if (!token) return
    const payload = await api.listResultsSetup(token)
    setSetup(payload)
  }

  const loadSheet = async (assessmentId = selectedAssessmentId) => {
    if (!token || !assessmentId) return null
    const payload = await api.getResultSheet(token, { assessment_id: assessmentId })
    setSheet(payload)
    setRows(payload?.rows || [])
    return payload
  }

  const openAssessmentSheet = (row: any) => {
    const assessmentId = String(row?.id || '')
    if (!assessmentId) return
    navigate(`/results/${assessmentId}`)
  }

  const downloadMarksheet = () => {
    if (!rows.length) {
      toast.error('Load a marksheet before downloading.')
      return
    }
    const html = buildMarksheetHtml({
      logoSrc: '',
      schoolName,
      rows,
      totalMarks,
      subjectName,
      className,
      paperName,
      termName,
      examSessionName,
    })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `${safeFileName(`${schoolName}-${className}-${paperName}-marksheet`)}.html`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(href)
    toast.success('Marksheet downloaded.')
  }

  const printMarksheet = () => {
    if (!rows.length) {
      toast.error('Load a marksheet before printing.')
      return
    }
    window.print()
  }

  useEffect(() => {
    refreshSetup().catch((err: any) => setError(err?.message || 'Unable to load results setup.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (!routeAssessmentId) {
      setSelectedAssessmentId('')
      setSheet(null)
      setRows([])
      return
    }
    setSelectedAssessmentId(String(routeAssessmentId))
    setAcademicEvidenceState({ loading: true, overall_ready: false, completion_percentage: 0 })
    if (!token) return
    setError('')
    loadSheet(String(routeAssessmentId))
      .catch((err: any) => {
        setSheet(null)
        setRows([])
        const nextError = err?.message || 'Unable to load result sheet.'
        setError(nextError)
        toast.error(nextError)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeAssessmentId, token])

  useEffect(() => {
    if (isSheetPage) return
    if (!selectedAssessmentId) return
    if (!assessmentRows.length) return
    if (!assessmentRows.some((row: any) => String(row.id) === selectedAssessmentId)) {
      setSelectedAssessmentId('')
      setSheet(null)
      setRows([])
    }
  }, [assessmentRows, isSheetPage, selectedAssessmentId])

  const submitFinal = async () => {
    if (!token || !selectedAssessmentId) return
    if (!window.confirm('Submit final results? You may not be able to edit after submission.')) return
    setError('')
    setMessage('')
    try {
      await api.submitResults(token, { assessment_id: selectedAssessmentId, entries: rows.map((row) => ({ student_id: row.id, enrollment_id: row.enrollment_id, score: isAbsentRow(row) ? null : row.score, comment: row.comment, status: row.status })) })
      setMessage('Results submitted for approval.')
      toast.success('Results submitted for approval.')
      await loadSheet(selectedAssessmentId)
      await refreshSetup()
    } catch (err: any) {
      const nextError = err?.message || 'Unable to submit final results.'
      setError(nextError)
      toast.error(nextError)
    }
  }

  const approveBatch = async (row: any) => {
    if (!token) return
    setError('')
    setMessage('')
    try {
      await api.approveResultBatch(token, row.id)
      setMessage('Result batch approved.')
      toast.success('Result batch approved.')
      await refreshSetup()
      if (selectedAssessmentId) await loadSheet(selectedAssessmentId)
    } catch (err: any) {
      const nextError = err?.message || 'Unable to approve result batch.'
      setError(nextError)
      toast.error(nextError)
    }
  }

  const returnBatch = async (row: any) => {
    if (!token) return
    if (!returnReason.trim()) {
      toast.error('Return reason is required.')
      return
    }
    setError('')
    setMessage('')
    try {
      await api.returnResultBatch(token, row.id, { reason: returnReason })
      setReturnReason('')
      setMessage('Result batch returned for correction.')
      toast.success('Result batch returned for correction.')
      await refreshSetup()
      if (selectedAssessmentId) await loadSheet(selectedAssessmentId)
    } catch (err: any) {
      const nextError = err?.message || 'Unable to return result batch.'
      setError(nextError)
      toast.error(nextError)
    }
  }

  if (isSheetPage) {
    return (
      <div className="min-h-screen bg-[#eef1f5] text-[#111827]">
        <header className="no-print sticky top-0 z-30 border-b border-[#d9dce3] bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <PageBackButton fallback="/results" label="Back to results" iconOnly />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6b7280]">{schoolName} marksheet</p>
                <h1 className="truncate text-[20px] font-semibold tracking-[-0.035em] text-[#111827]">{className} - {paperName}</h1>
                <p className="truncate text-[12px] font-medium text-[#6b7280]">{subjectName} - {termName}{examSessionName ? ` - ${examSessionName}` : ''}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!overallReady} type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={downloadMarksheet}><Download className="size-3.5" /> Download marksheet</Button>
              <Button disabled={!overallReady} type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={printMarksheet}><Printer className="size-3.5" /> Print / Save PDF</Button>
              <Button disabled={!overallReady || !rows.length || sheetReadOnly} type="button" className="h-9 rounded-[5px] text-[12px]" onClick={submitFinal}><Send className="size-3.5" /> Submit derived results</Button>
            </div>
          </div>
        </header>

        <main className="grid gap-4 p-4">
          {error ? <div className="no-print rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
          {message ? <div className="no-print rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[12px] font-semibold text-[#166534]">{message}</div> : null}

          <div className="no-print">
            <SectionKpiStrip items={sheetKpis} />
          </div>

          <div className="no-print">
            <AcademicMarkSheetPanel assessmentId={selectedAssessmentId} readOnly={sheetReadOnly} onStateChange={handleAcademicStateChange} onSaved={async () => { await loadSheet(selectedAssessmentId); await refreshSetup() }} />
            <AssessmentOperationalIntelligence assessmentId={selectedAssessmentId} />
          </div>

          {overallReady ? <MarksheetPrintPreview
            logoSrc=""
            schoolName={schoolName}
            rows={rows}
            totalMarks={totalMarks}
            subjectName={subjectName}
            className={className}
            paperName={paperName}
            termName={termName}
            examSessionName={examSessionName}
          /> : null}
        </main>
      </div>
    )
  }

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Results</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">Select an active-term assessment, enter its academic evidence once, then review the automatically derived overall marksheet.</p>
          </div>
        </div>
      </section>

      <SectionKpiStrip items={kpiItems} />

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      {message ? <div className="rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-[12px] font-semibold text-[#166534]">{message}</div> : null}

      <SectionCard
        title="Assessment Selection"
        subtitle={`${activeAcademicLabel} - ${role === 'teacher' ? 'Assigned assessments only' : 'All role-visible assessments'}`}
        actions={<span className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d4ed8]">{filteredAssessments.length} shown</span>}
      >
        <div className="grid gap-3 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_180px_180px]">
            <label className="relative grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
              Find assessment
              <Search className="absolute bottom-2 left-3 size-3.5 text-[#9ca3af]" />
              <Input className="h-8 pl-8 text-[12px]" placeholder="Search by name, class or subject..." value={assessmentQuery} onChange={(event) => setAssessmentQuery(event.target.value)} />
            </label>
            <Field label="Exam Session">
              <select className={selectClassName} value={filters.exam_session_id} onChange={(event) => setFilters({ ...filters, exam_session_id: event.target.value })}>
                <option value="">All sessions</option>
                {(setup.exam_sessions || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Class">
              <select className={selectClassName} value={filters.class_id} onChange={(event) => setFilters({ ...filters, class_id: event.target.value })}>
                <option value="">All classes</option>
                {(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Subject">
              <select className={selectClassName} value={filters.subject_id} onChange={(event) => setFilters({ ...filters, subject_id: event.target.value })}>
                <option value="">All subjects</option>
                {(setup.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
          </div>

          <PortalTable
            columns={[
              {
                key: 'name',
                label: 'Name',
                render: (row) => (
                  <div className="grid gap-1">
                    <span className="font-semibold text-[#111827]">{row.name || row.assessment_name || '-'}</span>
                    <span className="text-[11px] font-medium text-[#6b7280]">{row.subject_name || '-'}{row.exam_session_name ? ` - ${row.exam_session_name}` : ''}</span>
                  </div>
                ),
              },
              { key: 'class_name', label: 'Class', render: (row) => row.class_name || '-' },
              {
                key: 'term',
                label: 'Term',
                render: (row) => (
                  <div className="grid gap-1">
                    <span>{row.term_label || row.term_name || termName || '-'}</span>
                    <StatusPill value={assessmentBatch(row)?.status || row.status || 'not_started'} />
                  </div>
                ),
              },
              {
                key: 'action',
                label: 'Action',
                render: (row) => {
                  const isView = assessmentActionLabel(row) === 'View'
                  const Icon = isView ? Eye : PencilLine
                  return (
                    <Button
                      type="button"
                      size="sm"
                      variant={isView ? 'outline' : 'default'}
                      className="h-8 rounded-[5px] px-3 text-[12px]"
                      onClick={(event) => {
                        event.stopPropagation()
                        openAssessmentSheet(row)
                      }}
                    >
                      <Icon className="size-3.5" />
                      {assessmentActionLabel(row)}
                    </Button>
                  )
                },
              },
            ]}
            rows={filteredAssessments}
            emptyMessage={setup.setup_required ? (session.message || 'Set up an active academic year and term to view assessments.') : 'No assessments found for the active academic session.'}
          />
        </div>
      </SectionCard>

      {canApprove ? (
        <SectionCard title="Headteacher Results Overview" subtitle="Submitted batches can be approved or returned for correction">
          <div className="grid gap-3 p-4">
            <div className="flex flex-wrap gap-2">
              <Input className="h-8 max-w-sm text-[12px]" placeholder="Return reason" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} />
            </div>
            <PortalTable
              columns={[
                { key: 'assessment_name', label: 'Assessment' },
                { key: 'class_name', label: 'Class' },
                { key: 'subject_name', label: 'Subject' },
                { key: 'teacher_name', label: 'Teacher' },
                { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                { key: 'completed_marks', label: 'Saved Marks' },
                { key: 'actions', label: 'Actions', render: (row) => {
                  const ready = String(row.status || '').toLowerCase() === 'submitted'
                  return (
                    <span className="inline-flex gap-1">
                      <button disabled={!ready} type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#bbf7d0] text-[#15803d] disabled:opacity-40" onClick={(event) => { event.stopPropagation(); approveBatch(row) }} aria-label="Approve batch"><CheckCircle2 className="size-3.5" /></button>
                      <button disabled={!ready} type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#fed7aa] text-[#c2410c] disabled:opacity-40" onClick={(event) => { event.stopPropagation(); returnBatch(row) }} aria-label="Return batch"><RotateCcw className="size-3.5" /></button>
                    </span>
                  )
                } },
              ]}
              rows={setup.batches || []}
              emptyMessage="No result batches have been saved yet."
            />
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}
