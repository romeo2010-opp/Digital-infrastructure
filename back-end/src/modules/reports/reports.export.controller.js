import { asyncHandler } from "../../utils/asyncHandler.js"
import { parseExportQuery } from "./reports.export.schemas.js"
import {
  appendExportAudit,
  contentDispositionAttachment,
  fetchSectionRows,
  resolveExportContext,
  safeFilenamePart,
} from "./reports.export.service.js"
import { writeCsvResponse } from "./reports.export.csv.js"
import { streamReportPdf } from "./reports.export.pdf.js"
import { buildSmartLinkReportData } from "./pdf/reportDataBuilder.js"
import { renderSmartLinkReportPdfBuffer } from "./pdf/reportRenderer.js"

function isEnabled(envValue) {
  return String(envValue || "false").toLowerCase() === "true"
}

export const exportCsvHandler = asyncHandler(async (req, res) => {
  const { stationPublicId } = req.params
  const filters = parseExportQuery(req.query, { requireSection: true })
  const { station, actorStaffId, generatedBy } = await resolveExportContext(stationPublicId, req.auth?.userId)
  const section = filters.section

  const { columns, rows } = await fetchSectionRows(station.id, filters, section, { timezone: station.timezone || "UTC" })
  const filename = `smartlink_${safeFilenamePart(station.public_id)}_${safeFilenamePart(section)}_${filters.from}_to_${filters.to}.csv`

  res.status(200)
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", contentDispositionAttachment(filename))
  res.setHeader("Cache-Control", "no-store")

  writeCsvResponse({ res, columns, rows })
  res.end()

  await appendExportAudit({
    stationId: station.id,
    actorStaffId,
    actionType: "REPORT_EXPORT_CSV",
    section,
    filters,
    rowCount: rows.length,
    generatedBy,
  })
})

export const exportPdfHandler = asyncHandler(async (req, res) => {
  const allowPdfKitFallback = isEnabled(process.env.REPORT_PDF_ALLOW_PDFKIT_FALLBACK)
  const { stationPublicId } = req.params
  const filters = parseExportQuery(req.query, { requireSection: false })
  const { station, actorStaffId, generatedBy } = await resolveExportContext(stationPublicId, req.auth?.userId)
  const reportData = await buildSmartLinkReportData({
    station,
    filters,
    generatedBy,
  })
  const filename = `smartlink_${safeFilenamePart(station.name || station.public_id)}_report_${filters.from}_to_${filters.to}.pdf`

  res.status(200)
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", contentDispositionAttachment(filename))
  res.setHeader("Cache-Control", "no-store")

  try {
    const buffer = await renderSmartLinkReportPdfBuffer(reportData)
    res.setHeader("X-Report-Renderer", "puppeteer")
    res.end(buffer)
  } catch (error) {
    const isRendererError =
      error?.code === "PUPPETEER_UNAVAILABLE" || error?.code === "PUPPETEER_RENDER_FAILED"

    if (!isRendererError) {
      throw error
    }

    if (!allowPdfKitFallback) {
      const renderError = new Error(
        `${error?.message || "Puppeteer renderer failed"} ` +
          "(PDFKit fallback is disabled. Install/configure Puppeteer or set REPORT_PDF_ALLOW_PDFKIT_FALLBACK=true.)"
      )
      renderError.status = 500
      throw renderError
    }

    res.setHeader("X-Report-Renderer", "pdfkit-fallback")
    streamReportPdf({
      res,
      station,
      filters,
      generatedAt: reportData.header.generatedAt,
      summary: reportData.legacySummary,
    })
  }

  await appendExportAudit({
    stationId: station.id,
    actorStaffId,
    actionType: "REPORT_EXPORT_PDF",
    section: "full_report",
    filters,
    rowCount: reportData.totalRowCount,
    rowCounts: reportData.rowCounts,
    generatedBy,
  })
})
