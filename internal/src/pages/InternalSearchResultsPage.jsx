import { useEffect, useMemo, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useInternalAuth } from "../auth/AuthContext"
import InternalShell from "../components/InternalShell"
import {
  badgeLabelForInternalResult,
  fullInternalSearch,
  routeForInternalSearchResult,
} from "../search/internalSearch"

const filters = [
  ["all", "All"],
  ["navigation", "Navigation"],
  ["station", "Stations"],
  ["license", "Licenses"],
  ["user", "Users"],
  ["support", "Support"],
  ["refund", "Refunds"],
  ["finance", "Finance"],
  ["transaction", "Transactions"],
  ["settlement", "Settlements"],
  ["wallet", "Wallets"],
  ["case", "Cases"],
  ["risk", "Risk"],
  ["field", "Field"],
  ["audit", "Audit"],
  ["system", "System"],
  ["setting", "Settings"],
]

export default function InternalSearchResultsPage() {
  const { session } = useInternalAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get("q") || ""
  const type = searchParams.get("type") || "all"
  const [input, setInput] = useState(query)
  const [payload, setPayload] = useState({ results: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const results = useMemo(() => payload?.results || [], [payload])
  const profile = session?.profile || {}

  useEffect(() => {
    setInput(query)
  }, [query])

  useEffect(() => {
    if (query.trim().length < 2) {
      setPayload({ results: [], total: 0 })
      setError("")
      setLoading(false)
      return undefined
    }

    let disposed = false
    setLoading(true)
    setError("")
    fullInternalSearch(profile, { q: query.trim(), type, limit: 80 })
      .then((nextPayload) => {
        if (!disposed) setPayload(nextPayload)
      })
      .catch((requestError) => {
        if (disposed) return
        setError(requestError?.message || "Search is temporarily unavailable.")
        setPayload({ results: [], total: 0 })
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })

    return () => {
      disposed = true
    }
  }, [profile, query, type])

  function commitSearch() {
    const next = input.trim()
    if (!next) return
    setSearchParams({ q: next, type })
  }

  function setType(nextType) {
    const nextQuery = query || input.trim()
    if (!nextQuery) {
      setSearchParams({ type: nextType })
      return
    }
    setSearchParams({ q: nextQuery, type: nextType })
  }

  return (
    <InternalShell title="Search Results" contentClassName="internal-page-inner--search">
      <section className="internal-search-page">
        <header className="internal-search-hero">
          <div>
            <span>Global Search</span>
            <h1>Search results</h1>
            <p>{payload ? `${payload.total || 0} result${Number(payload.total || 0) === 1 ? "" : "s"} for "${query || input}"` : "Search internal records and destinations."}</p>
          </div>
        </header>

        <section className="internal-search-panel">
          <div className="internal-search-form">
            <label>
              <span>Search query</span>
              <div className="internal-search-input">
                <Search aria-hidden="true" />
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitSearch()
                  }}
                  placeholder="Search users, stations, licenses, linked IDs..."
                />
              </div>
            </label>
            <button type="button" className="primary-action" onClick={commitSearch}>Search</button>
          </div>
          <div className="internal-search-filters">
            {filters.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={type === value ? "is-active" : ""}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="internal-search-panel internal-search-results">
          <header>
            <div>
              <strong>Results</strong>
              <span>{query ? `Ranked matches for ${query}` : "Enter at least two characters to search"}</span>
            </div>
          </header>
          {loading ? (
            <div className="internal-search-state">
              <Loader2 className="is-spinning" aria-hidden="true" />
              Searching...
            </div>
          ) : error ? (
            <div className="internal-search-state is-error">{error}</div>
          ) : query.trim().length < 2 ? (
            <div className="internal-search-state">Enter at least two characters to search internal records.</div>
          ) : results.length ? (
            <div className="internal-search-result-list">
              {results.map((result) => (
                <button
                  key={`${result.resultType}-${result.id}-${result.collectionPath}`}
                  type="button"
                  onClick={() => navigate(routeForInternalSearchResult(result), { state: { fromSearch: true, result } })}
                >
                  <span>
                    <span className="internal-search-result-title">
                      <strong>{result.title}</strong>
                      <em>{badgeLabelForInternalResult(result)}</em>
                      {result.status ? <small>{String(result.status)}</small> : null}
                    </span>
                    {result.subtitle ? <span className="internal-search-result-subtitle">{result.subtitle}</span> : null}
                    <span className="internal-search-result-meta">
                      {result.district ? <span>District: {result.district}</span> : null}
                      {result.region ? <span>Region: {result.region}</span> : null}
                      {result.station ? <span>Station: {result.station}</span> : null}
                      {result.matchedField ? <span>Matched: {result.matchedField}</span> : null}
                      {result.linkedIds?.length ? <span>{result.linkedIds.length} linked IDs</span> : null}
                    </span>
                  </span>
                  <strong>Open</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="internal-search-state">No matching internal records found for "{query}".</div>
          )}
        </section>
      </section>
    </InternalShell>
  )
}
