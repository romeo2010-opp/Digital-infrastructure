import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

export const REPORT_TEMPLATE_SETTING_KEY = "report_pdf_template"

export const REPORT_PDF_TEMPLATES = Object.freeze([
  {
    id: "ria_exact",
    name: "RIA exact header",
    description: "Uses the Reign International Academy header artwork from the reference report.",
  },
  {
    id: "smartlink_word",
    name: "Word-style crest",
    description: "A close Word-export style with a generated school crest and assessment tables.",
  },
  {
    id: "modern_academic",
    name: "Modern academic",
    description: "A cleaner leadership report with a restrained school heading.",
  },
  {
    id: "compact_formal",
    name: "Compact formal",
    description: "A simpler formal report intended for dense printing and school files.",
  },
])

function parseSettingValue(value) {
  if (!value) return {}
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return {}
  }
}

function safeMissingSettingsTable(error) {
  return ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)
}

async function loadSchoolInfo(connection, schoolId) {
  if (!schoolId) return null
  const [[school]] = await connection.query(
    "SELECT id, code AS school_code, school_prefix, name AS school_name FROM schools WHERE id = ? LIMIT 1",
    [schoolId],
  )
  return school || null
}

export function defaultReportPdfTemplate(schoolInfo = {}) {
  const identity = [
    schoolInfo?.school_code,
    schoolInfo?.school_prefix,
    schoolInfo?.school_name,
    schoolInfo?.name,
  ].filter(Boolean).join(" ")
  return /(^|\s)ria(\s|$)|reign/i.test(identity) ? "ria_exact" : "smartlink_word"
}

export function reportPdfTemplatesForSchool(schoolInfo = {}) {
  const allowReignIdentity = defaultReportPdfTemplate(schoolInfo) === "ria_exact"
  return REPORT_PDF_TEMPLATES.filter((template) => allowReignIdentity || template.id !== "ria_exact")
}

export function normalizeReportPdfTemplateId(value, schoolInfo = {}) {
  const candidate = String(value || "").trim()
  const availableTemplateIds = new Set(reportPdfTemplatesForSchool(schoolInfo).map((template) => template.id))
  if (availableTemplateIds.has(candidate)) return candidate
  return defaultReportPdfTemplate(schoolInfo)
}

export async function getReportPdfSettings(connection = pool, schoolId, schoolInfo = null) {
  if (!schoolId) throw new HttpError(400, "School is required")
  const school = schoolInfo || await loadSchoolInfo(connection, schoolId)
  try {
    const [[row]] = await connection.query(
      "SELECT setting_value FROM school_settings WHERE school_id = ? AND setting_key = ? LIMIT 1",
      [schoolId, REPORT_TEMPLATE_SETTING_KEY],
    )
    const parsed = parseSettingValue(row?.setting_value)
    const selectedTemplate = normalizeReportPdfTemplateId(parsed.report_pdf_template || parsed.selected_template || parsed.template, school)
    return { selected_template: selectedTemplate, templates: reportPdfTemplatesForSchool(school) }
  } catch (error) {
    if (safeMissingSettingsTable(error)) {
      return { selected_template: defaultReportPdfTemplate(school), templates: reportPdfTemplatesForSchool(school) }
    }
    throw error
  }
}

export async function getReportPdfTemplateForSchool(connection = pool, schoolId, schoolInfo = null) {
  const settings = await getReportPdfSettings(connection, schoolId, schoolInfo)
  return settings.selected_template
}

export async function saveReportPdfSettings(connection = pool, schoolId, value, schoolInfo = null) {
  if (!schoolId) throw new HttpError(400, "School is required")
  const school = schoolInfo || await loadSchoolInfo(connection, schoolId)
  const selectedTemplate = normalizeReportPdfTemplateId(
    value?.report_pdf_template || value?.selected_template || value?.template,
    school,
  )
  await connection.query(
    `INSERT INTO school_settings (school_id, setting_key, setting_value)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [schoolId, REPORT_TEMPLATE_SETTING_KEY, JSON.stringify({ report_pdf_template: selectedTemplate })],
  )
  return { selected_template: selectedTemplate, templates: reportPdfTemplatesForSchool(school) }
}
