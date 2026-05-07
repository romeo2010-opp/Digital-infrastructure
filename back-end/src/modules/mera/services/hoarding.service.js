import { prisma } from "../../../db/prisma.js"
import { badRequest } from "../../../utils/http.js"
import { createComplianceFlagRecord } from "./portal.service.js"

function toInteger(value, fallback = 0) {
  const normalized = Number.parseInt(value, 10)
  return Number.isFinite(normalized) ? normalized : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizePagination({ page = 1, limit = 25 } = {}) {
  const normalizedPage = clamp(toInteger(page, 1), 1, 500)
  const normalizedLimit = clamp(toInteger(limit, 25), 1, 100)
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    offset: (normalizedPage - 1) * normalizedLimit,
  }
}

function riskBandFromScore(score) {
  if (score >= 85) return "CRITICAL"
  if (score >= 65) return "HIGH"
  if (score >= 35) return "MODERATE"
  return "LOW"
}

function severityFromBand(band) {
  if (band === "CRITICAL") return "CRITICAL"
  if (band === "HIGH") return "HIGH"
  if (band === "MODERATE") return "MEDIUM"
  return "LOW"
}

function toYesNo(value) {
  return Number(value) === 1 ? "Yes" : "No"
}

function toAvailabilityState(value) {
  const scoped = String(value || "").toUpperCase()
  if (scoped === "AVAILABLE") return "Available"
  if (scoped === "LIMITED") return "Limited"
  if (scoped === "DRY") return "Dry"
  return "Unknown"
}

export async function syncAvailabilityAuditRecord({
  stationId,
  petrolAvailable,
  dieselAvailable,
  activePumps = null,
  reportedBy = null,
  createdAt = null,
}) {
  await prisma.$executeRaw`
    INSERT INTO station_availability_reports (
      station_id,
      petrol_available,
      diesel_available,
      active_pumps,
      reported_by,
      created_at
    )
    VALUES (
      ${stationId},
      ${petrolAvailable},
      ${dieselAvailable},
      ${activePumps},
      ${reportedBy},
      COALESCE(${createdAt}, CURRENT_TIMESTAMP(3))
    )
  `
}

async function fetchStationRiskInputs(stationId) {
  const [
    complaintRows,
    refusalRows,
    failedInspectionRows,
    enforcementRows,
    latestDeliveryRows,
    latestLiveStatusRows,
    latestAvailabilityRows,
    availabilityAfterDeliveryRows,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM public_complaints
      WHERE station_id = ${stationId}
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM public_complaints
      WHERE station_id = ${stationId}
        AND complaint_type = 'REFUSAL_TO_SELL'
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM inspections
      WHERE station_id = ${stationId}
        AND inspection_status IN ('FAILED', 'ESCALATED')
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM enforcement_actions
      WHERE station_id = ${stationId}
        AND issued_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 90 DAY)
    `,
    prisma.$queryRaw`
      SELECT delivery_time, fuel_type, estimated_volume, source_type, reported_by
      FROM fuel_delivery_logs
      WHERE station_id = ${stationId}
      ORDER BY delivery_time DESC
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT availability_status, petrol_status, diesel_status, reported_source, created_at
      FROM station_status_logs
      WHERE station_id = ${stationId}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT petrol_available, diesel_available, active_pumps, reported_by, created_at
      FROM station_availability_reports
      WHERE station_id = ${stationId}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM station_status_logs
      WHERE station_id = ${stationId}
        AND created_at >= COALESCE((
          SELECT delivery_time
          FROM fuel_delivery_logs
          WHERE station_id = ${stationId}
          ORDER BY delivery_time DESC
          LIMIT 1
        ), DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 365 DAY))
        AND availability_status IN ('AVAILABLE', 'LIMITED')
    `,
  ])

  return {
    complaints24h: Number(complaintRows?.[0]?.total || 0),
    refusal24h: Number(refusalRows?.[0]?.total || 0),
    failedInspections30d: Number(failedInspectionRows?.[0]?.total || 0),
    enforcement90d: Number(enforcementRows?.[0]?.total || 0),
    latestDelivery: latestDeliveryRows?.[0] || null,
    latestLiveStatus: latestLiveStatusRows?.[0] || null,
    latestAvailability: latestAvailabilityRows?.[0] || null,
    availableAfterLastDelivery: Number(availabilityAfterDeliveryRows?.[0]?.total || 0),
  }
}

export async function calculateStationHoardingRisk(stationId, { actor = null, persist = true } = {}) {
  const inputs = await fetchStationRiskInputs(stationId)
  const factors = []
  let score = 0

  if (inputs.complaints24h >= 3) {
    const points = Math.min(30, inputs.complaints24h * 6)
    score += points
    factors.push({
      rule: "RULE_A",
      weight: points,
      evidence: `${inputs.complaints24h} complaints recorded within 24 hours.`,
    })
  }

  const deliveryStillDry =
    inputs.latestDelivery
    && String(inputs.latestLiveStatus?.availability_status || "").toUpperCase() === "DRY"
    && inputs.availableAfterLastDelivery === 0
  if (deliveryStillDry) {
    score += 26
    factors.push({
      rule: "RULE_B",
      weight: 26,
      evidence:
        "A delivery was logged, but live station availability has remained dry with no recovery declaration after that delivery.",
    })
  }

  const liveAvailable =
    ["AVAILABLE", "LIMITED"].includes(String(inputs.latestLiveStatus?.availability_status || "").toUpperCase())
    || Number(inputs.latestAvailability?.petrol_available || 0) === 1
    || Number(inputs.latestAvailability?.diesel_available || 0) === 1
  if (inputs.refusal24h >= 2 && liveAvailable) {
    score += 24
    factors.push({
      rule: "RULE_C",
      weight: 24,
      evidence:
        "Refusal-to-sell complaints continue while declarations or live status indicate fuel should be available.",
    })
  }

  const lowPumpActivity =
    Number(inputs.latestAvailability?.active_pumps || 0) <= 1
    && inputs.latestAvailability?.active_pumps !== null
  if (inputs.failedInspections30d >= 2 || lowPumpActivity) {
    const points = inputs.failedInspections30d >= 3 || lowPumpActivity ? 20 : 14
    score += points
    factors.push({
      rule: "RULE_D",
      weight: points,
      evidence:
        lowPumpActivity
          ? `Latest declaration shows only ${inputs.latestAvailability?.active_pumps || 0} active pumps.`
          : `${inputs.failedInspections30d} failed or escalated inspections in 30 days.`,
    })
  }

  if (inputs.enforcement90d >= 1) {
    const points = Math.min(15, inputs.enforcement90d * 5)
    score += points
    factors.push({
      rule: "RULE_E",
      weight: points,
      evidence: `${inputs.enforcement90d} enforcement actions recorded in the last 90 days.`,
    })
  }

  score = clamp(score, 0, 100)
  const escalationStatus = riskBandFromScore(score)
  const generatedFactorsJson = JSON.stringify({
    score,
    escalationStatus,
    complaints24h: inputs.complaints24h,
    refusal24h: inputs.refusal24h,
    failedInspections30d: inputs.failedInspections30d,
    enforcement90d: inputs.enforcement90d,
    latestDelivery: inputs.latestDelivery,
    latestLiveStatus: inputs.latestLiveStatus,
    latestAvailability: inputs.latestAvailability,
    evidence: factors,
  })

  if (persist) {
    await prisma.$executeRaw`
      INSERT INTO hoarding_risk_scores (
        station_id,
        risk_score,
        generated_factors_json,
        escalation_status,
        last_calculated_at
      )
      VALUES (
        ${stationId},
        ${score},
        ${generatedFactorsJson},
        ${escalationStatus},
        CURRENT_TIMESTAMP(3)
      )
      ON DUPLICATE KEY UPDATE
        risk_score = VALUES(risk_score),
        generated_factors_json = VALUES(generated_factors_json),
        escalation_status = VALUES(escalation_status),
        last_calculated_at = VALUES(last_calculated_at)
    `

    if (score >= 65) {
      await createComplianceFlagRecord({
        stationId,
        flagType: "POSSIBLE_HOARDING",
        severity: severityFromBand(escalationStatus),
        generatedReason:
          factors.map((factor) => factor.evidence).join(" ")
          || "Auto-generated hoarding suspicion based on live availability and compliance evidence.",
        sourceReference: "hoarding_risk_scores:auto",
        actor,
      })
    }
  }

  return {
    riskScore: score,
    escalationStatus,
    factors,
    inputs,
  }
}

export async function refreshAllHoardingRiskScores({ actor = null } = {}) {
  const stations = await prisma.$queryRaw`
    SELECT id
    FROM stations
    WHERE is_active = 1
    ORDER BY id ASC
  `

  for (const station of stations || []) {
    await calculateStationHoardingRisk(Number(station.id), { actor, persist: true })
  }
}

export async function listHoardingWatchlist(filters = {}, auth = null) {
  await refreshAllHoardingRiskScores()
  const pagination = normalizePagination(filters)
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const queryFilter = `%${String(filters.query || "").trim()}%`
  const riskFilter = String(filters.risk || "").trim().toUpperCase()
  const scopedDistrict = String(auth?.districtScope || "").trim()

  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      hrs.risk_score,
      hrs.escalation_status,
      hrs.last_calculated_at,
      latest_delivery.delivery_time AS last_delivery_time,
      latest_delivery.fuel_type AS last_delivery_fuel_type,
      latest_live.availability_status AS live_availability_status,
      complaints_24h.total AS complaints_24h,
      failed_inspections.total AS failed_inspections,
      latest_flag.public_id AS latest_flag_public_id
    FROM hoarding_risk_scores hrs
    INNER JOIN stations s ON s.id = hrs.station_id
    LEFT JOIN (
      SELECT fd1.station_id, fd1.delivery_time, fd1.fuel_type
      FROM fuel_delivery_logs fd1
      INNER JOIN (
        SELECT station_id, MAX(delivery_time) AS max_delivery_time
        FROM fuel_delivery_logs
        GROUP BY station_id
      ) fd2 ON fd2.station_id = fd1.station_id AND fd2.max_delivery_time = fd1.delivery_time
    ) latest_delivery ON latest_delivery.station_id = s.id
    LEFT JOIN (
      SELECT ssl1.station_id, ssl1.availability_status
      FROM station_status_logs ssl1
      INNER JOIN (
        SELECT station_id, MAX(created_at) AS max_created_at
        FROM station_status_logs
        GROUP BY station_id
      ) ssl2 ON ssl2.station_id = ssl1.station_id AND ssl2.max_created_at = ssl1.created_at
    ) latest_live ON latest_live.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS total
      FROM public_complaints
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
      GROUP BY station_id
    ) complaints_24h ON complaints_24h.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS total
      FROM inspections
      WHERE inspection_status IN ('FAILED', 'ESCALATED')
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
      GROUP BY station_id
    ) failed_inspections ON failed_inspections.station_id = s.id
    LEFT JOIN (
      SELECT cf1.station_id, cf1.public_id
      FROM compliance_flags cf1
      INNER JOIN (
        SELECT station_id, MAX(created_at) AS max_created_at
        FROM compliance_flags
        GROUP BY station_id
      ) cf2 ON cf2.station_id = cf1.station_id AND cf2.max_created_at = cf1.created_at
    ) latest_flag ON latest_flag.station_id = s.id
    WHERE s.is_active = 1
      AND (${String(filters.district || "").trim() === ""} = TRUE OR s.city LIKE ${districtFilter})
      AND (${String(filters.query || "").trim() === ""} = TRUE OR s.name LIKE ${queryFilter} OR s.public_id LIKE ${queryFilter})
      AND (${riskFilter === ""} = TRUE OR hrs.escalation_status = ${riskFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY hrs.risk_score DESC, hrs.last_calculated_at DESC, s.name ASC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      stationPublicId: row.station_public_id,
      stationName: row.station_name,
      district: row.district,
      lastDeliveryLogged: row.last_delivery_time,
      currentDeclaredAvailability: row.live_availability_status || "UNKNOWN",
      complaints24h: Number(row.complaints_24h || 0),
      inspectionFailures: Number(row.failed_inspections || 0),
      riskScore: Number(row.risk_score || 0),
      escalationStatus: row.escalation_status,
      lastCalculatedAt: row.last_calculated_at,
      latestFlagPublicId: row.latest_flag_public_id || null,
      fuelType: row.last_delivery_fuel_type || null,
    })),
  }
}

export async function getHoardingWatchlistDetail(stationPublicId, auth = null) {
  const stationRows = await prisma.$queryRaw`
    SELECT id, public_id, name, city, address
    FROM stations
    WHERE public_id = ${String(stationPublicId || "").trim()}
    LIMIT 1
  `
  const station = stationRows?.[0]
  if (!station?.id) throw badRequest("Station not found")
  if (String(auth?.districtScope || "").trim() && String(auth?.districtScope || "").trim().toLowerCase() !== String(station.city || "").trim().toLowerCase()) {
    throw badRequest("You do not have access to this station")
  }

  const risk = await calculateStationHoardingRisk(Number(station.id), { persist: true })

  const [complaints, deliveries, declarations, inspections, enforcement, riskRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT public_id, complaint_type, complaint_status, complaint_description, created_at
      FROM public_complaints
      WHERE station_id = ${station.id}
      ORDER BY created_at DESC
      LIMIT 25
    `,
    prisma.$queryRaw`
      SELECT delivery_time, fuel_type, estimated_volume, source_type, reported_by, created_at
      FROM fuel_delivery_logs
      WHERE station_id = ${station.id}
      ORDER BY delivery_time DESC
      LIMIT 25
    `,
    prisma.$queryRaw`
      SELECT petrol_available, diesel_available, active_pumps, reported_by, created_at
      FROM station_availability_reports
      WHERE station_id = ${station.id}
      ORDER BY created_at DESC
      LIMIT 25
    `,
    prisma.$queryRaw`
      SELECT i.public_id, i.inspection_type, i.inspection_status, i.queue_length, i.pumps_active, i.illegal_vending_detected, i.officer_notes, i.created_at, mu.full_name AS officer_name
      FROM inspections i
      INNER JOIN mera_users mu ON mu.id = i.officer_id
      WHERE i.station_id = ${station.id}
      ORDER BY i.created_at DESC
      LIMIT 25
    `,
    prisma.$queryRaw`
      SELECT ea.public_id, ea.action_type, ea.action_status, ea.action_notes, ea.issued_at, mu.full_name AS officer_name
      FROM enforcement_actions ea
      INNER JOIN mera_users mu ON mu.id = ea.initiated_by
      WHERE ea.station_id = ${station.id}
      ORDER BY ea.issued_at DESC
      LIMIT 25
    `,
    prisma.$queryRaw`
      SELECT risk_score, generated_factors_json, escalation_status, last_calculated_at
      FROM hoarding_risk_scores
      WHERE station_id = ${station.id}
      LIMIT 1
    `,
  ])

  let parsedFactors = risk.factors
  const storedJson = riskRows?.[0]?.generated_factors_json
  if (storedJson) {
    try {
      parsedFactors = JSON.parse(storedJson)?.evidence || parsedFactors
    } catch {
      // fall back to in-memory calculation
    }
  }

  return {
    station: {
      publicId: station.public_id,
      name: station.name,
      district: station.city || "Unknown",
      address: station.address || null,
    },
    riskScore: riskRows?.[0]?.risk_score ?? risk.riskScore,
    escalationStatus: riskRows?.[0]?.escalation_status ?? risk.escalationStatus,
    lastCalculatedAt: riskRows?.[0]?.last_calculated_at || new Date().toISOString(),
    generatedReasons: parsedFactors,
    complaintHistory: (complaints || []).map((row) => ({
      ref: row.public_id,
      type: row.complaint_type,
      status: row.complaint_status,
      description: row.complaint_description,
      createdAt: row.created_at,
    })),
    deliveryTimeline: (deliveries || []).map((row, index) => ({
      ref: `DLV-${station.public_id}-${index + 1}`,
      deliveryTime: row.delivery_time,
      fuelType: row.fuel_type,
      estimatedVolume: row.estimated_volume,
      sourceType: row.source_type,
      reportedBy: row.reported_by,
      createdAt: row.created_at,
    })),
    availabilityTimeline: (declarations || []).map((row, index) => ({
      ref: `AVL-${station.public_id}-${index + 1}`,
      petrolAvailable: toYesNo(row.petrol_available),
      dieselAvailable: toYesNo(row.diesel_available),
      activePumps: row.active_pumps,
      reportedBy: row.reported_by,
      createdAt: row.created_at,
    })),
    officerInspections: (inspections || []).map((row) => ({
      ref: row.public_id,
      inspectionType: row.inspection_type,
      result: row.inspection_status,
      queueLength: row.queue_length,
      pumpsActive: row.pumps_active,
      illegalVending: toYesNo(row.illegal_vending_detected),
      officerName: row.officer_name,
      notes: row.officer_notes,
      createdAt: row.created_at,
    })),
    enforcementActions: (enforcement || []).map((row) => ({
      ref: row.public_id,
      actionType: row.action_type,
      actionStatus: row.action_status,
      actionNotes: row.action_notes,
      officerName: row.officer_name,
      issuedAt: row.issued_at,
    })),
    liveAvailability: toAvailabilityState(risk.inputs.latestLiveStatus?.availability_status),
  }
}
