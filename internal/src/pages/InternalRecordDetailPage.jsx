import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Database, ExternalLink, Link2 } from "lucide-react"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useInternalAuth } from "../auth/AuthContext"
import InternalShell from "../components/InternalShell"
import MetricGrid from "../components/MetricGrid"
import PreviewTablePanel from "../components/PreviewTablePanel"
import StatusPill from "../components/StatusPill"
import {
  badgeLabelForInternalResult,
  findInternalSearchRecord,
} from "../search/internalSearch"
import { formatNumber } from "../utils/display"

function humanizeKey(value) {
  return String(value || "")
    .replace(/\[(\d+)\]/g, " $1")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function scalarEntries(value, prefix = "", depth = 0, entries = []) {
  if (entries.length > 500 || depth > 6 || value === null || value === undefined) return entries
  if (["string", "number", "boolean", "bigint"].includes(typeof value)) {
    const stringValue = String(value ?? "").trim()
    if (stringValue) entries.push({ key: prefix || "value", value: stringValue })
    return entries
  }
  if (Array.isArray(value)) {
    value.slice(0, 24).forEach((item, index) => scalarEntries(item, `${prefix}[${index}]`, depth + 1, entries))
    return entries
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => scalarEntries(item, prefix ? `${prefix}.${key}` : key, depth + 1, entries))
  }
  return entries
}

function linkedIdsFromEntries(entries) {
  const idLike = /(public.?id|_id$|id$|license|reference|transaction|station|wallet|session|challenge|case|task|run|target)/i
  return entries.filter((entry) => idLike.test(entry.key) && entry.value.length >= 3).slice(0, 40)
}

function JsonBlock({ value }) {
  return <pre className="admin-json-block">{JSON.stringify(value || {}, null, 2)}</pre>
}

export default function InternalRecordDetailPage() {
  const { entityType, recordId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useInternalAuth()
  const [result, setResult] = useState(location.state?.result || null)
  const [loading, setLoading] = useState(!location.state?.result)
  const [error, setError] = useState("")
  const profile = session?.profile || {}

  useEffect(() => {
    if (location.state?.result) {
      setResult(location.state.result)
      setLoading(false)
      setError("")
      return undefined
    }

    let disposed = false
    setLoading(true)
    setError("")
    findInternalSearchRecord(profile, {
      entityType,
      id: recordId,
      source: searchParams.get("source") || "",
      collection: searchParams.get("collection") || "",
    })
      .then((record) => {
        if (!disposed) setResult(record)
      })
      .catch((detailError) => {
        if (!disposed) setError(detailError?.message || "Unable to load this record.")
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })

    return () => {
      disposed = true
    }
  }, [entityType, location.state, profile, recordId, searchParams])

  const record = result?.record || {}
  const entries = useMemo(() => scalarEntries(record), [record])
  const linkedIds = useMemo(() => linkedIdsFromEntries(entries), [entries])
  const metrics = useMemo(() => [
    {
      label: "Fields",
      value: formatNumber(entries.length),
      helper: "indexed scalar fields",
      drilldown: {
        title: "Indexed Fields",
        value: formatNumber(entries.length),
        rows: entries,
        columns: [
          { key: "key", label: "Field", render: (row) => humanizeKey(row.key) },
          { key: "value", label: "Value" },
        ],
      },
    },
    {
      label: "Linked IDs",
      value: formatNumber(linkedIds.length),
      helper: "detected references",
      tone: linkedIds.length ? "warning" : "neutral",
      drilldown: {
        title: "Linked Identifiers",
        value: formatNumber(linkedIds.length),
        rows: linkedIds,
        columns: [
          { key: "key", label: "Field", render: (row) => humanizeKey(row.key) },
          { key: "value", label: "Identifier" },
        ],
      },
    },
    {
      label: "Source",
      value: result?.sourceLabel || "-",
      helper: result?.collectionPath || "record",
    },
    {
      label: "Type",
      value: result ? badgeLabelForInternalResult(result) : "-",
      helper: result?.matchedField ? `matched ${result.matchedField}` : "search result",
    },
  ], [entries, linkedIds, result])

  return (
    <InternalShell title={result?.title || "Record Detail"} alerts={error ? [{ id: "detail-error", type: "ERROR", title: "Record Detail", body: error }] : []}>
      <section className="internal-record-detail">
        <button type="button" className="internal-detail-back" onClick={() => navigate(-1)}>
          <ArrowLeft aria-hidden="true" />
          Back
        </button>

        <header className="internal-detail-hero">
          <div>
            <span className="internal-detail-kicker">{loading ? "Loading" : result ? badgeLabelForInternalResult(result) : "Missing Record"}</span>
            <h1>{loading ? "Loading record..." : result?.title || "Record not found"}</h1>
            <p>{result?.subtitle || "Full internal details, indexed fields, linked IDs, and raw record data."}</p>
            <div className="internal-detail-pills">
              {result?.status ? <StatusPill value={result.status} /> : null}
              {result?.id ? <span className="settings-chip">{result.id}</span> : null}
              {result?.sourceLabel ? <span className="settings-chip settings-chip--soft">{result.sourceLabel}</span> : null}
            </div>
          </div>
          <div className="internal-detail-hero__meta">
            <Database aria-hidden="true" />
            <span>Collection</span>
            <strong>{result?.collectionPath || "-"}</strong>
            {result?.matchedField ? (
              <>
                <span>Matched field</span>
                <strong>{humanizeKey(result.matchedField)}</strong>
              </>
            ) : null}
          </div>
        </header>

        {result ? <MetricGrid items={metrics} /> : null}

        {result ? (
          <div className="internal-record-detail__grid">
            <section className="internal-detail-section">
              <header>
                <div>
                  <h2>Record Fields</h2>
                  <p>All indexed scalar values found on this record.</p>
                </div>
              </header>
              <PreviewTablePanel
                title="Fields"
                subtitle="Searchable values and metadata."
                previewLimit={14}
                columns={[
                  { key: "key", label: "Field", render: (row) => humanizeKey(row.key) },
                  { key: "value", label: "Value" },
                ]}
                rows={entries}
              />
            </section>

            <section className="internal-detail-section">
              <header>
                <div>
                  <h2>Linked IDs</h2>
                  <p>Identifiers detected from public IDs, references, station IDs, wallets, tasks, and related records.</p>
                </div>
              </header>
              <div className="internal-linked-id-list">
                {linkedIds.length ? linkedIds.map((item) => (
                  <button
                    key={`${item.key}-${item.value}`}
                    type="button"
                    onClick={() => navigate(`/search?q=${encodeURIComponent(item.value)}`)}
                  >
                    <Link2 aria-hidden="true" />
                    <span>{humanizeKey(item.key)}</span>
                    <strong>{item.value}</strong>
                    <ExternalLink aria-hidden="true" />
                  </button>
                )) : (
                  <p>No linked IDs detected on this record.</p>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {result ? (
          <section className="internal-detail-section">
            <header>
              <div>
                <h2>Raw Record</h2>
                <p>Complete indexed payload for audit and troubleshooting.</p>
              </div>
            </header>
            <JsonBlock value={record} />
          </section>
        ) : null}
      </section>
    </InternalShell>
  )
}
