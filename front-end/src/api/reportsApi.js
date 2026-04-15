import { httpClient } from "./httpClient"
import { getAccessToken, getRoleCode, getStationPublicId } from "../auth/authSession"
import { getAppTimeZone, utcTodayISO, zonedDateTimeToUtcMs } from "../utils/dateTime"
import { pushSystemAlert } from "../utils/systemAlerts"
import { recordAction, recordActions } from "../offline/recordAction"
const baseUrl = import.meta.env.VITE_API_BASE_URL || ""

function stationPublicIdOrThrow() {
  const stationPublicId = getStationPublicId()
  if (!stationPublicId) {
    throw new Error("No active station scope in auth session")
  }
  return stationPublicId
}

function sectionToApiSection(section) {
  if (section === "inventory") return "reconciliation"
  if (section === "exceptions") return "exceptions"
  return section
}

function readFilenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1])
  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i)
  if (asciiMatch?.[1]) return asciiMatch[1]
  return fallback
}

async function downloadExport(path, fallbackFilename) {
  const accessToken = getAccessToken()
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    credentials: "include",
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const message = payload.error || `Export failed: ${response.status}`
    pushSystemAlert({
      type: "ERROR",
      title: "Export Error",
      body: message,
      meta: path,
    })
    throw new Error(message)
  }

  const blob = await response.blob()
  const disposition = response.headers.get("content-disposition")
  const filename = readFilenameFromDisposition(disposition, fallbackFilename)
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
  return filename
}

let localReportRun = {
  id: `RUN-${Date.now()}`,
  createdAt: new Date().toISOString(),
  status: "DRAFT",
}
const varianceSyncFingerprintByStation = new Map()
let lastSnapshotInitToken = null
const VARIANCE_ALERT_ROLES = new Set(["MANAGER", "ATTENDANT"])

function reportRunStorageKey(stationPublicId) {
  return `smartlink.reportRun.${stationPublicId}`
}

function loadReportRun(stationPublicId) {
  try {
    const raw = window.sessionStorage.getItem(reportRunStorageKey(stationPublicId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.id) return null
    return parsed
  } catch {
    return null
  }
}

function saveReportRun(stationPublicId, run) {
  try {
    window.sessionStorage.setItem(reportRunStorageKey(stationPublicId), JSON.stringify(run))
  } catch {
    // Ignore storage failures in private mode or restrictive browser settings.
  }
}

function unwrapNumericValue(value) {
  if (value === null || value === undefined) return null

  if (Array.isArray(value)) {
    return value.length ? unwrapNumericValue(value[0]) : null
  }

  if (typeof value === "object") {
    if (Array.isArray(value.d)) {
      return unwrapNumericValue(value.d[0])
    }

    if (typeof value.value === "number" || typeof value.value === "string") {
      return value.value
    }

    if (typeof value.toString === "function") {
      const strValue = value.toString()
      const num = Number(strValue)
      if (Number.isFinite(num)) return num
    }

    return null
  }

  return value
}

function toNumber(value) {
  const unwrapped = unwrapNumericValue(value)
  const num = Number(unwrapped)
  return Number.isFinite(num) ? num : 0
}

function toText(value) {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

function formatEnumLabel(value) {
  const text = toText(value)
  if (!text) return ""
  return text
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function toOptionalPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return undefined
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return undefined
  return num
}

function hasValue(value) {
  return value !== null && value !== undefined
}

function recalculateReconciliationRow(row) {
  const hasOpening = hasValue(row.opening)
  const hasClosing = hasValue(row.closing)
  const opening = hasOpening ? toNumber(row.opening) : null
  const closing = hasClosing ? toNumber(row.closing) : null
  const deliveries = toNumber(row.deliveries)
  const recordedSales = toNumber(row.recordedSales)
  const bookSales = hasOpening && hasClosing ? opening + deliveries - closing : null
  const varianceLitres = bookSales === null ? null : bookSales - recordedSales
  const variancePct = bookSales && bookSales !== 0 ? (varianceLitres / bookSales) * 100 : null

  return {
    ...row,
    opening,
    closing,
    deliveries,
    bookSales,
    varianceLitres,
    variancePct,
    attention: variancePct !== null && Math.abs(variancePct) > 0.5,
    missingData: !hasOpening || !hasClosing,
    missingFields: [
      ...(!hasOpening ? ["Opening"] : []),
      ...(!hasClosing ? ["Closing"] : []),
    ],
  }
}

function updateReconciliationRow(snapshot, matcher, updater) {
  if (!snapshot?.reconciliation?.length) return snapshot
  const nextRows = snapshot.reconciliation.map((row) => {
    if (!matcher(row)) return row
    return recalculateReconciliationRow(updater(row))
  })
  return { ...snapshot, reconciliation: nextRows }
}

function createDeliveryOptimisticUpdater(payload) {
  const deliveredLitres = toNumber(payload?.deliveredLitres)
  return (snapshot) =>
    updateReconciliationRow(
      snapshot,
      (row) => row.id === payload?.rowId || row.tankPublicId === payload?.tankPublicId,
      (row) => ({
        ...row,
        deliveries: toNumber(row.deliveries) + deliveredLitres,
        deliveriesLitres: toNumber(row.deliveriesLitres) + deliveredLitres,
      })
    )
}

function createReadingsOptimisticUpdater(payload) {
  const opening = hasValue(payload?.opening) ? toNumber(payload.opening) : null
  const closing = hasValue(payload?.closing) ? toNumber(payload.closing) : null

  return (snapshot) =>
    updateReconciliationRow(
      snapshot,
      (row) => row.id === payload?.rowId || row.tankPublicId === payload?.tankPublicId,
      (row) => ({
        ...row,
        opening: opening === null ? row.opening : opening,
        closing: closing === null ? row.closing : closing,
        openingAt: opening === null ? row.openingAt : new Date().toISOString(),
        closingAt: closing === null ? row.closingAt : new Date().toISOString(),
      })
    )
}

function parseDbTimestampToMs(value) {
  if (!value) return NaN
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value

  const raw = String(value).trim()
  if (!raw) return NaN

  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T")
  const hasTimezone = /[zZ]$|[-+]\d{2}:\d{2}$/.test(normalized)
  if (hasTimezone) return new Date(normalized).getTime()

  const floatingMatch = normalized.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/
  )
  if (floatingMatch) {
    const [, datePart, timePart, msPart = "0"] = floatingMatch
    const baseUtcMs = zonedDateTimeToUtcMs(datePart, timePart, getAppTimeZone())
    if (Number.isFinite(baseUtcMs)) {
      return baseUtcMs + Number(msPart.padEnd(3, "0"))
    }
  }

  return new Date(normalized).getTime()
}

function toIsoOrNull(value) {
  const ms = parseDbTimestampToMs(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function parseDateRange(filters) {
  const fromDate = filters?.fromDate || utcTodayISO()
  const toDate = filters?.toDate || fromDate
  const fromTime = Date.parse(`${fromDate}T00:00:00.000Z`)
  const toTime = Date.parse(`${toDate}T23:59:59.999Z`)
  return { fromTime, toTime }
}

function normalizeSnapshotFiltersForLogin(filters) {
  const today = utcTodayISO()
  const accessToken = getAccessToken()
  const wantsToday = !filters || filters?.preset === "TODAY"

  if (wantsToday) {
    return {
      ...(filters || {}),
      preset: "TODAY",
      fromDate: today,
      toDate: today,
    }
  }

  if (accessToken && accessToken !== lastSnapshotInitToken) {
    lastSnapshotInitToken = accessToken
    return {
      ...(filters || {}),
      preset: "TODAY",
      fromDate: today,
      toDate: today,
    }
  }

  return {
    ...(filters || {}),
    fromDate: filters?.fromDate || today,
    toDate: filters?.toDate || today,
  }
}

function mapSnapshot(data, filters) {
  const fuelName = {
    1: "Petrol",
    2: "Diesel",
  }
  const { fromTime, toTime } = parseDateRange(filters)
  const inventoryReadings = (data.inventoryReadings || [])
    .map((row) => ({
      id: row.id,
      stationId: row.station_id,
      tankId: row.tank_id,
      tankPublicId: row.tank_public_id,
      tankName: row.tank_name,
      fuelType: row.fuel_code,
      readingType: row.reading_type,
      readingTime: toIsoOrNull(row.reading_time),
      readingTimeMs: parseDbTimestampToMs(row.reading_time),
      litres: toNumber(row.litres),
      recordedByStaffId: row.recorded_by_staff_id,
      note: row.note,
      createdAt: toIsoOrNull(row.created_at),
    }))
    .filter((row) => Number.isFinite(row.readingTimeMs) && row.readingTimeMs >= fromTime && row.readingTimeMs <= toTime)

  const reconciliationRows = (data.reconciliation || []).map((row) => {
    const tankReadings = inventoryReadings.filter((item) => Number(item.tankId) === Number(row.tank_id))
    const openingFromReadings = tankReadings
      .filter((item) => item.readingType === "OPENING")
      .sort((a, b) => a.readingTimeMs - b.readingTimeMs)[0]
    const closingFromReadings = tankReadings
      .filter((item) => item.readingType === "CLOSING")
      .sort((a, b) => b.readingTimeMs - a.readingTimeMs)[0]

    const openingRaw = hasValue(openingFromReadings?.litres) ? openingFromReadings.litres : row.opening_litres
    const closingRaw = hasValue(closingFromReadings?.litres) ? closingFromReadings.litres : row.closing_litres
    const openingAt = openingFromReadings?.readingTime || toIsoOrNull(row.opening_time)
    const closingAt = closingFromReadings?.readingTime || toIsoOrNull(row.closing_time)
    const openingSourceRaw = String(row.opening_source || "").toUpperCase()

    const hasOpening = hasValue(openingRaw) && hasValue(openingAt)
    const hasClosing = hasValue(closingRaw) && hasValue(closingAt)
    const opening = hasOpening ? toNumber(openingRaw) : null
    const closing = hasClosing ? toNumber(closingRaw) : null
    const deliveries = toNumber(row.delivered_litres)
    const recordedSales = toNumber(row.recorded_litres)
    const capacityLitres = hasValue(row.capacity_litres) ? toNumber(row.capacity_litres) : null

    // Dashboard tank bar should start from opening and move with sales during the day.
    const liveTankLevelLitres = hasOpening
      ? Math.max(0, opening + deliveries - recordedSales)
      : null
    const tankLevelLitres = hasValue(liveTankLevelLitres) ? liveTankLevelLitres : closing
    const tankLevelPercent =
      capacityLitres && capacityLitres > 0 && hasValue(tankLevelLitres)
        ? Math.max(0, Math.min(100, (toNumber(tankLevelLitres) / capacityLitres) * 100))
        : null
    const bookSales = hasOpening && hasClosing ? opening + deliveries - closing : null
    const varianceLitres = bookSales !== null ? bookSales - recordedSales : null
    const variancePct = bookSales && bookSales !== 0 ? (varianceLitres / bookSales) * 100 : null
    const absoluteVariancePct = variancePct === null ? null : Math.abs(variancePct)

    return {
      id: `REC-${row.tank_id}`,
      tank: row.tank_name,
      tankPublicId: row.tank_public_id,
      fuelType: row.fuel_code || "UNKNOWN",
      opening,
      openingAt,
      openingSource: openingFromReadings
        ? "inventory_readings"
        : openingSourceRaw === "PREVIOUS_CLOSING"
          ? "previous_closing"
          : row.opening_time
            ? "reconciliation_fallback"
            : "missing",
      deliveries,
      deliveriesLitres: deliveries,
      closing,
      closingAt,
      closingSource: closingFromReadings ? "inventory_readings" : row.closing_time ? "reconciliation_fallback" : "missing",
      capacityLitres,
      tankLevelLitres,
      tankLevelPercent,
      actual: tankLevelPercent ?? tankLevelLitres,
      bookSales,
      recordedSales,
      recordedRevenue: toNumber(row.recorded_revenue),
      transactions: toNumber(row.tx_count),
      excludedTransactions: toNumber(row.excluded_tx_count),
      excludedLitres: toNumber(row.excluded_litres),
      excludedRevenue: toNumber(row.excluded_revenue),
      varianceLitres,
      variancePct,
      attention: absoluteVariancePct !== null && absoluteVariancePct > 0.5,
      missingData: !hasOpening || !hasClosing,
      missingFields: [
        ...(!hasOpening ? ["Opening"] : []),
        ...(!hasClosing ? ["Closing"] : []),
      ],
      varianceReason: "",
      varianceNote: "",
    }
  })

  const totalBookSales = reconciliationRows.reduce(
    (sum, row) => sum + (row.bookSales !== null ? row.bookSales : 0),
    0
  )
  const totalRecordedSales = reconciliationRows.reduce(
    (sum, row) => sum + (row.bookSales !== null ? row.recordedSales : 0),
    0
  )
  const hasComputableVarianceRows = reconciliationRows.some((row) => row.bookSales !== null)
  const varianceLitres = hasComputableVarianceRows ? totalBookSales - totalRecordedSales : null
  const variancePct = !hasComputableVarianceRows ? null : totalBookSales > 0 ? (varianceLitres / totalBookSales) * 100 : 0
  const hourlyRows = (data.queueHourly || []).map((row) => ({
    hour: row.hour_bucket,
    joined: toNumber(row.joined_count),
    served: toNumber(row.served_count),
    noShow: toNumber(row.no_show_count),
    avgWaitMin: toNumber(row.avg_wait_min),
  }))
  const peakQueueWindow = hourlyRows.reduce(
    (peak, row) => (row.joined > peak.joined ? row : peak),
    { hour: "-", joined: 0 }
  )

  const fuelSummaryBreakdown = (data.fuelTypeSummary || []).map((row) => ({
    fuelType: row.fuel_code || "UNKNOWN",
    litres: toNumber(row.litres),
    revenue: toNumber(row.revenue),
    transactions: toNumber(row.tx_count),
  }))
  const breakdownRows = fuelSummaryBreakdown.length
    ? fuelSummaryBreakdown
    : (data.salesDaily || []).map((row) => ({
        fuelType: fuelName[row.fuel_type_id] || `Fuel ${row.fuel_type_id}`,
        litres: toNumber(row.litres_sold),
        revenue: toNumber(row.revenue),
        transactions: toNumber(row.tx_count),
      }))

  const nozzleRows = data.nozzleBreakdown || []
  const hasNozzleBreakdownData = nozzleRows.length > 0
  const nozzlesByPump = nozzleRows.reduce((acc, row) => {
    const key = row.pump_public_id || `P-${row.pump_number}`
    if (!acc[key]) acc[key] = []
    acc[key].push({
      nozzlePublicId: row.nozzle_public_id,
      nozzleNumber: toText(row.nozzle_number) || "N/A",
      side: row.side || "",
      fuelType: row.fuel_code || "UNKNOWN",
      status: row.status || "ACTIVE",
      txCount: toNumber(row.tx_count),
      litresDispensed: toNumber(row.litres_dispensed),
      revenue: toNumber(row.revenue),
      avgPricePerLitre: toNumber(row.avg_price_per_litre),
    })
    return acc
  }, {})

  const pumpRollupTotalsByPump = (data.pumpRollup || []).reduce((acc, row) => {
    const key = row.pump_public_id || `P-${row.pump_number}`
    if (!acc[key]) {
      acc[key] = {
        pump_public_id: row.pump_public_id,
        pump_number: row.pump_number,
        fuelCodes: new Set(),
        tx_count: 0,
        litres_dispensed: 0,
        revenue: 0,
      }
    }
    const entry = acc[key]
    if (row.fuel_code) entry.fuelCodes.add(row.fuel_code)
    entry.tx_count += toNumber(row.tx_count)
    entry.litres_dispensed += toNumber(row.litres_dispensed)
    entry.revenue += toNumber(row.revenue)
    return acc
  }, {})

  const pumpRowsSource = (data.pumpMetrics && data.pumpMetrics.length)
    ? data.pumpMetrics
    : []
  const pumpRows = pumpRowsSource.map((row) => {
    const pumpPublicId = row.pump_public_id
    const pumpId = hasValue(row.pump_number) ? toNumber(row.pump_number) : null
    const pumpKey = pumpPublicId || `P-${row.pump_number}`
    const pumpNozzles = nozzlesByPump[pumpKey] || []
    const rollupTotals = pumpRollupTotalsByPump[pumpKey]
    const rawNozzleCount = hasValue(row.nozzle_count) ? row.nozzle_count : row.nozzleCount
    const parsedNozzleCount = Number(rawNozzleCount)
    const nozzleCountFromRow =
      hasValue(rawNozzleCount) && Number.isFinite(parsedNozzleCount)
        ? Math.max(0, parsedNozzleCount)
        : null
    const hasNozzleInfo = hasNozzleBreakdownData || nozzleCountFromRow !== null
    const hasNozzles = nozzleCountFromRow !== null ? nozzleCountFromRow > 0 : pumpNozzles.length > 0
    const normalizedRowStatus = String(row.status || "").toUpperCase()
    const fallbackNozzleMissingStatus = normalizedRowStatus === "PAUSED" ? "PAUSED" : "OFFLINE"
    const effectiveStatus = hasNozzleInfo && !hasNozzles
      ? fallbackNozzleMissingStatus
      : row.status || "UNKNOWN"

    return {
      pumpPublicId,
      pumpId,
      fuelType: row.fuel_code || "UNKNOWN",
      status: effectiveStatus,
      uptimePct: toNumber(row.uptime_pct),
      txCount: rollupTotals ? toNumber(rollupTotals.tx_count) : toNumber(row.tx_count),
      litresDispensed: rollupTotals ? toNumber(rollupTotals.litres_dispensed) : toNumber(row.litres_dispensed),
      revenue: rollupTotals ? toNumber(rollupTotals.revenue) : toNumber(row.revenue),
      avgPricePerLitre: toNumber(row.avg_price_per_litre),
      avgTransactionTimeSec: toNumber(row.avg_transaction_time_sec),
      statusChangeCount: toNumber(row.status_change_count),
      lastSaleAmount: toNumber(row.last_sale_amount),
      lastSaleAt: toIsoOrNull(row.last_sale_at),
      nozzles: pumpNozzles,
    }
  })

  const exceptionWarnings = data.exceptions?.warnings || []
  const offlineNozzleRows = data.exceptions?.offlineNozzles || []

  return {
    reportRun: data.reportRun || localReportRun,
    kpis: {
      totalLitres: toNumber(data.kpis?.totalLitres),
      revenue: toNumber(data.kpis?.revenue),
      transactions: toNumber(data.kpis?.transactions),
      avgPricePerLitre: toNumber(data.kpis?.avgPricePerLitre),
      bookSales: hasValue(data.kpis?.bookSales) ? toNumber(data.kpis?.bookSales) : (hasComputableVarianceRows ? totalBookSales : null),
      recordedSales: hasValue(data.kpis?.recordedSales) ? toNumber(data.kpis?.recordedSales) : (hasComputableVarianceRows ? totalRecordedSales : null),
      varianceLitres: hasValue(data.kpis?.varianceLitres) ? toNumber(data.kpis?.varianceLitres) : varianceLitres,
      variancePct: hasValue(data.kpis?.variancePct) ? toNumber(data.kpis?.variancePct) : variancePct,
      queueNoShowRate: toNumber(data.kpis?.queueNoShowRate),
      queueAvgWaitMin: toNumber(data.kpis?.queueAvgWaitMin),
    },
    sales: {
      trendDaily: (data.salesDaily || []).map((row) => ({
        label: row.sale_date,
        value: toNumber(row.revenue),
      })),
      trendByPump: [],
      breakdown: breakdownRows,
      byPayment: (data.salesByPayment || []).map((row) => ({
        paymentMethod: row.payment_method,
        litres: toNumber(row.litres),
        revenue: toNumber(row.revenue),
        transactions: toNumber(row.tx_count),
      })),
      byHour: (data.salesByHour || []).map((row) => ({
        hour: row.hour_bucket,
        litres: toNumber(row.litres),
        revenue: toNumber(row.revenue),
        transactions: toNumber(row.tx_count),
      })),
      transactions: (data.recentTransactions || []).map((row) => ({
        publicId: row.public_id,
        occurredAt: toIsoOrNull(row.occurred_at),
        litres: toNumber(row.litres),
        amount: toNumber(row.total_amount),
        paymentMethod: row.payment_method,
        status: row.status || "RECORDED",
        settlementImpactStatus: row.settlement_impact_status || "UNCHANGED",
        workflowReasonCode: row.workflow_reason_code || null,
        workflowReasonLabel: formatEnumLabel(row.workflow_reason_code),
        workflowNote: toText(row.workflow_note),
        complianceCasePublicId: toText(row.compliance_case_public_id) || null,
        complianceCaseStatus: toText(row.compliance_case_status) || null,
      })),
    },
    reconciliation: reconciliationRows,
    pumps: pumpRows,
    nozzleBreakdown: nozzleRows,
    queue: {
      enabled: Boolean(data.queueEnabled ?? true),
      stats: {
        avgWaitMin: toNumber(data.kpis?.queueAvgWaitMin),
        noShowRate: toNumber(data.kpis?.queueNoShowRate),
        served: hourlyRows.reduce((sum, row) => sum + row.served, 0),
        joined: hourlyRows.reduce((sum, row) => sum + row.joined, 0),
        peakWindow: peakQueueWindow.hour,
        peakQueueSize: peakQueueWindow.joined,
      },
      hourly: hourlyRows,
    },
    settlements: {
      summary: {
        settlementCount: toNumber(data.settlementSummary?.settlement_count),
        settlementValue: toNumber(data.settlementSummary?.settlement_value),
        pendingCount: toNumber(data.settlementSummary?.pending_count),
        pendingValue: toNumber(data.settlementSummary?.pending_value),
        paidCount: toNumber(data.settlementSummary?.paid_count),
      },
      items: (data.settlements || []).map((row) => ({
        publicId: toText(row.public_id),
        sourceReference: toText(row.source_reference) || null,
        batchDate: toText(row.batch_date) || null,
        status: toText(row.status) || "PENDING",
        grossAmount: toNumber(row.gross_amount),
        feeAmount: toNumber(row.fee_amount),
        netAmount: toNumber(row.net_amount),
        relatedEntityType: toText(row.related_entity_type) || null,
        relatedEntityId: toText(row.related_entity_id) || null,
        sourceTransactionReference: toText(row.source_transaction_reference) || null,
        reservationPublicId: toText(row.reservation_public_id) || null,
        queueEntryPublicId: toText(row.queue_entry_public_id) || null,
        userId: hasValue(row.user_id) ? toNumber(row.user_id) : null,
        userPublicId: toText(row.user_public_id) || null,
        userName: toText(row.user_full_name) || "Unknown user",
        userPhone: toText(row.user_phone) || null,
        requestedLitres: hasValue(row.requested_litres) ? toNumber(row.requested_litres) : null,
        forecourtLitres: hasValue(row.forecourt_litres) ? toNumber(row.forecourt_litres) : null,
        fuelCode: toText(row.fuel_code) || null,
        forecourtTransactionPublicId: toText(row.forecourt_transaction_public_id) || null,
        forecourtPaymentMethod: toText(row.forecourt_payment_method) || null,
        forecourtOccurredAt: toIsoOrNull(row.forecourt_occurred_at),
        createdAt: toIsoOrNull(row.created_at),
      })),
    },
    audit: (data.auditRows || []).map((row) => ({
      id: `AUD-${row.id}`,
      timestamp: toIsoOrNull(row.created_at),
      actor: "Manager",
      actionType: row.action_type,
      summary: row.action_type,
    })),
    exceptions: {
      warnings: exceptionWarnings,
      missingNozzleTxCount: toNumber(data.exceptions?.missingNozzleTxCount),
      voidCount: toNumber(data.exceptions?.voidCount),
      overrideCount: toNumber(data.exceptions?.overrideCount),
      transactionInspectionCount: toNumber(data.exceptions?.transactionInspectionCount),
      transactionInspectionItems: (data.exceptions?.transactionInspectionItems || []).map((row) => ({
        publicId: row.public_id,
        occurredAt: toIsoOrNull(row.occurred_at),
        fuelCode: toText(row.fuel_code) || null,
        pumpPublicId: toText(row.pump_public_id) || null,
        pumpNumber: hasValue(row.pump_number) ? toNumber(row.pump_number) : null,
        nozzlePublicId: toText(row.nozzle_public_id) || null,
        nozzleNumber: hasValue(row.nozzle_number) ? toNumber(row.nozzle_number) : null,
        nozzleSide: toText(row.nozzle_side) || null,
        litres: toNumber(row.litres),
        paymentMethod: toText(row.payment_method) || null,
        status: row.status || "RECORDED",
        settlementImpactStatus: toText(row.settlement_impact_status) || "UNCHANGED",
        workflowReasonCode: row.workflow_reason_code || null,
        workflowReasonLabel: formatEnumLabel(row.workflow_reason_code),
        workflowNote: toText(row.workflow_note) || null,
        totalAmount: toNumber(row.total_amount),
        complianceCasePublicId: toText(row.compliance_case_public_id) || null,
        complianceCaseStatus: toText(row.compliance_case_status) || null,
        complianceCaseActionTaken: toText(row.compliance_case_action_taken) || null,
      })),
      offlineNozzles: offlineNozzleRows,
    },
    incidents: (data.incidents || []).map((row) => ({
      id: row.public_id,
      createdAt: toIsoOrNull(row.created_at),
      severity: row.severity,
      title: row.title,
      status: row.status,
    })),
    notes: (data.notesRows || []).map((row) => ({
      id: `NOTE-${row.id}`,
      text: row.note_text,
      createdAt: toIsoOrNull(row.created_at) || `${row.note_date}T00:00:00.000Z`,
      author: row.full_name || "Manager",
    })),
    inventoryReadings,
    demandAnomaly: {
      generatedAt: data?.demandAnomaly?.generatedAt || null,
      window: data?.demandAnomaly?.window || "15m",
      methods: data?.demandAnomaly?.methods || null,
      metrics: (data?.demandAnomaly?.metrics || []).map((row) => ({
        fuelType: String(row.fuelType || "").toUpperCase(),
        salesVelocityLph: toNumber(row.salesVelocityLph),
        txRateTph: toNumber(row.txRateTph),
        expectedMeanLph: toNumber(row.expectedMeanLph),
        expectedStdLph: toNumber(row.expectedStdLph),
        expectedMeanTph: toNumber(row.expectedMeanTph),
        expectedStdTph: toNumber(row.expectedStdTph),
        zScore: toNumber(row.zScore),
        txZScore: toNumber(row.txZScore),
        ewmaValue: toNumber(row.ewmaValue),
        ewmaBaseline: toNumber(row.ewmaBaseline),
        ewmaShiftScore: toNumber(row.ewmaShiftScore),
        cusumValue: row.cusumValue === null ? null : toNumber(row.cusumValue),
        cusumScore: toNumber(row.cusumScore),
        severity: String(row.severity || "NONE").toUpperCase(),
        detectionScore: toNumber(row.detectionScore),
        baselineSource: row.baselineSource || "24h_rolling",
        baselineCount: toNumber(row.baselineCount),
        rulesTriggered: Array.isArray(row.rulesTriggered) ? row.rulesTriggered : [],
        persistencePending: Boolean(row.persistencePending),
        pendingSince: toIsoOrNull(row.pendingSince),
        activeEventId: row.activeEventId || null,
        lastObservedAt: toIsoOrNull(row.lastObservedAt),
      })),
      events: (data?.demandAnomaly?.events || []).map((row) => ({
        id: toNumber(row.id),
        fuelType: String(row.fuelType || row.fuel_type || "").toUpperCase(),
        severity: String(row.severity || "WARNING").toUpperCase(),
        startTime: toIsoOrNull(row.startTime || row.start_time),
        endTime: toIsoOrNull(row.endTime || row.end_time),
        currentVelocity: toNumber(row.currentVelocity || row.current_velocity),
        expectedMean: toNumber(row.expectedMean || row.expected_mean),
        expectedStd: toNumber(row.expectedStd || row.expected_std),
        zScore: toNumber(row.zScore || row.z_score),
        ewmaValue: toNumber(row.ewmaValue || row.ewma_value),
        cusumValue: row.cusumValue === null || row.cusum_value === null
          ? null
          : toNumber(row.cusumValue || row.cusum_value),
        rulesTriggered: Array.isArray(row.rulesTriggered)
          ? row.rulesTriggered
          : [],
        createdAt: toIsoOrNull(row.createdAt || row.created_at),
      })),
    },
  }
}

async function syncHighVarianceAlerts(stationPublicId, snapshot, filters) {
  if (!VARIANCE_ALERT_ROLES.has(getRoleCode())) return
  if (!getAccessToken()) return

  const isFullScope =
    (!filters?.fuelType || filters.fuelType === "ALL") &&
    (!filters?.pumpId || filters.pumpId === "ALL") &&
    (!filters?.shift || filters.shift === "ALL")
  if (!isFullScope) return

  const rows = (snapshot?.reconciliation || [])
    .filter((row) => row.attention && !row.missingData)
    .map((row) => ({
      tankPublicId: row.tankPublicId,
      tankName: row.tank,
      fuelType: row.fuelType,
      variancePct: Number(row.variancePct || 0),
      varianceLitres: Number(row.varianceLitres || 0),
      bookSales: Number(row.bookSales || 0),
      recordedSales: Number(row.recordedSales || 0),
    }))

  const payload = {
    fromDate: filters?.fromDate || utcTodayISO(),
    toDate: filters?.toDate || filters?.fromDate || utcTodayISO(),
    thresholdPct: 0.5,
    rows,
  }

  const fingerprint = JSON.stringify(payload)
  const previousFingerprint = varianceSyncFingerprintByStation.get(stationPublicId)
  if (previousFingerprint === fingerprint) return

  await httpClient.post(`/api/stations/${stationPublicId}/reports/variance-alerts`, payload)
  varianceSyncFingerprintByStation.set(stationPublicId, fingerprint)
}

export const reportsApi = {
  async getReportSnapshot(filters) {
    const stationPublicId = stationPublicIdOrThrow()
    const effectiveFilters = normalizeSnapshotFiltersForLogin(filters)
    const storedRun = loadReportRun(stationPublicId)
    if (storedRun) {
      localReportRun = storedRun
    }
    const params = new URLSearchParams()
    if (effectiveFilters?.fromDate) params.set("from", effectiveFilters.fromDate)
    if (effectiveFilters?.toDate) params.set("to", effectiveFilters.toDate)
    if (effectiveFilters?.fuelType) params.set("fuelType", effectiveFilters.fuelType)
    if (effectiveFilters?.shift) params.set("shift", effectiveFilters.shift)
    if (effectiveFilters?.pumpId && effectiveFilters.pumpId !== "ALL") {
      params.set("pumpPublicId", effectiveFilters.pumpId)
    }
    const data = await httpClient.get(`/api/stations/${stationPublicId}/reports/snapshot?${params.toString()}`)
    const snapshot = mapSnapshot(data, effectiveFilters)
    try {
      await syncHighVarianceAlerts(stationPublicId, snapshot, effectiveFilters)
    } catch {
      // Alerts sync is non-blocking for report rendering.
    }
    return snapshot
  },
  async generateReport() {
    const stationPublicId = stationPublicIdOrThrow()
    const run = await httpClient.post(`/api/stations/${stationPublicId}/reports/generate`, {})
    localReportRun = {
      id: run.id || `RUN-${Date.now()}`,
      createdAt: run.createdAt || new Date().toISOString(),
      status: run.status || "DRAFT",
    }
    saveReportRun(stationPublicId, localReportRun)
    return localReportRun
  },
  async exportCsv(section, filters) {
    const stationPublicId = stationPublicIdOrThrow()
    const apiSection = sectionToApiSection(section)
    const today = utcTodayISO()
    const params = new URLSearchParams({
      from: filters?.fromDate || today,
      to: filters?.toDate || filters?.fromDate || today,
      section: apiSection,
      fuelType: filters?.fuelType || "ALL",
    })
    if (filters?.pumpId && filters.pumpId !== "ALL") {
      params.set("pumpPublicId", filters.pumpId)
    }
    return downloadExport(
      `/api/stations/${stationPublicId}/reports/export/csv?${params.toString()}`,
      `smartlink_${apiSection}.csv`
    )
  },
  async exportPdf(filters, options = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const today = utcTodayISO()
    const params = new URLSearchParams({
      from: filters?.fromDate || today,
      to: filters?.toDate || filters?.fromDate || today,
      fuelType: filters?.fuelType || "ALL",
      includeAudit: options?.includeAudit === false ? "false" : "true",
    })
    if (filters?.pumpId && filters.pumpId !== "ALL") {
      params.set("pumpPublicId", filters.pumpId)
    }
    return downloadExport(
      `/api/stations/${stationPublicId}/reports/export/pdf?${params.toString()}`,
      `smartlink_report_${params.get("from")}_to_${params.get("to")}.pdf`
    )
  },
  async getDemandMetrics({ window = "15m" } = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const params = new URLSearchParams({ window })
    return httpClient.get(`/api/stations/${stationPublicId}/insights/demand-metrics?${params.toString()}`)
  },
  async getDemandAnomalies({ from, to } = {}) {
    const stationPublicId = stationPublicIdOrThrow()
    const params = new URLSearchParams()
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    const suffix = params.toString() ? `?${params.toString()}` : ""
    return httpClient.get(`/api/stations/${stationPublicId}/insights/demand-anomalies${suffix}`)
  },
  async addDeliveryRecord(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    const result = await recordAction("DELIVERY_CREATE", payload, { stationId: stationPublicId })
    return {
      ...result,
      optimisticUpdater: createDeliveryOptimisticUpdater(payload),
    }
  },
  async addOpeningClosingReadings(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    const cleanPayload = {
      rowId: payload?.rowId,
      tankPublicId: payload?.tankPublicId,
      opening: toOptionalPositiveNumber(payload?.opening),
      closing: toOptionalPositiveNumber(payload?.closing),
    }
    const actions = []
    if (hasValue(cleanPayload.opening)) {
      actions.push({
        type: "SHIFT_OPEN",
        payload: {
          rowId: cleanPayload.rowId,
          tankPublicId: cleanPayload.tankPublicId,
          opening: cleanPayload.opening,
        },
        stationId: stationPublicId,
      })
    }
    if (hasValue(cleanPayload.closing)) {
      actions.push({
        type: "SHIFT_CLOSE",
        payload: {
          rowId: cleanPayload.rowId,
          tankPublicId: cleanPayload.tankPublicId,
          closing: cleanPayload.closing,
        },
        stationId: stationPublicId,
      })
    }

    if (!actions.length) {
      return { queued: false, synced: true, optimisticUpdater: (snapshot) => snapshot }
    }

    const result =
      actions.length === 1
        ? await recordAction(actions[0].type, actions[0].payload, { stationId: stationPublicId })
        : await recordActions(actions)

    return {
      ...result,
      optimisticUpdater: createReadingsOptimisticUpdater(cleanPayload),
    }
  },
  async explainVariance(rowId, reason, note) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/reports/variance`, { rowId, reason, note })
  },
  async createIncident(payload) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/reports/incidents`, payload)
  },
  async addNote(text) {
    const stationPublicId = stationPublicIdOrThrow()
    return httpClient.post(`/api/stations/${stationPublicId}/reports/notes`, { text })
  },
  async finalizeReport(reportRunId, filters) {
    const stationPublicId = stationPublicIdOrThrow()
    const today = utcTodayISO()
    const fromDate = filters?.fromDate || today
    const toDate = filters?.toDate || fromDate
    const finalized = await httpClient.post(`/api/stations/${stationPublicId}/reports/finalize`, {
      reportRunId,
      fromDate,
      toDate,
    })
    localReportRun = {
      ...localReportRun,
      id: finalized.id || reportRunId || localReportRun.id,
      status: finalized.status || "FINAL",
    }
    saveReportRun(stationPublicId, localReportRun)
    return localReportRun
  },
  async unfinalizeReport(reportRunId, filters) {
    const stationPublicId = stationPublicIdOrThrow()
    const today = utcTodayISO()
    const fromDate = filters?.fromDate || today
    const toDate = filters?.toDate || fromDate
    const reopened = await httpClient.post(`/api/stations/${stationPublicId}/reports/unfinalize`, {
      reportRunId,
      fromDate,
      toDate,
    })
    localReportRun = {
      ...localReportRun,
      id: reopened.id || reportRunId || localReportRun.id,
      status: reopened.status || "DRAFT",
    }
    saveReportRun(stationPublicId, localReportRun)
    return localReportRun
  },
}
