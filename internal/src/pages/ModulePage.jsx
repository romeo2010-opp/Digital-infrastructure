import { useEffect, useState } from "react"
import InternalShell from "../components/InternalShell"
import { DataTable, Panel } from "../components/PanelTable"

function inferColumns(rows) {
  const sample = rows?.[0]
  if (!sample) return []
  return Object.keys(sample)
    .slice(0, 6)
    .map((key) => ({ key, label: key.replace(/_/g, " ") }))
}

function renderPanelContent(value) {
  if (Array.isArray(value)) {
    return <DataTable columns={inferColumns(value)} rows={value} />
  }
  if (value && typeof value === "object") {
    return (
      <div className="summary-stack">
        {Object.entries(value).map(([key, item]) => (
          <article key={key}>
            <strong>{key.replace(/_/g, " ")}</strong>
            <p>{typeof item === "object" ? JSON.stringify(item) : String(item)}</p>
          </article>
        ))}
      </div>
    )
  }
  return <p>{String(value ?? "-")}</p>
}

export default function ModulePage({ title, subtitle, load }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")

  useEffect(() => {
    load().then(setData).catch((err) => setError(err?.message || "Failed to load page"))
  }, [load])

  const sections = data ? Object.entries(data) : []

  return (
    <InternalShell title={title}>
      {subtitle ? <p className="module-intro">{subtitle}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {sections.map(([key, value]) => (
        <Panel key={key} title={key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}>
          {renderPanelContent(value)}
        </Panel>
      ))}
    </InternalShell>
  )
}
