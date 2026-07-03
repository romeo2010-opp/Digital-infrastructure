import crypto from "crypto"
import { HttpError } from "../../utils/http.js"

export const TIMETABLE_STATUSES = new Set([
  "SETUP",
  "VALIDATION_REQUIRED",
  "READY",
  "GENERATING",
  "DRAFT",
  "UNDER_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "PUBLISHED",
  "SUPERSEDED",
  "ARCHIVED",
])

export const EDITABLE_VERSION_STATUSES = new Set(["SETUP", "VALIDATION_REQUIRED", "READY", "DRAFT", "CHANGES_REQUESTED"])

export function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

export function idValue(value, label = "id", required = false) {
  const number = Number(value || 0)
  if (Number.isFinite(number) && number > 0) return number
  if (required) throw new HttpError(400, `${label} is required`)
  return null
}

export function enumValue(value, allowed, fallback, label) {
  const normalized = cleanText(value || fallback).toUpperCase()
  if (allowed.includes(normalized)) return normalized
  throw new HttpError(400, `${label} must be one of ${allowed.join(", ")}`)
}

export function dateOnly(value, label, required = false) {
  const text = cleanText(value)
  if (!text) {
    if (required) throw new HttpError(400, `${label} is required`)
    return null
  }
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label} must be a valid date`)
  return text.slice(0, 10)
}

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return fallback
  }
}

export function jsonString(value, fallback = null) {
  return JSON.stringify(value === undefined ? fallback : value)
}

export function sourceHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || {})).digest("hex")
}

export function normalizeTimetable(row) {
  if (!row) return null
  return {
    ...row,
    id: Number(row.id),
    school_id: Number(row.school_id),
    academic_year_id: Number(row.academic_year_id),
    term_id: row.term_id ? Number(row.term_id) : null,
    current_published_version_id: row.current_published_version_id ? Number(row.current_published_version_id) : null,
    created_by: row.created_by ? Number(row.created_by) : null,
    setup_progress: parseJson(row.setup_progress, {}),
  }
}

export function normalizeVersion(row) {
  if (!row) return null
  return {
    ...row,
    id: Number(row.id),
    timetable_id: Number(row.timetable_id),
    version_number: Number(row.version_number || 0),
    parent_version_id: row.parent_version_id ? Number(row.parent_version_id) : null,
    solver_score: row.solver_score === null || row.solver_score === undefined ? null : Number(row.solver_score),
    hard_conflict_count: Number(row.hard_conflict_count || 0),
    soft_penalty_score: Number(row.soft_penalty_score || 0),
    configuration_snapshot: parseJson(row.configuration_snapshot, {}),
    constraint_snapshot: parseJson(row.constraint_snapshot, {}),
    solver_configuration_snapshot: parseJson(row.solver_configuration_snapshot, {}),
  }
}

export function editableVersionOrThrow(version) {
  if (!version) throw new HttpError(404, "Timetable version was not found")
  if (!EDITABLE_VERSION_STATUSES.has(String(version.status || ""))) {
    throw new HttpError(409, "This timetable version is not editable")
  }
}

export function assertVersionBelongsToTimetable(version, timetableId) {
  if (!version || Number(version.timetable_id) !== Number(timetableId)) {
    throw new HttpError(404, "Timetable version was not found")
  }
}
