import fs from "node:fs"
import path from "node:path"
import PDFDocument from "pdfkit"

const COLORS = {
  brand: "#295f97",
  brandSoft: "#edf3fb",
  text: "#1e3f63",
  muted: "#5e7c9d",
  border: "#cfddef",
  white: "#ffffff",
  rowAlt: "#fafcff",
  dangerSoft: "#fdecec",
  danger: "#c63b3b",
}

function n(value, digits = 2) {
  if (value == null || value === "") return ""
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}
function p(value) {
  if (value == null || value === "") return ""
  return `${Number(value || 0).toFixed(2)}%`
}
function money(value) {
  if (value == null || value === "") return ""
  return `MWK ${Number(value || 0).toLocaleString()}`
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage()
}

function hline(doc, y) {
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor(COLORS.border)
    .stroke()
}

function roundedBox(doc, x, y, w, h, fill, stroke = COLORS.border, r = 6) {
  doc.save()
  doc.roundedRect(x, y, w, h, r)
  if (fill && stroke) {
    doc.fillColor(fill).strokeColor(stroke).fillAndStroke()
  } else if (fill) {
    doc.fillColor(fill).fill()
  } else if (stroke) {
    doc.strokeColor(stroke).stroke()
  }
  doc.restore()
}

function sectionBar(doc, x, y, w, title) {
  roundedBox(doc, x, y, w, 22, COLORS.brand, null, 5)
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(title, x + 10, y + 6, { width: w - 20 })
  return y + 22
}

function textSmall(doc, str, x, y, w, align = "left", color = COLORS.muted) {
  doc.fillColor(color).font("Helvetica").fontSize(9).text(str, x, y, { width: w, align })
}

function textBold(doc, str, x, y, w, align = "left", size = 10, color = COLORS.text) {
  doc.fillColor(color).font("Helvetica-Bold").fontSize(size).text(str, x, y, { width: w, align })
}

function safeLogo(doc) {
  const logoPath = path.resolve(process.cwd(), "..", "front-end", "public", "logo13.png")
  return fs.existsSync(logoPath) ? logoPath : null
}

/**
 * A table that can be drawn inside an arbitrary box (x,y,width).
 * This is critical to support the 2-column layout like the screenshot.
 */

function drawTableAt(doc, { x, y, width }, columns, rows, opts = {}) {
  const headerHeight = opts.headerHeight ?? 21
  const rowHeight = opts.rowHeight ?? 18
  const paddingX = opts.paddingX ?? 6
  const headerTextY = opts.headerTextY ?? 6
  const rowTextY = opts.rowTextY ?? 5

  const totalWeight = columns.reduce((sum, c) => sum + (c.width || 1), 0) || 1
  const widths = columns.map((c, i) => {
    if (i === columns.length - 1) return 0
    return Math.floor((width * (c.width || 1)) / totalWeight)
  })
  const used = widths.reduce((sum, w) => sum + w, 0)
  widths[columns.length - 1] = width - used

  const drawHeader = () => {
    doc
      .save()
      .lineWidth(0.7)
      .fillColor(COLORS.brandSoft)
      .strokeColor(COLORS.border)
      .rect(x, y, width, headerHeight)
      .fillAndStroke()

    let cx = x
    columns.forEach((col, i) => {
      doc
        .fillColor(COLORS.brand)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(col.label, cx + paddingX, y + headerTextY, {
          width: widths[i] - paddingX * 2,
          ellipsis: true,
          lineBreak: false,
        })
      if (i > 0) {
        doc.moveTo(cx, y).lineTo(cx, y + headerHeight).strokeColor(COLORS.border).stroke()
      }
      cx += widths[i]
    })
    doc.restore()
    y += headerHeight
  }

  ensureSpace(doc, headerHeight + rowHeight)
  drawHeader()

  const safeRows = Array.isArray(rows) ? rows : []
  const normalizedRows = safeRows.length
    ? safeRows
    : [{ __emptyRow: true, __emptyText: opts.emptyText || "No data" }]

  normalizedRows.forEach((row, idx) => {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage()
      y = doc.page.margins.top
      ensureSpace(doc, headerHeight + rowHeight)
      drawHeader()
    }

    doc.save()
    doc.lineWidth(0.7)
    if (idx % 2 === 1) {
      doc.save()
      doc.rect(x, y, width, rowHeight).fill(COLORS.rowAlt)
      doc.restore()
    }
    doc.rect(x, y, width, rowHeight).strokeColor(COLORS.border).stroke()

    let cx = x
    columns.forEach((col, i) => {
      let value = row[col.key] ?? ""
      if (row.__emptyRow) value = i === 0 ? row.__emptyText : ""
      doc
        .fillColor(COLORS.text)
        .font("Helvetica")
        .fontSize(8)
        .text(String(value), cx + paddingX, y + rowTextY, {
          width: widths[i] - paddingX * 2,
          align: col.align || "left",
          ellipsis: true,
          lineBreak: false,
        })
      if (i > 0) {
        doc.moveTo(cx, y).lineTo(cx, y + rowHeight).strokeColor(COLORS.border).stroke()
      }
      cx += widths[i]
    })
    doc.restore()
    y += rowHeight
  })

  return y + 8
}

function drawTopHeader(doc, station, summary) {
  const pageX = doc.page.margins.left
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const topY = doc.page.margins.top
  const header = summary.reportHeader || {}
  const shellHeight = 116
  const railHeight = 18
  const panelY = topY + railHeight + 10
  const brandHeight = 40
  const titleY = panelY + brandHeight + 8
  const titleHeight = 48

  roundedBox(doc, pageX, topY, pageW, shellHeight, COLORS.white, COLORS.border, 10)
  roundedBox(doc, pageX, topY, pageW, railHeight, COLORS.brand, null, 10)
  textSmall(doc, "SMARTLINK INFRASTRUCTURE PLATFORM", pageX + 12, topY + 5, pageW * 0.6, "left", COLORS.white)
  textSmall(doc, header.reportType || "Daily Report", pageX + pageW - 132, topY + 5, 120, "right", COLORS.white)
  roundedBox(doc, pageX + 12, titleY, pageW - 24, titleHeight, COLORS.brandSoft, COLORS.border, 10)

  const logo = safeLogo(doc)
  if (logo) {
    doc.image(logo, pageX + 20, panelY + 2, { fit: [52, 36] })
  } else {
    roundedBox(doc, pageX + 20, panelY + 2, 52, 36, COLORS.white, COLORS.border, 8)
    textSmall(doc, "SL", pageX + 20, panelY + 14, 52, "center", COLORS.brand)
  }

  textSmall(doc, "Operational Reporting Suite", pageX + 82, panelY + 4, pageW * 0.42, "left", COLORS.brand)
  textBold(doc, header.stationName || station?.name || "Station Report", pageX + 82, panelY + 18, pageW * 0.42, "left", 13, COLORS.text)
  textSmall(
    doc,
    `${header.stationPublicId || "No data"} · ${header.location || "No data"}`,
    pageX + 82,
    panelY + 30,
    pageW * 0.42,
    "left",
    COLORS.muted
  )

  textSmall(doc, "Station Performance & Reconciliation", pageX + 26, titleY + 10, pageW - 52, "left", COLORS.brand)
  textBold(doc, "Executive Operations Report", pageX + 26, titleY + 22, pageW - 52, "left", 16, COLORS.text)
  textSmall(
    doc,
    `Prepared for ${header.fromDate || "No data"} — ${header.toDate || "No data"} · Currency ${summary.currency || "MWK"}`,
    pageX + 26,
    titleY + 36,
    pageW - 52,
    "left",
    COLORS.muted
  )

  const metaY = titleY + titleHeight + 10
  const metaGap = 8
  const metaW = (pageW - metaGap * 3) / 4
  const metaItems = [
    ["Report Type", header.reportType || "Daily Report"],
    ["Date Range", `${header.fromDate || "No data"} — ${header.toDate || "No data"}`],
    ["Generated At", header.generatedAt || "No data"],
    ["Generated By", header.generatedBy || "Manager"],
  ]

  metaItems.forEach(([label, value], index) => {
    const x = pageX + index * (metaW + metaGap)
    roundedBox(doc, x, metaY, metaW, 24, COLORS.white, COLORS.border, 8)
    textSmall(doc, label, x + 8, metaY + 5, metaW - 16, "left", COLORS.muted)
    textBold(doc, value, x + 8, metaY + 13, metaW - 16, "left", 9, COLORS.text)
  })

  doc.y = topY + shellHeight + 10
}

function drawKpiStrip(doc, summary) {
  const k = summary.kpis
  const pageX = doc.page.margins.left
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right

  // KPI section bar
  doc.save()
  roundedBox(doc, pageX, doc.y, pageW, 22, COLORS.brand, null, 6)
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(10).text("KPI SUMMARY", pageX + 10, doc.y + 6)
  doc.restore()
  doc.y += 30

  // 5 cards (matches screenshot feeling)
  const cards = [
    { label: "Total Revenue", value: money(k.totalRevenue) },
    { label: "Total Litres Sold", value: `${n(k.totalLitresSold, 0)} L` },
    { label: "Total Transactions", value: n(k.totalTransactions, 0) },
    { label: "Avg Price per Litre", value: money(k.weightedAvgPricePerLitre) },
    { label: "Book Sales", value: `${n(k.bookSales, 0)} L` },
  ]

  const gap = 8
  const cardW = (pageW - gap * 4) / 5
  const cardH = 48
  let x = pageX
  const y = doc.y

  cards.forEach((c) => {
    roundedBox(doc, x, y, cardW, cardH, COLORS.white, COLORS.border, 6)
    textSmall(doc, c.label, x + 8, y + 8, cardW - 16, "left", COLORS.muted)
    textBold(doc, String(c.value), x + 8, y + 24, cardW - 16, "left", 11, COLORS.text)
    x += cardW + gap
  })

  doc.y = y + cardH + 10

  // Variance callout row like screenshot (“Book Sales | Recorded | Variance | Variance %”)
  const recorded = k.recordedSales
  const varianceL = k.varianceLitres
  const variancePct = k.variancePct
  const danger = Math.abs(Number(variancePct || 0)) > 0.5

  const stripH = 28
  roundedBox(doc, pageX, doc.y, pageW, stripH, danger ? COLORS.dangerSoft : COLORS.brandSoft, COLORS.border, 6)

  const cols = [
    { label: "Book Sales:", value: `${n(k.bookSales, 0)} L` },
    { label: "Recorded Sales:", value: `${n(recorded, 0)} L` },
    { label: "Variance:", value: `${n(varianceL, 0)} L` },
    { label: "Variance %:", value: p(variancePct) + (danger ? " (Attention Needed)" : "") },
  ]

  const colW = pageW / cols.length
  cols.forEach((c, i) => {
    const cx = pageX + i * colW
    textSmall(doc, c.label, cx + 10, doc.y + 8, colW - 20, "left", COLORS.text)
    doc
      .fillColor(danger && i >= 2 ? COLORS.danger : COLORS.text)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(String(c.value), cx + 10 + 62, doc.y + 8, { width: colW - 72, align: "left", ellipsis: true })
  })

  doc.y += stripH + 14
}

function drawReconciliation(doc, summary) {
  const pageX = doc.page.margins.left
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right

  doc.y = sectionBar(doc, pageX, doc.y, pageW, "FUEL RECONCILIATION") + 10

  const columns = [
    { key: "fuel_code", label: "Fuel Type", width: 0.11 },
    { key: "tank_name", label: "Tank", width: 0.14 },
    { key: "opening_litres", label: "Opening (L)", width: 0.1, align: "right" },
    { key: "delivered_litres", label: "Deliveries (L)", width: 0.1, align: "right" },
    { key: "closing_litres", label: "Closing (L)", width: 0.1, align: "right" },
    { key: "book_sales", label: "Book Sales (L)", width: 0.1, align: "right" },
    { key: "recorded_litres", label: "Recorded (L)", width: 0.1, align: "right" },
    { key: "variance_litres", label: "Variance (L)", width: 0.1, align: "right" },
    { key: "variance_pct", label: "Variance %", width: 0.09, align: "right" },
    { key: "attention_needed", label: "Flag", width: 0.06 },
  ]

  const rows = summary.reconciliationRows.map((r) => ({
    ...r,
    opening_litres: r.opening_litres == null ? "No data" : n(r.opening_litres, 0),
    delivered_litres: r.delivered_litres == null ? "No data" : n(r.delivered_litres, 0),
    closing_litres: r.closing_litres == null ? "No data" : n(r.closing_litres, 0),
    book_sales: r.book_sales == null ? "No data" : n(r.book_sales, 0),
    recorded_litres: n(r.recorded_litres, 0),
    variance_litres: r.variance_litres == null ? "No data" : n(r.variance_litres, 0),
    variance_pct: r.variance_pct == null ? "No data" : p(r.variance_pct),
    attention_needed: r.attention_needed ? "YES" : "",
  }))

  doc.y = drawTableAt(doc, { x: pageX, y: doc.y, width: pageW }, columns, rows)
}

function drawTwoColumnSections(doc, summary, options = {}) {
  const includeAudit = options?.includeAudit !== false
  const pageX = doc.page.margins.left
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const gap = 12
  const colW = (pageW - gap) / 2

  const leftX = pageX
  const rightX = pageX + colW + gap

  // Keep independent Y positions like a newspaper layout
  let leftY = doc.y
  let rightY = doc.y

  // ---------- LEFT: SALES ANALYSIS ----------
  leftY = sectionBar(doc, leftX, leftY, colW, "SALES ANALYSIS") + 10

  // Sales by Fuel Type (small table)
  textBold(doc, "Sales by Fuel Type", leftX, leftY, colW, "left", 9, COLORS.text)
  leftY += 10
  leftY = drawTableAt(
    doc,
    { x: leftX, y: leftY, width: colW },
    [
      { key: "fuel_code", label: "Fuel", width: 0.22 },
      { key: "litres", label: "Litres", width: 0.26, align: "right" },
      { key: "revenue", label: "Revenue", width: 0.32, align: "right" },
      { key: "avg_price", label: "Avg Price", width: 0.2, align: "right" },
    ],
    summary.salesByFuelTypeRows.map((r) => ({
      ...r,
      litres: `${n(r.litres, 0)} L`,
      revenue: money(r.revenue),
      avg_price: money(r.avg_price),
    })),
    { rowHeight: 18 }
  )

  // Sales by Day
  textBold(doc, "Sales by Day", leftX, leftY, colW, "left", 9, COLORS.text)
  leftY += 10
  leftY = drawTableAt(
    doc,
    { x: leftX, y: leftY, width: colW },
    [
      { key: "day_date", label: "Date", width: 0.35 },
      { key: "litres", label: "Litres", width: 0.25, align: "right" },
      { key: "revenue", label: "Revenue", width: 0.25, align: "right" },
      { key: "tx_count", label: "Tx", width: 0.15, align: "right" },
    ],
    summary.salesByDayRows.map((r) => ({
      ...r,
      litres: `${n(r.litres, 0)} L`,
      revenue: money(r.revenue),
      tx_count: n(r.tx_count, 0),
    })),
    { rowHeight: 18 }
  )

  // Payment method (simple table)
  textBold(doc, "Sales by Payment Method", leftX, leftY, colW, "left", 9, COLORS.text)
  leftY += 10
  leftY = drawTableAt(
    doc,
    { x: leftX, y: leftY, width: colW },
    [
      { key: "payment_method", label: "Method", width: 0.45 },
      { key: "revenue", label: "Revenue", width: 0.35, align: "right" },
      { key: "tx_count", label: "Tx", width: 0.2, align: "right" },
    ],
    summary.salesByPaymentRows.map((r) => ({
      ...r,
      revenue: money(r.revenue),
      tx_count: n(r.tx_count, 0),
    })),
    { rowHeight: 18 }
  )

  // ---------- RIGHT: PUMP PERFORMANCE ----------
  rightY = sectionBar(doc, rightX, rightY, colW, "PUMP PERFORMANCE") + 10
  rightY = drawTableAt(
    doc,
    { x: rightX, y: rightY, width: colW },
    [
      { key: "pump_number", label: "Pump #", width: 0.14 },
      { key: "fuel_code", label: "Fuel", width: 0.16 },
      { key: "litres_dispensed", label: "Litres", width: 0.24, align: "right" },
      { key: "revenue", label: "Revenue", width: 0.28, align: "right" },
      { key: "status", label: "Status", width: 0.18 },
    ],
    summary.pumpRows.map((r) => ({
      ...r,
      litres_dispensed: `${n(r.litres_dispensed, 0)} L`,
      revenue: money(r.revenue),
    })),
    { rowHeight: 18 }
  )

  // Nozzle breakdown (audit layer)
  rightY = sectionBar(doc, rightX, rightY, colW, "NOZZLE BREAKDOWN") + 10
  rightY = drawTableAt(
    doc,
    { x: rightX, y: rightY, width: colW },
    [
      { key: "pump_number", label: "Pump", width: 0.15 },
      { key: "nozzle_number", label: "Nozzle", width: 0.15 },
      { key: "fuel_code", label: "Fuel", width: 0.2 },
      { key: "litres_dispensed", label: "Litres", width: 0.25, align: "right" },
      { key: "tx_count", label: "Tx", width: 0.1, align: "right" },
      { key: "status", label: "Status", width: 0.15 },
    ],
    (summary.nozzleRows || []).slice(0, 20).map((r) => ({
      ...r,
      litres_dispensed: `${n(r.litres_dispensed, 0)} L`,
      tx_count: n(r.tx_count, 0),
    })),
    { rowHeight: 18 }
  )

  // Queue performance (bullet list style like screenshot)
  rightY = sectionBar(doc, rightX, rightY, colW, "QUEUE PERFORMANCE") + 10
  roundedBox(doc, rightX, rightY, colW, 88, COLORS.white, COLORS.border, 6)
  const q = summary.queueSummary || {}
  if (!q.queueEnabled) {
    textSmall(doc, "Queue disabled", rightX + 10, rightY + 12, colW - 20, "left", COLORS.muted)
  } else {
    const lines = [
      `Served Count: ${n(q.servedCount, 0)}`,
      `No-show Rate: ${p(q.noShowRate)}`,
      `Average Wait Time: ${q.avgWaitMin ?? "Not available yet"}`,
      `Calls Made: ${n(q.callsMade, 0)}`,
    ]
    lines.forEach((line, i) => textSmall(doc, `•  ${line}`, rightX + 10, rightY + 12 + i * 18, colW - 20, "left", COLORS.text))
  }
  rightY += 88 + 12

  // Inventory movement log (small)
  rightY = sectionBar(doc, rightX, rightY, colW, "INVENTORY MOVEMENT LOG") + 10
  rightY = drawTableAt(
    doc,
    { x: rightX, y: rightY, width: colW },
    [
      { key: "event_time", label: "Time", width: 0.19 },
      { key: "event_type", label: "Event", width: 0.24 },
      { key: "tank_name", label: "Tank", width: 0.19 },
      { key: "supplier_name", label: "Supplier", width: 0.2 },
      { key: "litres", label: "Litres", width: 0.18, align: "right" },
    ],
    summary.inventoryMovementRows.map((r) => ({
      ...r,
      supplier_name: r.event_type === "Delivery" ? (r.supplier_name || "N/A") : "—",
      litres: `${n(r.litres, 0)} L`,
    })),
    { rowHeight: 18 }
  )

  if (includeAudit) {
    // Audit trail (small)
    rightY = sectionBar(doc, rightX, rightY, colW, "AUDIT TRAIL") + 10
    rightY = drawTableAt(
      doc,
      { x: rightX, y: rightY, width: colW },
      [
        { key: "created_at", label: "Time", width: 0.34 },
        { key: "action_type", label: "Action", width: 0.42 },
        { key: "actor_name", label: "Actor", width: 0.24 },
      ],
      (summary.auditTrailRows || []).map((r) => ({
        ...r,
        actor_name: r.actor_name || "N/A",
      })),
      { rowHeight: 18 }
    )
  }

  rightY = sectionBar(doc, rightX, rightY, colW, "EXCEPTIONS") + 10
  rightY = drawTableAt(
    doc,
    { x: rightX, y: rightY, width: colW },
    [
      { key: "exception_type", label: "Type", width: 0.65 },
      { key: "exception_count", label: "Count", width: 0.35, align: "right" },
    ],
    (summary.exceptionRows || []).map((r) => ({
      ...r,
      exception_count: n(r.exception_count, 0),
    })),
    { rowHeight: 18 }
  )

  // Notes + Sign off (bottom, full width if space; else new page)
  const nextY = Math.max(leftY, rightY)
  doc.y = nextY

  // Manager Notes (right column feel but full width is fine)
  ensureSpace(doc, 160)
  doc.y = sectionBar(doc, pageX, doc.y, pageW, "MANAGER NOTES") + 10
  roundedBox(doc, pageX, doc.y, pageW, 70, COLORS.white, COLORS.border, 6)
  textSmall(doc, "Observations:", pageX + 10, doc.y + 10, pageW - 20, "left", COLORS.text)
  // lines
  doc
    .strokeColor(COLORS.border)
    .moveTo(pageX + 10, doc.y + 30)
    .lineTo(pageX + pageW - 10, doc.y + 30)
    .stroke()
  doc
    .moveTo(pageX + 10, doc.y + 48)
    .lineTo(pageX + pageW - 10, doc.y + 48)
    .stroke()
  doc
    .moveTo(pageX + 10, doc.y + 66)
    .lineTo(pageX + pageW - 10, doc.y + 66)
    .stroke()

  doc.y += 70 + 12

  ensureSpace(doc, 120)
  doc.y = sectionBar(doc, pageX, doc.y, pageW, "SIGN OFF") + 10
  roundedBox(doc, pageX, doc.y, pageW, 70, COLORS.white, COLORS.border, 6)

  textSmall(doc, "Prepared By:", pageX + 10, doc.y + 12, 120, "left", COLORS.text)
  textSmall(doc, "Reviewed By:", pageX + pageW / 2 + 10, doc.y + 12, 120, "left", COLORS.text)

  doc.strokeColor(COLORS.border)
  doc.moveTo(pageX + 95, doc.y + 24).lineTo(pageX + pageW / 2 - 10, doc.y + 24).stroke()
  doc.moveTo(pageX + pageW / 2 + 95, doc.y + 24).lineTo(pageX + pageW - 10, doc.y + 24).stroke()

  textSmall(doc, "Signature:", pageX + 10, doc.y + 40, 120, "left", COLORS.text)
  doc.moveTo(pageX + 75, doc.y + 52).lineTo(pageX + pageW / 2 - 10, doc.y + 52).stroke()

  textSmall(doc, "Date:", pageX + pageW / 2 + 10, doc.y + 40, 60, "left", COLORS.text)
  doc.moveTo(pageX + pageW / 2 + 45, doc.y + 52).lineTo(pageX + pageW - 10, doc.y + 52).stroke()

  doc.y += 70 + 10
}

export function streamReportPdf({ res, station, filters, generatedAt: _generatedAt, summary }) {
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true })

  // IMPORTANT: Your caller should set headers. If not, do it here:
  // res.setHeader("Content-Type", "application/pdf")
  // res.setHeader("Cache-Control", "no-store")

  doc.pipe(res)

  // --- Top header like the screenshot ---
  drawTopHeader(doc, station, summary)

  // --- KPI strip like the screenshot ---
  drawKpiStrip(doc, summary)

  // --- Reconciliation table full width ---
  drawReconciliation(doc, summary)

  // --- Two-column block like the screenshot ---
  drawTwoColumnSections(doc, summary, { includeAudit: filters?.includeAudit !== false })

  doc.end()
}
