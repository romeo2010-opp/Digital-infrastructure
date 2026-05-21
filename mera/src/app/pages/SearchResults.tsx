import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { PageBackButton } from '../components/PageBackButton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SectionCard } from '../components/SectionCard'
import { usePortal } from '../lib/portalContext'
import { badgeLabelForResult, routeForSearchResult, type SearchResult } from '../lib/searchRoutes'
import { renderPill } from '../lib/portalUtils'

const filters = [
  ['all', 'All'],
  ['navigation', 'Navigation'],
  ['locations', 'Districts / Regions'],
  ['licences', 'Licences'],
  ['stations', 'Stations'],
  ['stationManagers', 'Managers'],
  ['cases', 'Cases'],
  ['complaints', 'Complaints'],
  ['tasks', 'Tasks'],
  ['users', 'Users'],
  ['reports', 'Reports'],
]

export function SearchResultsPage() {
  const { token, api } = usePortal()
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
      .fullSearch(token, { q: query.trim(), type, district, page: 1, limit: 50 }, controller.signal)
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
  }, [api, query, token, type, district])

  const commitSearch = () => {
    const next = input.trim()
    if (!next) return
    setSearchParams({ q: next, type })
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
            <h1 className="text-lg font-semibold tracking-[-0.02em] text-[var(--mera-panel-text)]">Search Results</h1>
            <p className="mt-1 text-xs text-[var(--mera-panel-text-muted)]">
              {payload ? `${payload.total || 0} result${Number(payload.total || 0) === 1 ? '' : 's'} for "${query}"` : 'Search regulator records and portal destinations.'}
            </p>
          </div>
        </div>
      </div>

      <SectionCard title="Global Search" subtitle="Search regulator navigation, records, officers, managers, and assignments">
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitSearch()
                }}
                placeholder="Search stations, licences, cases, complaints, tasks..."
              />
            </div>
            <Button type="button" className="bg-blue-700 hover:bg-blue-800" onClick={commitSearch}>Search</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`h-8 rounded-[5px] border px-3 text-xs font-semibold ${
                  type === value
                    ? 'border-[#111827] bg-[#111827] text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Results" subtitle={query ? `Ranked matches for ${query}` : 'Enter at least two characters to search'}>
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            Searching...
          </div>
        ) : error ? (
          <div className="flex items-center justify-between gap-3 px-4 py-6 text-sm text-red-700">
            <span>Search is temporarily unavailable.</span>
            <Button type="button" variant="outline" size="sm" onClick={commitSearch}>Retry</Button>
          </div>
        ) : query.trim().length < 2 ? (
          <div className="px-4 py-8 text-sm text-slate-500">Enter at least two characters to search MERA records.</div>
        ) : results.length ? (
          <div className="divide-y divide-slate-200">
            {results.map((result) => (
              <button
                key={`${result.resultType}-${result.id}-${result.groupType}`}
                type="button"
                onClick={() => navigate(routeForSearchResult(result), { state: { fromSearch: true } })}
                className="grid w-full gap-2 px-4 py-3 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{result.title}</span>
                    <span className="rounded-[3px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-600">
                      {badgeLabelForResult(result)}
                    </span>
                    {result.status ? renderPill(result.status) : null}
                  </span>
                  {result.subtitle ? <span className="mt-1 block text-xs text-slate-600">{result.subtitle}</span> : null}
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {result.district ? <span>District: {result.district}</span> : null}
                    {result.region ? <span>Region: {result.region}</span> : null}
                    {result.station ? <span>Station: {result.station}</span> : null}
                    {result.matchedField ? <span>Matched: {result.matchedField}</span> : null}
                  </span>
                </span>
                <span className="self-center text-xs font-semibold text-blue-700">Open</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-sm text-slate-500">No matching regulator records found for "{query}".</div>
        )}
      </SectionCard>
      </div>
    </div>
  )
}
