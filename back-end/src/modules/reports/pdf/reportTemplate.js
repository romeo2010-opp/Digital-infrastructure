import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const stylesPath = path.join(__dirname, "reportStyles.css")
const reportStyles = fs.readFileSync(stylesPath, "utf8")
const frontEndLogoPath = path.resolve(__dirname, "../../../../../front-end/public/logo13.png")

let cachedLogoDataUri = null

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function parseDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function getInlineLogoDataUri() {
  if (cachedLogoDataUri !== null) return cachedLogoDataUri

  try {
    const logoBuffer = fs.readFileSync(frontEndLogoPath)
    cachedLogoDataUri = `data:image/png;base64,${logoBuffer.toString("base64")}`
    return cachedLogoDataUri
  } catch {
    cachedLogoDataUri = ""
    return cachedLogoDataUri
  }
}

function numberOrMissing(value) {
  if (value === null || value === undefined || value === "") return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatNumber(value, digits = 2) {
  const num = numberOrMissing(value)
  if (num === null) return "No data"
  return num.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatInteger(value) {
  const num = numberOrMissing(value)
  if (num === null) return "No data"
  return Math.trunc(num).toLocaleString(undefined)
}

function formatMoney(value, currencyCode = "MWK") {
  const num = numberOrMissing(value)
  if (num === null) return "No data"
  return `${currencyCode} ${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatLitres(value, digits = 0) {
  const num = numberOrMissing(value)
  if (num === null) return "No data"
  return `${num.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} L`
}

function formatPercent(value) {
  const num = numberOrMissing(value)
  if (num === null) return "No data"
  return `${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

function safePercent(numerator, denominator) {
  const num = numberOrMissing(numerator)
  const den = numberOrMissing(denominator)
  if (num === null || den === null) return null
  if (den === 0) return 0
  return (num / den) * 100
}

function formatSignedNumber(value, digits = 2) {
  const num = numberOrMissing(value)
  if (num === null) return "No data"
  const absValue = Math.abs(num).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  const sign = num >= 0 ? "+" : "-"
  return `${sign}${absValue}`
}

function formatSignedMoney(value, currencyCode = "MWK") {
  const num = numberOrMissing(value)
  if (num === null) return "No data"
  const absValue = Math.abs(num).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const sign = num >= 0 ? "+" : "-"
  return `${sign}${currencyCode} ${absValue}`
}

function formatSignedPercent(value) {
  const num = numberOrMissing(value)
  if (num === null) return "No data"
  const absValue = Math.abs(num).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const sign = num >= 0 ? "+" : "-"
  return `${sign}${absValue}%`
}

function emDash() {
  return "—"
}

function toDayKey(value) {
  const date = parseDate(value)
  if (!date) return null
  return date.toISOString().slice(0, 10)
}

function findTarget(targetMap, key) {
  if (!targetMap || !key) return null
  if (Object.prototype.hasOwnProperty.call(targetMap, key)) return targetMap[key]
  const loweredKey = String(key).toLowerCase()
  for (const [entryKey, entryValue] of Object.entries(targetMap)) {
    if (String(entryKey).toLowerCase() === loweredKey) return entryValue
  }
  return null
}

function formatDate(value, timeZone) {
  const date = parseDate(value)
  if (!date) return "No data"

  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date)
}

function formatDateTime(value, timeZone) {
  const date = parseDate(value)
  if (!date) return "No data"

  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

function formatTime(value, timeZone) {
  const date = parseDate(value)
  if (!date) return "No data"

  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function tableHtml({ columns, rows, emptyMessage = "No data", className = "" }) {
  const hasRows = Array.isArray(rows) && rows.length > 0
  const thead = `<thead><tr>${columns
    .map((column) => `<th class="${escapeHtml(column.className || "")}">${escapeHtml(column.label)}</th>`)
    .join("")}</tr></thead>`

  const tbody = hasRows
    ? `<tbody>${rows
        .map((row) => {
          const rowClassName = typeof row._rowClass === "string" ? row._rowClass : ""
          const cells = columns
            .map((column) => {
              const rawValue = column.render ? column.render(row) : row?.[column.key]
              const normalized = rawValue === null || rawValue === undefined || rawValue === "" ? "No data" : rawValue
              const content = column.isHtml ? String(normalized) : escapeHtml(normalized)
              return `<td class="${escapeHtml(column.className || "")}">${content}</td>`
            })
            .join("")

          return `<tr class="${escapeHtml(rowClassName)}">${cells}</tr>`
        })
        .join("")}</tbody>`
    : `<tbody><tr><td colspan="${columns.length}" class="muted">${escapeHtml(emptyMessage)}</td></tr></tbody>`

  return `<table class="${escapeHtml(className)}">${thead}${tbody}</table>`
}

function section(title, bodyHtml, subtitle = "") {
  return `<section class="report-section"><header class="section-title-row"><h2>${escapeHtml(title)}</h2>${
    subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""
  }</header><div class="section-content">${bodyHtml}</div></section>`
}

function keyValue(label, value) {
  return `<div class="kv"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

export function renderSmartLinkReportHtml(reportData) {
  const { header, kpis, sections } = reportData
  const timeZone = header.timezone || "UTC"
  const currencyCode = header.currencyCode || process.env.REPORT_PDF_CURRENCY || "MWK"
  const includeAuditTrail = sections?.includeAuditTrail !== false
  const variancePctValue = numberOrMissing(kpis.variancePct)
  const requiresAttention = variancePctValue !== null ? Math.abs(variancePctValue) > 0.5 : false
  const logoDataUri = getInlineLogoDataUri()

  const reconciliationRows = (sections.reconciliationRows || []).map((row) => {
    const opening = numberOrMissing(row.opening)
    const deliveries = numberOrMissing(row.deliveries)
    const closing = numberOrMissing(row.closing)
    const recordedSales = numberOrMissing(row.recordedSales)
    const computedBookSales =
      opening !== null && deliveries !== null && closing !== null
        ? opening + deliveries - closing
        : null
    const bookSales = numberOrMissing(row.bookSales) ?? computedBookSales
    const varianceLitres =
      recordedSales !== null && bookSales !== null
        ? recordedSales - bookSales
        : numberOrMissing(row.varianceLitres)
    const variancePct = safePercent(varianceLitres, bookSales)
    const attentionNeeded = variancePct !== null && Math.abs(variancePct) > 0.5
    return {
      ...row,
      opening,
      deliveries,
      closing,
      bookSales,
      recordedSales,
      varianceLitres,
      variancePct,
      attentionNeeded,
    }
  })

  const reconciliationTable = tableHtml({
    columns: [
      { key: "fuelType", label: "Fuel Type" },
      { key: "tankName", label: "Tank" },
      { key: "opening", label: "Opening (L)", className: "num", render: (row) => formatNumber(row.opening, 2) },
      { key: "deliveries", label: "Deliveries (L)", className: "num", render: (row) => formatNumber(row.deliveries, 2) },
      { key: "closing", label: "Closing (L)", className: "num", render: (row) => formatNumber(row.closing, 2) },
      { key: "bookSales", label: "Book Sales (L)", className: "num", render: (row) => formatNumber(row.bookSales, 2) },
      { key: "recordedSales", label: "Recorded Sales (L)", className: "num", render: (row) => formatNumber(row.recordedSales, 2) },
      {
        key: "varianceLitres",
        label: "Variance (L)",
        className: "num",
        render: (row) =>
          row.varianceLitres === null ? "No data" : `${formatSignedNumber(row.varianceLitres, 2)} L`,
      },
      {
        key: "variancePct",
        label: "Variance %",
        className: "num",
        render: (row) => {
          if (row.variancePct === null) return "No data"
          const variancePctLabel = formatSignedPercent(row.variancePct)
          if (row.attentionNeeded) {
            return `<span class="text-attention">${escapeHtml(variancePctLabel)} (Attention Needed)</span>`
          }
          return variancePctLabel
        },
        isHtml: true,
      },
    ],
    rows: reconciliationRows,
  })

  const salesTargets = sections.salesTargets || null
  const salesTargetsByFuelType = salesTargets?.byFuelType || null
  const salesTargetsByDay = salesTargets?.byDay || null
  const salesTargetsByPaymentMethod = salesTargets?.byPaymentMethod || null
  const salesTrendGranularity = sections.salesTrendGranularity === "HOUR" ? "HOUR" : "DAY"

  const salesByFuelTypeColumns = [
    { key: "fuelType", label: "Fuel Type" },
    { key: "litres", label: "Litres", className: "num", render: (row) => formatLitres(row.litres, 0) },
    { key: "revenue", label: "Revenue", className: "num", render: (row) => formatMoney(row.revenue, currencyCode) },
    { key: "avgPrice", label: "Avg Price / L", className: "num", render: (row) => formatMoney(row.avgPrice, currencyCode) },
  ]
  if (salesTargetsByFuelType) {
    salesByFuelTypeColumns.push(
      {
        key: "targetLitres",
        label: "Target Litres",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByFuelType, row.fuelType)
          return target?.litresTarget == null ? emDash() : formatLitres(target.litresTarget, 0)
        },
      },
      {
        key: "varianceLitres",
        label: "Var L",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByFuelType, row.fuelType)
          const litres = numberOrMissing(row.litres)
          if (target?.litresTarget == null || litres == null) return emDash()
          return `${formatSignedNumber(litres - target.litresTarget, 2)} L`
        },
      },
      {
        key: "varianceLitresPct",
        label: "Var %",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByFuelType, row.fuelType)
          const litres = numberOrMissing(row.litres)
          if (target?.litresTarget == null || litres == null) return emDash()
          const pct = safePercent(litres - target.litresTarget, target.litresTarget)
          if (pct === null) return emDash()
          const label = formatSignedPercent(pct)
          return Math.abs(pct) > 0.5 ? `<span class="text-attention">${escapeHtml(label)}</span>` : label
        },
        isHtml: true,
      },
      {
        key: "targetRevenue",
        label: "Target Revenue",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByFuelType, row.fuelType)
          return target?.revenueTarget == null ? emDash() : formatMoney(target.revenueTarget, currencyCode)
        },
      },
      {
        key: "varianceRevenue",
        label: "Var Revenue",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByFuelType, row.fuelType)
          const revenue = numberOrMissing(row.revenue)
          if (target?.revenueTarget == null || revenue == null) return emDash()
          return formatSignedMoney(revenue - target.revenueTarget, currencyCode)
        },
      },
      {
        key: "varianceRevenuePct",
        label: "Var %",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByFuelType, row.fuelType)
          const revenue = numberOrMissing(row.revenue)
          if (target?.revenueTarget == null || revenue == null) return emDash()
          const pct = safePercent(revenue - target.revenueTarget, target.revenueTarget)
          if (pct === null) return emDash()
          const label = formatSignedPercent(pct)
          return Math.abs(pct) > 0.5 ? `<span class="text-attention">${escapeHtml(label)}</span>` : label
        },
        isHtml: true,
      }
    )
  }
  const salesByFuelTypeTable = tableHtml({
    columns: salesByFuelTypeColumns,
    rows: sections.salesByFuelTypeRows || [],
    className: "table-compact",
  })

  const salesByDayColumns = [
    {
      key: "day",
      label: salesTrendGranularity === "HOUR" ? "Hour" : "Day",
      render: (row) => (salesTrendGranularity === "HOUR" ? formatTime(row.day, timeZone) : formatDate(row.day, timeZone)),
    },
    { key: "litres", label: "Litres", className: "num", render: (row) => formatLitres(row.litres, 0) },
    { key: "revenue", label: "Revenue", className: "num", render: (row) => formatMoney(row.revenue, currencyCode) },
    { key: "txCount", label: "Tx Count", className: "num", render: (row) => formatInteger(row.txCount) },
  ]
  if (salesTargetsByDay && salesTrendGranularity !== "HOUR") {
    salesByDayColumns.push(
      {
        key: "targetLitres",
        label: "Target Litres",
        className: "num",
        render: (row) => {
          const dayKey = toDayKey(row.day)
          const target = dayKey ? findTarget(salesTargetsByDay, dayKey) : null
          return target?.litresTarget == null ? emDash() : formatLitres(target.litresTarget, 0)
        },
      },
      {
        key: "varianceLitres",
        label: "Var L",
        className: "num",
        render: (row) => {
          const dayKey = toDayKey(row.day)
          const target = dayKey ? findTarget(salesTargetsByDay, dayKey) : null
          const litres = numberOrMissing(row.litres)
          if (target?.litresTarget == null || litres == null) return emDash()
          return `${formatSignedNumber(litres - target.litresTarget, 2)} L`
        },
      },
      {
        key: "varianceLitresPct",
        label: "Var %",
        className: "num",
        render: (row) => {
          const dayKey = toDayKey(row.day)
          const target = dayKey ? findTarget(salesTargetsByDay, dayKey) : null
          const litres = numberOrMissing(row.litres)
          if (target?.litresTarget == null || litres == null) return emDash()
          const pct = safePercent(litres - target.litresTarget, target.litresTarget)
          if (pct === null) return emDash()
          const label = formatSignedPercent(pct)
          return Math.abs(pct) > 0.5 ? `<span class="text-attention">${escapeHtml(label)}</span>` : label
        },
        isHtml: true,
      },
      {
        key: "targetRevenue",
        label: "Target Revenue",
        className: "num",
        render: (row) => {
          const dayKey = toDayKey(row.day)
          const target = dayKey ? findTarget(salesTargetsByDay, dayKey) : null
          return target?.revenueTarget == null ? emDash() : formatMoney(target.revenueTarget, currencyCode)
        },
      },
      {
        key: "varianceRevenue",
        label: "Var Revenue",
        className: "num",
        render: (row) => {
          const dayKey = toDayKey(row.day)
          const target = dayKey ? findTarget(salesTargetsByDay, dayKey) : null
          const revenue = numberOrMissing(row.revenue)
          if (target?.revenueTarget == null || revenue == null) return emDash()
          return formatSignedMoney(revenue - target.revenueTarget, currencyCode)
        },
      },
      {
        key: "varianceRevenuePct",
        label: "Var %",
        className: "num",
        render: (row) => {
          const dayKey = toDayKey(row.day)
          const target = dayKey ? findTarget(salesTargetsByDay, dayKey) : null
          const revenue = numberOrMissing(row.revenue)
          if (target?.revenueTarget == null || revenue == null) return emDash()
          const pct = safePercent(revenue - target.revenueTarget, target.revenueTarget)
          if (pct === null) return emDash()
          const label = formatSignedPercent(pct)
          return Math.abs(pct) > 0.5 ? `<span class="text-attention">${escapeHtml(label)}</span>` : label
        },
        isHtml: true,
      }
    )
  }
  const salesByDayTable = tableHtml({
    columns: salesByDayColumns,
    rows: sections.salesByDayRows || [],
    className: "table-compact",
  })

  const salesByPaymentColumns = [
    { key: "paymentMethod", label: "Payment Method" },
    { key: "litres", label: "Litres", className: "num", render: (row) => formatLitres(row.litres, 0) },
    { key: "revenue", label: "Revenue", className: "num", render: (row) => formatMoney(row.revenue, currencyCode) },
    { key: "txCount", label: "Tx Count", className: "num", render: (row) => formatInteger(row.txCount) },
  ]
  if (salesTargetsByPaymentMethod) {
    salesByPaymentColumns.push(
      {
        key: "targetLitres",
        label: "Target Litres",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByPaymentMethod, row.paymentMethod)
          return target?.litresTarget == null ? emDash() : formatLitres(target.litresTarget, 0)
        },
      },
      {
        key: "varianceLitres",
        label: "Var L",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByPaymentMethod, row.paymentMethod)
          const litres = numberOrMissing(row.litres)
          if (target?.litresTarget == null || litres == null) return emDash()
          return `${formatSignedNumber(litres - target.litresTarget, 2)} L`
        },
      },
      {
        key: "varianceLitresPct",
        label: "Var %",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByPaymentMethod, row.paymentMethod)
          const litres = numberOrMissing(row.litres)
          if (target?.litresTarget == null || litres == null) return emDash()
          const pct = safePercent(litres - target.litresTarget, target.litresTarget)
          if (pct === null) return emDash()
          const label = formatSignedPercent(pct)
          return Math.abs(pct) > 0.5 ? `<span class="text-attention">${escapeHtml(label)}</span>` : label
        },
        isHtml: true,
      },
      {
        key: "targetRevenue",
        label: "Target Revenue",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByPaymentMethod, row.paymentMethod)
          return target?.revenueTarget == null ? emDash() : formatMoney(target.revenueTarget, currencyCode)
        },
      },
      {
        key: "varianceRevenue",
        label: "Var Revenue",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByPaymentMethod, row.paymentMethod)
          const revenue = numberOrMissing(row.revenue)
          if (target?.revenueTarget == null || revenue == null) return emDash()
          return formatSignedMoney(revenue - target.revenueTarget, currencyCode)
        },
      },
      {
        key: "varianceRevenuePct",
        label: "Var %",
        className: "num",
        render: (row) => {
          const target = findTarget(salesTargetsByPaymentMethod, row.paymentMethod)
          const revenue = numberOrMissing(row.revenue)
          if (target?.revenueTarget == null || revenue == null) return emDash()
          const pct = safePercent(revenue - target.revenueTarget, target.revenueTarget)
          if (pct === null) return emDash()
          const label = formatSignedPercent(pct)
          return Math.abs(pct) > 0.5 ? `<span class="text-attention">${escapeHtml(label)}</span>` : label
        },
        isHtml: true,
      }
    )
  }
  const salesByPaymentTable = tableHtml({
    columns: salesByPaymentColumns,
    rows: sections.salesByPaymentRows || [],
    className: "table-compact",
  })

  const pumpRows = (sections.pumpRows || []).map((row) => {
    const litres = numberOrMissing(row.litres)
    const expectedLitres = numberOrMissing(row.expectedLitres)
    const varianceLitres =
      litres !== null && expectedLitres !== null
        ? litres - expectedLitres
        : numberOrMissing(row.varianceLitres)
    const variancePct = expectedLitres === null ? null : safePercent(varianceLitres, expectedLitres)
    const revenue = numberOrMissing(row.revenue)
    const expectedRevenue = numberOrMissing(row.expectedRevenue)
    const revenueVariance =
      revenue !== null && expectedRevenue !== null
        ? revenue - expectedRevenue
        : numberOrMissing(row.revenueVariance)
    const attentionNeeded = variancePct !== null && Math.abs(variancePct) > 0.5
    return {
      ...row,
      litres,
      expectedLitres,
      varianceLitres,
      variancePct,
      revenue,
      expectedRevenue,
      revenueVariance,
      attentionNeeded,
    }
  })

  function renderStatusPill(statusValue) {
    const status = String(statusValue || "No data")
    const normalized = status.toLowerCase()
    if (normalized === "active") return `<span class="status status--active">${escapeHtml(status)}</span>`
    if (normalized === "paused" || normalized === "idle") {
      return `<span class="status status--paused">${escapeHtml(status)}</span>`
    }
    if (normalized === "offline") return `<span class="status status--offline">${escapeHtml(status)}</span>`
    return `<span class="status">${escapeHtml(status)}</span>`
  }

  const hasPumpRevenueTargets = pumpRows.some((row) => row.expectedRevenue !== null || row.revenueVariance !== null)
  const pumpColumns = [
    { key: "pumpNumber", label: "Pump #", className: "num" },
    { key: "fuelType", label: "Fuel Type" },
    { key: "litres", label: "Litres", className: "num", render: (row) => formatLitres(row.litres, 0) },
    { key: "revenue", label: "Revenue", className: "num", render: (row) => formatMoney(row.revenue, currencyCode) },
  ]
  if (hasPumpRevenueTargets) {
    pumpColumns.push(
      {
        key: "expectedRevenue",
        label: "Expected Revenue",
        className: "num",
        render: (row) =>
          row.expectedRevenue === null ? emDash() : formatMoney(row.expectedRevenue, currencyCode),
      },
      {
        key: "revenueVariance",
        label: "Revenue Variance",
        className: "num",
        render: (row) =>
          row.expectedRevenue === null || row.revenueVariance === null
            ? emDash()
            : formatSignedMoney(row.revenueVariance, currencyCode),
      }
    )
  }
  pumpColumns.push(
    { key: "txCount", label: "Tx Count", className: "num", render: (row) => formatInteger(row.txCount) },
    {
      key: "status",
      label: "Status",
      className: "status-cell",
      render: (row) => renderStatusPill(row.status),
      isHtml: true,
    },
    { key: "timesPaused", label: "Paused", className: "num", render: (row) => formatInteger(row.timesPaused) },
    { key: "timesOffline", label: "Offline", className: "num", render: (row) => formatInteger(row.timesOffline) }
  )
  const pumpTable = tableHtml({
    columns: pumpColumns,
    rows: pumpRows,
  })

  const nozzleTable = tableHtml({
    columns: [
      { key: "pumpNumber", label: "Pump #", className: "num", render: (row) => formatInteger(row.pumpNumber) },
      { key: "nozzleNumber", label: "Nozzle Label", render: (row) => row.nozzleNumber || "No data" },
      { key: "side", label: "Side" },
      { key: "fuelType", label: "Fuel Type" },
      { key: "txCount", label: "Transactions", className: "num", render: (row) => formatInteger(row.txCount) },
      { key: "litres", label: "Litres", className: "num", render: (row) => formatLitres(row.litres, 0) },
      { key: "revenue", label: "Revenue", className: "num", render: (row) => formatMoney(row.revenue, currencyCode) },
      {
        key: "status",
        label: "Status",
        className: "status-cell",
        render: (row) => renderStatusPill(row.status),
        isHtml: true,
      },
    ],
    rows: sections.nozzleRows || [],
  })

  const movementTable = tableHtml({
    columns: [
      { key: "time", label: "Time", className: "num", render: (row) => formatTime(row.time, timeZone) },
      { key: "eventType", label: "Event Type" },
      { key: "tankName", label: "Tank" },
      { key: "litres", label: "Litres", className: "num", render: (row) => formatLitres(row.litres, 0) },
      {
        key: "supplierName",
        label: "Supplier",
        render: (row) => (String(row.eventType || "").toLowerCase() === "delivery" ? row.supplierName : emDash()),
      },
      { key: "recordedBy", label: "Recorded By" },
    ],
    rows: sections.inventoryMovementRows || [],
  })

  const incidentTable = tableHtml({
    columns: [
      { key: "createdAt", label: "Time", render: (row) => formatDateTime(row.createdAt, timeZone) },
      { key: "severity", label: "Severity" },
      { key: "category", label: "Category" },
      { key: "title", label: "Title" },
      { key: "status", label: "Status" },
    ],
    rows: sections.incidentRows || [],
  })

  const auditTable = tableHtml({
    columns: [
      { key: "createdAt", label: "Time", className: "num", render: (row) => formatTime(row.createdAt, timeZone) },
      { key: "actionType", label: "Action" },
      { key: "details", label: "Details" },
      { key: "actor", label: "Actor" },
    ],
    rows: sections.auditTrailRows || [],
  })

  const queueBody = sections.queueEnabled
    ? `<div class="queue-grid">${[
        keyValue("Served Count", formatInteger(sections.queueMetrics.servedCount)),
        keyValue("No-show Rate", formatPercent(sections.queueMetrics.noShowRate)),
        keyValue(
          "Average Wait",
          sections.queueMetrics.avgWaitMin === null || sections.queueMetrics.avgWaitMin === undefined
            ? "Not available yet"
            : `${formatNumber(sections.queueMetrics.avgWaitMin, 0)} mins`
        ),
        keyValue("Calls Made", formatInteger(sections.queueMetrics.callsMade)),
        keyValue(
          "Peak Queue Length",
          sections.queueMetrics.peakQueueLength === null || sections.queueMetrics.peakQueueLength === undefined
            ? "Not available yet"
            : formatInteger(sections.queueMetrics.peakQueueLength)
        ),
      ].join("")}</div>`
    : `<p class="muted">Queue disabled</p>`

  const notesBody = (sections.noteRows || []).length
    ? `<ul class="notes-list">${(sections.noteRows || [])
        .map(
          (row) =>
            `<li><strong>${escapeHtml(row.author || "No data")}</strong> · ${escapeHtml(
              formatDateTime(row.createdAt, timeZone)
            )}<br />${escapeHtml(row.text || "No data")}</li>`
        )
        .join("")}</ul>`
    : `<p class="muted">No data</p>`

  const heroMeta = [
    keyValue("Report Type", header.reportType || "Daily Report"),
    keyValue("Station Name", header.stationName || "No data"),
    keyValue("Station ID", header.stationPublicId || "No data"),
    keyValue("Location", header.location || "No data"),
    keyValue("Timezone", timeZone),
    keyValue("Date Range", `${header.fromDate || "No data"} to ${header.toDate || "No data"}`),
    keyValue("Generated At", formatDateTime(header.generatedAt, timeZone)),
    keyValue("Generated By", header.generatedBy || "No data"),
  ].join("")

  const kpiRows = [
    ["Total Revenue", formatMoney(kpis.totalRevenue, currencyCode), false],
    ["Total Litres Sold", formatLitres(kpis.totalLitresSold, 0), false],
    ["Total Transactions", formatInteger(kpis.totalTransactions), false],
    ["Weighted Avg Price / L", formatMoney(kpis.weightedAvgPricePerLitre, currencyCode), false],
    ["Book Sales", formatLitres(kpis.bookSales, 0), false],
    ["Recorded Sales", formatLitres(kpis.recordedSales, 0), false],
    ["Variance Litres", formatLitres(kpis.varianceLitres, 0), requiresAttention],
    ["Variance %", `${formatPercent(kpis.variancePct)}${requiresAttention ? " (Attention Needed)" : ""}`, requiresAttention],
  ]
  const kpiMatrixRows = []
  for (let index = 0; index < kpiRows.length; index += 2) {
    const left = kpiRows[index]
    const right = kpiRows[index + 1] || ["", "", false]
    const leftValueClass = left[2] ? "num text-attention" : "num"
    const rightValueClass = right[2] ? "num text-attention" : "num"
    kpiMatrixRows.push(
      `<tr>
        <th>${escapeHtml(left[0])}</th>
        <td class="${leftValueClass}">${escapeHtml(left[1])}</td>
        <th>${escapeHtml(right[0])}</th>
        <td class="${rightValueClass}">${escapeHtml(right[1])}</td>
      </tr>`
    )
  }
  const kpiSummaryTable = `<table class="kpi-table"><tbody>${kpiMatrixRows.join("")}</tbody></table>`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>SmartLink Fuel Station Report</title>
    <style>${reportStyles}</style>
  </head>
  <body>
    <main class="report-root">
      <header class="document-header">
        <div class="header-rail">
          <span class="header-platform">SmartLink Infrastructure Platform</span>
          <span class="header-report-badge">${escapeHtml(header.reportType || "Daily Report")}</span>
        </div>
        <div class="header-main">
          <div>
            <div class="header-brand">
              <div class="header-logo">${
              logoDataUri
                ? `<img class="brand-logo" src="${logoDataUri}" alt="SmartLink logo" />`
                : '<div class="brand-logo-fallback">SL</div>'
              }</div>
              <div class="header-brand-copy">
                <p class="header-kicker">Operational Reporting Suite</p>
                <p class="header-name">${escapeHtml(header.stationName || "Station Report")}</p>
                <p class="header-subline">${escapeHtml(header.stationPublicId || "No data")} · ${escapeHtml(header.location || "No data")}</p>
              </div>
            </div>
            <div class="header-title-block">
              <p class="header-eyebrow">Station Performance &amp; Reconciliation</p>
              <h1>Executive Operations Report</h1>
              <p>Prepared for ${escapeHtml(header.fromDate || "No data")} to ${escapeHtml(header.toDate || "No data")} · Currency ${escapeHtml(currencyCode)}</p>
              <div class="header-meta-pills">
                <span class="header-pill">Timezone: ${escapeHtml(timeZone)}</span>
                <span class="header-pill">Generated: ${escapeHtml(formatDateTime(header.generatedAt, timeZone))}</span>
                <span class="header-pill">Prepared by: ${escapeHtml(header.generatedBy || "No data")}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="header-facts">${heroMeta}</div>
      </header>

      ${section("KPI Summary", kpiSummaryTable)}

      ${section(
        "Fuel Reconciliation",
        reconciliationTable,
        "Flag rule: ABS(Variance%) > 0.5% is marked as Attention Needed"
      )}

      ${section(
        "Sales Analysis",
        `<div class="analysis-stack">
          <article class="analysis-block"><h3>Sales by Fuel Type</h3>${salesByFuelTypeTable}</article>
          <article class="analysis-block"><h3>${salesTrendGranularity === "HOUR" ? "Sales by Hour" : "Sales by Day"}</h3>${salesByDayTable}</article>
          <article class="analysis-block"><h3>Sales by Payment Method</h3>${salesByPaymentTable}</article>
        </div>`
      )}

      ${section("Pump Performance", pumpTable)}
      ${section("Nozzle Performance", nozzleTable)}
      ${section("Queue Performance", queueBody)}
      ${section("Inventory Movement Log", movementTable)}
      ${section("Incidents", incidentTable)}
      ${includeAuditTrail ? section("Audit Trail", auditTable) : ""}

      ${section(
        "Manager Notes",
        `${notesBody}
        <div class="observation-block"><span>Observations</span><div class="line"></div></div>`
      )}

      ${section(
        "Sign Off",
        `<div class="signoff-panel">
          <div class="signoff-item">
            <p><strong>Prepared By:</strong> ${escapeHtml(sections.signOff?.preparedBy || "________________")}</p>
            <div class="line"></div>
            <p><strong>Signature:</strong></p>
            <div class="line"></div>
          </div>
          <div class="signoff-item">
            <p><strong>Reviewed By:</strong> ${escapeHtml(sections.signOff?.reviewedBy || "________________")}</p>
            <div class="line"></div>
            <p><strong>Date:</strong> __________________</p>
            <div class="line"></div>
          </div>
        </div>`
      )}
    </main>
  </body>
</html>`
}
