import { useEffect, useMemo, useState } from "react"
import { DataTable, Panel } from "./PanelTable"

function ScrollableTableModal({
  title,
  columns,
  rows,
  emptyLabel,
  compact,
  minWidth,
  onClose,
  onRowClick,
  getRowClassName,
  controls = null,
}) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose()
    }

    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  return (
    <div className="internal-modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="internal-modal internal-modal--table" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{title}</h3>
            <p>Full table view for internal review.</p>
          </div>
          <div className="internal-modal-header-actions">
            <span className="internal-modal-count">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--table">
          {controls ? <div className="internal-modal-toolbar">{controls}</div> : null}
          <DataTable
            columns={columns}
            rows={rows}
            emptyLabel={emptyLabel}
            compact={compact}
            minWidth={minWidth}
            onRowClick={onRowClick}
            getRowClassName={getRowClassName}
          />
        </div>
      </div>
    </div>
  )
}

export default function PreviewTablePanel({
  title,
  subtitle = "",
  columns,
  modalColumns = null,
  rows,
  emptyLabel = "No data available.",
  previewLimit = 6,
  compact = false,
  minWidth = null,
  actions = null,
  modalTitle = "",
  onRowClick = null,
  getRowClassName = null,
  modalRows = null,
  modalControls = null,
}) {
  const [open, setOpen] = useState(false)
  const safeRows = Array.isArray(rows) ? rows : []
  const safeModalRows = Array.isArray(modalRows) ? modalRows : safeRows
  const previewRows = useMemo(() => safeRows.slice(0, previewLimit), [safeRows, previewLimit])
  const hasOverflow = safeRows.length > previewLimit
  const previewColumns = columns
  const fullColumns = modalColumns || columns
  const handleRowClick = typeof onRowClick === "function"
    ? (row) => {
        setOpen(false)
        onRowClick(row)
      }
    : null

  const resolvedActions = typeof actions === "function"
    ? actions({ hasOverflow, totalCount: safeRows.length, openModal: () => setOpen(true) })
    : actions

  return (
    <>
      <Panel
        title={title}
        subtitle={subtitle}
        actions={
          <div className="panel-actions">
            {resolvedActions}
            {hasOverflow ? (
              <button type="button" className="secondary-action view-all-action" onClick={() => setOpen(true)}>
                <span>View all</span>
                <strong>{safeRows.length}</strong>
              </button>
            ) : null}
          </div>
        }
      >
        <DataTable
          columns={previewColumns}
          rows={previewRows}
          emptyLabel={emptyLabel}
          compact={compact}
          minWidth={minWidth}
          onRowClick={handleRowClick}
          getRowClassName={getRowClassName}
        />
        {hasOverflow ? (
          <p className="panel-note">Showing {previewRows.length} of {safeRows.length} rows.</p>
        ) : null}
      </Panel>

      {open ? (
        <ScrollableTableModal
          title={modalTitle || title}
          columns={fullColumns}
          rows={safeModalRows}
          emptyLabel={emptyLabel}
          compact={compact}
          minWidth={minWidth}
          onRowClick={handleRowClick}
          getRowClassName={getRowClassName}
          controls={modalControls}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
