import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, FileText, Loader2, MapPin, Search, ShieldAlert, Sparkles, UserRound, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { usePortal } from '../../lib/portalContext'
import { badgeLabelForResult, routeForSearchResult, type SearchResult } from '../../lib/searchRoutes'
import { renderPill } from '../../lib/portalUtils'

const iconMap: Record<string, any> = {
  NAVIGATION: Search,
  LICENCE: FileText,
  LICENSE: FileText,
  DISTRICT: MapPin,
  REGION: MapPin,
  STATION: ShieldAlert,
  STATION_MANAGER: UserRound,
  CASE: ShieldAlert,
  COMPLAINT: ShieldAlert,
  TASK: FileText,
  ALERT: ShieldAlert,
  INSPECTION: FileText,
  DELIVERY: FileText,
  PRICE: FileText,
  NOTICE: FileText,
  USER: UserRound,
  REPORT: FileText,
}

const recentSearchKey = 'mera-global-search-recents'
const placeholderHints = [
  'Search stations',
  'Search licences',
  'Search cases',
  'Search tasks',
  'Search complaints',
]
const suggestedSearches = [
  { label: 'Open inspections', query: 'open inspections' },
  { label: 'High risk stations', query: 'high risk stations' },
  { label: 'Price compliance', query: 'price compliance' },
  { label: 'Audit logs', query: 'audit logs' },
]

function readRecentSearches() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentSearchKey) || '[]')
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : []
  } catch {
    return []
  }
}

function flattenGroups(groups: any[]) {
  return groups.flatMap((group) =>
    (group.results || []).map((result: SearchResult) => ({
      ...result,
      groupType: group.type,
      groupLabel: group.label,
    })),
  )
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
          {result.district ? <span>District: {result.district}</span> : null}
          {result.region ? <span>Region: {result.region}</span> : null}
          {result.station ? <span className="truncate">Station: {result.station}</span> : null}
          {result.matchedField ? <span>Matched: {result.matchedField}</span> : null}
        </span>
      </span>
    </button>
  )
}

export function GlobalSearch() {
  const { token, api } = usePortal()
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches())
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const flatResults = useMemo(() => flattenGroups(groups), [groups])
  const hasSearchableQuery = query.trim().length >= 2
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
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => {
    if (!token || !hasSearchableQuery) {
      setGroups([])
      setLoading(false)
      setError('')
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      api
        .quickSearch(token, query.trim(), 10, controller.signal)
        .then((payload: any) => {
          setGroups(payload?.groups || [])
          setOpen(true)
          setActiveIndex(-1)
        })
        .catch((requestError: any) => {
          if (controller.signal.aborted) return
          setGroups([])
          setError(requestError?.message || 'Search is temporarily unavailable.')
          setOpen(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [api, hasSearchableQuery, query, token])

  const openResult = (result: SearchResult) => {
    rememberSearch(result.title)
    setOpen(false)
    setActiveIndex(-1)
    navigate(routeForSearchResult(result), { state: { fromSearch: true } })
  }

  const openFullSearch = () => {
    if (!query.trim()) return
    rememberSearch(query.trim())
    setOpen(false)
    setActiveIndex(-1)
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }

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
    if (value.trim().length < 2) return
    navigate(`/search?q=${encodeURIComponent(value.trim())}`)
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

  const showDropdown = open && (hasSearchableQuery || loading || error || recentSearches.length > 0 || matchingSuggestions.length > 0)

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
            setGroups([])
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
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[13px] font-medium text-[#6b7280]">
              <Loader2 className="size-4 animate-spin" />
              Searching...
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-[13px] font-medium text-[#b91c1c]">Search is temporarily unavailable.</div>
          ) : flatResults.length ? (
            <>
              <div className="max-h-[28rem] overflow-y-auto py-1">
                {groups.map((group) => {
                  const groupResults = group.results || []
                  if (!groupResults.length) return null
                  return (
                    <section key={group.type} className="border-b border-[#e2e8f0] last:border-b-0">
                      <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#9ca3af]">{group.label}</div>
                      {groupResults.map((result: SearchResult) => {
                        const flatIndex = flatResults.findIndex((item) => item.id === result.id && item.resultType === result.resultType)
                        return <ResultRow key={`${result.resultType}-${result.id}`} result={{ ...result, groupLabel: group.label, groupType: group.type }} active={flatIndex === activeIndex} onOpen={openResult} />
                      })}
                    </section>
                  )
                })}
              </div>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={openFullSearch}
                className="flex h-9 w-full items-center justify-between border-t border-[#e2e8f0] bg-[#f8fafc] px-3 text-[12px] font-semibold text-[#374151] hover:bg-[#f3f4f6]"
              >
                <span>Open full search results</span>
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
                <div className="px-1 py-1 text-[13px] font-medium text-[#6b7280]">No matching regulator records found.</div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
