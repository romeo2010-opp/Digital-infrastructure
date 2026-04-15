import { renderSmartLinkReportHtml } from "./reportTemplate.js"

const DEFAULT_RENDER_TIMEOUT_MS = Number(process.env.REPORT_PDF_RENDER_TIMEOUT_MS || 45000)
const PDF_MARGIN_MM = Number.isFinite(Number(process.env.REPORT_PDF_MARGIN_MM))
  ? Number(process.env.REPORT_PDF_MARGIN_MM)
  : 16
const PDF_FOOTER_MARGIN_MM = Number.isFinite(Number(process.env.REPORT_PDF_FOOTER_MARGIN_MM))
  ? Number(process.env.REPORT_PDF_FOOTER_MARGIN_MM)
  : 22

let puppeteerModulePromise = null

async function loadPuppeteer() {
  if (!puppeteerModulePromise) {
    puppeteerModulePromise = import("puppeteer")
      .then((mod) => mod?.default || mod)
      .catch(() => null)
  }
  return puppeteerModulePromise
}

function createRenderError(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) error.cause = cause
  return error
}

function escapeFooterHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildFooterTemplate(reportData) {
  const generatedBy = String(reportData?.header?.generatedBy || "").trim()
  const managerLabel =
    generatedBy && generatedBy.toLowerCase() !== "data missing"
      ? `${generatedBy} · Station Manager`
      : "Station Manager"

  return `
<div style="width:100%;padding:0 16mm;font-family:Segoe UI, Arial, sans-serif;font-size:8px;color:#334155;">
  <div style="display:flex;align-items:flex-end;justify-content:space-between;width:100%;">
    <div style="width:34%;">
      <div style="line-height:1.2;">System Generated Report</div>
      <div style="line-height:1.2;">SmartLink Infrastructure Platform</div>
    </div>
    <div style="width:32%;text-align:center;">
      <div style="border-top:1px solid #64748b;height:0;margin:0 auto 3px auto;width:125px;"></div>
      <div style="line-height:1.2;">${escapeFooterHtml(managerLabel)}</div>
    </div>
    <div style="width:34%;text-align:right;line-height:1.2;">
      Page <span class="pageNumber"></span> of <span class="totalPages"></span>
    </div>
  </div>
</div>`
}

export async function renderPdfBufferFromHtml({
  html,
  footerTemplate = "<div></div>",
  headerTemplate = "<div></div>",
} = {}) {
  const puppeteer = await loadPuppeteer()
  if (!puppeteer) {
    throw createRenderError(
      "PUPPETEER_UNAVAILABLE",
      "Puppeteer is not installed. Install it with `npm i puppeteer` in back-end or use PDFKit fallback."
    )
  }

  const launchTimeout = Number.isFinite(DEFAULT_RENDER_TIMEOUT_MS) ? DEFAULT_RENDER_TIMEOUT_MS : 45000
  const launchOptions = {
    headless: true,
    timeout: launchTimeout,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
    ],
  }

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  }

  let browser
  try {
    browser = await puppeteer.launch(launchOptions)
    const page = await browser.newPage()
    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: launchTimeout,
    })
    const buffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: {
        top: `${PDF_MARGIN_MM}mm`,
        right: `${PDF_MARGIN_MM}mm`,
        bottom: `${PDF_FOOTER_MARGIN_MM}mm`,
        left: `${PDF_MARGIN_MM}mm`,
      },
      timeout: launchTimeout,
    })
    return buffer
  } catch (error) {
    throw createRenderError(
      "PUPPETEER_RENDER_FAILED",
      `Failed to render report PDF with Puppeteer: ${error?.message || "Unknown renderer error"}`,
      error
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}

export async function renderSmartLinkReportPdfBuffer(reportData) {
  const html = renderSmartLinkReportHtml(reportData)
  return renderPdfBufferFromHtml({
    html,
    footerTemplate: buildFooterTemplate(reportData),
  })
}
