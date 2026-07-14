import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  BookOpenCheck,
  CalendarCheck,
  Clock3,
  ClipboardCheck,
  FileText,
  GraduationCap,
  MessageSquare,
  ReceiptText,
  Search,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useNavigate } from 'react-router'
import { badgeLabelForResult, routeForSearchResult, type SearchResult } from '../../lib/searchRoutes'
import { renderPill } from '../../lib/portalUtils'
import { usePortal } from '../../lib/portalContext'

const iconMap: Record<string, any> = {
  NAVIGATION: Search,
  STUDENT: GraduationCap,
  CLASS: Users,
  PARENT: UserRound,
  GUARDIAN: UserRound,
  FEE: ReceiptText,
  RECEIPT: ReceiptText,
  PAYMENT: ReceiptText,
  ATTENDANCE: CalendarCheck,
  HOMEWORK: BookOpenCheck,
  RESULT: ClipboardCheck,
  MARKS: ClipboardCheck,
  ASSESSMENT: Sparkles,
  INSIGHT: Sparkles,
  DRILL: BookOpenCheck,
  FORECAST: BarChart3,
  MESSAGE: MessageSquare,
  REPORT: FileText,
  USER: Users,
  ROLE: Users,
}

const recentSearchKey = 'schools-global-search-recents'
const placeholderHints = [
  'Students who have not paid',
  'Outstanding balances',
  'Paid students',
  'Teachers currently on leave',
  'Pending discount approvals',
]
const suggestedSearches = [
  { label: 'Outstanding balances', query: 'students who have not paid' },
  { label: 'Paid students', query: 'fully paid students' },
  { label: 'Staff on leave', query: 'teachers currently on leave' },
  { label: 'Discount approvals', query: 'pending discount approvals' },
]

const navigationResults: SearchResult[] = [
  { id: 'nav-dashboard', title: 'Dashboard', subtitle: 'School command centre', resultType: 'NAVIGATION', route: '/dashboard' },
  { id: 'nav-students', title: 'Students', subtitle: 'Learner registry and profiles', resultType: 'NAVIGATION', route: '/students' },
  { id: 'nav-parents', title: 'Parents', subtitle: 'Guardian contacts and communication preferences', resultType: 'NAVIGATION', route: '/parents' },
  { id: 'nav-fees', title: 'Fees', subtitle: 'Balances, receipts and reminders', resultType: 'NAVIGATION', route: '/fees' },
  { id: 'nav-attendance', title: 'Attendance', subtitle: 'Daily registers and absence alerts', resultType: 'NAVIGATION', route: '/attendance' },
  { id: 'nav-homework', title: 'Homework', subtitle: 'Assignments and due-date reminders', resultType: 'NAVIGATION', route: '/homework' },
  { id: 'nav-results', title: 'Results', subtitle: 'Marks and report-card summaries', resultType: 'NAVIGATION', route: '/results' },
  { id: 'nav-insights', title: 'Assessment Insights', subtitle: 'Weak topics and support plans', resultType: 'NAVIGATION', route: '/assessment-insights' },
  { id: 'nav-reports', title: 'Reports', subtitle: 'Academic, attendance and fee summaries', resultType: 'NAVIGATION', route: '/reports' },
]

function navigationForUser(user: any) {
  const role = String(user?.role || '').toLowerCase()
  return navigationResults.filter((item) => !(role === 'teacher' && item.route === '/fees'))
}

function flattenApiGroups(payload: any): SearchResult[] {
  return (payload?.groups || []).flatMap((group: any) =>
    (group.results || []).map((result: any) => ({
      ...result,
      id: String(result.id),
      groupType: group.type,
      groupLabel: group.label,
      matchedField: result.matchedField || group.label,
    })),
  )
}

function readRecentSearches() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentSearchKey) || '[]')
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : []
  } catch {
    return []
  }
}

function groupResults(results: SearchResult[]) {
  const groups = [
    { type: 'navigation', label: 'Navigation', results: results.filter((result) => result.resultType === 'NAVIGATION') },
    { type: 'learners', label: 'Learners & Parents', results: results.filter((result) => ['STUDENT', 'PARENT', 'GUARDIAN', 'CLASS'].includes(result.resultType)) },
    { type: 'operations', label: 'School Operations', results: results.filter((result) => ['FEE', 'RECEIPT', 'PAYMENT', 'ATTENDANCE', 'MESSAGE'].includes(result.resultType)) },
    { type: 'learning', label: 'Teaching & Learning', results: results.filter((result) => ['HOMEWORK', 'RESULT', 'ASSESSMENT', 'INSIGHT', 'DRILL', 'FORECAST'].includes(result.resultType)) },
    { type: 'admin', label: 'Administration', results: results.filter((result) => ['REPORT', 'USER', 'ROLE'].includes(result.resultType)) },
  ]
  return groups.filter((group) => group.results.length > 0)
}

function flattenGroups(groups: Array<{ results: SearchResult[] }>) {
  return groups.flatMap((group) => group.results)
}

function ResultRow({
  result,
  active,
  onOpen,
}: {
  result: SearchResult
  active: boolean
  onOpen: (result: SearchResult) => void
}) {
  const Icon = iconMap[String(result.resultType || '').toUpperCase()] || Search
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onOpen(result)}
      className={`grid w-full grid-cols-[1.75rem_minmax(0,1fr)] gap-2 px-3 py-2 text-left transition ${
        active ? 'bg-[#f9fafb]' : 'hover:bg-[#f9fafb]'
      }`}
    >
      <span className="mt-0.5 grid size-7 place-items-center rounded-md border border-[#e2e8f0] bg-white text-[#6b7280]">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-[#111827]">{result.title}</span>
          <span className="shrink-0 rounded-[3px] border border-[#e2e8f0] bg-[#f8fafc] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            {badgeLabelForResult(result)}
          </span>
          {result.status ? <span className="shrink-0">{renderPill(result.status)}</span> : null}
        </span>
        {result.subtitle ? <span className="mt-1 block truncate text-[11px] font-medium text-[#6b7280]">{result.subtitle}</span> : null}
        <span className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px] font-medium text-[#9ca3af]">
          {result.className ? <span>Class: {result.className}</span> : null}
          {result.student ? <span>Student: {result.student}</span> : null}
          {result.parent ? <span>Parent: {result.parent}</span> : null}
          {result.matchedField ? <span>Matched: {result.matchedField}</span> : null}
        </span>
      </span>
    </button>
  )
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const { token, api, user } = usePortal()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches())
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const [serverResults, setServerResults] = useState<SearchResult[]>([])
  const hasSearchableQuery = query.trim().length >= 2
  const navigationMatches = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return []
    return navigationForUser(user).filter((result) =>
      [result.title, result.subtitle, result.resultType].some((field) => String(field || '').toLowerCase().includes(value)),
    )
  }, [query, user])
  const matchingResults = useMemo(() => {
    if (!hasSearchableQuery) return []
    return [...navigationMatches, ...serverResults].slice(0, 12)
  }, [hasSearchableQuery, navigationMatches, serverResults])
  const groups = useMemo(() => groupResults(matchingResults), [matchingResults])
  const flatResults = useMemo(() => flattenGroups(groups), [groups])
  const matchingSuggestions = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return suggestedSearches
    return suggestedSearches.filter((item) => `${item.label} ${item.query}`.toLowerCase().includes(value)).slice(0, 4)
  }, [query])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPlaceholderIndex((current) => (current + 1) % placeholderHints.length)
    }, 2200)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!hasSearchableQuery || !token) {
      setServerResults([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      api.quickSearch(token, query.trim(), 12, controller.signal)
        .then((payload: any) => setServerResults(flattenApiGroups(payload)))
        .catch((error: any) => {
          if (error?.name !== 'AbortError') setServerResults([])
        })
    }, 160)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [api, hasSearchableQuery, query, token])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const rememberSearch = (value: string) => {
    const nextValue = value.trim()
    if (!nextValue) return
    setRecentSearches((current) => {
      const next = [nextValue, ...current.filter((item) => item.toLowerCase() !== nextValue.toLowerCase())].slice(0, 8)
      try {
        window.localStorage.setItem(recentSearchKey, JSON.stringify(next))
      } catch {
        // ignore storage limits
      }
      return next
    })
  }

  const openResult = (result: SearchResult) => {
    rememberSearch(result.title)
    setOpen(false)
    setActiveIndex(-1)
    navigate(routeForSearchResult(result), { state: { fromSearch: true, search: query.trim() } })
  }

  const openFullSearch = () => {
    if (!query.trim()) return
    rememberSearch(query.trim())
    setOpen(false)
    setActiveIndex(-1)
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  const removeRecentSearch = (value: string) => {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== value)
      try {
        window.localStorage.setItem(recentSearchKey, JSON.stringify(next))
      } catch {
        // ignore storage limits
      }
      return next
    })
  }

  const runSavedSearch = (value: string) => {
    setQuery(value)
    setOpen(true)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
      inputRef.current?.blur()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) setOpen(true)
      setActiveIndex((current) => Math.min(flatResults.length - 1, current + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(-1, current - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0 && flatResults[activeIndex]) openResult(flatResults[activeIndex])
      else openFullSearch()
    }
  }

  const showDropdown = open && (hasSearchableQuery || recentSearches.length > 0 || matchingSuggestions.length > 0)

  return (
    <div ref={rootRef} className="relative grid min-w-0 w-full max-w-[520px] justify-self-center gap-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
        {!query ? (
          <span className="pointer-events-none absolute left-10 top-1/2 z-10 h-5 -translate-y-1/2 overflow-hidden text-[13px] font-medium tracking-[-0.012em] text-[#9ca3af]">
            <span key={placeholderIndex} className="mera-global-search-placeholder block">
              {placeholderHints[placeholderIndex]}
            </span>
          </span>
        ) : null}
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder=""
          className="h-8 w-full rounded-[5px] border border-[#e2e8f0] bg-white pl-10 pr-9 text-[13px] font-medium tracking-[-0.012em] text-[#111827] outline-none placeholder:text-[#9ca3af] focus:border-[#111827]/35"
        />
        {query ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-md text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setOpen(false)
              setActiveIndex(-1)
              inputRef.current?.focus()
            }}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 overflow-hidden rounded-md border border-[#e2e8f0] bg-white shadow-none">
          {flatResults.length ? (
            <>
              <div className="max-h-[28rem] overflow-y-auto py-1">
                {groups.map((group) => (
                  <section key={group.type} className="border-b border-[#e2e8f0] last:border-b-0">
                    <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#9ca3af]">{group.label}</div>
                    {group.results.map((result) => {
                      const flatIndex = flatResults.findIndex((item) => item.id === result.id && item.resultType === result.resultType)
                      return <ResultRow key={`${result.resultType}-${result.id}`} result={{ ...result, groupLabel: group.label, groupType: group.type }} active={flatIndex === activeIndex} onOpen={openResult} />
                    })}
                  </section>
                ))}
              </div>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openFullSearch}
                className="flex h-9 w-full items-center justify-between border-t border-[#e2e8f0] bg-[#f8fafc] px-3 text-[12px] font-semibold text-[#374151] hover:bg-[#f3f4f6]"
              >
                <span>Open full school search</span>
                <span className="text-[#6b7280]">Enter</span>
              </button>
            </>
          ) : (
            <div className="grid gap-3 px-3 py-3">
              {recentSearches.length ? (
                <section>
                  <div className="mb-1.5 text-[11px] font-medium tracking-[-0.012em] text-[#6b7280]">Recent searches</div>
                  <div className="grid gap-1">
                    {recentSearches.map((item) => (
                      <div key={item} className="flex items-center gap-2 rounded-[5px] hover:bg-[#f8fafc]">
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => runSavedSearch(item)}
                          className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[12px] font-medium tracking-[-0.012em] text-[#374151]"
                        >
                          <Clock3 className="size-3.5 shrink-0 text-[#9ca3af]" />
                          <span className="truncate">{item}</span>
                        </button>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => removeRecentSearch(item)}
                          className="mr-1 grid size-6 place-items-center rounded-[4px] text-[#9ca3af] hover:bg-white hover:text-[#111827]"
                          aria-label={`Remove ${item} from recent searches`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {matchingSuggestions.length ? (
                <section>
                  <div className="mb-1.5 text-[11px] font-medium tracking-[-0.012em] text-[#6b7280]">Suggested</div>
                  <div className="grid gap-1">
                    {matchingSuggestions.map((item) => (
                      <button
                        key={item.query}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runSavedSearch(item.query)}
                        className="flex h-8 items-center gap-2 rounded-[5px] px-2 text-left text-[12px] font-medium tracking-[-0.012em] text-[#374151] hover:bg-[#f8fafc]"
                      >
                        <Sparkles className="size-3.5 text-[#9ca3af]" />
                        {item.label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : hasSearchableQuery ? (
                <div className="px-1 py-1 text-[13px] font-medium text-[#6b7280]">No matching school records found.</div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
