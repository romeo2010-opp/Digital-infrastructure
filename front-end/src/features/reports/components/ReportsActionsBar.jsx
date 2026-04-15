import { useState } from "react"
import { formatDateTime } from "../../../utils/dateTime"

export default function ReportsActionsBar({
  run,
  isFinal,
  isExporting = false,
  canExport = true,
  exportNotice = "",
  onGenerate,
  onRefresh,
  onExportCsv,
  onExportPdf,
  includeAuditInPdf,
  onIncludeAuditChange,
  toast,
}) {
  const [showPdfExportModal, setShowPdfExportModal] = useState(false)

  function openPdfExportModal() {
    setShowPdfExportModal(true)
  }

  function closePdfExportModal() {
    setShowPdfExportModal(false)
  }

  function confirmPdfExport() {
    onExportPdf?.()
    setShowPdfExportModal(false)
  }

  return (
    <>
      <section className="reports-panel reports-actions">
        <div className="reports-run-meta">
          <strong>Run: {run?.id || "-"}</strong>
          <small>Created: {formatDateTime(run?.createdAt)}</small>
          <small>Status: {run?.status || "-"}</small>
        </div>

        <div className="reports-actions-buttons">
          <button type="button" onClick={onGenerate} disabled={isFinal || isExporting}>Generate Report</button>
          <button type="button" onClick={onRefresh} disabled={isExporting}>Refresh</button>
          {canExport ? <button type="button" onClick={onExportCsv} disabled={isExporting}>Export CSV</button> : null}
          {canExport ? <button type="button" onClick={openPdfExportModal} disabled={isExporting}>Export PDF</button> : null}
        </div>

        {!canExport && exportNotice ? <p className="reports-toast">{exportNotice}</p> : null}
        {toast ? <p className="reports-toast">{toast}</p> : null}
      </section>

      {showPdfExportModal && canExport ? (
        <div
          className="reports-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="PDF Export Options"
          onClick={closePdfExportModal}
        >
          <div className="reports-modal reports-export-modal" onClick={(event) => event.stopPropagation()}>
            <h4>Export PDF Options</h4>
            <div className="reports-form-grid">
              <label className="reports-export-option">
                <input
                  type="checkbox"
                  checked={includeAuditInPdf}
                  onChange={(event) => onIncludeAuditChange?.(event.target.checked)}
                />
                <span>Include audit logs in PDF</span>
              </label>
              <p className="reports-export-modal-copy">
                Choose whether to include the Audit Trail section in the exported PDF.
              </p>
            </div>
            <div className="reports-export-modal-actions">
              <button type="button" className="reports-export-modal-cancel" onClick={closePdfExportModal}>
                Cancel
              </button>
              <button type="button" onClick={confirmPdfExport} disabled={isExporting}>
                Download PDF
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
