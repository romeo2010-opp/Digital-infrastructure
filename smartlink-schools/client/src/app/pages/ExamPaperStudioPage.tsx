import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { FilePlus2, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
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

const statusOptions = ['draft', 'open', 'ready_for_review', 'returned', 'approved', 'scheduled', 'marking', 'results_submitted', 'results_approved', 'locked', 'archived']

function selectClassName() {
  return 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
}

function statusLabel(value: any) {
  return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dateLabel(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
}

export function ExamPaperStudioPage() {
  const navigate = useNavigate()
  const { token, api, user } = usePortal()
  const role = String(user?.role || '').toLowerCase()
  const canApprove = ['school_owner', 'headteacher', 'super_admin'].includes(role)
  const [setup, setSetup] = useState<any>({ classes: [], subjects: [], teachers: [], session: null })
  const [papers, setPapers] = useState<any[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<any>({ q: '', status: '', assessment_type: '', class_id: '', subject_id: '', teacher_id: '', include_history: false, include_archived: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async (nextFilters = filters) => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const [setupPayload, paperPayload] = await Promise.all([
        api.getAssessmentBuilderSetup(token),
        api.listAssessments(token, nextFilters),
      ])
      setSetup(setupPayload || {})
      setPapers(paperPayload?.assessments || [])
      if (paperPayload?.setup_required) setError('No active academic term found. Ask an admin to open a term.')
    } catch (err: any) {
      const message = err?.message || 'Unable to load assessment papers.'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const updateFilter = (key: string, value: any) => {
    const next = { ...filters, [key]: value }
    setFilters(next)
    if (key === 'q') load(next)
  }

  const resetFilters = () => {
    const next = { q: '', status: '', assessment_type: '', class_id: '', subject_id: '', teacher_id: '', include_history: false, include_archived: false }
    setFilters(next)
    load(next)
  }

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">Exam Paper Studio</h1>
            <p className="mt-1 text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">
              {(setup.session?.academic_year?.name || 'Current academic year')} · {(setup.session?.term?.name || 'Current term')}
            </p>
          </div>
          <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => navigate('/exam-builder/new')}>
            <FilePlus2 className="size-3.5" />
            New Paper
          </Button>
        </div>
      </section>

      <SectionCard title="Assessment Papers" subtitle={role === 'teacher' ? 'Assigned papers only' : 'School-wide papers'}>
        <div className="grid gap-3 p-4">
          <Toolbar>
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
              <Input value={filters.q} onChange={(event) => updateFilter('q', event.target.value)} className="h-8 pl-9 text-[12px]" placeholder="Search exam papers..." />
            </div>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setFiltersOpen((open) => !open)}>
              <SlidersHorizontal className="size-3.5" />
              Filters
            </Button>
          </Toolbar>

          {filtersOpen ? (
            <div className="grid gap-2 rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-3 md:grid-cols-3 xl:grid-cols-6">
              <select className={selectClassName()} value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
                <option value="">All statuses</option>
                {statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
              </select>
              <select className={selectClassName()} value={filters.assessment_type} onChange={(event) => updateFilter('assessment_type', event.target.value)}>
                <option value="">All types</option>
                {assessmentTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select className={selectClassName()} value={filters.class_id} onChange={(event) => updateFilter('class_id', event.target.value)}>
                <option value="">All classes</option>
                {(setup.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <select className={selectClassName()} value={filters.subject_id} onChange={(event) => updateFilter('subject_id', event.target.value)}>
                <option value="">All subjects</option>
                {(setup.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              {canApprove ? (
                <select className={selectClassName()} value={filters.teacher_id} onChange={(event) => updateFilter('teacher_id', event.target.value)}>
                  <option value="">All teachers</option>
                  {(setup.teachers || []).map((row: any) => <option key={row.id} value={row.id}>{row.full_name || row.email}</option>)}
                </select>
              ) : null}
              <div className="flex min-w-max items-center gap-3">
                <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151]">
                  <input type="checkbox" checked={filters.include_history} onChange={(event) => updateFilter('include_history', event.target.checked)} />
                  History
                </label>
                <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151]">
                  <input type="checkbox" checked={filters.include_archived} onChange={(event) => updateFilter('include_archived', event.target.checked)} />
                  Archived
                </label>
              </div>
              <div className="flex gap-2 md:col-span-3 xl:col-span-6">
                <Button type="button" className="h-8 rounded-[5px] text-[12px]" onClick={() => load()}>
                  Apply Filters
                </Button>
                <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={resetFilters}>
                  <RotateCcw className="size-3.5" />
                  Reset
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

          <PortalTable
            rows={papers}
            onRowClick={(row) => navigate(`/exam-builder/${row.id}`)}
            emptyMessage={loading ? 'Loading assessment papers...' : role === 'teacher' ? 'You are not assigned to any class/subject for the current term.' : 'No assessment papers found.'}
            columns={[
              { key: 'name', label: 'Assessment' },
              { key: 'assessment_type', label: 'Type', render: (row) => statusLabel(row.assessment_type) },
              { key: 'exam_session_name', label: 'Exam Session', render: (row) => row.exam_session_name || '-' },
              { key: 'class_name', label: 'Class' },
              { key: 'subject_name', label: 'Subject' },
              { key: 'teacher_name', label: 'Assigned Teacher', render: (row) => row.teacher_name || '-' },
              { key: 'total_marks', label: 'Marks' },
              { key: 'duration_minutes', label: 'Duration', render: (row) => row.duration_minutes ? `${row.duration_minutes} min` : '-' },
              { key: 'status', label: 'Status', render: (row) => statusLabel(row.status) },
              { key: 'updated_at', label: 'Updated', render: (row) => dateLabel(row.updated_at) },
            ]}
          />
        </div>
      </SectionCard>
    </div>
  )
}
