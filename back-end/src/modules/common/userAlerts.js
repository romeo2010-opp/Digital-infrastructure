import { Prisma } from "@prisma/client"
import { prisma } from "../../db/prisma.js"
import { createPublicId } from "./db.js"

const READ_ALERT_ARCHIVE_RETENTION_DAYS = 30
const READ_ALERT_ARCHIVE_BATCH_SIZE = 250

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function parseAlertMetadata(value) {
  if (!value || typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function parseArchivedAlerts(value) {
  if (!value || typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getArchiveTimestamp(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function toArchiveMonth(value) {
  const date = getArchiveTimestamp(value)
  if (!date) return null
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  return `${year}-${month}-01`
}

function compareAlertMoments(left, right) {
  const leftTime = getArchiveTimestamp(left?.readAt || left?.createdAt)?.getTime() || 0
  const rightTime = getArchiveTimestamp(right?.readAt || right?.createdAt)?.getTime() || 0
  return leftTime - rightTime
}

function buildArchivedAlert(row) {
  return mapUserAlertRow(row)
}

function normalizeArchivedAlert(item, { archivedAt = null, archivedReason = null } = {}) {
  const normalized = normalizeAlertRecord(item)
  const nextReadAt = normalized.readAt || archivedAt || new Date().toISOString()

  return {
    ...normalized,
    status: "READ",
    isRead: true,
    readAt: nextReadAt,
    archivedAt: archivedAt || normalized.archivedAt || null,
    archivedReason: archivedReason || normalized.archivedReason || null,
  }
}

function normalizeAlertRecord(item) {
  if (!item || typeof item !== "object") return {}

  const publicId = String(item.publicId || "").trim()
  const status = String(item.status || (item.readAt ? "READ" : "UNREAD")).trim().toUpperCase()

  return {
    publicId,
    category: String(item.category || "SYSTEM").trim().toUpperCase(),
    title: String(item.title || "Alert").trim() || "Alert",
    message: String(item.message || item.body || "").trim() || "You have a new alert.",
    status: status === "READ" ? "READ" : "UNREAD",
    isRead: status === "READ" || Boolean(item.isRead),
    createdAt: toIsoOrNull(item.createdAt || item.created_at),
    readAt: toIsoOrNull(item.readAt || item.read_at),
    reservationPublicId: String(item.reservationPublicId || item.reservation_public_id || "").trim() || null,
    station: {
      publicId: String(item?.station?.publicId || item.station_public_id || "").trim() || null,
      name: String(item?.station?.name || item.station_name || "").trim() || "Station",
      area: String(item?.station?.area || item.station_area || "").trim() || null,
    },
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
    archivedAt: toIsoOrNull(item.archivedAt || item.archived_at),
    archivedReason: String(item.archivedReason || item.archived_reason || "").trim() || null,
  }
}

function mergeArchivedAlerts(existingAlerts, nextAlerts) {
  const mergedById = new Map()
  for (const item of [...existingAlerts, ...nextAlerts]) {
    const normalized = normalizeAlertRecord(item)
    const publicId = String(normalized?.publicId || "").trim()
    if (!publicId) continue
    mergedById.set(publicId, normalized)
  }
  return [...mergedById.values()].sort(compareAlertMoments)
}

function resolveArchiveRange(alerts) {
  let firstArchivedAt = null
  let lastArchivedAt = null

  for (const item of alerts) {
    const timestamp = getArchiveTimestamp(item?.readAt || item?.createdAt)
    if (!timestamp) continue
    if (!firstArchivedAt || timestamp < firstArchivedAt) firstArchivedAt = timestamp
    if (!lastArchivedAt || timestamp > lastArchivedAt) lastArchivedAt = timestamp
  }

  return {
    firstArchivedAt,
    lastArchivedAt,
  }
}

export function isUserAlertsTableMissingError(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes("user_alerts")) return false
  return (
    message.includes("doesn't exist") ||
    message.includes("does not exist") ||
    message.includes("unknown table")
  )
}

export function isUserAlertArchivesTableMissingError(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes("user_alert_archives")) return false
  return (
    message.includes("doesn't exist") ||
    message.includes("does not exist") ||
    message.includes("unknown table")
  )
}

export function isUserAlertsReservationPublicIdTooShortError(error) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("reservation_public_id") && message.includes("data too long")
}

export async function ensureUserAlertsTableReady() {
  try {
    await prisma.$queryRaw`
      SELECT id, public_id, user_id, status, created_at
      FROM user_alerts
      LIMIT 1
    `
  } catch (error) {
    if (isUserAlertsTableMissingError(error)) {
      const wrapped = new Error(
        "User alerts storage is unavailable. Run SQL migration 018_create_user_alerts.sql."
      )
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
}

export async function ensureUserAlertArchivesTableReady() {
  try {
    await prisma.$queryRaw`
      SELECT id, public_id, user_id, archive_month
      FROM user_alert_archives
      LIMIT 1
    `
  } catch (error) {
    if (isUserAlertArchivesTableMissingError(error)) {
      const wrapped = new Error(
        "User alert archive storage is unavailable. Run SQL migration 033_archive_user_alerts.sql."
      )
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
}

export function mapUserAlertRow(row) {
  const status = String(row?.status || "UNREAD").trim().toUpperCase()
  const metadata = parseAlertMetadata(row?.metadata)
  const stationPublicId = String(row?.station_public_id || "").trim() || null
  const stationName = String(row?.station_name || "").trim() || "Station"
  const stationArea = String(row?.station_area || "").trim() || null

  return {
    publicId: String(row?.public_id || "").trim(),
    category: String(row?.category || "SYSTEM").trim().toUpperCase(),
    title: String(row?.title || "").trim() || "Alert",
    message: String(row?.body || "").trim() || "",
    status,
    isRead: status === "READ",
    createdAt: toIsoOrNull(row?.created_at),
    readAt: toIsoOrNull(row?.read_at),
    reservationPublicId: String(row?.reservation_public_id || "").trim() || null,
    station: {
      publicId: stationPublicId,
      name: stationName,
      area: stationArea,
    },
    metadata,
  }
}

export async function listUserAlertsByUserId(userId, { limit = 100 } = {}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return []

  await archiveReadUserAlertsByUserId(normalizedUserId)

  const safeLimit = Math.min(200, Math.max(1, Number(limit || 100)))
  const rows = await prisma.$queryRaw`
    SELECT
      ua.public_id,
      ua.category,
      ua.title,
      ua.body,
      ua.status,
      ua.metadata,
      ua.created_at,
      ua.read_at,
      ua.reservation_public_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area
    FROM user_alerts ua
    LEFT JOIN stations st ON st.id = ua.station_id
    WHERE ua.user_id = ${normalizedUserId}
    ORDER BY ua.created_at DESC, ua.id DESC
    LIMIT ${safeLimit}
  `
  return (rows || []).map(mapUserAlertRow)
}

export async function listUserAlertArchivesByUserId(userId, { limit = 100 } = {}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return []

  await archiveReadUserAlertsByUserId(normalizedUserId)

  const safeLimit = Math.min(500, Math.max(1, Number(limit || 100)))
  const rows = await prisma.$queryRaw`
    SELECT
      ua.public_id,
      ua.archive_month,
      ua.alert_count,
      ua.alerts_json,
      ua.first_archived_at,
      ua.last_archived_at
    FROM user_alert_archives ua
    WHERE ua.user_id = ${normalizedUserId}
    ORDER BY ua.archive_month DESC, ua.last_archived_at DESC, ua.id DESC
  `

  const items = []
  for (const row of rows || []) {
    const archivedAlerts = parseArchivedAlerts(row?.alerts_json).map((item) =>
      normalizeArchivedAlert(item, {
        archivedAt: toIsoOrNull(item?.archivedAt || row?.last_archived_at),
        archivedReason: item?.archivedReason || "AUTO_RETENTION",
      })
    )
    archivedAlerts.sort((left, right) => {
      const leftTime = getArchiveTimestamp(left?.archivedAt || left?.readAt || left?.createdAt)?.getTime() || 0
      const rightTime = getArchiveTimestamp(right?.archivedAt || right?.readAt || right?.createdAt)?.getTime() || 0
      return rightTime - leftTime
    })
    items.push(...archivedAlerts)
    if (items.length >= safeLimit) break
  }

  return items.slice(0, safeLimit)
}

export async function archiveReadUserAlertsByUserId(
  userId,
  {
    retentionDays = READ_ALERT_ARCHIVE_RETENTION_DAYS,
    batchSize = READ_ALERT_ARCHIVE_BATCH_SIZE,
  } = {}
) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return 0

  const safeRetentionDays = Math.max(1, Number(retentionDays || READ_ALERT_ARCHIVE_RETENTION_DAYS))
  const safeBatchSize = Math.min(1000, Math.max(1, Number(batchSize || READ_ALERT_ARCHIVE_BATCH_SIZE)))
  const cutoff = new Date(Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000)

  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT
          ua.id,
          ua.public_id,
          ua.category,
          ua.title,
          ua.body,
          ua.status,
          ua.metadata,
          ua.created_at,
          ua.read_at,
          ua.reservation_public_id,
          st.public_id AS station_public_id,
          st.name AS station_name,
          COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area
        FROM user_alerts ua
        LEFT JOIN stations st ON st.id = ua.station_id
        WHERE ua.user_id = ${normalizedUserId}
          AND ua.status = 'READ'
          AND ua.read_at IS NOT NULL
          AND ua.read_at < ${cutoff}
        ORDER BY ua.read_at ASC, ua.id ASC
        LIMIT ${safeBatchSize}
        FOR UPDATE
      `

      if (!rows?.length) return 0

      const buckets = new Map()
      const archivedIds = []

      for (const row of rows) {
        const archiveMonth = toArchiveMonth(row?.read_at || row?.created_at)
        if (!archiveMonth) continue
        const archivedAlert = buildArchivedAlert(row)
        if (!buckets.has(archiveMonth)) buckets.set(archiveMonth, [])
        buckets.get(archiveMonth).push(archivedAlert)
        archivedIds.push(Number(row.id))
      }

      if (!archivedIds.length) return 0

      for (const [archiveMonth, nextAlerts] of buckets.entries()) {
        await upsertUserAlertArchiveBucket(tx, {
          userId: normalizedUserId,
          archiveMonth,
          alerts: nextAlerts,
        })
      }

      await tx.$executeRaw`
        DELETE FROM user_alerts
        WHERE user_id = ${normalizedUserId}
          AND id IN (${Prisma.join(archivedIds)})
      `

      return archivedIds.length
    })
  } catch (error) {
    if (isUserAlertArchivesTableMissingError(error)) return 0
    throw error
  }
}

async function upsertUserAlertArchiveBucket(tx, { userId, archiveMonth, alerts }) {
  const existingRows = await tx.$queryRaw`
    SELECT id, alerts_json
    FROM user_alert_archives
    WHERE user_id = ${userId}
      AND archive_month = ${archiveMonth}
    LIMIT 1
    FOR UPDATE
  `

  const existingRow = existingRows?.[0] || null
  const mergedAlerts = mergeArchivedAlerts(parseArchivedAlerts(existingRow?.alerts_json), alerts)
  const { firstArchivedAt, lastArchivedAt } = resolveArchiveRange(mergedAlerts)
  const alertsJson = JSON.stringify(mergedAlerts)

  if (existingRow?.id) {
    await tx.$executeRaw`
      UPDATE user_alert_archives
      SET
        alerts_json = ${alertsJson},
        alert_count = ${mergedAlerts.length},
        first_archived_at = ${firstArchivedAt},
        last_archived_at = ${lastArchivedAt},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${existingRow.id}
    `
    return
  }

  await tx.$executeRaw`
    INSERT INTO user_alert_archives (
      public_id,
      user_id,
      archive_month,
      alert_count,
      first_archived_at,
      last_archived_at,
      alerts_json
    )
    VALUES (
      ${createPublicId()},
      ${userId},
      ${archiveMonth},
      ${mergedAlerts.length},
      ${firstArchivedAt},
      ${lastArchivedAt},
      ${alertsJson}
    )
  `
}

export async function createUserAlert({
  userId,
  stationId = null,
  reservationPublicId = null,
  category = "SYSTEM",
  title,
  body,
  metadata = {},
}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error("createUserAlert requires a valid userId")
  }

  const normalizedStationId = Number(stationId || 0)
  const scopedStationId =
    Number.isFinite(normalizedStationId) && normalizedStationId > 0 ? normalizedStationId : null
  const publicId = createPublicId()
  const normalizedCategory = String(category || "SYSTEM").trim().toUpperCase()
  const titleValue = String(title || "").trim() || "Alert"
  const bodyValue = String(body || "").trim() || "You have a new alert."
  const metadataValue = JSON.stringify(metadata || {})

  try {
    await prisma.$executeRaw`
      INSERT INTO user_alerts (
        public_id,
        user_id,
        station_id,
        reservation_public_id,
        category,
        title,
        body,
        status,
        metadata
      )
      VALUES (
        ${publicId},
        ${normalizedUserId},
        ${scopedStationId},
        ${reservationPublicId || null},
        ${normalizedCategory},
        ${titleValue},
        ${bodyValue},
        'UNREAD',
        ${metadataValue}
      )
    `
  } catch (error) {
    if (isUserAlertsReservationPublicIdTooShortError(error)) {
      const wrapped = new Error(
        "User alerts storage is outdated. Run SQL migration 024_expand_user_alerts_reservation_public_id_length.sql."
      )
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }

  const createdRows = await prisma.$queryRaw`
    SELECT
      ua.public_id,
      ua.category,
      ua.title,
      ua.body,
      ua.status,
      ua.metadata,
      ua.created_at,
      ua.read_at,
      ua.reservation_public_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area
    FROM user_alerts ua
    LEFT JOIN stations st ON st.id = ua.station_id
    WHERE ua.public_id = ${publicId}
    LIMIT 1
  `
  return mapUserAlertRow(createdRows?.[0] || {})
}

export async function markUserAlertRead({ userId, alertPublicId }) {
  const normalizedUserId = Number(userId || 0)
  const scopedPublicId = String(alertPublicId || "").trim()
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !scopedPublicId) {
    return null
  }

  await prisma.$executeRaw`
    UPDATE user_alerts
    SET
      status = 'READ',
      read_at = COALESCE(read_at, CURRENT_TIMESTAMP(3)),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE user_id = ${normalizedUserId}
      AND public_id = ${scopedPublicId}
  `

  const rows = await prisma.$queryRaw`
    SELECT
      ua.public_id,
      ua.category,
      ua.title,
      ua.body,
      ua.status,
      ua.metadata,
      ua.created_at,
      ua.read_at,
      ua.reservation_public_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area
    FROM user_alerts ua
    LEFT JOIN stations st ON st.id = ua.station_id
    WHERE ua.user_id = ${normalizedUserId}
      AND ua.public_id = ${scopedPublicId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.public_id) return null
  return mapUserAlertRow(row)
}

export async function archiveUserAlert({ userId, alertPublicId, reason = "USER_ACTION" }) {
  const normalizedUserId = Number(userId || 0)
  const scopedPublicId = String(alertPublicId || "").trim()
  const scopedReason = String(reason || "USER_ACTION").trim().toUpperCase() || "USER_ACTION"

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0 || !scopedPublicId) {
    return null
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT
        ua.id,
        ua.public_id,
        ua.category,
        ua.title,
        ua.body,
        ua.status,
        ua.metadata,
        ua.created_at,
        ua.read_at,
        ua.reservation_public_id,
        st.public_id AS station_public_id,
        st.name AS station_name,
        COALESCE(NULLIF(st.city, ''), NULLIF(st.address, ''), st.name) AS station_area
      FROM user_alerts ua
      LEFT JOIN stations st ON st.id = ua.station_id
      WHERE ua.user_id = ${normalizedUserId}
        AND ua.public_id = ${scopedPublicId}
      LIMIT 1
      FOR UPDATE
    `

    const row = rows?.[0]
    if (!row?.id) return null

    const archivedAt = new Date().toISOString()
    const archivedAlert = normalizeArchivedAlert(buildArchivedAlert(row), {
      archivedAt,
      archivedReason: scopedReason,
    })
    const archiveMonth = toArchiveMonth(archivedAlert.readAt || archivedAlert.createdAt || archivedAt)
    if (!archiveMonth) return null

    await upsertUserAlertArchiveBucket(tx, {
      userId: normalizedUserId,
      archiveMonth,
      alerts: [archivedAlert],
    })

    await tx.$executeRaw`
      DELETE FROM user_alerts
      WHERE user_id = ${normalizedUserId}
        AND public_id = ${scopedPublicId}
      LIMIT 1
    `

    return archivedAlert
  })
}
