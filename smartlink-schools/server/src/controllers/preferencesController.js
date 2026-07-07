import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

const BACKGROUND_ASSET_TYPE = "personalization_background"
const MAX_BACKGROUND_BYTES = 700 * 1024
const ALLOWED_BACKGROUND_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])

function parseJson(value, fallback = {}) {
  if (!value) return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return fallback
  }
}

function getUserScope(req) {
  const userId = Number(req.user?.id || 0)
  if (!userId) throw new HttpError(401, "Authentication required")
  return {
    userId,
    schoolId: req.user?.schoolId ? Number(req.user.schoolId) : null,
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key)
}

function safeFileName(value) {
  const name = String(value || "personalized-background").trim()
  return name.replace(/[^\w.\- ]+/g, "").slice(0, 180) || "personalized-background"
}

function parseBackgroundDataUrl(value, fileName) {
  const raw = String(value || "")
  const match = raw.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\r\n]+)$/i)
  if (!match) {
    throw new HttpError(400, "Use a PNG, JPEG, or WebP background image.")
  }

  const mimeType = match[1].toLowerCase()
  if (!ALLOWED_BACKGROUND_TYPES.has(mimeType)) {
    throw new HttpError(400, "Use a PNG, JPEG, or WebP background image.")
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64")
  if (!buffer.length) throw new HttpError(400, "The selected background image is empty.")
  if (buffer.length > MAX_BACKGROUND_BYTES) {
    throw new HttpError(413, "Use a smaller background image. SmartLink stores optimized profile backgrounds under 700KB.")
  }

  return {
    fileName: safeFileName(fileName),
    mimeType,
    buffer,
  }
}

async function readStoredPreferences(userId) {
  const [rows] = await pool.query(
    `SELECT preferences_json
     FROM user_portal_preferences
     WHERE user_id = ?
     LIMIT 1`,
    [userId],
  )
  return parseJson(rows[0]?.preferences_json, {})
}

async function readBackgroundAsset(userId) {
  const [rows] = await pool.query(
    `SELECT file_name, mime_type, asset_data, updated_at
     FROM user_portal_assets
     WHERE user_id = ? AND asset_type = ?
     LIMIT 1`,
    [userId, BACKGROUND_ASSET_TYPE],
  )
  const asset = rows[0]
  if (!asset?.asset_data) return null
  const buffer = Buffer.isBuffer(asset.asset_data) ? asset.asset_data : Buffer.from(asset.asset_data)
  return {
    fileName: asset.file_name,
    mimeType: asset.mime_type,
    dataUrl: `data:${asset.mime_type};base64,${buffer.toString("base64")}`,
    updatedAt: asset.updated_at,
  }
}

function stripBlobPreferences(preferences) {
  const next = { ...(preferences || {}) }
  delete next.dashboardBackgroundImage
  return next
}

async function writePreferences({ userId, schoolId, preferences }) {
  await pool.query(
    `INSERT INTO user_portal_preferences (user_id, school_id, preferences_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       school_id = VALUES(school_id),
       preferences_json = VALUES(preferences_json),
       updated_at = CURRENT_TIMESTAMP`,
    [userId, schoolId, JSON.stringify(preferences || {})],
  )
}

async function writeBackgroundAsset({ userId, schoolId, asset }) {
  await pool.query(
    `INSERT INTO user_portal_assets (user_id, school_id, asset_type, file_name, mime_type, file_size, asset_data)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       school_id = VALUES(school_id),
       file_name = VALUES(file_name),
       mime_type = VALUES(mime_type),
       file_size = VALUES(file_size),
       asset_data = VALUES(asset_data),
       updated_at = CURRENT_TIMESTAMP`,
    [userId, schoolId, BACKGROUND_ASSET_TYPE, asset.fileName, asset.mimeType, asset.buffer.length, asset.buffer],
  )
}

async function deleteBackgroundAsset(userId) {
  await pool.query(
    `DELETE FROM user_portal_assets
     WHERE user_id = ? AND asset_type = ?`,
    [userId, BACKGROUND_ASSET_TYPE],
  )
}

async function buildPreferencesResponse(userId, storedPreferences) {
  const preferences = { ...(storedPreferences || {}) }
  const asset = await readBackgroundAsset(userId)
  if (asset) {
    preferences.dashboardBackgroundImage = asset.dataUrl
    preferences.dashboardBackgroundName = preferences.dashboardBackgroundName || asset.fileName
    preferences.dashboardBackgroundUpdatedAt = asset.updatedAt
    if (!hasOwn(preferences, "dashboardBackgroundEnabled")) {
      preferences.dashboardBackgroundEnabled = true
    }
  } else {
    preferences.dashboardBackgroundImage = ""
  }
  return preferences
}

function numberPreference(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, number))
}

export async function getLoginAppearanceForUser(userId) {
  const preferences = await buildPreferencesResponse(userId, await readStoredPreferences(userId))
  return {
    appearance: ["dark", "black-white"].includes(String(preferences.appearance || "")) ? preferences.appearance : "light",
    dashboardBackgroundEnabled: Boolean(preferences.dashboardBackgroundImage && preferences.dashboardBackgroundEnabled !== false),
    dashboardBackgroundImage: preferences.dashboardBackgroundImage || "",
    dashboardBackgroundName: preferences.dashboardBackgroundName || "",
    dashboardBackgroundMode: String(preferences.dashboardBackgroundMode || "cover"),
    dashboardBackgroundX: numberPreference(preferences.dashboardBackgroundX, 50, 0, 100),
    dashboardBackgroundY: numberPreference(preferences.dashboardBackgroundY, 50, 0, 100),
    dashboardBackgroundScale: numberPreference(preferences.dashboardBackgroundScale, 100, 20, 300),
    dashboardBackgroundDim: numberPreference(preferences.dashboardBackgroundDim, 74, 0, 92),
    transparentSectionsEnabled: Boolean(preferences.transparentSectionsEnabled),
    sectionTransparency: numberPreference(preferences.sectionTransparency, 0, 0, 75),
    sectionBlur: numberPreference(preferences.sectionBlur, 10, 0, 28),
    accentTone: ["smartlink", "navy", "emerald", "graphite", "copper"].includes(String(preferences.accentTone || "")) ? preferences.accentTone : "smartlink",
  }
}

export async function getLoginAppearanceForSchool(schoolId) {
  const id = Number(schoolId || 0)
  if (!id) return null

  const [assetRows] = await pool.query(
    `SELECT a.user_id
     FROM user_portal_assets a
     JOIN users u ON u.id = a.user_id
     WHERE a.school_id = ? AND a.asset_type = ? AND u.is_active = 1
     ORDER BY a.updated_at DESC, a.id DESC
     LIMIT 1`,
    [id, BACKGROUND_ASSET_TYPE],
  )
  const assetOwnerId = Number(assetRows[0]?.user_id || 0)
  if (assetOwnerId) return getLoginAppearanceForUser(assetOwnerId)

  const [preferenceRows] = await pool.query(
    `SELECT p.user_id
     FROM user_portal_preferences p
     JOIN users u ON u.id = p.user_id
     WHERE p.school_id = ? AND u.is_active = 1
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT 1`,
    [id],
  )
  const preferenceOwnerId = Number(preferenceRows[0]?.user_id || 0)
  return preferenceOwnerId ? getLoginAppearanceForUser(preferenceOwnerId) : null
}

export async function getLatestLoginAppearance() {
  const [assetRows] = await pool.query(
    `SELECT a.user_id
     FROM user_portal_assets a
     JOIN users u ON u.id = a.user_id
     WHERE a.asset_type = ? AND u.is_active = 1
     ORDER BY a.updated_at DESC, a.id DESC
     LIMIT 1`,
    [BACKGROUND_ASSET_TYPE],
  )
  const assetOwnerId = Number(assetRows[0]?.user_id || 0)
  if (assetOwnerId) return getLoginAppearanceForUser(assetOwnerId)

  const [preferenceRows] = await pool.query(
    `SELECT p.user_id
     FROM user_portal_preferences p
     JOIN users u ON u.id = p.user_id
     WHERE u.is_active = 1
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT 1`,
  )
  const preferenceOwnerId = Number(preferenceRows[0]?.user_id || 0)
  return preferenceOwnerId ? getLoginAppearanceForUser(preferenceOwnerId) : null
}

export async function getMyPreferences(req, res) {
  const { userId } = getUserScope(req)
  const preferences = await readStoredPreferences(userId)
  res.json(await buildPreferencesResponse(userId, preferences))
}

export async function updateMyPreferences(req, res) {
  const { userId, schoolId } = getUserScope(req)
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new HttpError(400, "Preferences payload must be an object.")
  }

  const current = await readStoredPreferences(userId)
  const patch = { ...req.body }
  const hasBackgroundImage = hasOwn(patch, "dashboardBackgroundImage")

  if (hasBackgroundImage) {
    const imageValue = String(patch.dashboardBackgroundImage || "")
    if (imageValue) {
      const asset = parseBackgroundDataUrl(imageValue, patch.dashboardBackgroundName || current.dashboardBackgroundName)
      try {
        await writeBackgroundAsset({ userId, schoolId, asset })
      } catch (error) {
        if (error?.code === "ER_NET_PACKET_TOO_LARGE") {
          throw new HttpError(413, "The background image is too large for this database. Upload a smaller or simpler image.")
        }
        throw error
      }
      patch.dashboardBackgroundName = patch.dashboardBackgroundName || asset.fileName
    } else {
      await deleteBackgroundAsset(userId)
      patch.dashboardBackgroundName = ""
    }
  }

  const nextPreferences = stripBlobPreferences({ ...current, ...patch })
  await writePreferences({ userId, schoolId, preferences: nextPreferences })

  res.json(await buildPreferencesResponse(userId, nextPreferences))
}
