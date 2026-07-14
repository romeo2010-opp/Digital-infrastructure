import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { PageBackButton } from '../components/PageBackButton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { FieldControl, FieldLabel } from '../components/FieldLabel'
import { SectionCard } from '../components/SectionCard'
import { usePortal } from '../lib/portalContext'
import { badgeLabelForResult, routeForSearchResult, type SearchResult } from '../lib/searchRoutes'
import { renderPill } from '../lib/portalUtils'

const filters = [
  ['all', 'All'],
  ['students', 'Students'],
  ['guardians', 'Parents'],
  ['teachers', 'Teachers'],
  ['classes', 'Classes'],
  ['subjects', 'Subjects'],
  ['assessments', 'Assessments'],
  ['results', 'Results'],
  ['homework', 'Homework'],
  ['attendance', 'Attendance'],
  ['support', 'Learner Support'],
  ['fees', 'Fees'],
  ['discounts', 'Discounts'],
  ['leave', 'Leave'],
  ['payroll', 'Payroll'],
  ['calendar', 'Calendar'],
  ['messages', 'Messages'],
]

export function SearchResultsPage() {
  const { token, api, user } = usePortal()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') || ''
  const type = searchParams.get('type') || 'all'
  const district = searchParams.get('district') || ''
  const [input, setInput] = useState(query)
  const [payload, setPayload] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const results: SearchResult[] = useMemo(() => payload?.results || [], [payload])
  const isTeacher = String(user?.role || '').toLowerCase() === 'teacher'
  const activeType = isTeacher && ['teachers', 'fees', 'discounts', 'leave', 'payroll'].includes(type) ? 'all' : type
  const visibleFilters = useMemo(() => filters.filter(([value]) => !(isTeacher && ['teachers', 'fees', 'discounts', 'leave', 'payroll'].includes(value))), [isTeacher])
  const searchHelpText = isTeacher ? 'Search people, pages and academic records inside your assigned classes and subjects.' : 'Search permitted school data using names, statuses, dates or a natural-language question.'

  useEffect(() => {
    setInput(query)
  }, [query])

  useEffect(() => {
    if (!token || query.trim().length < 2) {
      setPayload(null)
      setError('')
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api
      .fullSearch(token, { q: query.trim(), type: activeType, district, page: 1, limit: 50 }, controller.signal)
      .then(setPayload)
      .catch((requestError: any) => {
        if (controller.signal.aborted) return
        setError(requestError?.message || 'Search is temporarily unavailable.')
        setPayload(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [activeType, api, query, token, district])

  const commitSearch = () => {
    const next = input.trim()
    if (!next) return
    setSearchParams({ q: next, type: activeType })
  }

  const setType = (nextType: string) => {
    const params: Record<string, string> = { q: query || input.trim(), type: nextType }
    if (district) params.district = district
    setSearchParams(params)
  }

  return (
    <div className="h-full min-h-0 max-h-full overflow-y-auto overscroll-contain">
      <div className="flex min-h-full flex-col gap-4 p-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PageBackButton fallback="/dashboard" />
          <div>
            <h1 className="text-lg font-medium tracking-normal text-[#111827]">Search Results</h1>
            <p className="mt-1 text-xs text-[#6b7280]">
              {payload ? `${payload.total || 0} result${Number(payload.total || 0) === 1 ? '' : 's'} for "${query}"${payload.interpretation ? ` · Understood as ${payload.interpretation}` : ''}` : searchHelpText}
            </p>
          </div>
        </div>
      </div>

      <SectionCard title="Aware Search" subtitle="Compositional language understanding, typo tolerance and fuzzy ranking are applied only to records your role is allowed to view.">
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-end gap-2">
            <FieldControl label="Search query" className="min-w-[260px] flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
                <Input
                  className="pl-9"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitSearch()
                  }}
                  placeholder={isTeacher ? 'Search a learner, topic, assessment or support case...' : 'Search any person, record, page, status or date...'}
                />
              </div>
            </FieldControl>
            <Button type="button" className="bg-accent-primary hover:bg-accent-primary" onClick={commitSearch}>Search</Button>
          </div>
          <div className="grid gap-2">
            <FieldLabel label="Result type" />
          <div className="flex flex-wrap gap-2">
            {visibleFilters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`h-8 rounded-md border px-3 text-xs font-medium ${
                  activeType === value
                    ? 'border-[#e2e8f0] bg-[#111827] text-white'
                    : 'border-[#e2e8f0] bg-white text-[#6b7280] hover:bg-[#f9fafb]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          </div>
          {payload?.understood ? (
            <div className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[11px] text-[#64748b]">
              <span className="font-semibold text-[#374151]">Search understanding:</span> {payload.understood.label}
              {payload.understood.entities?.length ? <span> · entities: {payload.understood.entities.join(', ')}</span> : null}
              {payload.understood.states?.length ? <span> · states: {payload.understood.states.join(', ')}</span> : null}
              {payload.understood.corrections?.length ? <span> · corrections: {payload.understood.corrections.map((item: any) => `${item.from} → ${item.to}`).join(', ')}</span> : null}
            </div>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Results" subtitle={query ? `Ranked matches for ${query}` : 'Enter at least two characters to search'}>
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-[#6b7280]">
            <Loader2 className="size-4 animate-spin" />
            Searching...
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-3 px-4 py-6 text-sm text-[#dc2626]">
            <span>Search is temporarily unavailable.</span>
            <Button type="button" variant="outline" size="sm" onClick={commitSearch}>Retry</Button>
          </div>
        ) : query.trim().length < 2 ? (
          <div className="px-4 py-8 text-sm text-[#6b7280]">Enter at least two characters to search school records.</div>
        ) : results.length ? (
          <div className="divide-y divide-slate-200">
            {results.map((result) => (
              <button
                key={`${result.resultType}-${result.id}-${result.groupType}`}
                type="button"
                onClick={() => navigate(routeForSearchResult(result), { state: { fromSearch: true, search: query } })}
                className="grid w-full gap-2 px-4 py-3 text-left hover:bg-[#f9fafb] md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-[#111827]">{result.title}</span>
                    <span className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">
                      {badgeLabelForResult(result)}
                    </span>
                    {result.status ? renderPill(result.status) : null}
                  </span>
                  {result.subtitle ? <span className="mt-1 block text-xs text-[#6b7280]">{result.subtitle}</span> : null}
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#6b7280]">
                    {result.className ? <span>Class: {result.className}</span> : null}
                    {result.student ? <span>Student: {result.student}</span> : null}
                    {result.parent ? <span>Guardian: {result.parent}</span> : null}
                    {result.matchedField ? <span>Matched: {result.matchedField}</span> : null}
                  </span>
                </span>
                <span className="self-center text-xs font-medium text-[#2563eb]">Open</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-sm text-[#6b7280]">No matching school records found for "{query}".</div>
        )}
      </SectionCard>
      </div>
    </div>
  )
}
