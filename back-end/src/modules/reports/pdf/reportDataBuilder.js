import { buildPdfSummary } from "../reports.export.service.js"

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toInteger(value) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : null
}

function toIso(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function safePercent(numerator, denominator) {
  const num = toNumber(numerator)
  const den = toNumber(denominator)
  if (num === null || den === null) return null
  if (den === 0) return 0
  return (num / den) * 100
}

function safeText(value) {
  const text = String(value || "").trim()
  return text || "No data"
}

const SAFE_AUDIT_DETAIL_KEYS = new Set([
  "status",
  "fromstatus",
  "tostatus",
  "section",
  "saved",
  "count",
  "created",
  "updated",
  "resolved",
  "reportrunid",
  "deliveryop",
  "readingops",
  "rowid",
  "reason",
  "note",
  "thresholdpct",
  "totalrows",
  "fromdate",
  "todate",
  "litres",
  "revenue",
  "txcount",
  "queueenabled",
  "position",
  "stationname",
  "pumpnumber",
  "nozzlenumber",
  "tankname",
  "fueltype",
  "paymentmethod",
])

const AUDIT_KEY_LABELS = {
  status: "Status",
  fromstatus: "From",
  tostatus: "To",
  section: "Section",
  saved: "Saved",
  count: "Count",
  created: "Created",
  updated: "Updated",
  resolved: "Resolved",
  reportrunid: "Report Run",
  deliveryop: "Delivery",
  readingops: "Readings",
  rowid: "Row",
  reason: "Reason",
  note: "Note",
  thresholdpct: "Threshold %",
  totalrows: "Rows",
  fromdate: "From Date",
  todate: "To Date",
  litres: "Litres",
  revenue: "Revenue",
  txcount: "Transactions",
  queueenabled: "Queue Enabled",
  position: "Position",
  stationname: "Station",
  pumpnumber: "Pump",
  nozzlenumber: "Nozzle",
  tankname: "Tank",
  fueltype: "Fuel Type",
  paymentmethod: "Payment",
}

function normalizeAuditKey(key) {
  return String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

function humanizeAuditKey(key) {
  const normalizedKey = normalizeAuditKey(key)
  if (AUDIT_KEY_LABELS[normalizedKey]) return AUDIT_KEY_LABELS[normalizedKey]
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
}

function summarizeAuditValue(value) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    return trimmed.length > 48 ? `${trimmed.slice(0, 45)}...` : trimmed
  }
  if (Array.isArray(value)) return `${value.length} items`
  if (typeof value === "object") {
    const keyCount = Object.keys(value).length
    return keyCount > 0 ? `${keyCount} fields` : null
  }
  return null
}

function summarizeAuditPayload(payload, actionType) {
  const actionLabel = safeText(actionType)
    .toLowerCase()
    .replace(/_/g, " ")
  const actionFallback = `${actionLabel.charAt(0).toUpperCase()}${actionLabel.slice(1)} recorded`

  if (payload === null || payload === undefined || payload === "") return "No data"

  let parsedPayload = payload
  if (typeof payload === "string") {
    const trimmedPayload = payload.trim()
    if (!trimmedPayload) return "No data"
    try {
      parsedPayload = JSON.parse(trimmedPayload)
    } catch {
      return actionFallback
    }
  }

  if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
    return actionFallback
  }

  const detailParts = []
  for (const [key, value] of Object.entries(parsedPayload)) {
    const normalizedKey = normalizeAuditKey(key)
    if (!SAFE_AUDIT_DETAIL_KEYS.has(normalizedKey)) continue
    const safeValue = summarizeAuditValue(value)
    if (!safeValue) continue
    detailParts.push(`${humanizeAuditKey(key)}: ${safeValue}`)
    if (detailParts.length >= 3) break
  }

  return detailParts.length ? detailParts.join(" | ") : actionFallback
}

function normalizeReconciliationRows(rows) {
  return (rows || []).map((row) => ({
    fuelType: safeText(row.fuel_code),
    tankName: safeText(row.tank_name),
    ...(() => {
      const opening = toNumber(row.opening_litres)
      const deliveries = toNumber(row.delivered_litres)
      const closing = toNumber(row.closing_litres)
      const recordedSales = toNumber(row.recorded_litres)
      const computedBookSales =
        opening !== null && deliveries !== null && closing !== null
          ? opening + deliveries - closing
          : null
      const bookSales = toNumber(row.book_sales) ?? computedBookSales
      const varianceLitres =
        recordedSales !== null && bookSales !== null
          ? recordedSales - bookSales
          : toNumber(row.variance_litres)
      const variancePct = safePercent(varianceLitres, bookSales)
      const attentionNeeded = variancePct !== null && Math.abs(variancePct) > 0.5
      const dataMissing = opening === null || deliveries === null || closing === null || recordedSales === null

      return {
        opening,
        deliveries,
        closing,
        bookSales,
        recordedSales,
        varianceLitres,
        variancePct,
        attentionNeeded,
        dataMissing,
      }
    })(),
  }))
}

function normalizeSalesByFuelTypeRows(rows) {
  return (rows || []).map((row) => ({
    fuelType: safeText(row.fuel_code),
    litres: toNumber(row.litres),
    revenue: toNumber(row.revenue),
    txCount: toInteger(row.tx_count),
    avgPrice: toNumber(row.avg_price),
  }))
}

function normalizeSalesByDayRows(rows) {
  return (rows || []).map((row) => ({
    day: toIso(row.day_date),
    litres: toNumber(row.litres),
    revenue: toNumber(row.revenue),
    txCount: toInteger(row.tx_count),
  }))
}

function normalizeSalesByPaymentRows(rows) {
  return (rows || []).map((row) => ({
    paymentMethod: safeText(row.payment_method),
    litres: toNumber(row.litres),
    revenue: toNumber(row.revenue),
    txCount: toInteger(row.tx_count),
  }))
}

function normalizePumpRows(rows) {
  return (rows || []).map((row) => ({
    pumpNumber: toInteger(row.pump_number),
    fuelType: safeText(row.fuel_code),
    ...(() => {
      const litres = toNumber(row.litres_dispensed)
      const revenue = toNumber(row.revenue)
      const expectedLitres = toNumber(row.expected_litres ?? row.expectedLitres)
      const expectedRevenue = toNumber(row.expected_revenue ?? row.expectedRevenue)
      const varianceLitres =
        litres !== null && expectedLitres !== null
          ? litres - expectedLitres
          : null
      const variancePct = expectedLitres === null ? null : safePercent(varianceLitres, expectedLitres)
      const revenueVariance =
        revenue !== null && expectedRevenue !== null
          ? revenue - expectedRevenue
          : null
      const revenueVariancePct = expectedRevenue === null ? null : safePercent(revenueVariance, expectedRevenue)
      const attentionNeeded = variancePct !== null && Math.abs(variancePct) > 0.5
      return {
        litres,
        revenue,
        expectedLitres,
        varianceLitres,
        variancePct,
        expectedRevenue,
        revenueVariance,
        revenueVariancePct,
        attentionNeeded,
      }
    })(),
    txCount: toInteger(row.tx_count),
    status: safeText(row.status),
    timesPaused: toInteger(row.paused_count),
    timesOffline: toInteger(row.offline_count),
  }))
}

function normalizeNozzleRows(rows) {
  return (rows || []).map((row) => ({
    pumpNumber: toInteger(row.pump_number),
    nozzleNumber: safeText(row.nozzle_number),
    side: safeText(row.side),
    fuelType: safeText(row.fuel_code),
    status: safeText(row.status),
    txCount: toInteger(row.tx_count),
    litres: toNumber(row.litres_dispensed),
    revenue: toNumber(row.revenue),
  }))
}

function normalizeTargetMap(targetMap) {
  if (!targetMap || typeof targetMap !== "object" || Array.isArray(targetMap)) return null
  const normalized = {}
  for (const [key, value] of Object.entries(targetMap)) {
    if (!value || typeof value !== "object") continue
    normalized[key] = {
      litresTarget: toNumber(value.litresTarget ?? value.litres_target),
      revenueTarget: toNumber(value.revenueTarget ?? value.revenue_target),
    }
  }
  return Object.keys(normalized).length ? normalized : null
}

function normalizeSalesTargets(targets) {
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) return null
  const normalized = {
    byFuelType: normalizeTargetMap(targets.byFuelType || targets.by_fuel_type),
    byDay: normalizeTargetMap(targets.byDay || targets.by_day),
    byPaymentMethod: normalizeTargetMap(targets.byPaymentMethod || targets.by_payment_method),
  }
  return normalized.byFuelType || normalized.byDay || normalized.byPaymentMethod ? normalized : null
}

function normalizeInventoryMovementRows(rows) {
  return (rows || [])
    .map((row) => ({
      time: toIso(row.event_time),
      eventType: safeText(row.event_type),
      tankName: safeText(row.tank_name),
      litres: toNumber(row.litres),
      supplierName: row.event_type === "Delivery" ? safeText(row.supplier_name) : null,
      recordedBy: safeText(row.recorded_by),
    }))
    .sort((a, b) => {
      const left = a.time ? Date.parse(a.time) : 0
      const right = b.time ? Date.parse(b.time) : 0
      return left - right
    })
}

function normalizeIncidentRows(rows) {
  return (rows || [])
    .map((row) => ({
      createdAt: toIso(row.created_at),
      severity: safeText(row.severity),
      category: safeText(row.category),
      title: safeText(row.title),
      description: safeText(row.description),
      status: safeText(row.status),
    }))
    .sort((a, b) => {
      const left = a.createdAt ? Date.parse(a.createdAt) : 0
      const right = b.createdAt ? Date.parse(b.createdAt) : 0
      return left - right
    })
}

function normalizeAuditRows(rows) {
  return (rows || [])
    .map((row) => ({
      createdAt: toIso(row.created_at),
      actor: safeText(row.actor_name),
      actionType: safeText(row.action_type),
      details: summarizeAuditPayload(row.payload, row.action_type),
    }))
    .sort((a, b) => {
      const left = a.createdAt ? Date.parse(a.createdAt) : 0
      const right = b.createdAt ? Date.parse(b.createdAt) : 0
      return left - right
    })
}

function normalizeNoteRows(rows) {
  return (rows || []).map((row) => ({
    createdAt: toIso(row.created_at),
    author: safeText(row.full_name),
    text: safeText(row.note_text),
  }))
}

function calcRowCounts(sections) {
  return {
    reconciliation: sections.reconciliationRows.length,
    salesByFuelType: sections.salesByFuelTypeRows.length,
    salesByDay: sections.salesByDayRows.length,
    salesByPayment: sections.salesByPaymentRows.length,
    pumps: sections.pumpRows.length,
    nozzles: sections.nozzleRows.length,
    queue: sections.queueEnabled ? 1 : 0,
    inventoryMovement: sections.inventoryMovementRows.length,
    incidents: sections.incidentRows.length,
    auditTrail: sections.auditTrailRows.length,
    managerNotes: sections.noteRows.length,
  }
}

export async function buildSmartLinkReportData({ station, filters, generatedBy = "Manager" }) {
  const summary = await buildPdfSummary(station, filters, generatedBy)
  const includeAuditTrail = filters?.includeAudit !== false

  const sections = {
    reconciliationRows: normalizeReconciliationRows(summary.reconciliationRows),
    salesByFuelTypeRows: normalizeSalesByFuelTypeRows(summary.salesByFuelTypeRows),
    salesByDayRows: normalizeSalesByDayRows(summary.salesByDayRows),
    salesTrendGranularity: summary.salesTrendGranularity === "HOUR" ? "HOUR" : "DAY",
    salesByPaymentRows: normalizeSalesByPaymentRows(summary.salesByPaymentRows),
    pumpRows: normalizePumpRows(summary.pumpRows),
    nozzleRows: normalizeNozzleRows(summary.nozzleRows),
    queueEnabled: Boolean(summary.queueSummary?.queueEnabled),
    queueMetrics: {
      servedCount: toInteger(summary.queueSummary?.servedCount),
      noShowCount: toInteger(summary.queueSummary?.noShowCount),
      noShowRate: toNumber(summary.queueSummary?.noShowRate),
      callsMade: toInteger(summary.queueSummary?.callsMade),
      peakQueueLength:
        typeof summary.queueSummary?.peakQueueLength === "number"
          ? toInteger(summary.queueSummary?.peakQueueLength)
          : null,
      avgWaitMin:
        typeof summary.queueSummary?.avgWaitMin === "number"
          ? toNumber(summary.queueSummary?.avgWaitMin)
          : null,
    },
    inventoryMovementRows: normalizeInventoryMovementRows(summary.inventoryMovementRows),
    incidentRows: normalizeIncidentRows(summary.incidentRows),
    auditTrailRows: includeAuditTrail ? normalizeAuditRows(summary.auditTrailRows) : [],
    includeAuditTrail,
    salesTargets: normalizeSalesTargets(summary.salesTargets),
    noteRows: normalizeNoteRows(summary.noteRows),
    signOff: {
      preparedBy: safeText(summary.signOff?.preparedBy || generatedBy),
      reviewedBy: "________________",
      preparedDate: toIso(summary.reportHeader?.generatedAt || new Date().toISOString()),
    },
  }

  const rowCounts = calcRowCounts(sections)
  const totalRowCount = Object.values(rowCounts).reduce((sum, value) => sum + Number(value || 0), 0)

  return {
    header: {
      stationName: safeText(summary.reportHeader?.stationName || station.name),
      stationPublicId: safeText(summary.reportHeader?.stationPublicId || station.public_id),
      location: safeText(summary.reportHeader?.location),
      timezone: safeText(summary.reportHeader?.timezone || station.timezone || "UTC"),
      reportType: safeText(summary.reportHeader?.reportType),
      fromDate: filters.from,
      toDate: filters.to,
      generatedAt: toIso(summary.reportHeader?.generatedAt || new Date().toISOString()),
      generatedBy: safeText(summary.reportHeader?.generatedBy || generatedBy),
    },
    kpis: {
      totalRevenue: toNumber(summary.kpis?.totalRevenue),
      totalLitresSold: toNumber(summary.kpis?.totalLitresSold),
      totalTransactions: toInteger(summary.kpis?.totalTransactions),
      weightedAvgPricePerLitre: toNumber(summary.kpis?.weightedAvgPricePerLitre),
      bookSales: toNumber(summary.kpis?.bookSales),
      recordedSales: toNumber(summary.kpis?.recordedSales),
      varianceLitres: toNumber(summary.kpis?.varianceLitres),
      variancePct: toNumber(summary.kpis?.variancePct),
    },
    sections,
    rowCounts,
    totalRowCount,
    legacySummary: summary,
  }
}
