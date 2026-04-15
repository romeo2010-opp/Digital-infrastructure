import { useEffect, useMemo, useState } from "react"
import { Panel } from "./PanelTable"

function ScrollableListModal({ title, items, renderContent, countNoun = "item", onClose }) {
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
      <div className="internal-modal internal-modal--list" onClick={(event) => event.stopPropagation()}>
        <header className="internal-modal-header">
          <div className="internal-modal-header-copy">
            <h3>{title}</h3>
            <p>Expanded list view for internal review.</p>
          </div>
          <div className="internal-modal-header-actions">
            <span className="internal-modal-count">
              {items.length} {items.length === 1 ? countNoun : `${countNoun}s`}
            </span>
            <button type="button" className="secondary-action internal-modal-close" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="internal-modal-body internal-modal-body--list">
          {renderContent(items)}
        </div>
      </div>
    </div>
  )
}

export default function PreviewListPanel({
  title,
  subtitle = "",
  items,
  previewLimit = 4,
  modalTitle = "",
  countNoun = "item",
  actions = null,
  renderContent,
}) {
  const [open, setOpen] = useState(false)
  const safeItems = Array.isArray(items) ? items : []
  const previewItems = useMemo(() => safeItems.slice(0, previewLimit), [safeItems, previewLimit])
  const hasOverflow = safeItems.length > previewLimit

  const resolvedActions = typeof actions === "function"
    ? actions({ hasOverflow, totalCount: safeItems.length, openModal: () => setOpen(true) })
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
                <strong>{safeItems.length}</strong>
              </button>
            ) : null}
          </div>
        }
      >
        {renderContent(previewItems)}
        {hasOverflow ? (
          <p className="panel-note">Showing {previewItems.length} of {safeItems.length} {safeItems.length === 1 ? countNoun : `${countNoun}s`}.</p>
        ) : null}
      </Panel>

      {open ? (
        <ScrollableListModal
          title={modalTitle || title}
          items={safeItems}
          renderContent={renderContent}
          countNoun={countNoun}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
