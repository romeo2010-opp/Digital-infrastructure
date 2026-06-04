import { Prisma } from "@prisma/client"
import { prisma } from "../../../db/prisma.js"
import { badRequest, notFound } from "../../../utils/http.js"
import { createPublicId } from "../../common/db.js"
import { logMeraAudit } from "./audit.service.js"
import { publishPublicNoticeToChannels } from "./socialPublishingService.js"

const CLOSED_CASE_STATUSES = new Set(["CLOSED", "DISMISSED"])
const CLOSED_INSPECTION_STATUSES = new Set(["COMPLETED", "CANCELLED", "CLOSED", "PASSED", "FAILED"])
const NOTICE_CHANNELS = ["FACEBOOK_PAGE", "INSTAGRAM_BUSINESS", "X_TWITTER", "LINKEDIN_PAGE", "YOUTUBE_COMMUNITY", "TIKTOK"]

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizePagination({ page = 1, limit = 20 } = {}) {
  const safePage = clamp(toInteger(page, 1), 1, 500)
  const safeLimit = clamp(toInteger(limit, 20), 1, 100)
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit }
}

function normalizeString(value) {
  const scoped = String(value || "").trim()
  return scoped || null
}

function normalizeUpper(value, fallback = "") {
  return String(value || fallback).trim().toUpperCase()
}

function parseJsonArray(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePriceAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value)
  const raw = String(value || "").trim()
  if (!raw) return null
  const normalized = raw.replace(/,/g, "")
  const match = normalized.match(/(\d+(?:\.\d+)?)/)
  if (!match?.[1]) return null
  const amount = Number(match[1])
  return Number.isFinite(amount) ? amount : null
}

function resolveStationPricePerLitre(pricesJson, fuelType) {
  const normalizedFuelType = normalizeUpper(fuelType)
  if (!normalizedFuelType) return null
  const items = parseJsonArray(pricesJson)
  const match = items.find((item) => {
    const label = normalizeUpper(item?.fuelType || item?.code || item?.label || item?.name || item?.type)
    return label === normalizedFuelType || label.startsWith(`${normalizedFuelType} `) || label.includes(normalizedFuelType)
  })
  if (!match) return null
  const amount =
    parsePriceAmount(match?.pricePerLitre) ??
    parsePriceAmount(match?.price_per_litre) ??
    parsePriceAmount(match?.price) ??
    parsePriceAmount(match?.amount) ??
    parsePriceAmount(match?.value)
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null
}

function priceComparison({ fuelType, officialPrice, reportedPrice }) {
  const official = toNumber(officialPrice)
  const reported = toNumber(reportedPrice)
  if (!official || !reported) {
    return {
      fuelType,
      officialPrice: official || null,
      stationReportedPrice: reported || null,
      mismatchAmount: 0,
      mismatchPercent: 0,
      mismatchDirection: "NONE",
      severity: "NONE",
      status: "unknown",
    }
  }
  const mismatchAmount = reported - official
  const mismatchPercent = mismatchAmount / official
  const isHigh = mismatchAmount > 0
  const tolerance = isHigh ? 0 : Math.max(50, official * 0.02)
  if (Math.abs(mismatchAmount) <= tolerance) {
    return {
      fuelType,
      officialPrice: official,
      stationReportedPrice: reported,
      mismatchAmount,
      mismatchPercent,
      mismatchDirection: "NONE",
      severity: "NONE",
      status: "compliant",
    }
  }
  const absPercent = Math.abs(mismatchPercent)
  let severity = "LOW"
  if (isHigh && absPercent >= 0.08) severity = "CRITICAL"
  else if (isHigh && absPercent >= 0.04) severity = "HIGH"

  return {
    fuelType,
    officialPrice: official,
    stationReportedPrice: reported,
    mismatchAmount,
    mismatchPercent,
    mismatchDirection: isHigh ? "ABOVE_OFFICIAL" : "BELOW_OFFICIAL",
    severity,
    status: isHigh ? "overpriced_violation" : "underpriced_anomaly",
  }
}

async function ensurePriceAnomalyFlag(item, auth = null) {
  if (!item || item.status === "compliant" || item.status === "unknown") return null
  if (item.activeFlagPublicId || !item.stationDbId) return item.activeFlagPublicId || null

  const sourceReference = `PRICE_REPORT:${item.fuelType}:${item.mismatchDirection}`
  const existingRows = await prisma.$queryRaw`
    SELECT public_id
    FROM compliance_flags
    WHERE station_id = ${item.stationDbId}
      AND flag_type = 'PRICE_ANOMALY'
      AND source_reference = ${sourceReference}
      AND resolved_status IN ('OPEN', 'UNDER_REVIEW')
    ORDER BY created_at DESC
    LIMIT 1
  `
  if (existingRows?.[0]?.public_id) return existingRows[0].public_id

  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO compliance_flags (
      public_id,
      station_id,
      flag_type,
      severity,
      generated_reason,
      source_reference
    )
    VALUES (
      ${publicId},
      ${item.stationDbId},
      'PRICE_ANOMALY',
      ${item.severity || "MEDIUM"},
      ${`${item.fuelType} price ${item.mismatchDirection === "ABOVE_OFFICIAL" ? "above" : "below"} official MERA price at ${item.stationName}: reported MWK ${Number(item.stationReportedPrice || 0).toFixed(2)} versus official MWK ${Number(item.officialPrice || 0).toFixed(2)} (${Number(item.mismatchAmount || 0) > 0 ? "+" : ""}${Number(item.mismatchAmount || 0).toFixed(2)}).`},
      ${sourceReference}
    )
  `
  await logMeraAudit({
    ...actorAuditContext(auth),
    actionType: "price anomaly flag created",
    actionDescription: `Price anomaly flag ${publicId} created for ${item.stationName}.`,
    affectedEntity: publicId,
  })
  return publicId
}

function actorAuditContext(actor = null) {
  return {
    actorId: actor?.userId || null,
    actorName: actor?.fullName || null,
    actorRole: actor?.role || null,
    permissionUsed: actor?.permissionUsed || null,
    ipAddress: actor?.ipAddress || null,
    deviceInfo: actor?.deviceInfo || null,
  }
}

function districtFilterValue(auth) {
  return String(auth?.districtScope || "").trim()
}

function ensureDistrictAccess(auth, district, label = "record") {
  const scopedDistrict = districtFilterValue(auth)
  if (!scopedDistrict) return
  if (String(district || "").trim().toLowerCase() !== scopedDistrict.toLowerCase()) {
    throw badRequest(`You do not have access to this ${label}`)
  }
}

function safeParseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "object") return value
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}

function jsonString(value) {
  return JSON.stringify(value ?? null)
}

function mapStation(row = {}) {
  return {
    id: row.station_public_id || row.public_id || null,
    publicId: row.station_public_id || row.public_id || null,
    stationId: row.station_public_id || row.public_id || null,
    stationNumericId: row.station_id ? Number(row.station_id) : row.id ? Number(row.id) : null,
    name: row.station_name || row.name || "Unknown station",
    stationName: row.station_name || row.name || "Unknown station",
    district: row.district || row.city || "Unknown",
    owner: row.operator_name || row.owner || "Unknown OMC",
    omc: row.operator_name || row.omc || "Unknown OMC",
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
  }
}

function riskLevelForScore(score) {
  if (score >= 91) return "Critical"
  if (score >= 76) return "High Risk"
  if (score >= 56) return "Suspicious"
  if (score >= 31) return "Watch"
  return "Normal"
}

function recommendedActionForScore(score, reasons = []) {
  const reasonText = reasons.join(" ").toLowerCase()
  if (score >= 91) return "Prepare Enforcement Review"
  if (score >= 76) return "Open Compliance Case"
  if (score >= 65 || reasonText.includes("price") || reasonText.includes("delivery")) return "Assign Inspection"
  if (score >= 45) return "Request Explanation"
  return "Monitor"
}

function alertSeverityForScore(score) {
  if (score >= 91) return "critical"
  if (score >= 76) return "high"
  if (score >= 56) return "medium"
  return "low"
}

function fuelStateScore(state) {
  const normalized = normalizeUpper(state)
  if (["DRY", "OUT_OF_STOCK"].includes(normalized)) return 22
  if (["LIMITED", "LOW"].includes(normalized)) return 12
  if (["OFFLINE", "UNKNOWN"].includes(normalized)) return 8
  return 0
}

function deriveMarkerStatus(result = {}) {
  const riskScore = toNumber(result.riskScore)
  const availability = normalizeUpper(result.availabilityStatus)
  const petrol = normalizeUpper(result.petrolStatus)
  const diesel = normalizeUpper(result.dieselStatus)
  const queueLength = toNumber(result.queueLength)
  if (riskScore >= 91) return "Critical Risk"
  if (riskScore >= 76) return "Under Investigation"
  if (availability === "OFFLINE" || availability === "UNKNOWN") return "Offline"
  if (availability === "DRY" || (petrol === "DRY" && diesel === "DRY")) return "Dry"
  if (queueLength >= 60) return "Congested"
  if (petrol === "LIMITED" || diesel === "LIMITED" || petrol === "LOW" || diesel === "LOW") return "Low Stock"
  return "Available"
}

function normalizeCaseType(value) {
  const scoped = normalizeUpper(value || "suspected hoarding").replace(/_/g, " ")
  const allowed = [
    "SUSPECTED HOARDING",
    "QUEUE MANIPULATION",
    "FALSE AVAILABILITY REPORTING",
    "DELIVERY DELAY",
    "STOCK VARIANCE",
    "PRICE VIOLATION",
    "CONSUMER DISCRIMINATION",
    "ATTENDANT CORRUPTION",
    "ILLEGAL VENDING",
    "REPEATED OFFLINE REPORTING",
    "PAYMENT/FUEL DISPUTE",
    "COMPLAINT CLUSTER",
  ]
  return allowed.includes(scoped) ? scoped : "SUSPECTED HOARDING"
}

function normalizeCaseStatus(value, fallback = "New") {
  const scoped = String(value || fallback).trim()
  const allowed = [
    "New",
    "Under Review",
    "Evidence Requested",
    "Inspection Assigned",
    "Inspection Completed",
    "Warning Issued",
    "Sanction Recommended",
    "Escalated",
    "Closed",
    "Dismissed",
  ]
  return allowed.find((item) => item.toLowerCase() === scoped.toLowerCase()) || fallback
}

function normalizeInspectionStatus(value, fallback = "scheduled") {
  const scoped = String(value || fallback).trim().toLowerCase()
  return ["scheduled", "in_progress", "completed", "cancelled", "overdue"].includes(scoped) ? scoped : fallback
}

function normalizeNoticeStatus(value, fallback = "draft") {
  const scoped = String(value || fallback).trim().toLowerCase()
  return ["draft", "pending_approval", "approved", "scheduled", "published", "rejected"].includes(scoped) ? scoped : fallback
}

function casePublicId() {
  const now = new Date()
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("")
  return `CASE-${stamp}-${createPublicId().slice(0, 6)}`
}

function reportPublicId() {
  return `RPT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${createPublicId().slice(0, 8)}`
}

async function resolveStation(value) {
  const scoped = normalizeString(value)
  if (!scoped) throw badRequest("stationId is required")
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, operator_name, city, address, latitude, longitude
    FROM stations
    WHERE public_id = ${scoped} OR CAST(id AS CHAR) = ${scoped}
    LIMIT 1
  `
  const station = rows?.[0]
  if (!station?.id) throw notFound("Station not found")
  return station
}

async function resolveMeraUser(value, fallbackActor = null) {
  const scoped = normalizeString(value)
  if (!scoped && fallbackActor?.userId) {
    const rows = await prisma.$queryRaw`SELECT id, public_id, full_name, district_scope FROM mera_users WHERE id = ${fallbackActor.userId} LIMIT 1`
    return rows?.[0] || null
  }
  if (!scoped) return null
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, full_name, district_scope
    FROM mera_users
    WHERE public_id = ${scoped} OR CAST(id AS CHAR) = ${scoped}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function latestOfficialPriceRows() {
  return prisma.$queryRaw`
    SELECT fuel_type, price_per_litre, effective_date
    FROM mera_official_prices mop
    INNER JOIN (
      SELECT fuel_type AS latest_fuel_type, MAX(effective_date) AS latest_date
      FROM mera_official_prices
      GROUP BY fuel_type
    ) latest
      ON latest.latest_fuel_type = mop.fuel_type
      AND latest.latest_date = mop.effective_date
  `
}

function priceMapFromRows(rows = []) {
  return new Map(rows.map((row) => [normalizeUpper(row.fuel_type), toNumber(row.price_per_litre)]))
}

function computeRiskResult(row, officialPriceMap = new Map()) {
  const station = mapStation(row)
  const reasons = []
  const evidence = []
  let score = 0

  const complaintVolume = toNumber(row.complaints_24h) + toNumber(row.complaints_7d) * 0.7
  const severeComplaints = toNumber(row.severe_complaints_7d)
  const queueLength = toNumber(row.queue_length)
  const avgWait = toNumber(row.avg_wait_minutes)
  const offlineHours = toNumber(row.offline_hours_7d)
  const openFlags = toNumber(row.open_flags)
  const failedInspections = toNumber(row.failed_inspections)
  const salesLitres24h = toNumber(row.sales_litres_24h)
  const deliveryLitres7d = toNumber(row.delivery_litres_7d)
  const deliveryDelayHours = row.last_delivery_at ? Math.max(0, (Date.now() - new Date(row.last_delivery_at).getTime()) / 3600000) : 0
  const petrolStatus = normalizeUpper(row.petrol_status || "UNKNOWN")
  const dieselStatus = normalizeUpper(row.diesel_status || "UNKNOWN")
  const availabilityStatus = normalizeUpper(row.availability_status || "UNKNOWN")
  const latestPetrolPrice = toNumber(row.petrol_price, NaN)
  const latestDieselPrice = toNumber(row.diesel_price, NaN)
  const petrolMismatch = Number.isFinite(latestPetrolPrice) && officialPriceMap.has("PETROL")
    ? Math.max(0, latestPetrolPrice - officialPriceMap.get("PETROL"))
    : 0
  const dieselMismatch = Number.isFinite(latestDieselPrice) && officialPriceMap.has("DIESEL")
    ? Math.max(0, latestDieselPrice - officialPriceMap.get("DIESEL"))
    : 0

  if (complaintVolume >= 3) {
    const points = clamp(Math.round(complaintVolume * 3), 0, 18)
    score += points
    reasons.push("Complaint volume above normal threshold")
    evidence.push({ type: "complaints", count24h: toNumber(row.complaints_24h), count7d: toNumber(row.complaints_7d), points })
  }
  if (severeComplaints > 0) {
    const points = clamp(severeComplaints * 5, 0, 18)
    score += points
    reasons.push("Repeated customer claims indicate hoarding, favouritism, or queue manipulation")
    evidence.push({ type: "complaint_severity", severeComplaints, points })
  }
  const stockScore = fuelStateScore(availabilityStatus) + Math.max(fuelStateScore(petrolStatus), fuelStateScore(dieselStatus))
  if (stockScore) {
    score += clamp(stockScore, 0, 24)
    reasons.push("Station fuel availability signal is constrained or dry")
    evidence.push({ type: "fuel_state", availabilityStatus, petrolStatus, dieselStatus, points: clamp(stockScore, 0, 24) })
  }
  if (queueLength >= 35 || avgWait >= 45) {
    const points = clamp(Math.round(queueLength / 5 + avgWait / 10), 8, 20)
    score += points
    reasons.push("Abnormal queue length or average wait time")
    evidence.push({ type: "queue", queueLength, avgWaitMinutes: Math.round(avgWait), points })
  }
  if (offlineHours >= 8) {
    const points = clamp(Math.round(offlineHours / 2), 8, 18)
    score += points
    reasons.push("Station has extended offline reporting behaviour")
    evidence.push({ type: "offline", offlineHours: Math.round(offlineHours), points })
  }
  if (deliveryLitres7d >= 10000 && salesLitres24h < deliveryLitres7d * 0.08) {
    score += 16
    reasons.push("Delivery received but sales velocity remains unusually low")
    evidence.push({ type: "delivery_to_sale", deliveryLitres7d, salesLitres24h, points: 16 })
  }
  if (deliveryDelayHours <= 72 && deliveryLitres7d > 0 && ["DRY", "UNKNOWN", "OFFLINE"].includes(availabilityStatus)) {
    score += 14
    reasons.push("Delivery received but public availability remains unavailable")
    evidence.push({ type: "false_availability", lastDeliveryAt: row.last_delivery_at, availabilityStatus, points: 14 })
  }
  if (queueLength >= 45 && salesLitres24h < 500) {
    score += 12
    reasons.push("High queue but low recorded sales")
    evidence.push({ type: "high_queue_low_sales", queueLength, salesLitres24h, points: 12 })
  }
  if (openFlags > 0) {
    const points = clamp(openFlags * 6, 0, 18)
    score += points
    reasons.push("Open compliance flags or manual review signals")
    evidence.push({ type: "compliance_flags", openFlags, points })
  }
  if (failedInspections > 0) {
    const points = clamp(failedInspections * 8, 0, 16)
    score += points
    reasons.push("Previous inspection violations or failures")
    evidence.push({ type: "inspection_history", failedInspections, points })
  }
  if (petrolMismatch > 0 || dieselMismatch > 0) {
    const amount = Math.max(petrolMismatch, dieselMismatch)
    const points = clamp(Math.ceil(amount / 25) * 4, 8, 16)
    score += points
    reasons.push("Reported pump price exceeds official MERA price")
    evidence.push({ type: "price_mismatch", petrolMismatch, dieselMismatch, points })
  }

  const riskScore = clamp(Math.round(score), 0, 100)
  const mainReasons = reasons.length ? reasons.slice(0, 5) : ["No abnormal regulatory signal above baseline"]
  return {
    stationId: station.publicId,
    stationPublicId: station.publicId,
    stationNumericId: station.stationNumericId,
    stationName: station.name,
    district: station.district,
    owner: station.owner,
    omc: station.omc,
    latitude: station.latitude,
    longitude: station.longitude,
    petrolStatus,
    dieselStatus,
    availabilityStatus,
    queueLength,
    averageWaitTime: Math.round(avgWait),
    riskScore,
    riskLevel: riskLevelForScore(riskScore),
    markerStatus: deriveMarkerStatus({ riskScore, availabilityStatus, petrolStatus, dieselStatus, queueLength }),
    mainReasons,
    evidence,
    recommendedAction: recommendedActionForScore(riskScore, mainReasons),
    openCases: toNumber(row.open_cases),
    lastUpdate: row.status_updated_at || row.last_status_at || row.generated_at || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
  }
}

async function riskSourceRows(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const scopedDistrict = districtFilterValue(auth)
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const queryFilter = `%${String(filters.query || filters.search || "").trim()}%`
  return prisma.$queryRaw`
    SELECT
      s.id AS station_id,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.operator_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      s.latitude,
      s.longitude,
      COALESCE(scs.availability_status, latest_status.availability_status, 'UNKNOWN') AS availability_status,
      COALESCE(scs.petrol_status, latest_status.petrol_status, 'UNKNOWN') AS petrol_status,
      COALESCE(scs.diesel_status, latest_status.diesel_status, 'UNKNOWN') AS diesel_status,
      COALESCE(scs.updated_at, latest_status.created_at, s.updated_at) AS status_updated_at,
      COALESCE(complaints.complaints_24h, 0) AS complaints_24h,
      COALESCE(complaints.complaints_7d, 0) AS complaints_7d,
      COALESCE(complaints.severe_complaints_7d, 0) AS severe_complaints_7d,
      COALESCE(queues.queue_length, 0) AS queue_length,
      COALESCE(queues.avg_wait_minutes, 0) AS avg_wait_minutes,
      COALESCE(offline.offline_hours_7d, 0) AS offline_hours_7d,
      COALESCE(flags.open_flags, 0) AS open_flags,
      COALESCE(inspections.failed_inspections, 0) AS failed_inspections,
      COALESCE(sales.sales_litres_24h, 0) AS sales_litres_24h,
      COALESCE(deliveries.delivery_litres_7d, 0) AS delivery_litres_7d,
      deliveries.last_delivery_at,
      prices.petrol_price,
      prices.diesel_price,
      COALESCE(cases.open_cases, 0) AS open_cases
    FROM stations s
    LEFT JOIN station_current_status scs ON scs.station_id = s.id
    LEFT JOIN (
      SELECT status_log.station_id, status_log.availability_status, status_log.petrol_status, status_log.diesel_status, status_log.created_at
      FROM station_status_logs status_log
      INNER JOIN (
        SELECT station_id, MAX(created_at) AS created_at
        FROM station_status_logs
        GROUP BY station_id
      ) latest_status_log ON latest_status_log.station_id = status_log.station_id AND latest_status_log.created_at = status_log.created_at
    ) latest_status ON latest_status.station_id = s.id
    LEFT JOIN (
      SELECT
        station_id,
        SUM(CASE WHEN created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS complaints_24h,
        COUNT(*) AS complaints_7d,
        SUM(CASE WHEN complaint_type IN ('HOARDING','REFUSAL_TO_SELL','SUSPICIOUS_QUEUE_MANIPULATION','OVERPRICING','ILLEGAL_VENDING') THEN 1 ELSE 0 END) AS severe_complaints_7d
      FROM public_complaints
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
      GROUP BY station_id
    ) complaints ON complaints.station_id = s.id
    LEFT JOIN (
      SELECT
        station_id,
        COUNT(*) AS queue_length,
        AVG(TIMESTAMPDIFF(MINUTE, joined_at, COALESCE(served_at, CURRENT_TIMESTAMP(3)))) AS avg_wait_minutes
      FROM queue_entries
      WHERE joined_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
        AND status IN ('WAITING','CALLED','LATE')
      GROUP BY station_id
    ) queues ON queues.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) * 2 AS offline_hours_7d
      FROM station_status_logs
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
        AND availability_status = 'UNKNOWN'
      GROUP BY station_id
    ) offline ON offline.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS open_flags
      FROM compliance_flags
      WHERE resolved_status IN ('OPEN','UNDER_REVIEW')
      GROUP BY station_id
    ) flags ON flags.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS failed_inspections
      FROM inspections
      WHERE inspection_status IN ('FAILED','ESCALATED')
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 180 DAY)
      GROUP BY station_id
    ) inspections ON inspections.station_id = s.id
    LEFT JOIN (
      SELECT station_id, SUM(litres) AS sales_litres_24h
      FROM transactions
      WHERE occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
        AND status IN ('RECORDED','UNDER_REVIEW')
      GROUP BY station_id
    ) sales ON sales.station_id = s.id
    LEFT JOIN (
      SELECT station_id, SUM(COALESCE(estimated_volume, 0)) AS delivery_litres_7d, MAX(delivery_time) AS last_delivery_at
      FROM fuel_delivery_logs
      WHERE delivery_time >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
      GROUP BY station_id
    ) deliveries ON deliveries.station_id = s.id
    LEFT JOIN (
      SELECT fpr.station_id, fpr.petrol_price, fpr.diesel_price
      FROM fuel_price_reports fpr
      INNER JOIN (
        SELECT station_id, MAX(created_at) AS created_at
        FROM fuel_price_reports
        GROUP BY station_id
      ) latest_price ON latest_price.station_id = fpr.station_id AND latest_price.created_at = fpr.created_at
    ) prices ON prices.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS open_cases
      FROM mera_cases
      WHERE status NOT IN ('Closed','Dismissed')
      GROUP BY station_id
    ) cases ON cases.station_id = s.id
    WHERE s.is_active = 1
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      AND (${String(filters.district || "").trim() === ""} = TRUE OR s.city LIKE ${districtFilter})
      AND (${String(filters.query || filters.search || "").trim() === ""} = TRUE OR s.name LIKE ${queryFilter} OR s.public_id LIKE ${queryFilter} OR s.operator_name LIKE ${queryFilter})
    ORDER BY s.name ASC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
}

export async function listRiskStations(filters = {}, auth = null) {
  const [rows, prices] = await Promise.all([riskSourceRows({ ...filters, limit: filters.limit || 100 }, auth), latestOfficialPriceRows().catch(() => [])])
  const priceMap = priceMapFromRows(prices)
  const items = (rows || []).map((row) => computeRiskResult(row, priceMap))
  const riskLevel = normalizeString(filters.riskLevel || filters.level)
  const filtered = riskLevel ? items.filter((item) => item.riskLevel.toLowerCase() === riskLevel.toLowerCase()) : items
  return {
    page: normalizePagination(filters).page,
    limit: normalizePagination(filters).limit,
    items: filtered,
  }
}

export async function getRiskSummary(auth = null) {
  const payload = await listRiskStations({ limit: 100 }, auth)
  const items = payload.items
  const counts = items.reduce((acc, item) => {
    acc[item.riskLevel] = (acc[item.riskLevel] || 0) + 1
    return acc
  }, {})
  const total = items.length
  const highRisk = items.filter((item) => item.riskScore >= 76).length
  const critical = items.filter((item) => item.riskScore >= 91).length
  const avgRiskScore = total ? Math.round(items.reduce((sum, item) => sum + item.riskScore, 0) / total) : 0
  return {
    generatedAt: new Date().toISOString(),
    totalStations: total,
    avgRiskScore,
    highRiskStations: highRisk,
    criticalStations: critical,
    levels: {
      Normal: counts.Normal || 0,
      Watch: counts.Watch || 0,
      Suspicious: counts.Suspicious || 0,
      "High Risk": counts["High Risk"] || 0,
      Critical: counts.Critical || 0,
    },
    topReasons: items.flatMap((item) => item.mainReasons || []).reduce((acc, reason) => {
      acc[reason] = (acc[reason] || 0) + 1
      return acc
    }, {}),
  }
}

export async function getRiskStation(stationId, auth = null) {
  const station = await resolveStation(stationId)
  ensureDistrictAccess(auth, station.city, "station")
  const payload = await listRiskStations({ query: station.public_id, limit: 10 }, auth)
  const item = payload.items.find((row) => row.stationPublicId === station.public_id)
  if (!item) throw notFound("Risk station result not found")
  return item
}

export async function getRiskWatchlist(filters = {}, auth = null) {
  const payload = await listRiskStations({ ...filters, limit: filters.limit || 100 }, auth)
  return {
    ...payload,
    items: payload.items.filter((item) => item.riskScore >= 56).sort((a, b) => b.riskScore - a.riskScore),
  }
}

export async function recalculateRisk(auth = null) {
  const payload = await listRiskStations({ limit: 100 }, auth)
  for (const item of payload.items) {
    if (!item.stationNumericId) continue
    await prisma.$executeRaw`
      INSERT INTO mera_risk_scores (
        station_id,
        risk_score,
        risk_level,
        main_reasons_json,
        evidence_json,
        recommended_action,
        generated_at
      )
      VALUES (
        ${item.stationNumericId},
        ${item.riskScore},
        ${item.riskLevel},
        ${jsonString(item.mainReasons)},
        ${jsonString(item.evidence)},
        ${item.recommendedAction},
        CURRENT_TIMESTAMP(3)
      )
      ON DUPLICATE KEY UPDATE
        risk_score = VALUES(risk_score),
        risk_level = VALUES(risk_level),
        main_reasons_json = VALUES(main_reasons_json),
        evidence_json = VALUES(evidence_json),
        recommended_action = VALUES(recommended_action),
        generated_at = CURRENT_TIMESTAMP(3)
    `
  }
  await logMeraAudit({
    ...actorAuditContext(auth),
    actionType: "risk recalculated",
    actionDescription: `MERA risk engine recalculated ${payload.items.length} station scores.`,
    affectedEntity: "mera_risk_scores",
  })
  return { recalculated: payload.items.length, generatedAt: new Date().toISOString(), items: payload.items }
}

function alertFromRisk(item) {
  const reason = item.mainReasons?.[0] || "Risk score elevated by station behaviour"
  let type = "FUEL_DEPLETION_ANOMALY"
  const text = `${item.mainReasons?.join(" ") || ""}`.toLowerCase()
  if (text.includes("hoarding") || text.includes("availability remains unavailable")) type = "POSSIBLE_HOARDING"
  else if (text.includes("queue")) type = text.includes("low recorded sales") ? "HIGH_QUEUE_LOW_SALES" : "QUEUE_MANIPULATION"
  else if (text.includes("delivery")) type = "DELIVERY_TO_SALE_DELAY"
  else if (text.includes("price")) type = "PRICE_MISMATCH"
  else if (text.includes("offline")) type = "STATION_OFFLINE"
  else if (text.includes("complaint")) type = "COMPLAINT_SPIKE"

  return {
    id: `risk:${item.stationPublicId}:${type}`,
    sourceKey: `risk:${item.stationPublicId}:${type}`,
    type,
    severity: alertSeverityForScore(item.riskScore),
    stationId: item.stationPublicId,
    stationPublicId: item.stationPublicId,
    stationName: item.stationName,
    district: item.district,
    title: `${type.replace(/_/g, " ")} at ${item.stationName}`,
    description: reason,
    evidence: item.evidence || [],
    recommendedAction: item.recommendedAction,
    status: "new",
    createdAt: item.generatedAt,
    riskScore: item.riskScore,
  }
}

async function persistedAlertRows(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  return prisma.$queryRaw`
    SELECT
      ma.public_id,
      ma.source_key,
      ma.type,
      ma.severity,
      ma.title,
      ma.description,
      ma.evidence_json,
      ma.recommended_action,
      ma.status,
      ma.created_at,
      ma.station_id,
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM mera_alerts ma
    LEFT JOIN stations s ON s.id = ma.station_id
    WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
  `
}

function mapPersistedAlert(row) {
  return {
    id: row.public_id,
    sourceKey: row.source_key,
    type: row.type,
    severity: String(row.severity || "").toLowerCase(),
    stationId: row.station_public_id,
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    district: row.district,
    title: row.title,
    description: row.description,
    evidence: safeParseJson(row.evidence_json, []),
    recommendedAction: row.recommended_action,
    status: row.status,
    createdAt: row.created_at,
  }
}

export async function listAlerts(filters = {}, auth = null) {
  const [risk, persistedRows] = await Promise.all([getRiskWatchlist({ limit: 100 }, auth), persistedAlertRows(auth).catch(() => [])])
  const persistedBySource = new Map((persistedRows || []).map((row) => [row.source_key, mapPersistedAlert(row)]))
  const generated = risk.items.map(alertFromRisk).map((alert) => ({ ...alert, ...(persistedBySource.get(alert.sourceKey) || {}) }))
  const manual = (persistedRows || [])
    .map(mapPersistedAlert)
    .filter((alert) => !generated.some((item) => item.sourceKey && item.sourceKey === alert.sourceKey))
  let items = [...generated, ...manual]
  const status = normalizeString(filters.status)
  const severity = normalizeString(filters.severity)
  if (status) items = items.filter((item) => String(item.status || "").toLowerCase() === status.toLowerCase())
  if (severity) items = items.filter((item) => String(item.severity || "").toLowerCase() === severity.toLowerCase())
  items.sort((a, b) => {
    const severityRank = { critical: 4, high: 3, medium: 2, low: 1 }
    return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
  const pagination = normalizePagination(filters)
  return { page: pagination.page, limit: pagination.limit, total: items.length, items: items.slice(pagination.offset, pagination.offset + pagination.limit) }
}

async function persistGeneratedAlert(alert, auth = null) {
  const station = await resolveStation(alert.stationId)
  ensureDistrictAccess(auth, station.city, "station")
  const rows = await prisma.$queryRaw`SELECT public_id FROM mera_alerts WHERE source_key = ${alert.sourceKey} LIMIT 1`
  if (rows?.[0]?.public_id) return rows[0].public_id
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO mera_alerts (
      public_id,
      source_key,
      type,
      severity,
      station_id,
      title,
      description,
      evidence_json,
      recommended_action,
      status
    )
    VALUES (
      ${publicId},
      ${alert.sourceKey},
      ${alert.type},
      ${alert.severity},
      ${station.id},
      ${alert.title},
      ${alert.description},
      ${jsonString(alert.evidence)},
      ${alert.recommendedAction},
      ${alert.status || "new"}
    )
  `
  return publicId
}

async function resolveAlert(alertId, auth = null) {
  const alerts = await listAlerts({ limit: 100 }, auth)
  const alert = alerts.items.find((item) => item.id === alertId || item.sourceKey === alertId)
  if (!alert) throw notFound("Alert not found")
  return alert
}

export async function acknowledgeAlert(alertId, auth = null) {
  const alert = await resolveAlert(alertId, auth)
  const publicId = alert.id?.startsWith("risk:") ? await persistGeneratedAlert(alert, auth) : alert.id
  await prisma.$executeRaw`UPDATE mera_alerts SET status = 'acknowledged', acknowledged_by = ${auth?.userId || null}, acknowledged_at = CURRENT_TIMESTAMP(3) WHERE public_id = ${publicId}`
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "alert acknowledged", actionDescription: `Alert ${publicId} acknowledged.`, affectedEntity: publicId })
  return { publicId, status: "acknowledged" }
}

export async function dismissAlert(alertId, payload = {}, auth = null) {
  const alert = await resolveAlert(alertId, auth)
  const publicId = alert.id?.startsWith("risk:") ? await persistGeneratedAlert(alert, auth) : alert.id
  const reason = normalizeString(payload.reason) || "Dismissed by MERA officer"
  await prisma.$executeRaw`UPDATE mera_alerts SET status = 'dismissed', dismissed_reason = ${reason}, dismissed_by = ${auth?.userId || null}, dismissed_at = CURRENT_TIMESTAMP(3) WHERE public_id = ${publicId}`
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "alert dismissed", actionDescription: `Alert ${publicId} dismissed: ${reason}`, affectedEntity: publicId })
  return { publicId, status: "dismissed", reason }
}

export async function openCaseFromAlert(alertId, auth = null) {
  const alert = await resolveAlert(alertId, auth)
  const caseRecord = await createCase({
    title: alert.title,
    type: alert.type === "PRICE_MISMATCH" ? "price violation" : alert.type === "QUEUE_MANIPULATION" ? "queue manipulation" : "suspected hoarding",
    stationId: alert.stationId,
    severity: alert.severity,
    sourceAlertId: alert.id,
    evidence: alert.evidence,
  }, auth)
  const publicId = alert.id?.startsWith("risk:") ? await persistGeneratedAlert(alert, auth) : alert.id
  await prisma.$executeRaw`UPDATE mera_alerts SET status = 'converted_to_case', linked_case_id = ${caseRecord.caseId} WHERE public_id = ${publicId}`
  return { alertId: publicId, case: caseRecord }
}

export async function assignInspectionFromAlert(alertId, payload = {}, auth = null) {
  const alert = await resolveAlert(alertId, auth)
  const inspection = await createInspectionFromPayload({
    stationId: alert.stationId,
    assignedOfficerId: payload.assignedOfficerId,
    reason: payload.reason || alert.title,
    priority: payload.priority || (alert.severity === "critical" ? "critical" : "high"),
    linkedCaseId: payload.linkedCaseId || null,
  }, auth)
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "inspection assigned", actionDescription: `Inspection ${inspection.inspectionId} assigned from alert ${alert.id}.`, affectedEntity: inspection.inspectionId })
  return inspection
}

function mapCaseRow(row) {
  return {
    caseId: row.public_id,
    title: row.title,
    type: row.type,
    stationId: row.station_public_id,
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    district: row.district,
    severity: row.severity,
    assignedOfficerId: row.assigned_officer_public_id,
    assignedOfficerName: row.assigned_officer_name,
    createdBy: row.created_by_public_id,
    sourceAlertId: row.source_alert_id,
    evidence: safeParseJson(row.evidence_json, []),
    status: row.status,
    dueDate: row.due_date,
    finalOutcome: row.final_outcome,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listCases(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const scopedDistrict = districtFilterValue(auth)
  const status = normalizeString(filters.status)
  const severity = normalizeString(filters.severity)
  const query = `%${String(filters.query || filters.search || "").trim()}%`
  const rows = await prisma.$queryRaw`
    SELECT
      mc.public_id,
      mc.title,
      mc.type,
      mc.severity,
      mc.source_alert_id,
      mc.evidence_json,
      mc.status,
      mc.due_date,
      mc.final_outcome,
      mc.created_at,
      mc.updated_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), mc.district, 'Unknown') AS district,
      assigned.public_id AS assigned_officer_public_id,
      assigned.full_name AS assigned_officer_name,
      created.public_id AS created_by_public_id
    FROM mera_cases mc
    LEFT JOIN stations s ON s.id = mc.station_id
    LEFT JOIN mera_users assigned ON assigned.id = mc.assigned_officer_id
    LEFT JOIN mera_users created ON created.id = mc.created_by
    WHERE (${scopedDistrict === ""} = TRUE OR COALESCE(s.city, mc.district) = ${scopedDistrict})
      AND (${status === null} = TRUE OR mc.status = ${status || ""})
      AND (${severity === null} = TRUE OR mc.severity = ${severity || ""})
      AND (${String(filters.query || filters.search || "").trim() === ""} = TRUE OR mc.title LIKE ${query} OR s.name LIKE ${query} OR mc.public_id LIKE ${query})
    ORDER BY mc.updated_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return { page: pagination.page, limit: pagination.limit, items: (rows || []).map(mapCaseRow) }
}

export async function getCaseRecordDetail(caseId, auth = null) {
  const rows = await prisma.$queryRaw`
    SELECT
      mc.*,
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), mc.district, 'Unknown') AS district,
      assigned.public_id AS assigned_officer_public_id,
      assigned.full_name AS assigned_officer_name,
      created.public_id AS created_by_public_id
    FROM mera_cases mc
    LEFT JOIN stations s ON s.id = mc.station_id
    LEFT JOIN mera_users assigned ON assigned.id = mc.assigned_officer_id
    LEFT JOIN mera_users created ON created.id = mc.created_by
    WHERE mc.public_id = ${caseId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.id) return null
  ensureDistrictAccess(auth, row.district, "case")
  const [notes, evidence, timeline, inspections, complaints] = await Promise.all([
    prisma.$queryRaw`
      SELECT mcn.public_id, mcn.note, mcn.visibility, mcn.created_at, mu.public_id AS author_public_id, mu.full_name AS author_name
      FROM mera_case_notes mcn
      LEFT JOIN mera_users mu ON mu.id = mcn.author_user_id
      WHERE mcn.case_id = ${row.id}
      ORDER BY mcn.created_at DESC
    `,
    prisma.$queryRaw`
      SELECT public_id, evidence_type, title, description, file_url, metadata_json, created_at
      FROM mera_case_evidence
      WHERE case_id = ${row.id}
      ORDER BY created_at DESC
    `,
    prisma.$queryRaw`
      SELECT public_id, event_type, event_title, event_description, metadata_json, created_at
      FROM mera_case_timeline
      WHERE case_id = ${row.id}
      ORDER BY created_at ASC
    `,
    prisma.$queryRaw`
      SELECT public_id, inspection_type, inspection_status, created_at, updated_at
      FROM inspections
      WHERE linked_case_id = ${caseId}
      ORDER BY created_at DESC
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT pc.public_id, pc.complaint_type, pc.complaint_status, pc.created_at
      FROM public_complaints pc
      WHERE pc.linked_case_id = ${caseId}
      ORDER BY pc.created_at DESC
    `.catch(() => []),
  ])
  return {
    case: mapCaseRow(row),
    notes: (notes || []).map((item) => ({ ...item, publicId: item.public_id, author: item.author_name })),
    evidence: (evidence || []).map((item) => ({ ...item, publicId: item.public_id, metadata: safeParseJson(item.metadata_json, {}) })),
    timeline: (timeline || []).map((item) => ({ ...item, publicId: item.public_id, metadata: safeParseJson(item.metadata_json, {}) })),
    linkedInspections: inspections || [],
    linkedComplaints: complaints || [],
  }
}

async function writeCaseTimeline(caseNumericId, eventType, title, description, metadata = {}) {
  await prisma.$executeRaw`
    INSERT INTO mera_case_timeline (public_id, case_id, event_type, event_title, event_description, metadata_json)
    VALUES (${createPublicId()}, ${caseNumericId}, ${eventType}, ${title}, ${description || null}, ${jsonString(metadata)})
  `
}

export async function createCase(payload = {}, auth = null) {
  const station = await resolveStation(payload.stationId || payload.stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const assignee = await resolveMeraUser(payload.assignedOfficerId || payload.assignedOfficerPublicId, auth)
  const publicId = payload.caseId || casePublicId()
  const title = normalizeString(payload.title) || `MERA compliance case for ${station.name}`
  const type = normalizeCaseType(payload.type)
  const severity = normalizeUpper(payload.severity || "medium").toLowerCase()
  const dueDate = normalizeString(payload.dueDate)
  await prisma.$executeRaw`
    INSERT INTO mera_cases (
      public_id,
      title,
      type,
      station_id,
      district,
      severity,
      assigned_officer_id,
      created_by,
      source_alert_id,
      evidence_json,
      status,
      due_date
    )
    VALUES (
      ${publicId},
      ${title},
      ${type},
      ${station.id},
      ${station.city || null},
      ${severity},
      ${assignee?.id || null},
      ${auth?.userId || null},
      ${payload.sourceAlertId || null},
      ${jsonString(payload.evidence || [])},
      ${normalizeCaseStatus(payload.status || "New")},
      ${dueDate}
    )
  `
  const rows = await prisma.$queryRaw`SELECT id FROM mera_cases WHERE public_id = ${publicId} LIMIT 1`
  if (rows?.[0]?.id) {
    await writeCaseTimeline(rows[0].id, "case_opened", "Case opened", title, { sourceAlertId: payload.sourceAlertId || null })
  }
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "case opened", actionDescription: `Case ${publicId} opened for ${station.name}.`, affectedEntity: publicId })
  return (await getCaseRecordDetail(publicId, auth))?.case
}

export async function patchCase(caseId, payload = {}, auth = null) {
  const detail = await getCaseRecordDetail(caseId, auth)
  if (!detail?.case?.caseId) throw notFound("Case not found")
  const before = detail.case
  const status = payload.status !== undefined ? normalizeCaseStatus(payload.status, before.status) : before.status
  const severity = payload.severity !== undefined ? normalizeUpper(payload.severity).toLowerCase() : before.severity
  const title = payload.title !== undefined ? normalizeString(payload.title) || before.title : before.title
  const dueDate = payload.dueDate !== undefined ? normalizeString(payload.dueDate) : before.dueDate
  const finalOutcome = payload.finalOutcome !== undefined ? normalizeString(payload.finalOutcome) : before.finalOutcome
  const assignee = payload.assignedOfficerId !== undefined || payload.assignedOfficerPublicId !== undefined
    ? await resolveMeraUser(payload.assignedOfficerId || payload.assignedOfficerPublicId, auth)
    : null
  await prisma.$executeRaw`
    UPDATE mera_cases
    SET
      title = ${title},
      severity = ${severity},
      status = ${status},
      due_date = ${dueDate},
      final_outcome = ${finalOutcome},
      assigned_officer_id = CASE WHEN ${payload.assignedOfficerId !== undefined || payload.assignedOfficerPublicId !== undefined} THEN ${assignee?.id || null} ELSE assigned_officer_id END,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${caseId}
  `
  const updated = await getCaseRecordDetail(caseId, auth)
  const rows = await prisma.$queryRaw`SELECT id FROM mera_cases WHERE public_id = ${caseId} LIMIT 1`
  if (rows?.[0]?.id) await writeCaseTimeline(rows[0].id, "case_status_changed", "Case updated", `Status changed to ${status}.`, { before, after: updated?.case })
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "case status changed", actionDescription: `Case ${caseId} updated.`, affectedEntity: caseId })
  return updated?.case
}

export async function addCaseNote(caseId, payload = {}, auth = null) {
  const detail = await getCaseRecordDetail(caseId, auth)
  if (!detail?.case?.caseId) throw notFound("Case not found")
  const rows = await prisma.$queryRaw`SELECT id FROM mera_cases WHERE public_id = ${caseId} LIMIT 1`
  const note = normalizeString(payload.note)
  if (!note) throw badRequest("note is required")
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO mera_case_notes (public_id, case_id, author_user_id, note, visibility)
    VALUES (${publicId}, ${rows[0].id}, ${auth?.userId || null}, ${note}, ${payload.visibility || "internal"})
  `
  await writeCaseTimeline(rows[0].id, "case_note_added", "Case note added", note.slice(0, 240))
  return { publicId, note }
}

export async function addCaseEvidence(caseId, payload = {}, auth = null) {
  const detail = await getCaseRecordDetail(caseId, auth)
  if (!detail?.case?.caseId) throw notFound("Case not found")
  const rows = await prisma.$queryRaw`SELECT id FROM mera_cases WHERE public_id = ${caseId} LIMIT 1`
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO mera_case_evidence (public_id, case_id, evidence_type, title, description, file_url, metadata_json, created_by)
    VALUES (${publicId}, ${rows[0].id}, ${payload.evidenceType || "document"}, ${payload.title || "Evidence item"}, ${payload.description || null}, ${payload.fileUrl || null}, ${jsonString(payload.metadata || {})}, ${auth?.userId || null})
  `
  await writeCaseTimeline(rows[0].id, "case_evidence_added", "Evidence added", payload.title || "Evidence item", { evidencePublicId: publicId })
  return { publicId }
}

export async function escalateCase(caseId, payload = {}, auth = null) {
  const updated = await patchCase(caseId, { status: "Escalated", finalOutcome: payload.reason || null }, auth)
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "case escalated", actionDescription: `Case ${caseId} escalated.`, affectedEntity: caseId })
  return updated
}

export async function closeCase(caseId, payload = {}, auth = null) {
  const status = normalizeUpper(payload.status) === "DISMISSED" ? "Dismissed" : "Closed"
  const updated = await patchCase(caseId, { status, finalOutcome: payload.finalOutcome || payload.outcome || "Closed by MERA officer" }, auth)
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "case closed", actionDescription: `Case ${caseId} closed.`, affectedEntity: caseId })
  return updated
}

export async function exportCaseEvidencePack(caseId, auth = null) {
  const detail = await getCaseRecordDetail(caseId, auth)
  if (!detail?.case?.caseId) throw notFound("Case not found")
  return {
    caseId,
    generatedAt: new Date().toISOString(),
    format: "json",
    filename: `${caseId}-evidence-pack.json`,
    content: detail,
  }
}

function mapInspectionRow(row) {
  return {
    inspectionId: row.public_id,
    stationId: row.station_public_id,
    stationPublicId: row.station_public_id,
    stationName: row.station_name,
    assignedOfficerId: row.officer_public_id,
    assignedOfficerName: row.officer_name,
    district: row.district,
    reason: row.reason || row.inspection_type,
    priority: row.priority || "medium",
    scheduledDate: row.scheduled_at || row.created_at,
    status: row.status || row.inspection_status,
    inspectionStatus: row.inspection_status,
    checklist: safeParseJson(row.checklist_json, []),
    findings: safeParseJson(row.findings_json, []),
    result: row.result,
    linkedCaseId: row.linked_case_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getInspection(inspectionId, auth = null) {
  const rows = await prisma.$queryRaw`
    SELECT
      i.*,
      COALESCE(i.status, LOWER(i.inspection_status)) AS status,
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name
    FROM inspections i
    INNER JOIN stations s ON s.id = i.station_id
    LEFT JOIN mera_users mu ON mu.id = i.officer_id
    WHERE i.public_id = ${inspectionId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.id) throw notFound("Inspection not found")
  ensureDistrictAccess(auth, row.district, "inspection")
  return mapInspectionRow(row)
}

export async function patchInspection(inspectionId, payload = {}, auth = null) {
  const current = await getInspection(inspectionId, auth)
  const assignee = payload.assignedOfficerId || payload.officerPublicId ? await resolveMeraUser(payload.assignedOfficerId || payload.officerPublicId, auth) : null
  await prisma.$executeRaw`
    UPDATE inspections
    SET
      reason = COALESCE(${payload.reason || null}, reason),
      priority = COALESCE(${payload.priority || null}, priority),
      status = COALESCE(${payload.status ? normalizeInspectionStatus(payload.status) : null}, status),
      scheduled_at = COALESCE(${payload.scheduledDate || null}, scheduled_at),
      checklist_json = COALESCE(${payload.checklist ? jsonString(payload.checklist) : null}, checklist_json),
      findings_json = COALESCE(${payload.findings ? jsonString(payload.findings) : null}, findings_json),
      officer_id = CASE WHEN ${Boolean(assignee?.id)} THEN ${assignee?.id || null} ELSE officer_id END,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${inspectionId}
  `
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "inspection assigned", actionDescription: `Inspection ${inspectionId} updated.`, affectedEntity: inspectionId })
  return getInspection(inspectionId, auth)
}

export async function completeInspection(inspectionId, payload = {}, auth = null) {
  const result = normalizeString(payload.result) || "completed"
  await prisma.$executeRaw`
    UPDATE inspections
    SET
      status = 'completed',
      inspection_status = CASE WHEN ${normalizeUpper(result).includes("FAIL")} THEN 'FAILED' ELSE 'CLOSED' END,
      result = ${result},
      findings_json = ${jsonString(payload.findings || [])},
      completed_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${inspectionId}
  `
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "inspection completed", actionDescription: `Inspection ${inspectionId} completed.`, affectedEntity: inspectionId })
  return getInspection(inspectionId, auth)
}

async function createInspectionFromPayload(payload = {}, auth = null) {
  const station = await resolveStation(payload.stationId || payload.stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const assignee = await resolveMeraUser(payload.assignedOfficerId || payload.officerPublicId, auth)
  const publicId = createPublicId()
  const checklist = payload.checklist || [
    "verify physical stock",
    "verify recent delivery records",
    "verify pump meter readings",
    "verify official pump price",
    "check queue process",
    "interview station manager",
    "review CCTV if available",
    "verify complaints",
    "verify manual override explanation",
  ]
  await prisma.$executeRaw`
    INSERT INTO inspections (
      public_id,
      station_id,
      officer_id,
      inspection_type,
      reason,
      priority,
      scheduled_at,
      status,
      inspection_status,
      checklist_json,
      linked_case_id,
      stock_visible,
      illegal_vending_detected
    )
    VALUES (
      ${publicId},
      ${station.id},
      ${assignee?.id || auth?.userId || null},
      'SPOT_CHECK',
      ${payload.reason || "Risk engine recommended inspection"},
      ${payload.priority || "high"},
      ${payload.scheduledDate || null},
      ${normalizeInspectionStatus(payload.status || "scheduled")},
      'OPEN',
      ${jsonString(checklist)},
      ${payload.linkedCaseId || null},
      1,
      0
    )
  `
  return getInspection(publicId, auth)
}

export async function createInspection(payload = {}, auth = null) {
  return createInspectionFromPayload(payload, auth)
}

export async function recommendedInspections(filters = {}, auth = null) {
  const [risk, overdueRows] = await Promise.all([
    getRiskWatchlist({ limit: 100 }, auth),
    prisma.$queryRaw`
      SELECT s.public_id AS station_public_id, s.name AS station_name, COALESCE(NULLIF(s.city, ''), 'Unknown') AS district, MAX(i.created_at) AS last_inspection_at
      FROM stations s
      LEFT JOIN inspections i ON i.station_id = s.id
      WHERE (${districtFilterValue(auth) === ""} = TRUE OR s.city = ${districtFilterValue(auth)})
      GROUP BY s.id, s.public_id, s.name, s.city
      HAVING last_inspection_at IS NULL OR last_inspection_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 90 DAY)
      LIMIT 25
    `.catch(() => []),
  ])
  const items = [
    ...risk.items.map((item) => ({
      stationId: item.stationPublicId,
      stationName: item.stationName,
      district: item.district,
      reason: item.mainReasons?.[0] || "Critical risk station",
      priority: item.riskScore >= 91 ? "critical" : "high",
      riskScore: item.riskScore,
      recommendedAction: "Assign Inspection",
    })),
    ...(overdueRows || []).map((row) => ({
      stationId: row.station_public_id,
      stationName: row.station_name,
      district: row.district,
      reason: "No recent inspection coverage",
      priority: "medium",
      riskScore: null,
      recommendedAction: "Assign Inspection",
    })),
  ]
  const unique = new Map()
  items.forEach((item) => {
    if (!unique.has(item.stationId)) unique.set(item.stationId, item)
  })
  const pagination = normalizePagination(filters)
  return { page: pagination.page, limit: pagination.limit, items: [...unique.values()].slice(pagination.offset, pagination.offset + pagination.limit) }
}

export async function listComplaintClusters(filters = {}, auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      pc.complaint_type,
      COUNT(*) AS complaint_count,
      MIN(pc.created_at) AS first_seen_at,
      MAX(pc.created_at) AS last_seen_at,
      GROUP_CONCAT(pc.public_id ORDER BY pc.created_at DESC SEPARATOR ',') AS complaint_ids
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    WHERE pc.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY s.id, s.public_id, s.name, s.city, pc.complaint_type
    HAVING COUNT(*) >= 2
    ORDER BY complaint_count DESC, last_seen_at DESC
    LIMIT 50
  `
  return {
    items: (rows || []).map((row) => ({
      id: `cluster:${row.station_public_id}:${row.complaint_type}`,
      stationId: row.station_public_id,
      stationName: row.station_name,
      district: row.district,
      category: row.complaint_type,
      fuelType: null,
      severity: toNumber(row.complaint_count) >= 5 ? "high" : "medium",
      complaintCount: toNumber(row.complaint_count),
      repeatedKeywords: [],
      timeWindow: "7d",
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      complaintIds: String(row.complaint_ids || "").split(",").filter(Boolean),
    })),
  }
}

export async function getComplaintTrends(filters = {}, auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT DATE(pc.created_at) AS day, pc.complaint_type, COUNT(*) AS count
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    WHERE pc.created_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY DATE(pc.created_at), pc.complaint_type
    ORDER BY day ASC
  `
  return { items: rows || [] }
}

export async function linkComplaintToCase(complaintPublicId, payload = {}, auth = null) {
  const caseId = normalizeString(payload.caseId)
  if (!caseId) throw badRequest("caseId is required")
  const caseDetail = await getCaseRecordDetail(caseId, auth)
  if (!caseDetail?.case?.caseId) throw notFound("Case not found")
  await prisma.$executeRaw`UPDATE public_complaints SET linked_case_id = ${caseId}, updated_at = CURRENT_TIMESTAMP(3) WHERE public_id = ${complaintPublicId}`
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "complaint linked to case", actionDescription: `Complaint ${complaintPublicId} linked to case ${caseId}.`, affectedEntity: complaintPublicId })
  return { complaintPublicId, caseId }
}

function mapDeliveryRow(row) {
  const expected = row.expected_arrival || row.delivery_time
  const actual = row.actual_arrival || row.delivery_time
  const delayMinutes = expected && actual ? Math.round((new Date(actual).getTime() - new Date(expected).getTime()) / 60000) : 0
  const anomalyFlags = []
  if (delayMinutes > 120) anomalyFlags.push("delivery delay")
  if (row.first_sale_after_delivery_at && new Date(row.first_sale_after_delivery_at).getTime() - new Date(actual).getTime() > 4 * 3600000) anomalyFlags.push("delivery-to-sale delay")
  if (toNumber(row.discrepancy_litres) > 250) anomalyFlags.push("stock variance")
  return {
    deliveryId: row.public_id || `FDL-${row.id}`,
    id: row.public_id || `FDL-${row.id}`,
    stationId: row.station_public_id,
    stationName: row.station_name,
    station: { publicId: row.station_public_id, name: row.station_name, city: row.district },
    district: row.district,
    sourceDepot: row.source_depot || row.source_type,
    omc: row.omc || row.operator_name,
    tankerPlate: row.tanker_plate,
    driverName: row.driver_name,
    fuelType: row.fuel_type,
    litresLoaded: row.litres_loaded || row.estimated_volume,
    expectedArrival: expected,
    actualArrival: actual,
    deliveryTime: row.delivery_time,
    offloadedQuantity: row.offloaded_quantity || row.estimated_volume,
    stationConfirmationStatus: row.station_confirmation_status || row.verification_status || "PENDING_REVIEW",
    firstSaleAfterDeliveryAt: row.first_sale_after_delivery_at,
    salesVelocityAfterDelivery: row.sales_velocity_after_delivery,
    discrepancyLitres: row.discrepancy_litres,
    status: row.status || "pending_review",
    anomalyFlags,
    estimatedVolume: row.estimated_volume,
    sourceType: row.source_type,
    reportedBy: row.reported_by,
    createdAt: row.created_at,
  }
}

export async function listFuelSupplyDeliveries(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const scopedDistrict = districtFilterValue(auth)
  const stationFilter = String(filters.station || filters.stationId || filters.stationPublicId || "").trim()
  const rows = await prisma.$queryRaw`
    SELECT
      fdl.*,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.operator_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM fuel_delivery_logs fdl
    INNER JOIN stations s ON s.id = fdl.station_id
    WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      AND (${String(filters.fuelType || "").trim() === ""} = TRUE OR fdl.fuel_type = ${String(filters.fuelType || "").trim()})
      AND (${String(filters.district || "").trim() === ""} = TRUE OR s.city = ${String(filters.district || "").trim()})
      AND (${stationFilter === ""} = TRUE OR s.public_id = ${stationFilter} OR CAST(fdl.station_id AS CHAR) = ${stationFilter})
    ORDER BY fdl.delivery_time DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return { page: pagination.page, limit: pagination.limit, items: (rows || []).map(mapDeliveryRow) }
}

export async function getFuelSupplyTimeline(filters = {}, auth = null) {
  const deliveries = await listFuelSupplyDeliveries({ ...filters, limit: filters.limit || 50 }, auth)
  return {
    items: deliveries.items.flatMap((item) => [
      { type: "delivery dispatched", deliveryId: item.deliveryId, stationName: item.stationName, at: item.expectedArrival, fuelType: item.fuelType },
      { type: "delivery arrived", deliveryId: item.deliveryId, stationName: item.stationName, at: item.actualArrival, fuelType: item.fuelType },
      ...(item.firstSaleAfterDeliveryAt ? [{ type: "first sale after delivery", deliveryId: item.deliveryId, stationName: item.stationName, at: item.firstSaleAfterDeliveryAt, fuelType: item.fuelType }] : []),
    ]).sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime()),
  }
}

export async function getStationFuelSupply(stationId, auth = null) {
  const station = await resolveStation(stationId)
  ensureDistrictAccess(auth, station.city, "station")
  return listFuelSupplyDeliveries({ station: station.public_id, limit: 100 }, auth)
}

export async function createFuelSupplyDelivery(payload = {}, auth = null) {
  const station = await resolveStation(payload.stationId || payload.stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO fuel_delivery_logs (
      public_id,
      station_id,
      source_depot,
      omc,
      tanker_plate,
      driver_name,
      fuel_type,
      litres_loaded,
      expected_arrival,
      actual_arrival,
      offloaded_quantity,
      station_confirmation_status,
      first_sale_after_delivery_at,
      sales_velocity_after_delivery,
      discrepancy_litres,
      status,
      delivery_time,
      estimated_volume,
      source_type,
      reported_by
    )
    VALUES (
      ${publicId},
      ${station.id},
      ${payload.sourceDepot || null},
      ${payload.omc || station.operator_name || null},
      ${payload.tankerPlate || null},
      ${payload.driverName || null},
      ${payload.fuelType || "PETROL"},
      ${payload.litresLoaded || payload.estimatedVolume || null},
      ${payload.expectedArrival || payload.deliveryTime || new Date().toISOString()},
      ${payload.actualArrival || null},
      ${payload.offloadedQuantity || payload.estimatedVolume || null},
      ${payload.stationConfirmationStatus || "pending"},
      ${payload.firstSaleAfterDeliveryAt || null},
      ${payload.salesVelocityAfterDelivery || null},
      ${payload.discrepancyLitres || null},
      ${payload.status || "pending_review"},
      ${payload.actualArrival || payload.expectedArrival || payload.deliveryTime || new Date().toISOString()},
      ${payload.estimatedVolume || payload.litresLoaded || null},
      ${payload.sourceType || "TANKER_MANIFEST"},
      ${payload.reportedBy || `${auth?.role || "MERA"}:${auth?.userId || "NA"}`}
    )
  `
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "fuel delivery created", actionDescription: `Delivery ${publicId} created for ${station.name}.`, affectedEntity: publicId })
  return { deliveryId: publicId }
}

export async function patchFuelSupplyDelivery(deliveryId, payload = {}, auth = null) {
  await prisma.$executeRaw`
    UPDATE fuel_delivery_logs
    SET
      actual_arrival = COALESCE(${payload.actualArrival || null}, actual_arrival),
      offloaded_quantity = COALESCE(${payload.offloadedQuantity || null}, offloaded_quantity),
      station_confirmation_status = COALESCE(${payload.stationConfirmationStatus || null}, station_confirmation_status),
      first_sale_after_delivery_at = COALESCE(${payload.firstSaleAfterDeliveryAt || null}, first_sale_after_delivery_at),
      sales_velocity_after_delivery = COALESCE(${payload.salesVelocityAfterDelivery || null}, sales_velocity_after_delivery),
      discrepancy_litres = COALESCE(${payload.discrepancyLitres || null}, discrepancy_litres),
      status = COALESCE(${payload.status || null}, status)
    WHERE public_id = ${deliveryId} OR CAST(id AS CHAR) = ${deliveryId}
  `
  return { deliveryId }
}

export async function listOfficialPrices(filters = {}) {
  const rows = await prisma.$queryRaw`
    SELECT public_id, fuel_type, price_per_litre, effective_date, status, created_at
    FROM mera_official_prices
    ORDER BY effective_date DESC, fuel_type ASC
    LIMIT ${normalizePagination(filters).limit}
  `
  return { items: rows || [] }
}

export async function createOfficialPrice(payload = {}, auth = null) {
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO mera_official_prices (public_id, fuel_type, price_per_litre, effective_date, status, created_by)
    VALUES (${publicId}, ${normalizeUpper(payload.fuelType || "PETROL")}, ${payload.pricePerLitre}, ${payload.effectiveDate || new Date().toISOString().slice(0, 10)}, ${payload.status || "active"}, ${auth?.userId || null})
  `
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "official price created", actionDescription: `Official ${payload.fuelType} price created.`, affectedEntity: publicId })
  return { publicId }
}

export async function listPriceCompliance(filters = {}, auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const [officialRows, stationRows, flagRows] = await Promise.all([
    latestOfficialPriceRows(),
    prisma.$queryRaw`
      SELECT
        s.id AS station_id,
        s.public_id AS station_public_id,
        s.name AS station_name,
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        s.prices_json,
        fpr.petrol_price,
        fpr.diesel_price,
        fpr.created_at
      FROM stations s
      LEFT JOIN fuel_price_reports fpr ON fpr.id = (
        SELECT latest.id
        FROM fuel_price_reports latest
        WHERE latest.station_id = s.id
        ORDER BY latest.created_at DESC
        LIMIT 1
      )
      WHERE s.is_active = 1
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      LIMIT 100
    `,
    prisma.$queryRaw`
      SELECT
        cf.public_id,
        cf.station_id,
        cf.severity,
        cf.generated_reason,
        cf.source_reference,
        cf.created_at
      FROM compliance_flags cf
      INNER JOIN stations s ON s.id = cf.station_id
      WHERE cf.flag_type = 'PRICE_ANOMALY'
        AND cf.resolved_status IN ('OPEN', 'UNDER_REVIEW')
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      ORDER BY cf.created_at DESC
    `,
  ])
  const official = priceMapFromRows(officialRows)
  const priceFlagMap = new Map()
  for (const flag of flagRows || []) {
    const stationId = Number(flag.station_id || 0)
    const keyText = String(flag.source_reference || flag.generated_reason || "").toUpperCase()
    const fuelType = keyText.includes("DIESEL") ? "DIESEL" : keyText.includes("PETROL") ? "PETROL" : ""
    const key = `${stationId}:${fuelType}`
    if (!priceFlagMap.has(key)) priceFlagMap.set(key, flag)
  }
  const items = (stationRows || []).flatMap((row) => {
    const records = []
    const petrolPrice = row.petrol_price !== null && row.petrol_price !== undefined
      ? toNumber(row.petrol_price)
      : resolveStationPricePerLitre(row.prices_json, "PETROL")
    const dieselPrice = row.diesel_price !== null && row.diesel_price !== undefined
      ? toNumber(row.diesel_price)
      : resolveStationPricePerLitre(row.prices_json, "DIESEL")
    const effectiveDate = row.created_at || null

    if (petrolPrice !== null && petrolPrice !== undefined) {
      const comparison = priceComparison({ fuelType: "PETROL", officialPrice: official.get("PETROL"), reportedPrice: petrolPrice })
      const activeFlag = priceFlagMap.get(`${Number(row.station_id || 0)}:PETROL`)
      records.push({
        stationDbId: Number(row.station_id || 0),
        stationId: row.station_public_id,
        stationName: row.station_name,
        district: row.district,
        ...comparison,
        activeFlagPublicId: activeFlag?.public_id || null,
        activeFlagSeverity: activeFlag?.severity || (comparison.severity !== "NONE" ? comparison.severity : null),
        activeFlagReason: activeFlag?.generated_reason || null,
        effectiveDate,
        source: row.created_at ? "fuel_price_report" : "station_prices",
      })
    }
    if (dieselPrice !== null && dieselPrice !== undefined) {
      const comparison = priceComparison({ fuelType: "DIESEL", officialPrice: official.get("DIESEL"), reportedPrice: dieselPrice })
      const activeFlag = priceFlagMap.get(`${Number(row.station_id || 0)}:DIESEL`)
      records.push({
        stationDbId: Number(row.station_id || 0),
        stationId: row.station_public_id,
        stationName: row.station_name,
        district: row.district,
        ...comparison,
        activeFlagPublicId: activeFlag?.public_id || null,
        activeFlagSeverity: activeFlag?.severity || (comparison.severity !== "NONE" ? comparison.severity : null),
        activeFlagReason: activeFlag?.generated_reason || null,
        effectiveDate,
        source: row.created_at ? "fuel_price_report" : "station_prices",
      })
    }
    return records
  })
  const ensuredFlagIds = await Promise.all(items.map((item) => ensurePriceAnomalyFlag(item, auth).catch(() => null)))
  ensuredFlagIds.forEach((flagId, index) => {
    if (flagId && !items[index].activeFlagPublicId) items[index].activeFlagPublicId = flagId
  })
  return { items }
}

export async function listPriceViolations(filters = {}, auth = null) {
  const compliance = await listPriceCompliance(filters, auth)
  return { items: compliance.items.filter((item) => item.status !== "compliant" && item.status !== "unknown") }
}

const REPORT_TYPES = [
  "National Fuel Availability Report",
  "District Shortage Report",
  "Station Compliance Report",
  "Complaints Intelligence Report",
  "Inspection Report",
  "Hoarding Suspicion Report",
  "Delivery-to-Sale Report",
  "Price Compliance Report",
  "Heatmap Export",
  "Case Evidence Pack",
]

export async function listReportTypes() {
  return { items: REPORT_TYPES.map((name) => ({ id: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, ""), name })) }
}

export async function generateReport(payload = {}, auth = null) {
  const publicId = reportPublicId()
  const type = normalizeString(payload.type) || "National Fuel Availability Report"
  await prisma.$executeRaw`
    INSERT INTO mera_reports (public_id, report_type, title, filters_json, status, generated_by)
    VALUES (${publicId}, ${type}, ${payload.title || type}, ${jsonString(payload.filters || {})}, 'ready', ${auth?.userId || null})
  `
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "report generated", actionDescription: `Report ${publicId} generated.`, affectedEntity: publicId })
  return { reportId: publicId, status: "ready" }
}

export async function listReports(filters = {}) {
  const pagination = normalizePagination(filters)
  const rows = await prisma.$queryRaw`
    SELECT mr.public_id, mr.report_type, mr.title, mr.filters_json, mr.status, mr.created_at, mu.full_name AS generated_by_name
    FROM mera_reports mr
    LEFT JOIN mera_users mu ON mu.id = mr.generated_by
    ORDER BY mr.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return { page: pagination.page, limit: pagination.limit, items: (rows || []).map((row) => ({ ...row, reportId: row.public_id, filters: safeParseJson(row.filters_json, {}) })) }
}

export async function getReport(reportId) {
  const reports = await prisma.$queryRaw`
    SELECT public_id, report_type, title, filters_json, status, created_at
    FROM mera_reports
    WHERE public_id = ${reportId}
    LIMIT 1
  `
  const row = reports?.[0]
  if (!row?.public_id) throw notFound("Report not found")
  return { ...row, reportId: row.public_id, filters: safeParseJson(row.filters_json, {}) }
}

export async function downloadReport(reportId) {
  const report = await getReport(reportId)
  return {
    reportId,
    filename: `${reportId}.json`,
    mimeType: "application/json",
    content: {
      ...report,
      generatedAt: new Date().toISOString(),
      note: "PDF rendering is not configured in this environment. This placeholder preserves the report workflow.",
    },
  }
}

function mapNoticeRow(row) {
  return {
    noticeId: row.public_id,
    title: row.title,
    message: row.message,
    category: row.category,
    targetRegion: row.target_region,
    targetDistrict: row.target_district,
    fuelType: row.fuel_type,
    severity: row.severity,
    status: row.status,
    selectedChannels: safeParseJson(row.selected_channels_json, []),
    externalPostStatus: safeParseJson(row.external_post_status_json, []),
    externalPostId: row.external_post_id,
    externalError: row.external_error,
    retryCount: row.retry_count,
    createdBy: row.created_by_name,
    approvedBy: row.approved_by_name,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listPublicNotices(filters = {}) {
  const pagination = normalizePagination(filters)
  const rows = await prisma.$queryRaw`
    SELECT pn.*, created.full_name AS created_by_name, approved.full_name AS approved_by_name
    FROM public_notices pn
    LEFT JOIN mera_users created ON created.id = pn.created_by
    LEFT JOIN mera_users approved ON approved.id = pn.approved_by
    ORDER BY pn.updated_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return { page: pagination.page, limit: pagination.limit, items: (rows || []).map(mapNoticeRow) }
}

export async function createPublicNotice(payload = {}, auth = null) {
  const publicId = createPublicId()
  const channels = Array.isArray(payload.selectedChannels) ? payload.selectedChannels.filter((channel) => NOTICE_CHANNELS.includes(channel)) : []
  await prisma.$executeRaw`
    INSERT INTO public_notices (
      public_id,
      title,
      message,
      category,
      target_region,
      target_district,
      fuel_type,
      severity,
      status,
      selected_channels_json,
      created_by,
      scheduled_at
    )
    VALUES (
      ${publicId},
      ${payload.title || "MERA public advisory"},
      ${payload.message || ""},
      ${payload.category || "general public advisory"},
      ${payload.targetRegion || null},
      ${payload.targetDistrict || null},
      ${payload.fuelType || null},
      ${payload.severity || "medium"},
      ${normalizeNoticeStatus(payload.status || "draft")},
      ${jsonString(channels)},
      ${auth?.userId || null},
      ${payload.scheduledAt || null}
    )
  `
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "public notice drafted", actionDescription: `Public notice ${publicId} drafted.`, affectedEntity: publicId })
  return { noticeId: publicId }
}

export async function patchPublicNotice(noticeId, payload = {}, auth = null) {
  await prisma.$executeRaw`
    UPDATE public_notices
    SET
      title = COALESCE(${payload.title || null}, title),
      message = COALESCE(${payload.message || null}, message),
      category = COALESCE(${payload.category || null}, category),
      target_region = COALESCE(${payload.targetRegion || null}, target_region),
      target_district = COALESCE(${payload.targetDistrict || null}, target_district),
      fuel_type = COALESCE(${payload.fuelType || null}, fuel_type),
      severity = COALESCE(${payload.severity || null}, severity),
      status = COALESCE(${payload.status ? normalizeNoticeStatus(payload.status) : null}, status),
      selected_channels_json = COALESCE(${payload.selectedChannels ? jsonString(payload.selectedChannels) : null}, selected_channels_json),
      scheduled_at = COALESCE(${payload.scheduledAt || null}, scheduled_at),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${noticeId}
  `
  return getPublicNotice(noticeId)
}

export async function getPublicNotice(noticeId) {
  const rows = await prisma.$queryRaw`
    SELECT pn.*, created.full_name AS created_by_name, approved.full_name AS approved_by_name
    FROM public_notices pn
    LEFT JOIN mera_users created ON created.id = pn.created_by
    LEFT JOIN mera_users approved ON approved.id = pn.approved_by
    WHERE pn.public_id = ${noticeId}
    LIMIT 1
  `
  if (!rows?.[0]?.public_id) throw notFound("Public notice not found")
  return mapNoticeRow(rows[0])
}

export async function submitPublicNotice(noticeId, auth = null) {
  await prisma.$executeRaw`UPDATE public_notices SET status = 'pending_approval', updated_at = CURRENT_TIMESTAMP(3) WHERE public_id = ${noticeId}`
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "public notice submitted", actionDescription: `Public notice ${noticeId} submitted for approval.`, affectedEntity: noticeId })
  return getPublicNotice(noticeId)
}

export async function approvePublicNotice(noticeId, payload = {}, auth = null) {
  await prisma.$executeRaw`
    UPDATE public_notices
    SET status = 'approved', approved_by = ${auth?.userId || null}, approved_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${noticeId}
  `
  await prisma.$executeRaw`
    INSERT INTO public_notice_approvals (public_notice_id, actor_id, action, note)
    SELECT id, ${auth?.userId || null}, 'approved', ${payload.note || null}
    FROM public_notices
    WHERE public_id = ${noticeId}
  `
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "public notice approved", actionDescription: `Public notice ${noticeId} approved.`, affectedEntity: noticeId })
  return getPublicNotice(noticeId)
}

export async function rejectPublicNotice(noticeId, payload = {}, auth = null) {
  await prisma.$executeRaw`UPDATE public_notices SET status = 'rejected', external_error = ${payload.reason || "Rejected"}, updated_at = CURRENT_TIMESTAMP(3) WHERE public_id = ${noticeId}`
  await prisma.$executeRaw`
    INSERT INTO public_notice_approvals (public_notice_id, actor_id, action, note)
    SELECT id, ${auth?.userId || null}, 'rejected', ${payload.reason || null}
    FROM public_notices
    WHERE public_id = ${noticeId}
  `
  return getPublicNotice(noticeId)
}

export async function publishPublicNotice(noticeId, auth = null) {
  const notice = await getPublicNotice(noticeId)
  const results = await publishPublicNoticeToChannels(notice, notice.selectedChannels || [])
  await prisma.$executeRaw`
    UPDATE public_notices
    SET status = 'published', published_at = CURRENT_TIMESTAMP(3), external_post_status_json = ${jsonString(results)}, external_error = ${results.find((item) => item.status === "not_configured") ? "One or more channels not configured" : null}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${noticeId}
  `
  await logMeraAudit({ ...actorAuditContext(auth), actionType: "public notice published", actionDescription: `Public notice ${noticeId} published internally.`, affectedEntity: noticeId })
  return getPublicNotice(noticeId)
}

export async function listPublicNoticeHistory(noticeId) {
  const rows = await prisma.$queryRaw`
    SELECT pna.action, pna.note, pna.created_at, mu.full_name AS actor_name
    FROM public_notice_approvals pna
    LEFT JOIN mera_users mu ON mu.id = pna.actor_id
    INNER JOIN public_notices pn ON pn.id = pna.public_notice_id
    WHERE pn.public_id = ${noticeId}
    ORDER BY pna.created_at DESC
  `
  return { items: rows || [] }
}

export async function getFuelStressAnalytics(auth = null) {
  const risk = await listRiskStations({ limit: 100 }, auth)
  const byDistrict = new Map()
  risk.items.forEach((item) => {
    const key = item.district || "Unknown"
    const current = byDistrict.get(key) || { district: key, stations: 0, riskScoreTotal: 0, availabilityPressure: 0 }
    current.stations += 1
    current.riskScoreTotal += item.riskScore
    if (["DRY", "LIMITED", "LOW", "UNKNOWN", "OFFLINE"].includes(item.availabilityStatus)) current.availabilityPressure += 1
    byDistrict.set(key, current)
  })
  const districts = [...byDistrict.values()].map((row) => ({
    ...row,
    fuelStressIndex: row.stations ? Math.round((row.riskScoreTotal / row.stations) * 0.7 + (row.availabilityPressure / row.stations) * 30) : 0,
    averageRiskScore: row.stations ? Math.round(row.riskScoreTotal / row.stations) : 0,
  }))
  return {
    generatedAt: new Date().toISOString(),
    national: districts.length ? Math.round(districts.reduce((sum, row) => sum + row.fuelStressIndex, 0) / districts.length) : 0,
    byDistrict: districts.sort((a, b) => b.fuelStressIndex - a.fuelStressIndex),
  }
}

export async function getDistrictAnalytics(auth = null) {
  const stress = await getFuelStressAnalytics(auth)
  return { items: stress.byDistrict }
}

export async function getStationAnalytics(auth = null) {
  const risk = await listRiskStations({ limit: 100 }, auth)
  return { items: risk.items }
}

export async function getTrendAnalytics(auth = null) {
  const [complaints, deliveries, prices] = await Promise.all([
    getComplaintTrends({}, auth),
    getFuelSupplyTimeline({ limit: 50 }, auth),
    listPriceViolations({}, auth).catch(() => ({ items: [] })),
  ])
  return {
    generatedAt: new Date().toISOString(),
    complaintVolume: complaints.items,
    deliveryEvents: deliveries.items,
    priceViolationCount: prices.items.length,
  }
}

export async function auditLogDetailed(filters = {}) {
  const pagination = normalizePagination(filters)
  const action = normalizeString(filters.action)
  const actor = normalizeString(filters.actor)
  const entity = normalizeString(filters.entity)
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM audit_logs_mera
    WHERE (${action === null} = TRUE OR action_type LIKE ${`%${action || ""}%`})
      AND (${actor === null} = TRUE OR actor_name LIKE ${`%${actor || ""}%`} OR CAST(actor_id AS CHAR) = ${actor || ""})
      AND (${entity === null} = TRUE OR affected_entity LIKE ${`%${entity || ""}%`} OR entity_id = ${entity || ""})
    ORDER BY created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return { page: pagination.page, limit: pagination.limit, items: rows || [] }
}

export function jsonDownloadResponse(payload) {
  return Prisma.JsonNull ? payload : payload
}
