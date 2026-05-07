import bcrypt from "bcryptjs"
import { prisma } from "../../../db/prisma.js"
import { badRequest, notFound } from "../../../utils/http.js"
import { createPublicId } from "../../common/db.js"
import { MERA_ROLE_SET } from "../permissions.js"
import { logMeraAudit } from "./audit.service.js"

function toInteger(value, fallback = 0) {
  const normalized = Number.parseInt(value, 10)
  return Number.isFinite(normalized) ? normalized : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizePagination({ page = 1, limit = 20 } = {}) {
  const normalizedPage = clamp(toInteger(page, 1), 1, 500)
  const normalizedLimit = clamp(toInteger(limit, 20), 1, 100)
  return {
    page: normalizedPage,
    limit: normalizedLimit,
    offset: (normalizedPage - 1) * normalizedLimit,
  }
}

function normalizePublicId(value, label) {
  const scoped = String(value || "").trim()
  if (!scoped) throw badRequest(`${label} is required`)
  return scoped
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizeRole(value) {
  const scoped = String(value || "").trim().toUpperCase()
  if (!MERA_ROLE_SET.has(scoped)) throw badRequest("Invalid MERA role")
  return scoped
}

function normalizeAccountStatus(value) {
  const scoped = String(value || "").trim().toUpperCase()
  if (!["ACTIVE", "INVITED", "SUSPENDED", "DISABLED"].includes(scoped)) {
    throw badRequest("Invalid MERA account status")
  }
  return scoped
}

function districtFilterValue(auth) {
  return String(auth?.districtScope || "").trim()
}

function hasDistrictScope(auth) {
  return Boolean(districtFilterValue(auth))
}

function isFieldOfficer(auth) {
  return String(auth?.role || "").trim().toUpperCase() === "FIELD_COMPLIANCE_OFFICER"
}

function actorAuditContext(actor = null, overrides = {}) {
  return {
    actorId: actor?.userId || null,
    actorName: actor?.fullName || null,
    actorRole: actor?.role || null,
    permissionUsed: actor?.permissionUsed || null,
    ipAddress: actor?.ipAddress || null,
    deviceInfo: actor?.deviceInfo || null,
    ...overrides,
  }
}

function ensureDistrictAccess(auth, district, label = "record") {
  if (!hasDistrictScope(auth)) return
  const actorDistrict = districtFilterValue(auth).toLowerCase()
  const targetDistrict = String(district || "").trim().toLowerCase()
  if (!targetDistrict || actorDistrict !== targetDistrict) {
    throw badRequest(`You do not have access to this ${label}`)
  }
}

async function resolveStationId(stationPublicId) {
  const scopedPublicId = normalizePublicId(stationPublicId, "stationPublicId")
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, city, address
    FROM stations
    WHERE public_id = ${scopedPublicId}
    LIMIT 1
  `
  const station = rows?.[0]
  if (!station?.id) throw notFound("Station not found")
  return station
}

async function resolveUserIdByPublicId(userPublicId) {
  if (!String(userPublicId || "").trim()) return null
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM users
    WHERE public_id = ${String(userPublicId).trim()}
    LIMIT 1
  `
  return rows?.[0]?.id ? Number(rows[0].id) : null
}

async function resolveMeraUserByPublicId(meraUserPublicId) {
  const scopedPublicId = normalizePublicId(meraUserPublicId, "meraUserPublicId")
  const rows = await prisma.$queryRaw`
    SELECT
      mu.id,
      mu.public_id,
      mu.full_name,
      mu.district_scope,
      mr.code AS role_code,
      mr.display_name AS role_display_name
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE mu.public_id = ${scopedPublicId}
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user?.id) throw notFound("MERA user not found")
  return user
}

async function resolveComplaintByPublicId(complaintPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      pc.id,
      pc.public_id,
      pc.station_id,
      pc.complaint_status,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    WHERE pc.public_id = ${normalizePublicId(complaintPublicId, "complaintPublicId")}
    LIMIT 1
  `
  const complaint = rows?.[0]
  if (!complaint?.id) throw notFound("Complaint not found")
  return complaint
}

async function getLatestInventoryByStationRows() {
  const rows = await prisma.$queryRaw`
    SELECT
      s.id AS station_id,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      s.fuel_level,
      ft.code AS fuel_code,
      SUM(COALESCE(latest_reading.litres, 0)) AS remaining_litres
    FROM stations s
    LEFT JOIN tanks t ON t.station_id = s.id AND t.is_active = 1
    LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
    LEFT JOIN (
      SELECT ir.tank_id, ir.litres
      FROM inventory_readings ir
      INNER JOIN (
        SELECT tank_id, MAX(reading_time) AS max_reading_time
        FROM inventory_readings
        GROUP BY tank_id
      ) latest_per_tank
        ON latest_per_tank.tank_id = ir.tank_id
       AND latest_per_tank.max_reading_time = ir.reading_time
    ) latest_reading ON latest_reading.tank_id = t.id
    WHERE s.is_active = 1
    GROUP BY s.id, COALESCE(NULLIF(s.city, ''), 'Unknown'), s.fuel_level, ft.code
  `
  return Array.isArray(rows) ? rows : []
}

function buildInventorySnapshot(rows) {
  const stations = new Map()

  for (const row of rows || []) {
    const stationId = Number(row?.station_id || 0)
    if (!stationId) continue

    if (!stations.has(stationId)) {
      stations.set(stationId, {
        stationId,
        district: String(row?.district || 'Unknown'),
        fuelLevel: String(row?.fuel_level || 'MEDIUM').toUpperCase(),
        fuelRemaining: {},
        totalRemainingLitres: 0,
      })
    }

    const station = stations.get(stationId)
    const fuelCode = String(row?.fuel_code || '').trim().toUpperCase()
    const remainingLitres = Number(row?.remaining_litres || 0)

    if (fuelCode) {
      station.fuelRemaining[fuelCode] = remainingLitres
    }
    station.totalRemainingLitres += remainingLitres
  }

  const stationList = Array.from(stations.values()).map((station) => {
    const positiveFuels = Object.entries(station.fuelRemaining).filter(([, litres]) => Number(litres) > 0)
    const knownFuels = Object.keys(station.fuelRemaining)
    const outOfStock = knownFuels.length > 0 ? positiveFuels.length === 0 : station.totalRemainingLitres <= 0
    const partialOutage = knownFuels.length > 1 && positiveFuels.length > 0 && positiveFuels.length < knownFuels.length

    return {
      ...station,
      outOfStock,
      partialOutage,
    }
  })

  return {
    stations: stationList,
    byStationId: new Map(stationList.map((station) => [station.stationId, station])),
  }
}

async function resolveInspectionByPublicId(inspectionPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      i.id,
      i.public_id,
      i.station_id,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM inspections i
    INNER JOIN stations s ON s.id = i.station_id
    WHERE public_id = ${normalizePublicId(inspectionPublicId, "inspectionPublicId")}
    LIMIT 1
  `
  const inspection = rows?.[0]
  if (!inspection?.id) throw notFound("Inspection not found")
  return inspection
}

async function resolveFlagByPublicId(flagPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT
      cf.id,
      cf.public_id,
      cf.station_id,
      cf.resolved_status,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM compliance_flags cf
    INNER JOIN stations s ON s.id = cf.station_id
    WHERE public_id = ${normalizePublicId(flagPublicId, "flagPublicId")}
    LIMIT 1
  `
  const flag = rows?.[0]
  if (!flag?.id) throw notFound("Compliance flag not found")
  return flag
}

async function syncAvailabilityAuditRecord({
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

export async function createComplianceFlagRecord({
  stationId,
  flagType,
  severity = "MEDIUM",
  generatedReason,
  sourceReference = null,
  actor = null,
}) {
  const recentRows = await prisma.$queryRaw`
    SELECT id, public_id
    FROM compliance_flags
    WHERE station_id = ${stationId}
      AND flag_type = ${flagType}
      AND resolved_status IN ('OPEN', 'UNDER_REVIEW')
      AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
    ORDER BY created_at DESC
    LIMIT 1
  `
  if (recentRows?.[0]?.id) {
    return {
      created: false,
      flagPublicId: recentRows[0].public_id,
    }
  }

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
      ${stationId},
      ${flagType},
      ${severity},
      ${generatedReason},
      ${sourceReference}
    )
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_FLAG_CREATED",
    actionDescription: `Compliance flag ${flagType} created for station ${stationId}.`,
    affectedEntity: publicId,
  })

  return {
    created: true,
    flagPublicId: publicId,
  }
}

export async function listPublicStations({ query = "", limit = 20 } = {}) {
  const scopedQuery = `%${String(query || "").trim()}%`
  const scopedLimit = clamp(toInteger(limit, 20), 1, 100)
  const rows = await prisma.$queryRaw`
    SELECT public_id, name, city, address
    FROM stations
    WHERE is_active = 1
      AND (
        ${String(query || "").trim() === ""} = TRUE
        OR name LIKE ${scopedQuery}
        OR city LIKE ${scopedQuery}
        OR address LIKE ${scopedQuery}
      )
    ORDER BY name ASC
    LIMIT ${scopedLimit}
  `
  return (rows || []).map((row) => ({
    publicId: row.public_id,
    name: row.name,
    city: row.city || null,
    address: row.address || null,
  }))
}

export async function createPublicComplaint({
  stationPublicId,
  complaintType,
  complaintDescription,
  mediaUrl = null,
  geoLat = null,
  geoLng = null,
  userPublicId = null,
}) {
  const station = await resolveStationId(stationPublicId)
  const userId = await resolveUserIdByPublicId(userPublicId)
  const publicId = createPublicId()

  await prisma.$executeRaw`
    INSERT INTO public_complaints (
      public_id,
      user_id,
      station_id,
      complaint_type,
      complaint_description,
      media_url,
      geo_lat,
      geo_lng
    )
    VALUES (
      ${publicId},
      ${userId},
      ${station.id},
      ${complaintType},
      ${complaintDescription},
      ${mediaUrl},
      ${geoLat},
      ${geoLng}
    )
  `

  await logMeraAudit({
    actorName: "Public Portal",
    actorRole: "PUBLIC_PORTAL",
    permissionUsed: "PUBLIC_COMPLAINT_CREATE",
    actionType: "PUBLIC_COMPLAINT_CREATED",
    actionDescription: `Public complaint ${publicId} created against ${station.name}.`,
    affectedEntity: publicId,
  })

  return {
    complaintPublicId: publicId,
    station: {
      publicId: station.public_id,
      name: station.name,
      city: station.city || null,
    },
    complaintType,
    complaintStatus: "NEW",
  }
}

export async function listComplaints(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const complaintTypeFilter = String(filters.complaintType || "").trim().toUpperCase()
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const scopedDistrict = districtFilterValue(auth)

  const rows = await prisma.$queryRaw`
    SELECT
      pc.public_id,
      pc.complaint_type,
      pc.complaint_description,
      pc.media_url,
      pc.geo_lat,
      pc.geo_lng,
      pc.complaint_status,
      pc.created_at,
      pc.updated_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name,
      u.public_id AS user_public_id,
      u.full_name AS user_name
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    LEFT JOIN mera_users mu ON mu.id = pc.assigned_officer_id
    LEFT JOIN users u ON u.id = pc.user_id
    WHERE (${statusFilter === ""} = TRUE OR pc.complaint_status = ${statusFilter})
      AND (${complaintTypeFilter === ""} = TRUE OR pc.complaint_type = ${complaintTypeFilter})
      AND (${String(filters.district || "").trim() === ""} = TRUE OR s.city LIKE ${districtFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY pc.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      complaintType: row.complaint_type,
      description: row.complaint_description,
      mediaUrl: row.media_url || null,
      geoLat: row.geo_lat,
      geoLng: row.geo_lng,
      complaintStatus: row.complaint_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
      },
      assignedOfficer: row.officer_public_id
        ? {
            publicId: row.officer_public_id,
            fullName: row.officer_name,
          }
        : null,
      complainant: row.user_public_id
        ? {
            publicId: row.user_public_id,
            fullName: row.user_name || null,
          }
        : null,
    })),
  }
}

export async function assignComplaint({ complaintPublicId, officerPublicId, actor }) {
  const complaint = await resolveComplaintByPublicId(complaintPublicId)
  const officer = await resolveMeraUserByPublicId(officerPublicId)
  ensureDistrictAccess(actor, complaint.district, "complaint")
  if (hasDistrictScope(actor)) {
    ensureDistrictAccess(actor, officer.district_scope, "officer")
  }

  await prisma.$executeRaw`
    UPDATE public_complaints
    SET
      assigned_officer_id = ${officer.id},
      complaint_status = 'ASSIGNED',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${complaint.id}
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_COMPLAINT_ASSIGNED",
    actionDescription: `Complaint ${complaint.public_id} assigned to ${officer.full_name}.`,
    affectedEntity: complaint.public_id,
  })

  return {
    complaintPublicId: complaint.public_id,
    assignedOfficer: {
      publicId: officer.public_id,
      fullName: officer.full_name,
      role: officer.role_code,
    },
    complaintStatus: "ASSIGNED",
  }
}

export async function updateComplaintStatus({ complaintPublicId, complaintStatus, actor }) {
  const complaint = await resolveComplaintByPublicId(complaintPublicId)
  ensureDistrictAccess(actor, complaint.district, "complaint")
  await prisma.$executeRaw`
    UPDATE public_complaints
    SET complaint_status = ${complaintStatus}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${complaint.id}
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_COMPLAINT_STATUS_UPDATED",
    actionDescription: `Complaint ${complaint.public_id} moved to ${complaintStatus}.`,
    affectedEntity: complaint.public_id,
  })

  return {
    complaintPublicId: complaint.public_id,
    complaintStatus,
  }
}

export async function createInspection(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  let officerId = actor.userId
  if (String(payload.officerPublicId || "").trim()) {
    const officer = await resolveMeraUserByPublicId(payload.officerPublicId)
    if (hasDistrictScope(actor)) {
      ensureDistrictAccess(actor, officer.district_scope, "officer")
    }
    officerId = Number(officer.id)
  }
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO inspections (
      public_id,
      station_id,
      officer_id,
      inspection_type,
      queue_length,
      stock_visible,
      pumps_active,
      displayed_price,
      illegal_vending_detected,
      geotag_lat,
      geotag_lng,
      officer_notes,
      inspection_status
    )
    VALUES (
      ${publicId},
      ${station.id},
      ${officerId},
      ${payload.inspectionType},
      ${payload.queueLength},
      ${payload.stockVisible},
      ${payload.pumpsActive},
      ${payload.displayedPrice},
      ${payload.illegalVendingDetected},
      ${payload.geotagLat},
      ${payload.geotagLng},
      ${payload.officerNotes},
      ${payload.inspectionStatus}
    )
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_INSPECTION_CREATED",
    actionDescription: `Inspection ${publicId} created for ${station.name}.`,
    affectedEntity: publicId,
  })

  return {
    inspectionPublicId: publicId,
    stationPublicId: station.public_id,
    inspectionStatus: payload.inspectionStatus,
  }
}

export async function attachInspectionEvidence({ inspectionPublicId, fileUrl, fileType, actor }) {
  const inspection = await resolveInspectionByPublicId(inspectionPublicId)
  ensureDistrictAccess(actor, inspection.district, "inspection")
  await prisma.$executeRaw`
    INSERT INTO inspection_evidence (inspection_id, file_url, file_type)
    VALUES (${inspection.id}, ${fileUrl}, ${fileType})
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_INSPECTION_EVIDENCE_UPLOADED",
    actionDescription: `Evidence uploaded for inspection ${inspection.public_id}.`,
    affectedEntity: inspection.public_id,
  })

  return {
    inspectionPublicId: inspection.public_id,
    fileUrl,
    fileType,
  }
}

export async function listInspections(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      i.public_id,
      i.inspection_type,
      i.queue_length,
      i.stock_visible,
      i.pumps_active,
      i.displayed_price,
      i.illegal_vending_detected,
      i.geotag_lat,
      i.geotag_lng,
      i.officer_notes,
      i.inspection_status,
      i.created_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name
    FROM inspections i
    INNER JOIN stations s ON s.id = i.station_id
    INNER JOIN mera_users mu ON mu.id = i.officer_id
    WHERE (${statusFilter === ""} = TRUE OR i.inspection_status = ${statusFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      AND (${isFieldOfficer(auth) === false} = TRUE OR i.officer_id = ${auth?.userId || 0})
    ORDER BY i.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      inspectionType: row.inspection_type,
      queueLength: row.queue_length,
      stockVisible: Number(row.stock_visible) === 1,
      pumpsActive: row.pumps_active,
      displayedPrice: row.displayed_price,
      illegalVendingDetected: Number(row.illegal_vending_detected) === 1,
      geotagLat: row.geotag_lat,
      geotagLng: row.geotag_lng,
      officerNotes: row.officer_notes || null,
      inspectionStatus: row.inspection_status,
      createdAt: row.created_at,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
      },
      officer: {
        publicId: row.officer_public_id,
        fullName: row.officer_name,
      },
    })),
  }
}

export async function getStationInspectionHistory(stationPublicId, auth = null) {
  const station = await resolveStationId(stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const rows = await prisma.$queryRaw`
    SELECT
      i.public_id,
      i.inspection_type,
      i.inspection_status,
      i.queue_length,
      i.stock_visible,
      i.pumps_active,
      i.displayed_price,
      i.illegal_vending_detected,
      i.officer_notes,
      i.created_at,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name
    FROM inspections i
    INNER JOIN mera_users mu ON mu.id = i.officer_id
    WHERE i.station_id = ${station.id}
    ORDER BY i.created_at DESC
  `
  return {
    station: {
      publicId: station.public_id,
      name: station.name,
    },
    items: rows || [],
  }
}

export async function createManualFlag(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  const result = await createComplianceFlagRecord({
    stationId: Number(station.id),
    flagType: payload.flagType,
    severity: payload.severity,
    generatedReason: payload.generatedReason,
    sourceReference: payload.sourceReference,
    actor,
  })
  return {
    stationPublicId: station.public_id,
    ...result,
  }
}

export async function listFlags(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const severityFilter = String(filters.severity || "").trim().toUpperCase()
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      cf.public_id,
      cf.flag_type,
      cf.severity,
      cf.generated_reason,
      cf.source_reference,
      cf.resolved_status,
      cf.created_at,
      cf.resolved_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      mu.public_id AS resolved_by_public_id,
      mu.full_name AS resolved_by_name
    FROM compliance_flags cf
    INNER JOIN stations s ON s.id = cf.station_id
    LEFT JOIN mera_users mu ON mu.id = cf.resolved_by
    WHERE (${statusFilter === ""} = TRUE OR cf.resolved_status = ${statusFilter})
      AND (${severityFilter === ""} = TRUE OR cf.severity = ${severityFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY cf.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      flagType: row.flag_type,
      severity: row.severity,
      generatedReason: row.generated_reason,
      sourceReference: row.source_reference || null,
      resolvedStatus: row.resolved_status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
      },
      resolvedBy: row.resolved_by_public_id
        ? {
            publicId: row.resolved_by_public_id,
            fullName: row.resolved_by_name,
          }
        : null,
    })),
  }
}

export async function resolveFlag({ flagPublicId, resolvedStatus, actor }) {
  const flag = await resolveFlagByPublicId(flagPublicId)
  ensureDistrictAccess(actor, flag.district, "flag")
  await prisma.$executeRaw`
    UPDATE compliance_flags
    SET
      resolved_status = ${resolvedStatus},
      resolved_at = CURRENT_TIMESTAMP(3),
      resolved_by = ${actor.userId}
    WHERE id = ${flag.id}
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_FLAG_RESOLVED",
    actionDescription: `Flag ${flag.public_id} marked ${resolvedStatus}.`,
    affectedEntity: flag.public_id,
  })
  return {
    flagPublicId: flag.public_id,
    resolvedStatus,
  }
}

export async function createEnforcementAction(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  let relatedFlagId = null
  if (String(payload.relatedFlagPublicId || "").trim()) {
    const flag = await resolveFlagByPublicId(payload.relatedFlagPublicId)
    ensureDistrictAccess(actor, flag.district, "flag")
    relatedFlagId = Number(flag.id)
  }
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO enforcement_actions (
      public_id,
      station_id,
      initiated_by,
      related_flag_id,
      action_type,
      action_notes,
      action_status
    )
    VALUES (
      ${publicId},
      ${station.id},
      ${actor.userId},
      ${relatedFlagId},
      ${payload.actionType},
      ${payload.actionNotes},
      ${payload.actionStatus}
    )
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_ENFORCEMENT_CREATED",
    actionDescription: `Enforcement action ${publicId} created for ${station.name}.`,
    affectedEntity: publicId,
  })
  return {
    enforcementPublicId: publicId,
    stationPublicId: station.public_id,
    actionStatus: payload.actionStatus,
  }
}

export async function getStationEnforcementHistory(stationPublicId, auth = null) {
  const station = await resolveStationId(stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const rows = await prisma.$queryRaw`
    SELECT
      ea.public_id,
      ea.action_type,
      ea.action_notes,
      ea.action_status,
      ea.issued_at,
      ea.resolved_at,
      mu.public_id AS actor_public_id,
      mu.full_name AS actor_name,
      cf.public_id AS flag_public_id
    FROM enforcement_actions ea
    INNER JOIN mera_users mu ON mu.id = ea.initiated_by
    LEFT JOIN compliance_flags cf ON cf.id = ea.related_flag_id
    WHERE ea.station_id = ${station.id}
    ORDER BY ea.issued_at DESC
  `
  return {
    station: {
      publicId: station.public_id,
      name: station.name,
    },
    items: rows || [],
  }
}

export async function listEnforcementActions(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      ea.public_id,
      ea.action_type,
      ea.action_notes,
      ea.action_status,
      ea.issued_at,
      ea.resolved_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      mu.public_id AS actor_public_id,
      mu.full_name AS actor_name,
      cf.public_id AS flag_public_id
    FROM enforcement_actions ea
    INNER JOIN stations s ON s.id = ea.station_id
    INNER JOIN mera_users mu ON mu.id = ea.initiated_by
    LEFT JOIN compliance_flags cf ON cf.id = ea.related_flag_id
    WHERE (${statusFilter === ""} = TRUE OR ea.action_status = ${statusFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY ea.issued_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      publicId: row.public_id,
      actionType: row.action_type,
      actionNotes: row.action_notes || null,
      actionStatus: row.action_status,
      issuedAt: row.issued_at,
      resolvedAt: row.resolved_at,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
      },
      actor: {
        publicId: row.actor_public_id,
        fullName: row.actor_name,
      },
      relatedFlagPublicId: row.flag_public_id || null,
    })),
  }
}

export async function attachLicense(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  await prisma.$executeRaw`
    INSERT INTO fuel_station_licenses (
      station_id,
      license_number,
      issue_date,
      expiry_date,
      license_status,
      compliance_conditions
    )
    VALUES (
      ${station.id},
      ${payload.licenseNumber},
      ${payload.issueDate},
      ${payload.expiryDate},
      ${payload.licenseStatus},
      ${payload.complianceConditions}
    )
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_LICENSE_ATTACHED",
    actionDescription: `License ${payload.licenseNumber} attached to ${station.name}.`,
    affectedEntity: payload.licenseNumber,
  })
  return {
    stationPublicId: station.public_id,
    licenseNumber: payload.licenseNumber,
    licenseStatus: payload.licenseStatus,
  }
}

export async function updateLicense({ licenseId, payload, actor }) {
  const licenseRows = await prisma.$queryRaw`
    SELECT COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM fuel_station_licenses fsl
    INNER JOIN stations s ON s.id = fsl.station_id
    WHERE fsl.id = ${toInteger(licenseId)}
    LIMIT 1
  `
  ensureDistrictAccess(actor, licenseRows?.[0]?.district, "license")
  await prisma.$executeRaw`
    UPDATE fuel_station_licenses
    SET
      issue_date = ${payload.issueDate},
      expiry_date = ${payload.expiryDate},
      license_status = ${payload.licenseStatus},
      compliance_conditions = ${payload.complianceConditions},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${toInteger(licenseId)}
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_LICENSE_UPDATED",
    actionDescription: `License record ${licenseId} updated.`,
    affectedEntity: `LICENSE:${licenseId}`,
  })
  return {
    licenseId: toInteger(licenseId),
    ...payload,
  }
}

export async function getLicenseExpiryAlerts({ days = 60 } = {}, auth = null) {
  const scopedDays = clamp(toInteger(days, 60), 1, 365)
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      fsl.id,
      fsl.license_number,
      fsl.issue_date,
      fsl.expiry_date,
      fsl.license_status,
      s.public_id AS station_public_id,
      s.name AS station_name
    FROM fuel_station_licenses fsl
    INNER JOIN stations s ON s.id = fsl.station_id
    WHERE fsl.expiry_date <= DATE_ADD(CURDATE(), INTERVAL ${scopedDays} DAY)
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY fsl.expiry_date ASC
  `
  return rows || []
}

export async function listLicenseRegistry(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      fsl.id,
      fsl.license_number,
      fsl.issue_date,
      fsl.expiry_date,
      fsl.license_status,
      fsl.compliance_conditions,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city AS station_city,
      s.operator_name
    FROM fuel_station_licenses fsl
    INNER JOIN stations s ON s.id = fsl.station_id
    WHERE (${statusFilter === ""} = TRUE OR fsl.license_status = ${statusFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY fsl.expiry_date ASC, s.name ASC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      id: Number(row.id),
      licenseNumber: row.license_number,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      licenseStatus: row.license_status,
      complianceConditions: row.compliance_conditions || null,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.station_city || null,
        operatorName: row.operator_name || null,
      },
    })),
  }
}

export async function createStationStatusLog(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  await prisma.$executeRaw`
    INSERT INTO station_status_logs (
      station_id,
      reported_source,
      availability_status,
      diesel_status,
      petrol_status,
      updated_by
    )
    VALUES (
      ${station.id},
      ${payload.reportedSource},
      ${payload.availabilityStatus},
      ${payload.dieselStatus},
      ${payload.petrolStatus},
      ${actor?.userId || null}
    )
  `
  await syncAvailabilityAuditRecord({
    stationId: Number(station.id),
    petrolAvailable: ["AVAILABLE", "LIMITED"].includes(String(payload.petrolStatus || "").toUpperCase()) ? 1 : 0,
    dieselAvailable: ["AVAILABLE", "LIMITED"].includes(String(payload.dieselStatus || "").toUpperCase()) ? 1 : 0,
    activePumps: null,
    reportedBy: actor?.role ? `${actor.role}:${actor.userId || "SYSTEM"}` : payload.reportedSource,
  })
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_STATION_STATUS_LOG_CREATED",
    actionDescription: `Station status log created for ${station.name}.`,
    affectedEntity: station.public_id,
  })
  return {
    stationPublicId: station.public_id,
    availabilityStatus: payload.availabilityStatus,
  }
}

export async function createAvailabilityReport(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  const petrolAvailable = payload.petrolAvailable ? 1 : 0
  const dieselAvailable = payload.dieselAvailable ? 1 : 0
  const activePumps = payload.activePumps ?? null
  const overallAvailability =
    petrolAvailable === 0 && dieselAvailable === 0
      ? "DRY"
      : petrolAvailable === 1 && dieselAvailable === 1
        ? "AVAILABLE"
        : "LIMITED"

  await prisma.$executeRaw`
    INSERT INTO station_status_logs (
      station_id,
      reported_source,
      availability_status,
      diesel_status,
      petrol_status,
      updated_by
    )
    VALUES (
      ${station.id},
      'MERA_INSPECTION',
      ${overallAvailability},
      ${dieselAvailable ? "AVAILABLE" : "DRY"},
      ${petrolAvailable ? "AVAILABLE" : "DRY"},
      ${actor?.userId || null}
    )
  `

  await syncAvailabilityAuditRecord({
    stationId: Number(station.id),
    petrolAvailable,
    dieselAvailable,
    activePumps,
    reportedBy: payload.reportedBy || `${actor?.role || "SYSTEM"}:${actor?.userId || "NA"}`,
  })

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_AVAILABILITY_REPORT_CREATED",
    actionDescription: `Availability report recorded for ${station.name}.`,
    affectedEntity: station.public_id,
  })

  return {
    stationPublicId: station.public_id,
    petrolAvailable: Boolean(petrolAvailable),
    dieselAvailable: Boolean(dieselAvailable),
    activePumps,
    availabilityStatus: overallAvailability,
  }
}

export async function listAvailabilityReports(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const stationFilter = `%${String(filters.station || "").trim()}%`
  const scopedDistrict = districtFilterValue(auth)

  const rows = await prisma.$queryRaw`
    SELECT
      sar.id,
      sar.petrol_available,
      sar.diesel_available,
      sar.active_pumps,
      sar.reported_by,
      sar.created_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      (
        SELECT COUNT(*)
        FROM public_complaints pc
        WHERE pc.station_id = sar.station_id
          AND pc.created_at BETWEEN DATE_SUB(sar.created_at, INTERVAL 12 HOUR) AND DATE_ADD(sar.created_at, INTERVAL 12 HOUR)
          AND pc.complaint_type IN ('REFUSAL_TO_SELL', 'HOARDING')
      ) AS mismatch_total
    FROM station_availability_reports sar
    INNER JOIN stations s ON s.id = sar.station_id
    WHERE (${String(filters.district || "").trim() === ""} = TRUE OR s.city LIKE ${districtFilter})
      AND (${String(filters.station || "").trim() === ""} = TRUE OR s.name LIKE ${stationFilter} OR s.public_id LIKE ${stationFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY sar.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      recordId: `SAR-${row.id}`,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.district,
      },
      petrolAvailable: Number(row.petrol_available) === 1,
      dieselAvailable: Number(row.diesel_available) === 1,
      activePumps: row.active_pumps,
      reportedBy: row.reported_by,
      createdAt: row.created_at,
      mismatchIndicator: Number(row.mismatch_total || 0) > 0 ? "CONFLICT" : "CLEAR",
      mismatchTotal: Number(row.mismatch_total || 0),
    })),
  }
}

export async function createFuelDeliveryLog(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  await prisma.$executeRaw`
    INSERT INTO fuel_delivery_logs (
      station_id,
      delivery_time,
      fuel_type,
      estimated_volume,
      source_type,
      reported_by
    )
    VALUES (
      ${station.id},
      ${payload.deliveryTime},
      ${payload.fuelType},
      ${payload.estimatedVolume},
      ${payload.sourceType},
      ${payload.reportedBy || `${actor?.role || "SYSTEM"}:${actor?.userId || "NA"}`}
    )
  `

  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_FUEL_DELIVERY_LOG_CREATED",
    actionDescription: `Fuel delivery log created for ${station.name}.`,
    affectedEntity: station.public_id,
  })

  return {
    stationPublicId: station.public_id,
    fuelType: payload.fuelType,
    deliveryTime: payload.deliveryTime,
    estimatedVolume: payload.estimatedVolume,
  }
}

export async function listFuelDeliveryLogs(filters = {}, auth = null) {
  const pagination = normalizePagination(filters)
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const stationFilter = `%${String(filters.station || "").trim()}%`
  const scopedDistrict = districtFilterValue(auth)

  const rows = await prisma.$queryRaw`
    SELECT
      fdl.id,
      fdl.delivery_time,
      fdl.fuel_type,
      fdl.estimated_volume,
      fdl.source_type,
      fdl.reported_by,
      fdl.created_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
    FROM fuel_delivery_logs fdl
    INNER JOIN stations s ON s.id = fdl.station_id
    WHERE (${String(filters.district || "").trim() === ""} = TRUE OR s.city LIKE ${districtFilter})
      AND (${String(filters.station || "").trim() === ""} = TRUE OR s.name LIKE ${stationFilter} OR s.public_id LIKE ${stationFilter})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY fdl.delivery_time DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `

  return {
    page: pagination.page,
    limit: pagination.limit,
    items: (rows || []).map((row) => ({
      id: row.id,
      station: {
        publicId: row.station_public_id,
        name: row.station_name,
        city: row.district,
      },
      fuelType: row.fuel_type,
      deliveryTime: row.delivery_time,
      estimatedVolume: row.estimated_volume,
      sourceType: row.source_type,
      reportedBy: row.reported_by,
      verificationStatus: "PENDING_REVIEW",
      createdAt: row.created_at,
    })),
  }
}

export async function createFuelPriceReport(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  ensureDistrictAccess(actor, station.city, "station")
  await prisma.$executeRaw`
    INSERT INTO fuel_price_reports (station_id, petrol_price, diesel_price, submitted_by)
    VALUES (${station.id}, ${payload.petrolPrice}, ${payload.dieselPrice}, ${actor?.userId || null})
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_FUEL_PRICE_REPORT_CREATED",
    actionDescription: `Fuel price report recorded for ${station.name}.`,
    affectedEntity: station.public_id,
  })
  return {
    stationPublicId: station.public_id,
    petrolPrice: payload.petrolPrice,
    dieselPrice: payload.dieselPrice,
  }
}

export async function getDashboardOverview(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const [stationsRows, inventoryRows, complaintsRows, flagsRows, actionsRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalStations,
        SUM(CASE WHEN fuel_level = 'LOW' THEN 1 ELSE 0 END) AS lowStockStations,
        SUM(CASE WHEN fuel_level = 'MEDIUM' THEN 1 ELSE 0 END) AS mediumStockStations,
        SUM(CASE WHEN fuel_level = 'HIGH' THEN 1 ELSE 0 END) AS highStockStations
      FROM stations
      WHERE is_active = 1
        AND (${scopedDistrict === ""} = TRUE OR city = ${scopedDistrict})
    `,
    prisma.$queryRaw`
      SELECT
        t.station_id,
        ft.code AS fuel_code,
        SUM(COALESCE(latest_reading.litres, 0)) AS remaining_litres
      FROM tanks t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN (
        SELECT ir.tank_id, ir.litres
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS max_reading_time
          FROM inventory_readings
          GROUP BY tank_id
        ) latest_per_tank
          ON latest_per_tank.tank_id = ir.tank_id
         AND latest_per_tank.max_reading_time = ir.reading_time
      ) latest_reading ON latest_reading.tank_id = t.id
      WHERE t.is_active = 1
        AND (${scopedDistrict === ""} = TRUE OR EXISTS (
          SELECT 1
          FROM stations s
          WHERE s.id = t.station_id
            AND s.city = ${scopedDistrict}
        ))
      GROUP BY t.station_id, ft.code
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalComplaints,
        SUM(CASE WHEN complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION') THEN 1 ELSE 0 END) AS openComplaints
      FROM public_complaints
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = public_complaints.station_id AND s.city = ${scopedDistrict}
      ))
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalFlags,
        SUM(CASE WHEN resolved_status IN ('OPEN', 'UNDER_REVIEW') THEN 1 ELSE 0 END) AS openFlags
      FROM compliance_flags
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = compliance_flags.station_id AND s.city = ${scopedDistrict}
      ))
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalActions,
        SUM(CASE WHEN action_status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED') THEN 1 ELSE 0 END) AS activeActions
      FROM enforcement_actions
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = enforcement_actions.station_id AND s.city = ${scopedDistrict}
      ))
    `,
  ])

  const inventorySummaryRows = Array.isArray(inventoryRows) ? inventoryRows : []
  const stationsTotal = Number(stationsRows?.[0]?.totalStations || 0)
  const inventorySnapshot = buildInventorySnapshot(inventorySummaryRows)
  const fuelAvailabilityBuckets = {
    PETROL: new Set(),
    DIESEL: new Set(),
    KEROSENE: new Set(),
  }

  inventorySnapshot.stations.forEach((station) => {
    Object.entries(fuelAvailabilityBuckets).forEach(([fuelCode, bucket]) => {
      if (Number(station.fuelRemaining[fuelCode] || 0) > 0) {
        bucket.add(station.stationId)
      }
    })
  })

  const outOfStockStations = inventorySnapshot.stations.filter((station) => station.outOfStock).length
  const partialOutageStations = inventorySnapshot.stations.filter((station) => station.partialOutage).length

  const fuelAvailabilityByType = [
    { label: "Petrol", code: "PETROL", value: fuelAvailabilityBuckets.PETROL.size, total: stationsTotal },
    { label: "Diesel", code: "DIESEL", value: fuelAvailabilityBuckets.DIESEL.size, total: stationsTotal },
    { label: "Kerosene", code: "KEROSENE", value: fuelAvailabilityBuckets.KEROSENE.size, total: stationsTotal },
    { label: "Out of Stock", code: "OUT_OF_STOCK", value: outOfStockStations, total: stationsTotal },
  ]

  return {
    totalStations: stationsTotal,
    lowStockStations: Number(stationsRows?.[0]?.lowStockStations || 0),
    mediumStockStations: Number(stationsRows?.[0]?.mediumStockStations || 0),
    highStockStations: Number(stationsRows?.[0]?.highStockStations || 0),
    outOfStockStations,
    partialOutageStations,
    fuelAvailabilityByType,
    totalComplaints: Number(complaintsRows?.[0]?.totalComplaints || 0),
    openComplaints: Number(complaintsRows?.[0]?.openComplaints || 0),
    totalFlags: Number(flagsRows?.[0]?.totalFlags || 0),
    openFlags: Number(flagsRows?.[0]?.openFlags || 0),
    totalEnforcementActions: Number(actionsRows?.[0]?.totalActions || 0),
    activeEnforcementActions: Number(actionsRows?.[0]?.activeActions || 0),
  }
}

export async function getDemandForecastSummary(auth = null) {
  const [overview, inventoryRows, districtShortagesRows, transactionRows, queueRows, complaintRows, deliveryRows, flagRows] = await Promise.all([
    getDashboardOverview(auth),
    getLatestInventoryByStationRows(),
    getDistrictShortageSummaries(auth),
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        HOUR(tx.occurred_at) AS hour_bucket,
        SUM(tx.litres) AS litres
      FROM transactions tx
      INNER JOIN stations s ON s.id = tx.station_id
      WHERE tx.occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown'), HOUR(tx.occurred_at)
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        COUNT(*) AS active_queue_count,
        AVG(TIMESTAMPDIFF(MINUTE, qe.joined_at, CURRENT_TIMESTAMP(3))) AS avg_wait_minutes
      FROM queue_entries qe
      INNER JOIN stations s ON s.id = qe.station_id
      WHERE qe.status IN ('WAITING', 'CALLED', 'LATE')
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        COUNT(*) AS open_complaints
      FROM public_complaints pc
      INNER JOIN stations s ON s.id = pc.station_id
      WHERE pc.complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION')
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        MAX(fd.delivered_time) AS last_delivery_time,
        SUM(CASE WHEN fd.delivered_time >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 48 HOUR) THEN COALESCE(fd.litres, 0) ELSE 0 END) AS recent_delivery_litres
      FROM fuel_deliveries fd
      INNER JOIN stations s ON s.id = fd.station_id
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
        COUNT(*) AS active_flags
      FROM compliance_flags cf
      INNER JOIN stations s ON s.id = cf.station_id
      WHERE cf.resolved_status IN ('OPEN', 'UNDER_REVIEW')
      GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    `,
  ])

  const inventorySnapshot = buildInventorySnapshot(inventoryRows)
  const shortageMap = new Map(normalizeRows(districtShortagesRows).map((row) => [String(row.district || 'Unknown'), row]))
  const queueMap = new Map(normalizeRows(queueRows).map((row) => [String(row.district || 'Unknown'), row]))
  const complaintMap = new Map(normalizeRows(complaintRows).map((row) => [String(row.district || 'Unknown'), row]))
  const deliveryMap = new Map(normalizeRows(deliveryRows).map((row) => [String(row.district || 'Unknown'), row]))
  const flagMap = new Map(normalizeRows(flagRows).map((row) => [String(row.district || 'Unknown'), row]))

  const hourlyByDistrict = new Map()
  for (const row of normalizeRows(transactionRows)) {
    const district = String(row.district || 'Unknown')
    const hour = Number(row.hour_bucket || 0)
    const litres = Number(row.litres || 0)
    if (!hourlyByDistrict.has(district)) hourlyByDistrict.set(district, new Map())
    const districtHours = hourlyByDistrict.get(district)
    districtHours.set(hour, [...(districtHours.get(hour) || []), litres])
  }

  const districtStations = new Map()
  inventorySnapshot.stations.forEach((station) => {
    const district = String(station.district || 'Unknown')
    if (!districtStations.has(district)) districtStations.set(district, [])
    districtStations.get(district).push(station)
  })

  const now = new Date()
  const forecastRows = Array.from(districtStations.entries()).map(([district, stations]) => {
    const shortage = shortageMap.get(district) || {}
    const queue = queueMap.get(district) || {}
    const complaints = complaintMap.get(district) || {}
    const deliveries = deliveryMap.get(district) || {}
    const flags = flagMap.get(district) || {}
    const hourMap = hourlyByDistrict.get(district) || new Map()

    const projectedDemandLitres = Array.from({ length: 6 }).reduce((sum, _value, index) => {
      const hour = new Date(now.getTime() + (index + 1) * 60 * 60 * 1000).getHours()
      const samples = hourMap.get(hour) || []
      if (!samples.length) return sum
      return sum + samples.reduce((acc, sample) => acc + sample, 0) / samples.length
    }, 0)

    const inventoryLitres = stations.reduce((sum, station) => sum + Number(station.totalRemainingLitres || 0), 0)
    const outOfStockCount = stations.filter((station) => station.outOfStock).length
    const partialCount = stations.filter((station) => station.partialOutage).length
    const totalStations = Number(shortage.total_stations || stations.length || 0)
    const shortageStations = Number(shortage.shortage_stations || 0)
    const avgWaitMinutes = Math.round(Number(queue.avg_wait_minutes || 0))
    const openComplaints = Number(complaints.open_complaints || 0)
    const activeFlags = Number(flags.active_flags || 0)
    const recentDeliveries = Number(deliveries.recent_delivery_litres || 0)
    const coverageHours = projectedDemandLitres > 0 ? inventoryLitres / (projectedDemandLitres / 6) : null
    const shortageRatio = totalStations > 0 ? shortageStations / totalStations : 0
    const outageRatio = stations.length > 0 ? outOfStockCount / stations.length : 0
    const partialRatio = stations.length > 0 ? partialCount / stations.length : 0
    const queueFactor = clampNumber(avgWaitMinutes / 30, 0, 1)
    const complaintFactor = clampNumber(openComplaints / 6, 0, 1)
    const flagFactor = clampNumber(activeFlags / 4, 0, 1)
    const deliveryReliefFactor = recentDeliveries > 0 ? 0.12 : 0
    const coverageRisk = coverageHours === null ? 0.5 : clampNumber((12 - coverageHours) / 12, 0, 1)

    const pressureScore = Math.round(
      (
        shortageRatio * 0.28 +
        outageRatio * 0.26 +
        partialRatio * 0.12 +
        queueFactor * 0.12 +
        complaintFactor * 0.08 +
        flagFactor * 0.08 +
        coverageRisk * 0.18 -
        deliveryReliefFactor
      ) * 100
    )

    const outlook =
      pressureScore >= 75 ? 'Critical' : pressureScore >= 55 ? 'Elevated' : pressureScore >= 35 ? 'Watch' : 'Stable'

    const recommendation =
      pressureScore >= 75
        ? 'Pre-position supply and escalate field oversight immediately.'
        : pressureScore >= 55
          ? 'Coordinate deliveries and monitor queue growth closely.'
          : pressureScore >= 35
            ? 'Maintain observation and verify next delivery timing.'
            : 'Demand posture remains stable.'

    return {
      district,
      totalStations,
      shortageStations,
      outOfStockStations: outOfStockCount,
      partialOutageStations: partialCount,
      projectedDemandLitres: Math.round(projectedDemandLitres),
      inventoryLitres: Math.round(inventoryLitres),
      coverageHours: coverageHours === null ? null : Math.round(coverageHours * 10) / 10,
      avgWaitMinutes,
      openComplaints,
      activeFlags,
      pressureScore: clampNumber(pressureScore, 0, 100),
      outlook,
      recommendation,
      nextDelivery: deliveries.last_delivery_time || null,
    }
  }).sort((a, b) => b.pressureScore - a.pressureScore)

  const nationalSignal = forecastRows.length
    ? Math.round(forecastRows.reduce((sum, row) => sum + row.pressureScore, 0) / forecastRows.length)
    : 0

  const summary = {
    nationalSignal,
    criticalDistricts: forecastRows.filter((row) => row.outlook === 'Critical').length,
    elevatedDistricts: forecastRows.filter((row) => row.outlook === 'Elevated').length,
    constrainedStations: forecastRows.reduce((sum, row) => sum + row.outOfStockStations + row.partialOutageStations, 0),
    totalProjectedDemandLitres: forecastRows.reduce((sum, row) => sum + row.projectedDemandLitres, 0),
    explanation:
      "Forecast scores blend live shortages, full and partial outages, projected hourly demand, queue waits, open complaints, active flags, and recent delivery relief.",
  }

  return {
    generatedAt: new Date().toISOString(),
    summary,
    rows: forecastRows,
  }
}

function normalizeRows(items) {
  return Array.isArray(items) ? items : []
}

const OUT_OF_STOCK_STATES = new Set(["DRY", "OUT_OF_STOCK"])

function normalizeStationState(value) {
  return String(value || "").trim().toUpperCase()
}

function isOutOfStockHeatmapRow(row) {
  const availability = normalizeStationState(row?.availability_status)
  const petrol = normalizeStationState(row?.petrol_status)
  const diesel = normalizeStationState(row?.diesel_status)

  if (OUT_OF_STOCK_STATES.has(availability)) return true
  return OUT_OF_STOCK_STATES.has(petrol) && OUT_OF_STOCK_STATES.has(diesel)
}

function isLiveReportingHeatmapRow(row) {
  return !["", "UNKNOWN", "OFFLINE"].includes(normalizeStationState(row?.availability_status))
}

export async function getSidebarStats(auth = null) {
  const [
    overview,
    heatmapRows,
    queueWaitRows,
    complaintsRows,
    flagsRows,
    inspectionsRows,
    enforcementRows,
  ] = await Promise.all([
    getDashboardOverview(auth),
    getShortageHeatmapData(auth),
    prisma.$queryRaw`
      SELECT AVG(TIMESTAMPDIFF(MINUTE, joined_at, CURRENT_TIMESTAMP(3))) AS avg_wait
      FROM queue_entries
      WHERE status IN ('WAITING', 'CALLED', 'LATE')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM public_complaints
      WHERE complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM compliance_flags
      WHERE resolved_status IN ('OPEN', 'UNDER_REVIEW')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM inspections
      WHERE inspection_status IN ('OPEN', 'ESCALATED')
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM enforcement_actions
      WHERE action_status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED')
    `,
  ])

  const heatmap = Array.isArray(heatmapRows) ? heatmapRows : []
  const stationsTotal = Number(overview?.totalStations || heatmap.length || 0)
  const stationsOnline = heatmap.filter((row) => isLiveReportingHeatmapRow(row)).length
  const outOfStock = Number(overview?.outOfStockStations || 0)
  const lowStock = Number(overview?.lowStockStations || 0)
  const avgQueueWait = Math.round(Number(queueWaitRows?.[0]?.avg_wait || 0))
  const openComplaints = Number(complaintsRows?.[0]?.total || 0)
  const activeFlags = Number(flagsRows?.[0]?.total || 0)
  const activeInspections = Number(inspectionsRows?.[0]?.total || 0)
  const pendingEnforcement = Number(enforcementRows?.[0]?.total || 0)
  const shortageDistricts = new Set(
    heatmap
      .filter((row) => isOutOfStockHeatmapRow(row) || normalizeStationState(row?.availability_status) === "LIMITED")
      .map((row) => String(row?.city || 'Unknown').trim() || 'Unknown'),
  ).size

  let nationalSituation = "STABLE"
  let situationDetail = "Supply stable · national network normal"

  if (stationsTotal > 0 && outOfStock >= Math.ceil(stationsTotal * 0.35)) {
    nationalSituation = "NATIONAL_OUTAGE"
    situationDetail = `National outage · ${outOfStock} dry stations`
  } else if (shortageDistricts >= 4) {
    nationalSituation = "REGIONAL_SHORTAGE"
    situationDetail = `Regional shortage · ${shortageDistricts} districts`
  } else if (activeFlags >= 5 || pendingEnforcement >= 3) {
    nationalSituation = "PRICE_SPIKE"
    situationDetail = `Price spike watch · ${activeFlags} active flags`
  } else if (lowStock > 0 || avgQueueWait > 15 || openComplaints > 0) {
    nationalSituation = "MONITORING"
    situationDetail = `Monitoring supply · ${lowStock} low stock`
  }

  return {
    stationsOnline,
    stationsTotal,
    outOfStock,
    lowStock,
    avgQueueWait,
    openComplaints,
    activeFlags,
    activeInspections,
    pendingEnforcement,
    nationalSituation,
    situationDetail,
    lastSync: new Date().toISOString(),
  }
}

export async function getFlaggedStations(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COUNT(cf.id) AS open_flags,
      MAX(cf.severity) AS max_severity
    FROM compliance_flags cf
    INNER JOIN stations s ON s.id = cf.station_id
    WHERE cf.resolved_status IN ('OPEN', 'UNDER_REVIEW')
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY s.id, s.public_id, s.name, s.city
    ORDER BY open_flags DESC, s.name ASC
  `
  return rows || []
}

export async function getShortageHeatmapData(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COALESCE((
        SELECT status_log.availability_status
        FROM station_status_logs status_log
        WHERE status_log.station_id = s.id
        ORDER BY status_log.created_at DESC
        LIMIT 1
      ), 'UNKNOWN') AS availability_status,
      COALESCE((
        SELECT status_log.petrol_status
        FROM station_status_logs status_log
        WHERE status_log.station_id = s.id
        ORDER BY status_log.created_at DESC
        LIMIT 1
      ), 'UNKNOWN') AS petrol_status,
      COALESCE((
        SELECT status_log.diesel_status
        FROM station_status_logs status_log
        WHERE status_log.station_id = s.id
        ORDER BY status_log.created_at DESC
        LIMIT 1
      ), 'UNKNOWN') AS diesel_status,
      s.created_at,
      s.updated_at
    FROM stations s
    WHERE s.is_active = 1
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY s.name ASC
  `
  return rows || []
}

export async function getComplaintMetrics(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const [summaryRows, typeRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS bucket,
        COUNT(*) AS total
      FROM public_complaints
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 6 MONTH)
        AND (${scopedDistrict === ""} = TRUE OR EXISTS (
          SELECT 1 FROM stations s WHERE s.id = public_complaints.station_id AND s.city = ${scopedDistrict}
        ))
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY bucket ASC
    `,
    prisma.$queryRaw`
      SELECT complaint_type, COUNT(*) AS total
      FROM public_complaints
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = public_complaints.station_id AND s.city = ${scopedDistrict}
      ))
      GROUP BY complaint_type
      ORDER BY total DESC, complaint_type ASC
    `,
  ])
  return {
    monthly: summaryRows || [],
    byType: typeRows || [],
  }
}

export async function getInspectionMetrics(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const [statusRows, officerRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT inspection_status, COUNT(*) AS total
      FROM inspections
      WHERE (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = inspections.station_id AND s.city = ${scopedDistrict}
      ))
      GROUP BY inspection_status
      ORDER BY total DESC, inspection_status ASC
    `,
    prisma.$queryRaw`
      SELECT
        mu.public_id,
        mu.full_name,
        COUNT(i.id) AS inspections_count
      FROM inspections i
      INNER JOIN mera_users mu ON mu.id = i.officer_id
      INNER JOIN stations s ON s.id = i.station_id
      WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      GROUP BY mu.id, mu.public_id, mu.full_name
      ORDER BY inspections_count DESC, mu.full_name ASC
      LIMIT 10
    `,
  ])
  return {
    byStatus: statusRows || [],
    topInspectors: officerRows || [],
  }
}

export async function getTopComplaintStations(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COUNT(pc.id) AS complaints_count
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY s.id, s.public_id, s.name, s.city
    ORDER BY complaints_count DESC, s.name ASC
    LIMIT 10
  `
  return rows || []
}

export async function getDistrictShortageSummaries(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      COALESCE(NULLIF(s.city, ''), 'Unknown') AS district,
      COUNT(*) AS total_stations,
      SUM(
        CASE
          WHEN COALESCE((
            SELECT status_log.availability_status
            FROM station_status_logs status_log
            WHERE status_log.station_id = s.id
            ORDER BY status_log.created_at DESC
            LIMIT 1
          ), 'UNKNOWN') IN ('DRY', 'LIMITED')
            THEN 1
          ELSE 0
        END
      ) AS shortage_stations
    FROM stations s
    WHERE s.is_active = 1
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    ORDER BY shortage_stations DESC, district ASC
  `
  return rows || []
}

export async function getRepeatedOffenders(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COUNT(cf.id) AS flag_count,
      COUNT(ea.id) AS enforcement_count
    FROM stations s
    LEFT JOIN compliance_flags cf ON cf.station_id = s.id
    LEFT JOIN enforcement_actions ea ON ea.station_id = s.id
    WHERE s.is_active = 1
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY s.id, s.public_id, s.name, s.city
    HAVING flag_count >= 2 OR enforcement_count >= 1
    ORDER BY flag_count DESC, enforcement_count DESC, s.name ASC
  `
  return rows || []
}

export async function getMonthlyRegulatoryReports(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      DATE_FORMAT(pc.created_at, '%Y-%m') AS month_bucket,
      COUNT(DISTINCT pc.id) AS complaints_count,
      COUNT(DISTINCT i.id) AS inspections_count,
      COUNT(DISTINCT cf.id) AS flags_count,
      COUNT(DISTINCT ea.id) AS enforcement_count
    FROM public_complaints pc
    LEFT JOIN inspections i ON DATE_FORMAT(i.created_at, '%Y-%m') = DATE_FORMAT(pc.created_at, '%Y-%m')
    LEFT JOIN compliance_flags cf ON DATE_FORMAT(cf.created_at, '%Y-%m') = DATE_FORMAT(pc.created_at, '%Y-%m')
    LEFT JOIN enforcement_actions ea ON DATE_FORMAT(ea.issued_at, '%Y-%m') = DATE_FORMAT(pc.created_at, '%Y-%m')
    WHERE pc.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 12 MONTH)
      AND (${scopedDistrict === ""} = TRUE OR EXISTS (
        SELECT 1 FROM stations s WHERE s.id = pc.station_id AND s.city = ${scopedDistrict}
      ))
    GROUP BY DATE_FORMAT(pc.created_at, '%Y-%m')
    ORDER BY month_bucket ASC
  `
  return rows || []
}

export async function listMeraUsers(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.district_scope,
      mu.region_scope,
      mu.account_status,
      mu.created_at,
      (
        SELECT MAX(mas.last_seen_at)
        FROM mera_auth_sessions mas
        WHERE mas.mera_user_id = mu.id
      ) AS last_login_at,
      mr.code AS role_code,
      mr.display_name AS role_display_name,
      mr.description AS role_description,
      (
        SELECT COUNT(*)
        FROM public_complaints pc
        WHERE pc.assigned_officer_id = mu.id
          AND pc.complaint_status IN ('NEW', 'REVIEWING', 'VERIFIED', 'ESCALATED', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION')
      ) AS active_cases
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict})
    ORDER BY mu.created_at DESC
  `
  const permissionRows = await prisma.$queryRaw`
    SELECT
      mu.public_id AS user_public_id,
      mp.code AS permission_code
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    INNER JOIN mera_role_permissions mrp ON mrp.role_id = mr.id
    INNER JOIN mera_permissions mp ON mp.id = mrp.permission_id
    WHERE (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict})
  `
  const permissionMap = new Map()
  for (const row of permissionRows || []) {
    const userPublicId = String(row.user_public_id || "").trim()
    if (!permissionMap.has(userPublicId)) permissionMap.set(userPublicId, [])
    permissionMap.get(userPublicId).push(String(row.permission_code || "").trim())
  }

  return (rows || []).map((row) => ({
    ...row,
    permissions: permissionMap.get(String(row.public_id || "").trim()) || [],
  }))
}

export async function createMeraUser(payload, actor) {
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM mera_roles
    WHERE code = ${normalizeRole(payload.roleName)}
    LIMIT 1
  `
  const roleId = rows?.[0]?.id
  if (!roleId) throw badRequest("MERA role is not configured")

  const passwordHash = await bcrypt.hash(String(payload.password || ""), 10)
  const publicId = createPublicId()
  await prisma.$executeRaw`
    INSERT INTO mera_users (
      public_id,
      full_name,
      email,
      phone,
      password_hash,
      role_id,
      district_scope,
      region_scope,
      account_status
    )
    VALUES (
      ${publicId},
      ${payload.fullName},
      ${String(payload.email || "").trim().toLowerCase()},
      ${payload.phone || null},
      ${passwordHash},
      ${roleId},
      ${payload.districtScope || null},
      ${payload.regionScope || null},
      ${normalizeAccountStatus(payload.accountStatus || "ACTIVE")}
    )
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_USER_CREATED",
    actionDescription: `MERA user ${payload.fullName} created with role ${payload.roleName}.`,
    affectedEntity: publicId,
  })
  return {
    publicId,
    fullName: payload.fullName,
    email: String(payload.email || "").trim().toLowerCase(),
    roleName: normalizeRole(payload.roleName),
  }
}

export async function updateMeraUserStatus({ meraUserPublicId, accountStatus, actor }) {
  const user = await resolveMeraUserByPublicId(meraUserPublicId)
  ensureDistrictAccess(actor, user.district_scope, "user")
  const normalizedStatus = normalizeAccountStatus(accountStatus)
  await prisma.$executeRaw`
    UPDATE mera_users
    SET account_status = ${normalizedStatus}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${user.id}
  `
  await logMeraAudit({
    ...actorAuditContext(actor),
    actionType: "MERA_USER_STATUS_UPDATED",
    actionDescription: `MERA user ${user.full_name} moved to ${normalizedStatus}.`,
    affectedEntity: user.public_id,
  })
  return {
    publicId: user.public_id,
    accountStatus: normalizedStatus,
  }
}

export async function listMeraAuditLogs({ page = 1, limit = 50 } = {}, auth = null) {
  const pagination = normalizePagination({ page, limit })
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      alm.id,
      alm.actor_role,
      alm.permission_code,
      alm.action_type,
      alm.action_description,
      alm.affected_entity,
      alm.ip_address,
      alm.device_info,
      alm.created_at,
      mu.public_id AS actor_public_id,
      COALESCE(mu.full_name, alm.actor_name) AS actor_name
    FROM audit_logs_mera alm
    LEFT JOIN mera_users mu ON mu.id = alm.actor_id
    WHERE (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict} OR alm.actor_id IS NULL)
    ORDER BY alm.created_at DESC
    LIMIT ${pagination.limit}
    OFFSET ${pagination.offset}
  `
  return {
    page: pagination.page,
    limit: pagination.limit,
    items: rows || [],
  }
}

export async function listStationRegulatoryProfiles(auth = null) {
  const scopedDistrict = districtFilterValue(auth)
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      s.address,
      latest_license.license_number,
      latest_license.license_status,
      latest_license.expiry_date,
      COALESCE(flags.open_flags, 0) AS open_flags,
      COALESCE(complaints.complaint_count, 0) AS complaint_count
    FROM stations s
    LEFT JOIN fuel_station_licenses latest_license ON latest_license.id = (
      SELECT inner_license.id
      FROM fuel_station_licenses inner_license
      WHERE inner_license.station_id = s.id
      ORDER BY inner_license.expiry_date DESC, inner_license.id DESC
      LIMIT 1
    )
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS open_flags
      FROM compliance_flags
      WHERE resolved_status IN ('OPEN', 'UNDER_REVIEW')
      GROUP BY station_id
    ) flags ON flags.station_id = s.id
    LEFT JOIN (
      SELECT station_id, COUNT(*) AS complaint_count
      FROM public_complaints
      GROUP BY station_id
    ) complaints ON complaints.station_id = s.id
    WHERE s.is_active = 1
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY s.name ASC
  `
  return rows || []
}

export async function getStationRegulatoryProfile(stationPublicId, auth = null) {
  const station = await resolveStationId(stationPublicId)
  ensureDistrictAccess(auth, station.city, "station")
  const [licenseRows, complaintRows, flagRows, enforcementRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT id, license_number, issue_date, expiry_date, license_status, compliance_conditions
      FROM fuel_station_licenses
      WHERE station_id = ${station.id}
      ORDER BY expiry_date DESC, id DESC
    `,
    prisma.$queryRaw`
      SELECT complaint_type, complaint_status, created_at
      FROM public_complaints
      WHERE station_id = ${station.id}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    prisma.$queryRaw`
      SELECT public_id, flag_type, severity, resolved_status, created_at
      FROM compliance_flags
      WHERE station_id = ${station.id}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    prisma.$queryRaw`
      SELECT public_id, action_type, action_status, issued_at, resolved_at
      FROM enforcement_actions
      WHERE station_id = ${station.id}
      ORDER BY issued_at DESC
      LIMIT 50
    `,
  ])

  return {
    station,
    licenses: licenseRows || [],
    complaints: complaintRows || [],
    flags: flagRows || [],
    enforcementActions: enforcementRows || [],
  }
}
