import { useEffect, useMemo, useRef, useState } from "react"
import { Clock3, FileText, Loader2, MapPin, Search, ShieldAlert, Sparkles, UserRound, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useInternalAuth } from "../auth/AuthContext"
import {
  INTERNAL_SEARCH_RECENTS_KEY,
  badgeLabelForInternalResult,
  quickInternalSearch,
  routeForInternalSearchResult,
} from "../search/internalSearch"

const iconMap = {
  NAVIGATION: Search,
  LICENSE: FileText,
  STATION: MapPin,
  USER: UserRound,
  ROLE: UserRound,
  PERMISSION: ShieldAlert,
  SUPPORT: ShieldAlert,
  REFUND: FileText,
  FINANCE: FileText,
  TRANSACTION: FileText,
  SETTLEMENT: FileText,
  WALLET: FileText,
  RISK: ShieldAlert,
  CASE: ShieldAlert,
  AUDIT: FileText,
  FIELD: FileText,
  ONBOARDING: FileText,
  NETWORK: ShieldAlert,
  SYSTEM: ShieldAlert,
  ANALYTICS: FileText,
  SETTING: FileText,
  KIOSK: FileText,
}

const placeholderHints = [
  "Search users",
  "Search stations",
  "Search licenses",
  "Search linked IDs",
  "Search refunds",
]

const suggestedSearches = [
  { label: "Station licenses", query: "license" },
  { label: "Suspended users", query: "suspended" },
  { label: "Open refunds", query: "refund" },
  { label: "Audit activity", query: "audit" },
]

function readRecentSearches() {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INTERNAL_SEARCH_RECENTS_KEY) || "[]")
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : []
  } catch {
    return []
  }
}

function flattenGroups(groups) {
  return groups.flatMap((group) => (group.results || []).map((result) => ({ ...result, groupType: group.type, groupLabel: group.label })))
}

function ResultRow({ result, active, onOpen }) {
  const Icon = iconMap[String(result.resultType || "").toUpperCase()] || Search
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onOpen(result)}
      className={`internal-global-search__result ${active ? "is-active" : ""}`}
    >
      <span className="internal-global-search__result-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="internal-global-search__result-copy">
        <span className="internal-global-search__result-title">
          <strong>{result.title}</strong>
          <span>{badgeLabelForInternalResult(result)}</span>
          {result.status ? <em>{String(result.status)}</em> : null}
        </span>
        {result.subtitle ? <small>{result.subtitle}</small> : null}
        <span className="internal-global-search__result-meta">
          {result.district ? <span>District: {result.district}</span> : null}
          {result.region ? <span>Region: {result.region}</span> : null}
          {result.station ? <span>Station: {result.station}</span> : null}
          {result.matchedField ? <span>Matched: {result.matchedField}</span> : null}
        </span>
      </span>
    </button>
  )
}

export default function InternalGlobalSearch() {
  const navigate = useNavigate()
  const { session } = useInternalAuth()
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [activeIndex, setActiveIndex] = useState(-1)
  const [recentSearches, setRecentSearches] = useState(() => readRecentSearches())
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const flatResults = useMemo(() => flattenGroups(groups), [groups])
  const hasSearchableQuery = query.trim().length >= 2
  const profile = session?.profile || {}
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
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [])

  useEffect(() => {
    if (!hasSearchableQuery) {
      setGroups([])
      setLoading(false)
      setError("")
      return undefined
    }

    let disposed = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError("")
      quickInternalSearch(profile, query.trim(), 8)
        .then((payload) => {
          if (disposed) return
          setGroups(payload?.groups || [])
          setOpen(true)
          setActiveIndex(-1)
        })
        .catch((requestError) => {
          if (disposed) return
          setGroups([])
          setError(requestError?.message || "Search is temporarily unavailable.")
          setOpen(true)
        })
        .finally(() => {
          if (!disposed) setLoading(false)
        })
    }, 260)

    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [hasSearchableQuery, profile, query])

  function rememberSearch(value) {
    const nextValue = String(value || "").trim()
    if (!nextValue) return
    setRecentSearches((current) => {
      const next = [nextValue, ...current.filter((item) => item.toLowerCase() !== nextValue.toLowerCase())].slice(0, 8)
      try {
        window.localStorage.setItem(INTERNAL_SEARCH_RECENTS_KEY, JSON.stringify(next))
      } catch {
        // ignore storage limits
      }
      return next
    })
  }

  function removeRecentSearch(value) {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== value)
      try {
        window.localStorage.setItem(INTERNAL_SEARCH_RECENTS_KEY, JSON.stringify(next))
      } catch {
        // ignore storage limits
      }
      return next
    })
  }

  function openResult(result) {
    rememberSearch(result.title)
    setOpen(false)
    setActiveIndex(-1)
    navigate(routeForInternalSearchResult(result), { state: { fromSearch: true, result } })
  }

  function openFullSearch(value = query) {
    const next = String(value || "").trim()
    if (!next) return
    rememberSearch(next)
    setOpen(false)
    setActiveIndex(-1)
    navigate(`/search?q=${encodeURIComponent(next)}`)
  }

  function runSavedSearch(value) {
    setQuery(value)
    setOpen(true)
    inputRef.current?.focus()
    if (String(value || "").trim().length >= 2) openFullSearch(value)
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      setOpen(false)
      setActiveIndex(-1)
      inputRef.current?.blur()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!open) setOpen(true)
      setActiveIndex((current) => Math.min(flatResults.length - 1, current + 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((current) => Math.max(-1, current - 1))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      if (activeIndex >= 0 && flatResults[activeIndex]) openResult(flatResults[activeIndex])
      else openFullSearch()
    }
  }

  const showDropdown = open && (hasSearchableQuery || loading || error || recentSearches.length > 0 || matchingSuggestions.length > 0)

  return (
    <div ref={rootRef} className="internal-global-search">
      <div className="internal-global-search__input">
        <Search aria-hidden="true" />
        {!query ? <span className="internal-global-search__placeholder">{placeholderHints[placeholderIndex]}</span> : null}
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder=""
          aria-label="Search internal records"
        />
        {query ? (
          <button
            type="button"
            className="internal-global-search__clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("")
              setGroups([])
              setOpen(false)
              setActiveIndex(-1)
              inputRef.current?.focus()
            }}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div className="internal-global-search__results">
          {loading ? (
            <div className="internal-global-search__state">
              <Loader2 className="is-spinning" aria-hidden="true" />
              Searching...
            </div>
          ) : error ? (
            <div className="internal-global-search__state is-error">Search is temporarily unavailable.</div>
          ) : flatResults.length ? (
            <>
              <div className="internal-global-search__result-list">
                {groups.map((group) => {
                  const groupResults = group.results || []
                  if (!groupResults.length) return null
                  return (
                    <section key={group.type}>
                      <div className="internal-global-search__group-label">{group.label}</div>
                      {groupResults.map((result) => {
                        const flatIndex = flatResults.findIndex((item) => item.id === result.id && item.resultType === result.resultType && item.collectionPath === result.collectionPath)
                        return (
                          <ResultRow
                            key={`${result.resultType}-${result.id}-${result.collectionPath}`}
                            result={{ ...result, groupLabel: group.label, groupType: group.type }}
                            active={flatIndex === activeIndex}
                            onOpen={openResult}
                          />
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              <button type="button" className="internal-global-search__full" onMouseDown={(event) => event.preventDefault()} onClick={() => openFullSearch()}>
                <span>Open full search results</span>
                <span>Enter</span>
              </button>
            </>
          ) : (
            <div className="internal-global-search__empty">
              {recentSearches.length ? (
                <section>
                  <div className="internal-global-search__group-label">Recent searches</div>
                  {recentSearches.map((item) => (
                    <div key={item} className="internal-global-search__recent">
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runSavedSearch(item)}>
                        <Clock3 aria-hidden="true" />
                        <span>{item}</span>
                      </button>
                      <button type="button" aria-label={`Remove ${item}`} onMouseDown={(event) => event.preventDefault()} onClick={() => removeRecentSearch(item)}>
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </section>
              ) : null}

              {matchingSuggestions.length ? (
                <section>
                  <div className="internal-global-search__group-label">Suggested</div>
                  {matchingSuggestions.map((item) => (
                    <button key={item.query} type="button" className="internal-global-search__suggestion" onMouseDown={(event) => event.preventDefault()} onClick={() => runSavedSearch(item.query)}>
                      <Sparkles aria-hidden="true" />
                      {item.label}
                    </button>
                  ))}
                </section>
              ) : hasSearchableQuery ? (
                <p>No matching internal records found.</p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
