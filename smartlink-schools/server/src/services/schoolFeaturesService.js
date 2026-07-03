import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

export const SCHOOL_FEATURE_SETTING_KEY = "school_features"

export const DEFAULT_SCHOOL_FEATURES = {
  school_timetables: true,
  exam_timetables: true,
  personal_timetable_views: true,
  student_exam_views: true,
  invigilation_views: true,
  timetable_generation: true,
  timetable_publication: true,
  daily_adjustments: false,
}

const FEATURE_LABELS = {
  school_timetables: "School timetable management",
  exam_timetables: "Exam timetable management",
  personal_timetable_views: "Personal timetable views",
  student_exam_views: "Student examination views",
  invigilation_views: "Invigilation views",
  timetable_generation: "Automatic timetable generation",
  timetable_publication: "Timetable publication",
  daily_adjustments: "Daily adjustments and substitutions",
}

function parseSettingValue(value) {
  if (!value) return {}
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return {}
  }
}

export function normalizeSchoolFeatures(value) {
  const parsed = parseSettingValue(value)
  const source = parsed.features && typeof parsed.features === "object" ? parsed.features : parsed
  return Object.fromEntries(
    Object.entries(DEFAULT_SCHOOL_FEATURES).map(([key, defaultValue]) => [
      key,
      source[key] === undefined ? defaultValue : Boolean(source[key]),
    ]),
  )
}

function safeMissingSettingsTable(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)
}

export async function getSchoolFeatures(connection = pool, schoolId) {
  if (!schoolId) return normalizeSchoolFeatures({})
  try {
    const [[row]] = await connection.query(
      "SELECT setting_value FROM school_settings WHERE school_id = ? AND setting_key = ? LIMIT 1",
      [schoolId, SCHOOL_FEATURE_SETTING_KEY],
    )
    return normalizeSchoolFeatures(row?.setting_value)
  } catch (error) {
    if (safeMissingSettingsTable(error)) return normalizeSchoolFeatures({})
    throw error
  }
}

export async function saveSchoolFeatures(connection = pool, schoolId, value) {
  if (!schoolId) throw new HttpError(400, "School is required")
  const features = normalizeSchoolFeatures(value)
  await connection.query(
    `INSERT INTO school_settings (school_id, setting_key, setting_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [schoolId, SCHOOL_FEATURE_SETTING_KEY, JSON.stringify({ features })],
  )
  return features
}

export function timetableFeatureKey(timetableType) {
  return String(timetableType || "").toUpperCase() === "EXAM_TIMETABLE"
    ? "exam_timetables"
    : "school_timetables"
}

export function featureEnabled(features, key) {
  const normalized = normalizeSchoolFeatures(features)
  return normalized[key] !== false
}

export async function assertSchoolFeatureEnabled(connection = pool, schoolId, key) {
  const features = await getSchoolFeatures(connection, schoolId)
  if (featureEnabled(features, key)) return features
  throw new HttpError(403, `${FEATURE_LABELS[key] || "This school feature"} is disabled in school settings`)
}

export async function enabledTimetableTypes(connection = pool, schoolId) {
  const features = await getSchoolFeatures(connection, schoolId)
  const types = []
  if (featureEnabled(features, "school_timetables")) types.push("SCHOOL_TIMETABLE")
  if (featureEnabled(features, "exam_timetables")) types.push("EXAM_TIMETABLE")
  return types
}
