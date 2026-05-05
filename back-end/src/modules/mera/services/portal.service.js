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
    SELECT mu.id, mu.public_id, mu.full_name, mr.role_name
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
    SELECT id, public_id, station_id, complaint_status
    FROM public_complaints
    WHERE public_id = ${normalizePublicId(complaintPublicId, "complaintPublicId")}
    LIMIT 1
  `
  const complaint = rows?.[0]
  if (!complaint?.id) throw notFound("Complaint not found")
  return complaint
}

async function resolveInspectionByPublicId(inspectionPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, station_id
    FROM inspections
    WHERE public_id = ${normalizePublicId(inspectionPublicId, "inspectionPublicId")}
    LIMIT 1
  `
  const inspection = rows?.[0]
  if (!inspection?.id) throw notFound("Inspection not found")
  return inspection
}

async function resolveFlagByPublicId(flagPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, station_id, resolved_status
    FROM compliance_flags
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
    actorId: actor?.userId || null,
    actorRole: actor?.role || "SYSTEM",
    actionType: "MERA_FLAG_CREATED",
    actionDescription: `Compliance flag ${flagType} created for station ${stationId}.`,
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
    actorRole: "PUBLIC_PORTAL",
    actionType: "PUBLIC_COMPLAINT_CREATED",
    actionDescription: `Public complaint ${publicId} created against ${station.name}.`,
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

export async function listComplaints(filters = {}) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const complaintTypeFilter = String(filters.complaintType || "").trim().toUpperCase()
  const districtFilter = `%${String(filters.district || "").trim()}%`

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

  await prisma.$executeRaw`
    UPDATE public_complaints
    SET
      assigned_officer_id = ${officer.id},
      complaint_status = 'ASSIGNED',
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${complaint.id}
  `

  await logMeraAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_COMPLAINT_ASSIGNED",
    actionDescription: `Complaint ${complaint.public_id} assigned to ${officer.full_name}.`,
  })

  return {
    complaintPublicId: complaint.public_id,
    assignedOfficer: {
      publicId: officer.public_id,
      fullName: officer.full_name,
      role: officer.role_name,
    },
    complaintStatus: "ASSIGNED",
  }
}

export async function updateComplaintStatus({ complaintPublicId, complaintStatus, actor }) {
  const complaint = await resolveComplaintByPublicId(complaintPublicId)
  await prisma.$executeRaw`
    UPDATE public_complaints
    SET complaint_status = ${complaintStatus}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${complaint.id}
  `

  await logMeraAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_COMPLAINT_STATUS_UPDATED",
    actionDescription: `Complaint ${complaint.public_id} moved to ${complaintStatus}.`,
  })

  return {
    complaintPublicId: complaint.public_id,
    complaintStatus,
  }
}

export async function createInspection(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
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
      ${actor.userId},
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
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_INSPECTION_CREATED",
    actionDescription: `Inspection ${publicId} created for ${station.name}.`,
  })

  return {
    inspectionPublicId: publicId,
    stationPublicId: station.public_id,
    inspectionStatus: payload.inspectionStatus,
  }
}

export async function attachInspectionEvidence({ inspectionPublicId, fileUrl, fileType, actor }) {
  const inspection = await resolveInspectionByPublicId(inspectionPublicId)
  await prisma.$executeRaw`
    INSERT INTO inspection_evidence (inspection_id, file_url, file_type)
    VALUES (${inspection.id}, ${fileUrl}, ${fileType})
  `

  await logMeraAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_INSPECTION_EVIDENCE_UPLOADED",
    actionDescription: `Evidence uploaded for inspection ${inspection.public_id}.`,
  })

  return {
    inspectionPublicId: inspection.public_id,
    fileUrl,
    fileType,
  }
}

export async function listInspections(filters = {}) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
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
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name
    FROM inspections i
    INNER JOIN stations s ON s.id = i.station_id
    INNER JOIN mera_users mu ON mu.id = i.officer_id
    WHERE (${statusFilter === ""} = TRUE OR i.inspection_status = ${statusFilter})
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
      },
      officer: {
        publicId: row.officer_public_id,
        fullName: row.officer_name,
      },
    })),
  }
}

export async function getStationInspectionHistory(stationPublicId) {
  const station = await resolveStationId(stationPublicId)
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

export async function listFlags(filters = {}) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
  const severityFilter = String(filters.severity || "").trim().toUpperCase()
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
      mu.public_id AS resolved_by_public_id,
      mu.full_name AS resolved_by_name
    FROM compliance_flags cf
    INNER JOIN stations s ON s.id = cf.station_id
    LEFT JOIN mera_users mu ON mu.id = cf.resolved_by
    WHERE (${statusFilter === ""} = TRUE OR cf.resolved_status = ${statusFilter})
      AND (${severityFilter === ""} = TRUE OR cf.severity = ${severityFilter})
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
  await prisma.$executeRaw`
    UPDATE compliance_flags
    SET
      resolved_status = ${resolvedStatus},
      resolved_at = CURRENT_TIMESTAMP(3),
      resolved_by = ${actor.userId}
    WHERE id = ${flag.id}
  `
  await logMeraAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_FLAG_RESOLVED",
    actionDescription: `Flag ${flag.public_id} marked ${resolvedStatus}.`,
  })
  return {
    flagPublicId: flag.public_id,
    resolvedStatus,
  }
}

export async function createEnforcementAction(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
  let relatedFlagId = null
  if (String(payload.relatedFlagPublicId || "").trim()) {
    const flag = await resolveFlagByPublicId(payload.relatedFlagPublicId)
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
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_ENFORCEMENT_CREATED",
    actionDescription: `Enforcement action ${publicId} created for ${station.name}.`,
  })
  return {
    enforcementPublicId: publicId,
    stationPublicId: station.public_id,
    actionStatus: payload.actionStatus,
  }
}

export async function getStationEnforcementHistory(stationPublicId) {
  const station = await resolveStationId(stationPublicId)
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

export async function listEnforcementActions(filters = {}) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
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
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_LICENSE_ATTACHED",
    actionDescription: `License ${payload.licenseNumber} attached to ${station.name}.`,
  })
  return {
    stationPublicId: station.public_id,
    licenseNumber: payload.licenseNumber,
    licenseStatus: payload.licenseStatus,
  }
}

export async function updateLicense({ licenseId, payload, actor }) {
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
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_LICENSE_UPDATED",
    actionDescription: `License record ${licenseId} updated.`,
  })
  return {
    licenseId: toInteger(licenseId),
    ...payload,
  }
}

export async function getLicenseExpiryAlerts({ days = 60 } = {}) {
  const scopedDays = clamp(toInteger(days, 60), 1, 365)
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
    ORDER BY fsl.expiry_date ASC
  `
  return rows || []
}

export async function listLicenseRegistry(filters = {}) {
  const pagination = normalizePagination(filters)
  const statusFilter = String(filters.status || "").trim().toUpperCase()
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
  return {
    stationPublicId: station.public_id,
    availabilityStatus: payload.availabilityStatus,
  }
}

export async function createAvailabilityReport(payload, actor) {
  const station = await resolveStationId(payload.stationPublicId)
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
    actorId: actor?.userId || null,
    actorRole: actor?.role || "SYSTEM",
    actionType: "MERA_AVAILABILITY_REPORT_CREATED",
    actionDescription: `Availability report recorded for ${station.name}.`,
  })

  return {
    stationPublicId: station.public_id,
    petrolAvailable: Boolean(petrolAvailable),
    dieselAvailable: Boolean(dieselAvailable),
    activePumps,
    availabilityStatus: overallAvailability,
  }
}

export async function listAvailabilityReports(filters = {}) {
  const pagination = normalizePagination(filters)
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const stationFilter = `%${String(filters.station || "").trim()}%`

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
    actorId: actor?.userId || null,
    actorRole: actor?.role || "SYSTEM",
    actionType: "MERA_FUEL_DELIVERY_LOG_CREATED",
    actionDescription: `Fuel delivery log created for ${station.name}.`,
  })

  return {
    stationPublicId: station.public_id,
    fuelType: payload.fuelType,
    deliveryTime: payload.deliveryTime,
    estimatedVolume: payload.estimatedVolume,
  }
}

export async function listFuelDeliveryLogs(filters = {}) {
  const pagination = normalizePagination(filters)
  const districtFilter = `%${String(filters.district || "").trim()}%`
  const stationFilter = `%${String(filters.station || "").trim()}%`

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
  await prisma.$executeRaw`
    INSERT INTO fuel_price_reports (station_id, petrol_price, diesel_price, submitted_by)
    VALUES (${station.id}, ${payload.petrolPrice}, ${payload.dieselPrice}, ${actor?.userId || null})
  `
  return {
    stationPublicId: station.public_id,
    petrolPrice: payload.petrolPrice,
    dieselPrice: payload.dieselPrice,
  }
}

export async function getDashboardOverview() {
  const [stationsRows, complaintsRows, flagsRows, actionsRows] = await Promise.all([
    prisma.$queryRaw`SELECT COUNT(*) AS totalStations FROM stations WHERE is_active = 1`,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalComplaints,
        SUM(CASE WHEN complaint_status IN ('NEW', 'TRIAGED', 'ASSIGNED', 'UNDER_INVESTIGATION') THEN 1 ELSE 0 END) AS openComplaints
      FROM public_complaints
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalFlags,
        SUM(CASE WHEN resolved_status IN ('OPEN', 'UNDER_REVIEW') THEN 1 ELSE 0 END) AS openFlags
      FROM compliance_flags
    `,
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS totalActions,
        SUM(CASE WHEN action_status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED') THEN 1 ELSE 0 END) AS activeActions
      FROM enforcement_actions
    `,
  ])

  return {
    totalStations: Number(stationsRows?.[0]?.totalStations || 0),
    totalComplaints: Number(complaintsRows?.[0]?.totalComplaints || 0),
    openComplaints: Number(complaintsRows?.[0]?.openComplaints || 0),
    totalFlags: Number(flagsRows?.[0]?.totalFlags || 0),
    openFlags: Number(flagsRows?.[0]?.openFlags || 0),
    totalEnforcementActions: Number(actionsRows?.[0]?.totalActions || 0),
    activeEnforcementActions: Number(actionsRows?.[0]?.activeActions || 0),
  }
}

export async function getFlaggedStations() {
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
    GROUP BY s.id, s.public_id, s.name, s.city
    ORDER BY open_flags DESC, s.name ASC
  `
  return rows || []
}

export async function getShortageHeatmapData() {
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
    ORDER BY s.name ASC
  `
  return rows || []
}

export async function getComplaintMetrics() {
  const [summaryRows, typeRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS bucket,
        COUNT(*) AS total
      FROM public_complaints
      WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m')
      ORDER BY bucket ASC
    `,
    prisma.$queryRaw`
      SELECT complaint_type, COUNT(*) AS total
      FROM public_complaints
      GROUP BY complaint_type
      ORDER BY total DESC, complaint_type ASC
    `,
  ])
  return {
    monthly: summaryRows || [],
    byType: typeRows || [],
  }
}

export async function getInspectionMetrics() {
  const [statusRows, officerRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT inspection_status, COUNT(*) AS total
      FROM inspections
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

export async function getTopComplaintStations() {
  const rows = await prisma.$queryRaw`
    SELECT
      s.public_id,
      s.name,
      s.city,
      COUNT(pc.id) AS complaints_count
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    GROUP BY s.id, s.public_id, s.name, s.city
    ORDER BY complaints_count DESC, s.name ASC
    LIMIT 10
  `
  return rows || []
}

export async function getDistrictShortageSummaries() {
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
    GROUP BY COALESCE(NULLIF(s.city, ''), 'Unknown')
    ORDER BY shortage_stations DESC, district ASC
  `
  return rows || []
}

export async function getRepeatedOffenders() {
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
    GROUP BY s.id, s.public_id, s.name, s.city
    HAVING flag_count >= 2 OR enforcement_count >= 1
    ORDER BY flag_count DESC, enforcement_count DESC, s.name ASC
  `
  return rows || []
}

export async function getMonthlyRegulatoryReports() {
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
    GROUP BY DATE_FORMAT(pc.created_at, '%Y-%m')
    ORDER BY month_bucket ASC
  `
  return rows || []
}

export async function listMeraUsers() {
  const rows = await prisma.$queryRaw`
    SELECT
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.district,
      mu.account_status,
      mu.created_at,
      (
        SELECT MAX(mas.last_seen_at)
        FROM mera_auth_sessions mas
        WHERE mas.mera_user_id = mu.id
      ) AS last_login_at,
      mr.role_name,
      mr.role_description
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    ORDER BY mu.created_at DESC
  `
  return rows || []
}

export async function createMeraUser(payload, actor) {
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM mera_roles
    WHERE role_name = ${normalizeRole(payload.roleName)}
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
      district,
      account_status
    )
    VALUES (
      ${publicId},
      ${payload.fullName},
      ${String(payload.email || "").trim().toLowerCase()},
      ${payload.phone || null},
      ${passwordHash},
      ${roleId},
      ${payload.district || null},
      ${normalizeAccountStatus(payload.accountStatus || "ACTIVE")}
    )
  `
  await logMeraAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_USER_CREATED",
    actionDescription: `MERA user ${payload.fullName} created with role ${payload.roleName}.`,
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
  const normalizedStatus = normalizeAccountStatus(accountStatus)
  await prisma.$executeRaw`
    UPDATE mera_users
    SET account_status = ${normalizedStatus}, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${user.id}
  `
  await logMeraAudit({
    actorId: actor.userId,
    actorRole: actor.role,
    actionType: "MERA_USER_STATUS_UPDATED",
    actionDescription: `MERA user ${user.full_name} moved to ${normalizedStatus}.`,
  })
  return {
    publicId: user.public_id,
    accountStatus: normalizedStatus,
  }
}

export async function listMeraAuditLogs({ page = 1, limit = 50 } = {}) {
  const pagination = normalizePagination({ page, limit })
  const rows = await prisma.$queryRaw`
    SELECT
      alm.id,
      alm.actor_role,
      alm.action_type,
      alm.action_description,
      alm.created_at,
      mu.public_id AS actor_public_id,
      mu.full_name AS actor_name
    FROM audit_logs_mera alm
    LEFT JOIN mera_users mu ON mu.id = alm.actor_id
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

export async function listStationRegulatoryProfiles() {
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
    ORDER BY s.name ASC
  `
  return rows || []
}

export async function getStationRegulatoryProfile(stationPublicId) {
  const station = await resolveStationId(stationPublicId)
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
