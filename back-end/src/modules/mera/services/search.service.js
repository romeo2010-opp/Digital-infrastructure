import { Prisma } from "@prisma/client"
import { prisma } from "../../../db/prisma.js"
import { badRequest, notFound } from "../../../utils/http.js"
import { hasMeraPermission, MERA_PERMISSIONS } from "../permissions.js"
import { logMeraAudit } from "./audit.service.js"
import { getTask } from "./task.service.js"

const QUICK_GROUP_LIMIT = 5
const RESULT_GROUPS = [
  ["navigation", "Navigation"],
  ["locations", "Districts / Regions"],
  ["licences", "Licences"],
  ["stations", "Stations"],
  ["stationManagers", "Station Managers"],
  ["cases", "Regulatory Cases"],
  ["complaints", "Complaints"],
  ["tasks", "Tasks / Assignments"],
  ["users", "Users / Officers"],
  ["reports", "Reports / Documents"],
]

const closedTaskStatuses = new Set(["COMPLETED", "CANCELLED", "REJECTED"])
const malawiRegions = {
  "Northern Region": ["Chitipa", "Karonga", "Likoma", "Mzimba", "Nkhata Bay", "Rumphi"],
  "Central Region": ["Dedza", "Dowa", "Kasungu", "Lilongwe", "Mchinji", "Nkhotakota", "Ntcheu", "Ntchisi", "Salima"],
  "Southern Region": ["Balaka", "Blantyre", "Chikwawa", "Chiradzulu", "Machinga", "Mangochi", "Mulanje", "Mwanza", "Neno", "Nsanje", "Phalombe", "Thyolo", "Zomba"],
}

const navigationEntries = [
  {
    id: "nav-dashboard",
    title: "Dashboard",
    subtitle: "Open MERA national operations dashboard",
    route: "/dashboard",
    permissions: [MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL, MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT],
    keywords: ["dashboard", "national operations", "home", "overview", "command"],
  },
  {
    id: "nav-task-operations",
    title: "Task Operations",
    subtitle: "Open regulatory task assignment tracking",
    route: "/tasks",
    permissions: [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE],
    keywords: ["task", "tasks", "assignment", "assignments", "operations", "work queue", "dispatch"],
  },
  {
    id: "nav-my-tasks",
    title: "My Tasks",
    subtitle: "Open your assigned MERA work queue",
    route: "/tasks/my",
    permissions: [MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_WORK],
    keywords: ["my tasks", "assigned to me", "my assignments", "work queue"],
  },
  {
    id: "nav-cases",
    title: "Cases",
    subtitle: "Open compliance flags and enforcement cases",
    route: "/compliance-flags",
    permissions: [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.ENFORCEMENT_VIEW],
    keywords: ["case", "cases", "regulatory cases", "compliance case", "investigation", "review"],
  },
  {
    id: "nav-complaints",
    title: "Complaints",
    subtitle: "Open complaint casework centre",
    route: "/complaints-center",
    permissions: [MERA_PERMISSIONS.COMPLAINTS_VIEW],
    keywords: ["complaint", "complaints", "citizen complaint", "public complaint", "casework"],
  },
  {
    id: "nav-stations",
    title: "Station Registry",
    subtitle: "Open station management and regulatory profiles",
    route: "/station-regulatory-profiles",
    permissions: [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT],
    keywords: ["station", "stations", "registry", "station registry", "station profiles", "profile", "dossier"],
  },
  {
    id: "nav-station-managers",
    title: "Station Managers",
    subtitle: "Find station managers, owners, and managed stations",
    route: "/search?type=stationManagers&q=manager",
    permissions: [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT],
    keywords: ["manager", "managers", "station manager", "owner", "owners", "operator", "operators"],
  },
  {
    id: "nav-licences",
    title: "Licence Registry",
    subtitle: "Open station licence and compliance condition register",
    route: "/license-registry",
    permissions: [MERA_PERMISSIONS.LICENSES_VIEW],
    keywords: ["licence", "license", "licensing", "permit", "registration", "retail fuel licence", "retail fuel license", "station licence", "station license"],
  },
  {
    id: "nav-compliance",
    title: "Compliance",
    subtitle: "Open compliance flags and evidence chain",
    route: "/compliance-flags",
    permissions: [MERA_PERMISSIONS.FLAGS_VIEW],
    keywords: ["compliance", "flags", "violation", "violations", "risk", "evidence"],
  },
  {
    id: "nav-price-compliance",
    title: "Price Compliance",
    subtitle: "Open price and market compliance intelligence",
    route: "/reports-intelligence",
    permissions: [MERA_PERMISSIONS.REPORTS_VIEW],
    keywords: ["price", "pricing", "overpricing", "price compliance", "price violation", "market price"],
  },
  {
    id: "nav-hoarding",
    title: "Hoarding Investigations",
    subtitle: "Open hoarding risk watchlist",
    route: "/hoarding-watchlist",
    permissions: [MERA_PERMISSIONS.FLAGS_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT],
    keywords: ["hoarding", "hoarding investigation", "shortage", "dry station", "refusal to sell"],
  },
  {
    id: "nav-reports",
    title: "Reports",
    subtitle: "Open reports, intelligence, and exports",
    route: "/reports-intelligence",
    permissions: [MERA_PERMISSIONS.REPORTS_VIEW],
    keywords: ["report", "reports", "documents", "intelligence", "analytics", "exports", "monthly report"],
  },
  {
    id: "nav-users",
    title: "Users",
    subtitle: "Open MERA officer administration",
    route: "/user-administration",
    permissions: [MERA_PERMISSIONS.USERS_VIEW],
    keywords: ["users", "officers", "user administration", "roles", "access"],
  },
  {
    id: "nav-settings",
    title: "Settings",
    subtitle: "Open MERA workspace preferences and security settings",
    route: "/settings/preferences",
    permissions: [],
    keywords: ["settings", "preferences", "security", "notifications", "account"],
  },
]

function forbidden(message = "Forbidden") {
  const error = new Error(message)
  error.status = 403
  return error
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number.parseInt(value, 10) || min, min), max)
}

function normalizeOptionalString(value) {
  const scoped = String(value || "").trim()
  return scoped || null
}

export function normalizeSearchQuery(value, { allowEmpty = false } = {}) {
  const query = String(value || "").trim().replace(/\s+/g, " ").slice(0, 100)
  if (!query && !allowEmpty) throw badRequest("Search query is required")
  return query
}

function lower(value) {
  return String(value || "").trim().toLowerCase()
}

function normalizeLicenceSpelling(value) {
  return lower(value)
    .replace(/\blicensing\b/g, "license")
    .replace(/\blicences\b/g, "licenses")
    .replace(/\blicence\b/g, "license")
}

function normalizeLoose(value) {
  return normalizeLicenceSpelling(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function searchTokens(value) {
  return normalizeLoose(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

export function expandSearchTerms(value) {
  const query = normalizeSearchQuery(value)
  const terms = new Set([lower(query), normalizeLicenceSpelling(query)])
  const normal = normalizeLicenceSpelling(query)
  if (normal.includes("license")) {
    terms.add(normal.replace(/\blicense\b/g, "licence"))
    terms.add(normal.replace(/\blicenses\b/g, "licences"))
    terms.add("permit")
  }
  return [...terms].filter(Boolean)
}

function isIntent(query, words) {
  const normalized = normalizeLicenceSpelling(query)
  return words.some((word) => normalized.includes(word))
}

function escapeLike(value) {
  return String(value || "").replace(/[\\%_]/g, "\\$&")
}

function likePatterns(query) {
  const phrasePatterns = expandSearchTerms(query).map((term) => `%${escapeLike(term)}%`)
  const tokenPatterns = [...new Set(searchTokens(query))]
    .slice(0, 8)
    .map((token) => `%${escapeLike(token)}%`)
  return { phrasePatterns, tokenPatterns }
}

function likeCondition(columns, searchPatterns) {
  const patterns = Array.isArray(searchPatterns) ? searchPatterns : searchPatterns?.phrasePatterns || []
  const tokenPatterns = Array.isArray(searchPatterns) ? [] : searchPatterns?.tokenPatterns || []
  const clauses = []
  for (const column of columns) {
    for (const pattern of patterns) {
      clauses.push(Prisma.sql`LOWER(COALESCE(${Prisma.raw(column)}, '')) LIKE ${pattern}`)
    }
  }
  if (tokenPatterns.length > 1) {
    const searchableText = Prisma.sql`LOWER(CONCAT_WS(' ', ${Prisma.join(columns.map((column) => Prisma.sql`COALESCE(${Prisma.raw(column)}, '')`))}))`
    clauses.push(Prisma.sql`(${Prisma.join(tokenPatterns.map((pattern) => Prisma.sql`${searchableText} LIKE ${pattern}`), " AND ")})`)
  }
  return clauses.length ? Prisma.sql`(${Prisma.join(clauses, " OR ")})` : Prisma.sql`FALSE`
}

function hasAnyPermission(auth, permissions = []) {
  if (!permissions?.length) return true
  return permissions.some((permission) => hasMeraPermission(auth, permission))
}

function districtScope(auth) {
  return String(auth?.districtScope || "").trim()
}

function ensurePermission(auth, permissions, message = "Forbidden") {
  if (!hasAnyPermission(auth, permissions)) throw forbidden(message)
}

function ensureDistrictAccess(auth, district, label = "record") {
  const scopedDistrict = districtScope(auth)
  if (!scopedDistrict) return
  if (lower(scopedDistrict) !== lower(district)) throw forbidden(`You do not have access to this ${label}`)
}

function canViewAllTaskRecords(auth) {
  return hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_ASSIGN])
}

function canViewTaskRecord(auth, task = {}) {
  if (canViewAllTaskRecords(auth)) return true
  if (Number(task.assigned_to_user_id || 0) === Number(auth?.userId || 0)) return true
  if (
    hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE]) &&
    (["HIGH", "CRITICAL"].includes(String(task.priority || "").toUpperCase()) || String(task.status || "").toUpperCase() === "COMPLETED")
  ) {
    return true
  }
  return false
}

function taskEvidenceRoute(id) {
  return id ? `/documents/task-evidence/${id}` : null
}

function complaintMediaRoute(publicId) {
  return publicId ? `/documents/complaint-media/${publicId}` : null
}

function mapComplaintMediaDocument(row) {
  if (!row?.media_url) return null
  return {
    id: row.public_id,
    document_type: "COMPLAINT_MEDIA",
    evidence_type: "COMPLAINT_MEDIA",
    title: `Complaint media ${row.public_id}`,
    description: row.complaint_description || null,
    file_url: row.media_url,
    complaint_public_id: row.public_id,
    station_public_id: row.station_public_id || null,
    station_name: row.station_name || null,
    uploaded_by_name: row.complainant_name || "Public complainant",
    created_at: row.created_at,
    document_route: complaintMediaRoute(row.public_id),
  }
}

function withDocumentRoute(row) {
  if (!row) return row
  if (row.document_route) return row
  if (row.document_type === "COMPLAINT_MEDIA" || row.complaint_public_id) {
    return { ...row, document_route: complaintMediaRoute(row.complaint_public_id || row.public_id || row.id) }
  }
  return { ...row, document_route: taskEvidenceRoute(row.id) }
}

function regionForDistrict(district) {
  const normalizedDistrict = lower(district)
  if (!normalizedDistrict) return null
  for (const [region, districts] of Object.entries(malawiRegions)) {
    if (districts.some((item) => lower(item) === normalizedDistrict)) return region
  }
  return null
}

function regionAliases(region) {
  const name = String(region || "").trim()
  const stem = name.replace(/\s+Region$/i, "")
  return [name, stem, `${stem} region`, `${stem} regional`].filter(Boolean)
}

export function scoreSearchFields(query, fields = {}) {
  const normalizedQuery = normalizeLicenceSpelling(query)
  const looseQuery = normalizeLoose(query)
  const queryTokens = searchTokens(query)
  const exactIds = Object.entries(fields.exact || {})
  const names = Object.entries(fields.names || {})
  const related = Object.entries(fields.related || {})
  const allFields = [...exactIds, ...names, ...related]
  const isLooseEqual = (value) => looseQuery && normalizeLoose(value) === looseQuery
  const looseStartsWith = (value) => looseQuery && normalizeLoose(value).startsWith(looseQuery)
  const looseContains = (value) => {
    const looseValue = normalizeLoose(value)
    return looseQuery && (looseValue.includes(looseQuery) || (queryTokens.length > 1 && queryTokens.every((token) => looseValue.includes(token))))
  }

  for (const [field, value] of exactIds) {
    if (normalizeLicenceSpelling(value) === normalizedQuery) return { score: 100, matchedField: field }
  }
  for (const [field, value] of names) {
    if (normalizeLicenceSpelling(value) === normalizedQuery || isLooseEqual(value)) return { score: 94, matchedField: field }
  }
  for (const [field, value] of [...exactIds, ...names]) {
    if (normalizeLicenceSpelling(value).startsWith(normalizedQuery) || looseStartsWith(value)) return { score: 86, matchedField: field }
  }
  for (const [field, value] of [...exactIds, ...names]) {
    if (normalizeLicenceSpelling(value).includes(normalizedQuery) || looseContains(value)) return { score: 74, matchedField: field }
  }
  for (const [field, value] of related) {
    if (normalizeLicenceSpelling(value).startsWith(normalizedQuery) || looseStartsWith(value)) return { score: 62, matchedField: field }
  }
  for (const [field, value] of related) {
    if (normalizeLicenceSpelling(value).includes(normalizedQuery) || looseContains(value)) return { score: 52, matchedField: field }
  }
  const synonymHit = allFields.find(([, value]) => expandSearchTerms(query).some((term) => normalizeLicenceSpelling(value).includes(normalizeLicenceSpelling(term)) || normalizeLoose(value).includes(normalizeLoose(term))))
  if (synonymHit) return { score: 50, matchedField: synonymHit[0] }
  return { score: 0, matchedField: null }
}

function sortAndLimit(results, limit) {
  return results
    .filter(Boolean)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(a.title || "").localeCompare(String(b.title || "")))
    .slice(0, limit)
}

function groupResults(groups) {
  return RESULT_GROUPS.map(([type, label]) => ({
    type,
    label,
    results: groups[type] || [],
  })).filter((group) => group.results.length > 0)
}

function resultBase(extra) {
  return {
    score: 1,
    status: null,
    district: null,
    station: null,
    matchedField: null,
    ...extra,
  }
}

function scoreResult(query, result, fields, baseScore = 0) {
  const match = scoreSearchFields(query, fields)
  return {
    ...result,
    score: Math.max(baseScore, match.score),
    matchedField: result.matchedField || match.matchedField,
  }
}

export function navigationResults(query, auth, limit = QUICK_GROUP_LIMIT) {
  const terms = expandSearchTerms(query)
  const results = []
  for (const entry of navigationEntries) {
    if (!hasAnyPermission(auth, entry.permissions)) continue
    const haystack = [entry.title, entry.subtitle, ...(entry.keywords || [])].join(" ")
    const match = scoreSearchFields(query, {
      names: { title: entry.title },
      related: { keywords: haystack },
    })
    const phraseHit = terms.some((term) => normalizeLicenceSpelling(haystack).includes(normalizeLicenceSpelling(term)))
    if (!phraseHit && match.score <= 0) continue
    results.push(
      resultBase({
        id: entry.id,
        title: entry.title,
        subtitle: entry.subtitle,
        resultType: "NAVIGATION",
        route: entry.route,
        score: Math.max(match.score, 58),
        matchedField: match.matchedField || "navigation",
      })
    )
  }
  return sortAndLimit(results, limit)
}

async function searchLocations(query, auth, { limit, filters = {} }) {
  if (!hasAnyPermission(auth, [
    MERA_PERMISSIONS.STATIONS_VIEW,
    MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT,
    MERA_PERMISSIONS.DASHBOARD_VIEW_NATIONAL,
    MERA_PERMISSIONS.DASHBOARD_VIEW_DISTRICT,
    MERA_PERMISSIONS.REPORTS_VIEW,
  ])) return []

  const patterns = likePatterns(query)
  const scopedDistrict = districtScope(auth)
  const district = normalizeOptionalString(filters.district)
  const intent = isIntent(query, ["district", "districts", "region", "regional", "north", "northern", "central", "south", "southern"])
  const condition = likeCondition(["s.city"], patterns)
  const rows = await prisma.$queryRaw`
    SELECT
      s.city AS district,
      COUNT(DISTINCT s.id) AS station_count,
      COUNT(DISTINCT fsl.id) AS licence_count,
      SUM(CASE WHEN s.is_active = 1 THEN 1 ELSE 0 END) AS active_station_count
    FROM stations s
    LEFT JOIN fuel_station_licenses fsl ON fsl.station_id = s.id
    WHERE s.city IS NOT NULL
      AND TRIM(s.city) <> ''
      AND (${intent} = TRUE OR ${condition})
      AND (${district === null} = TRUE OR s.city = ${district})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY s.city
    ORDER BY s.city ASC
    LIMIT ${Math.max(limit * 4, 20)}
  `

  const districtResults = (rows || []).map((row) => {
    const region = regionForDistrict(row.district)
    return scoreResult(
      query,
      resultBase({
        id: `district-${row.district}`,
        title: row.district,
        subtitle: `District · ${Number(row.station_count || 0)} station${Number(row.station_count || 0) === 1 ? "" : "s"} · ${Number(row.licence_count || 0)} licence${Number(row.licence_count || 0) === 1 ? "" : "s"}${region ? ` · ${region}` : ""}`,
        resultType: "DISTRICT",
        route: `/search?q=${encodeURIComponent(row.district)}&district=${encodeURIComponent(row.district)}`,
        status: Number(row.active_station_count || 0) > 0 ? "ACTIVE" : null,
        district: row.district,
        region,
      }),
      {
        names: { district: row.district },
        related: { region },
      },
      intent ? 57 : 0
    )
  })

  const regionMap = new Map()
  for (const row of rows || []) {
    const region = regionForDistrict(row.district)
    if (!region) continue
    const current = regionMap.get(region) || { stationCount: 0, licenceCount: 0, districts: [] }
    current.stationCount += Number(row.station_count || 0)
    current.licenceCount += Number(row.licence_count || 0)
    current.districts.push(row.district)
    regionMap.set(region, current)
  }

  const regionResults = [...regionMap.entries()]
    .map(([region, value]) => {
      const match = scoreSearchFields(query, {
        names: { region },
        related: { aliases: regionAliases(region).join(" "), districts: value.districts.join(" ") },
      })
      const phraseHit = regionAliases(region).some((alias) => normalizeLicenceSpelling(alias).includes(normalizeLicenceSpelling(query)) || normalizeLicenceSpelling(query).includes(normalizeLicenceSpelling(alias)))
      if (!intent && !phraseHit && match.score <= 0) return null
      return resultBase({
        id: `region-${region}`,
        title: region,
        subtitle: `Region · ${value.districts.length} district${value.districts.length === 1 ? "" : "s"} · ${value.stationCount} station${value.stationCount === 1 ? "" : "s"}`,
        resultType: "REGION",
        route: `/search?q=${encodeURIComponent(regionAliases(region)[1] || region)}`,
        status: "REGIONAL",
        region,
        score: Math.max(match.score, intent ? 57 : 0),
        matchedField: match.matchedField || "region",
      })
    })
    .filter(Boolean)

  return sortAndLimit([...districtResults, ...regionResults], limit)
}

async function searchLicences(query, auth, { limit, filters = {} }) {
  if (!hasAnyPermission(auth, [MERA_PERMISSIONS.LICENSES_VIEW])) return []
  const patterns = likePatterns(query)
  const scopedDistrict = districtScope(auth)
  const status = normalizeOptionalString(filters.status)?.toUpperCase() || ""
  const district = normalizeOptionalString(filters.district)
  const intent = isIntent(query, ["license", "licence", "permit", "registration"])
  const condition = likeCondition([
    "fsl.license_number",
    "fsl.license_status",
    "fsl.compliance_conditions",
    "s.name",
    "s.operator_name",
    "s.city",
    "s.address",
  ], patterns)
  const rows = await prisma.$queryRaw`
    SELECT
      fsl.id,
      fsl.license_number,
      CAST(fsl.issue_date AS CHAR) AS issue_date,
      CAST(fsl.expiry_date AS CHAR) AS expiry_date,
      fsl.license_status,
      NULLIF(CAST(fsl.updated_at AS CHAR), '0000-00-00 00:00:00.000') AS updated_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.operator_name,
      s.city,
      s.address
    FROM fuel_station_licenses fsl
    INNER JOIN stations s ON s.id = fsl.station_id
    WHERE (${intent} = TRUE OR ${condition})
      AND (${status === ""} = TRUE OR fsl.license_status = ${status})
      AND (${district === null} = TRUE OR s.city = ${district})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY fsl.expiry_date ASC, s.name ASC
    LIMIT ${limit}
  `
  return sortAndLimit((rows || []).map((row) =>
    scoreResult(
      query,
      resultBase({
        id: String(row.id),
        title: `${row.license_number} - ${row.station_name}`,
        subtitle: `Fuel service licence · ${row.license_status} · ${row.city || "Unknown district"}`,
        resultType: "LICENCE",
        route: `/licences/${row.id}`,
        status: row.license_status,
        district: row.city || null,
        station: row.station_name || null,
        createdAt: row.issue_date,
        updatedAt: row.updated_at,
      }),
      {
        exact: { licenseNumber: row.license_number, id: row.id },
        names: { stationName: row.station_name },
        related: {
          operatorName: row.operator_name,
          district: row.city,
          address: row.address,
          status: row.license_status,
        },
      },
      intent ? 65 : 0
    )
  ), limit)
}

async function searchStations(query, auth, { limit, filters = {} }) {
  if (!hasAnyPermission(auth, [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT])) return []
  const patterns = likePatterns(query)
  const scopedDistrict = districtScope(auth)
  const district = normalizeOptionalString(filters.district)
  const intent = isIntent(query, ["station", "registry", "profile"])
  const condition = likeCondition([
    "s.public_id",
    "s.name",
    "s.operator_name",
    "s.city",
    "s.address",
    "latest_license.license_number",
    "latest_license.license_status",
  ], patterns)
  const rows = await prisma.$queryRaw`
    SELECT
      s.id,
      s.public_id,
      s.name,
      s.operator_name,
      s.city,
      s.address,
      s.is_active,
      NULLIF(CAST(s.updated_at AS CHAR), '0000-00-00 00:00:00.000') AS updated_at,
      latest_license.license_number,
      latest_license.license_status
    FROM stations s
    LEFT JOIN fuel_station_licenses latest_license ON latest_license.id = (
      SELECT inner_license.id
      FROM fuel_station_licenses inner_license
      WHERE inner_license.station_id = s.id
      ORDER BY inner_license.expiry_date DESC, inner_license.id DESC
      LIMIT 1
    )
    WHERE (${intent} = TRUE OR ${condition})
      AND (${district === null} = TRUE OR s.city = ${district})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY s.name ASC
    LIMIT ${limit}
  `
  return sortAndLimit((rows || []).map((row) =>
    scoreResult(
      query,
      resultBase({
        id: row.public_id,
        title: row.name,
        subtitle: `${row.operator_name || "Station operator"} · ${row.city || "Unknown district"}${row.license_number ? ` · ${row.license_number}` : ""}`,
        resultType: "STATION",
        route: `/stations/${row.public_id}`,
        status: Number(row.is_active) === 1 ? "ACTIVE" : "INACTIVE",
        district: row.city || null,
        station: row.name || null,
        updatedAt: row.updated_at,
      }),
      {
        exact: { publicId: row.public_id, licenseNumber: row.license_number },
        names: { stationName: row.name },
        related: { operatorName: row.operator_name, district: row.city, address: row.address, licenseStatus: row.license_status },
      },
      intent ? 60 : 0
    )
  ), limit)
}

async function searchStationManagers(query, auth, { limit, filters = {} }) {
  if (!hasAnyPermission(auth, [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT])) return []
  const patterns = likePatterns(query)
  const scopedDistrict = districtScope(auth)
  const district = normalizeOptionalString(filters.district)
  const intent = isIntent(query, ["manager", "owner", "operator"])
  const condition = likeCondition([
    "u.public_id",
    "u.full_name",
    "u.email",
    "u.phone_e164",
    "s.name",
    "s.operator_name",
    "s.city",
  ], patterns)
  const rows = await prisma.$queryRaw`
    SELECT
      u.id,
      u.public_id,
      u.full_name,
      u.email,
      u.phone_e164,
      u.is_active,
      COUNT(DISTINCT s.id) AS station_count,
      MIN(s.city) AS primary_district,
      GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') AS station_names,
      GROUP_CONCAT(DISTINCT s.city ORDER BY s.city SEPARATOR ', ') AS districts,
      NULLIF(CAST(MAX(ss.updated_at) AS CHAR), '0000-00-00 00:00:00.000') AS updated_at
    FROM users u
    INNER JOIN station_staff ss ON ss.user_id = u.id AND ss.is_active = 1
    INNER JOIN staff_roles sr ON sr.id = ss.role_id AND sr.code = 'MANAGER'
    INNER JOIN stations s ON s.id = ss.station_id
    WHERE (${intent} = TRUE OR ${condition})
      AND (${district === null} = TRUE OR s.city = ${district})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    GROUP BY u.id, u.public_id, u.full_name, u.email, u.phone_e164, u.is_active
    ORDER BY u.full_name ASC, u.public_id ASC
    LIMIT ${limit}
  `
  return sortAndLimit((rows || []).map((row) =>
    scoreResult(
      query,
      resultBase({
        id: row.public_id,
        title: row.full_name || row.email || row.phone_e164 || row.public_id,
        subtitle: `Station manager · ${Number(row.station_count || 0)} station${Number(row.station_count || 0) === 1 ? "" : "s"} · ${row.districts || "No district"}`,
        resultType: "STATION_MANAGER",
        route: `/station-managers/${row.public_id}`,
        status: Number(row.is_active) === 1 ? "ACTIVE" : "INACTIVE",
        district: row.primary_district || null,
        station: row.station_names || null,
        updatedAt: row.updated_at,
      }),
      {
        exact: { publicId: row.public_id, email: row.email, phone: row.phone_e164 },
        names: { fullName: row.full_name },
        related: { stations: row.station_names, districts: row.districts },
      },
      intent ? 68 : 0
    )
  ), limit)
}

async function searchCases(query, auth, { limit, filters = {} }) {
  const results = []
  const patterns = likePatterns(query)
  const scopedDistrict = districtScope(auth)
  const district = normalizeOptionalString(filters.district)
  const status = normalizeOptionalString(filters.status)?.toUpperCase() || ""
  const intent = isIntent(query, ["case", "compliance", "flag", "hoarding", "price", "violation", "enforcement"])

  if (hasAnyPermission(auth, [MERA_PERMISSIONS.FLAGS_VIEW])) {
    const condition = likeCondition(["cf.public_id", "cf.flag_type", "cf.severity", "cf.generated_reason", "cf.source_reference", "cf.resolved_status", "s.name", "s.city"], patterns)
    const rows = await prisma.$queryRaw`
      SELECT
        cf.public_id,
        cf.flag_type,
        cf.severity,
        cf.generated_reason,
        cf.source_reference,
        cf.resolved_status,
        NULLIF(CAST(cf.created_at AS CHAR), '0000-00-00 00:00:00.000') AS created_at,
        s.public_id AS station_public_id,
        s.name AS station_name,
        s.city
      FROM compliance_flags cf
      INNER JOIN stations s ON s.id = cf.station_id
      WHERE (${intent} = TRUE OR ${condition})
        AND (${status === ""} = TRUE OR cf.resolved_status = ${status} OR cf.severity = ${status})
        AND (${district === null} = TRUE OR s.city = ${district})
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      ORDER BY cf.created_at DESC
      LIMIT ${limit}
    `
    results.push(...(rows || []).map((row) =>
      scoreResult(
        query,
        resultBase({
          id: `flag-${row.public_id}`,
          title: `${row.public_id} - ${String(row.flag_type || "").replaceAll("_", " ")}`,
          subtitle: `Station: ${row.station_name} · Severity: ${row.severity}`,
          resultType: "CASE",
          entitySubtype: "COMPLIANCE_FLAG",
          route: `/cases/flag-${row.public_id}`,
          status: row.resolved_status,
          district: row.city || null,
          station: row.station_name || null,
          createdAt: row.created_at,
        }),
        {
          exact: { caseNumber: row.public_id },
          names: { title: row.flag_type },
          related: { reason: row.generated_reason, source: row.source_reference, station: row.station_name, district: row.city, severity: row.severity },
        },
        intent ? 55 : 0
      )
    ))
  }

  if (hasAnyPermission(auth, [MERA_PERMISSIONS.ENFORCEMENT_VIEW])) {
    const condition = likeCondition(["ea.public_id", "ea.action_type", "ea.action_notes", "ea.action_status", "s.name", "s.city", "mu.full_name"], patterns)
    const rows = await prisma.$queryRaw`
      SELECT
        ea.public_id,
        ea.action_type,
        ea.action_notes,
        ea.action_status,
        NULLIF(CAST(ea.issued_at AS CHAR), '0000-00-00 00:00:00.000') AS issued_at,
        s.public_id AS station_public_id,
        s.name AS station_name,
        s.city,
        mu.full_name AS actor_name
      FROM enforcement_actions ea
      INNER JOIN stations s ON s.id = ea.station_id
      INNER JOIN mera_users mu ON mu.id = ea.initiated_by
      WHERE (${intent} = TRUE OR ${condition})
        AND (${status === ""} = TRUE OR ea.action_status = ${status} OR ea.action_type = ${status})
        AND (${district === null} = TRUE OR s.city = ${district})
        AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
      ORDER BY ea.issued_at DESC
      LIMIT ${limit}
    `
    results.push(...(rows || []).map((row) =>
      scoreResult(
        query,
        resultBase({
          id: `enforcement-${row.public_id}`,
          title: `${row.public_id} - ${String(row.action_type || "").replaceAll("_", " ")}`,
          subtitle: `Station: ${row.station_name} · Status: ${row.action_status}`,
          resultType: "CASE",
          entitySubtype: "ENFORCEMENT_ACTION",
          route: `/cases/enforcement-${row.public_id}`,
          status: row.action_status,
          district: row.city || null,
          station: row.station_name || null,
          createdAt: row.issued_at,
        }),
        {
          exact: { caseNumber: row.public_id },
          names: { title: row.action_type },
          related: { notes: row.action_notes, station: row.station_name, district: row.city, actor: row.actor_name },
        },
        intent ? 55 : 0
      )
    ))
  }

  return sortAndLimit(results, limit)
}

async function searchComplaints(query, auth, { limit, filters = {} }) {
  if (!hasAnyPermission(auth, [MERA_PERMISSIONS.COMPLAINTS_VIEW])) return []
  const patterns = likePatterns(query)
  const scopedDistrict = districtScope(auth)
  const district = normalizeOptionalString(filters.district)
  const status = normalizeOptionalString(filters.status)?.toUpperCase() || ""
  const intent = isIntent(query, ["complaint", "hoarding", "price", "overpricing", "refusal"])
  const condition = likeCondition(["pc.public_id", "pc.complaint_type", "pc.complaint_status", "pc.complaint_description", "s.name", "s.city"], patterns)
  const rows = await prisma.$queryRaw`
    SELECT
      pc.public_id,
      pc.complaint_type,
      pc.complaint_status,
      pc.complaint_description,
      NULLIF(CAST(pc.created_at AS CHAR), '0000-00-00 00:00:00.000') AS created_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    WHERE (${intent} = TRUE OR ${condition})
      AND (${status === ""} = TRUE OR pc.complaint_status = ${status} OR pc.complaint_type = ${status})
      AND (${district === null} = TRUE OR s.city = ${district})
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY pc.created_at DESC
    LIMIT ${limit}
  `
  return sortAndLimit((rows || []).map((row) =>
    scoreResult(
      query,
      resultBase({
        id: row.public_id,
        title: `${row.public_id} - ${String(row.complaint_type || "").replaceAll("_", " ")}`,
        subtitle: `Station: ${row.station_name} · Status: ${row.complaint_status}`,
        resultType: "COMPLAINT",
        route: `/complaints/${row.public_id}`,
        status: row.complaint_status,
        district: row.city || null,
        station: row.station_name || null,
        createdAt: row.created_at,
      }),
      {
        exact: { complaintNumber: row.public_id },
        names: { category: row.complaint_type },
        related: { description: row.complaint_description, station: row.station_name, district: row.city, status: row.complaint_status },
      },
      intent ? 55 : 0
    )
  ), limit)
}

async function searchTasks(query, auth, { limit, filters = {} }) {
  if (!hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE, MERA_PERMISSIONS.TASKS_WORK])) return []
  const patterns = likePatterns(query)
  const scopedDistrict = districtScope(auth)
  const district = normalizeOptionalString(filters.district)
  const status = normalizeOptionalString(filters.status)?.toUpperCase() || ""
  const viewAll = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_ASSIGN])
  const assignedView = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_WORK])
  const executiveView = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE])
  const intent = isIntent(query, ["task", "assignment", "inspect", "inspection", "hoarding", "price"])
  const condition = likeCondition(["rt.task_number", "rt.title", "rt.description", "rt.type", "rt.category", "rt.priority", "rt.status", "rt.district", "rt.station_name", "s.name", "assigned_to.full_name"], patterns)
  const rows = await prisma.$queryRaw`
    SELECT
      rt.task_number,
      rt.title,
      rt.type,
      rt.priority,
      rt.status,
      rt.district,
      rt.station_name,
      NULLIF(CAST(rt.due_at AS CHAR), '0000-00-00 00:00:00.000') AS due_at,
      NULLIF(CAST(rt.created_at AS CHAR), '0000-00-00 00:00:00.000') AS created_at,
      s.public_id AS station_public_id,
      COALESCE(rt.station_name, s.name) AS resolved_station_name,
      assigned_to.full_name AS assigned_to_name
    FROM regulator_tasks rt
    LEFT JOIN stations s ON s.id = rt.station_id
    INNER JOIN mera_users assigned_to ON assigned_to.id = rt.assigned_to_user_id
    WHERE rt.deleted_at IS NULL
      AND (${intent} = TRUE OR ${condition})
      AND (${status === ""} = TRUE OR rt.status = ${status} OR rt.priority = ${status} OR rt.type = ${status})
      AND (${district === null} = TRUE OR rt.district = ${district})
      AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict} OR rt.assigned_to_user_id = ${auth?.userId || 0})
      AND (
        ${viewAll} = TRUE
        OR (${assignedView} = TRUE AND rt.assigned_to_user_id = ${auth?.userId || 0})
        OR (
          ${executiveView} = TRUE
          AND (
            rt.priority IN ('HIGH', 'CRITICAL')
            OR rt.status = 'COMPLETED'
            OR (rt.due_at < CURRENT_TIMESTAMP(3) AND rt.status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED'))
          )
        )
      )
    ORDER BY rt.created_at DESC
    LIMIT ${limit}
  `
  return sortAndLimit((rows || []).map((row) =>
    scoreResult(
      query,
      resultBase({
        id: row.task_number,
        title: `${row.task_number} - ${row.title}`,
        subtitle: `Assigned to ${row.assigned_to_name} · Status: ${row.status}`,
        resultType: "TASK",
        route: `/tasks/${row.task_number}`,
        status: row.status,
        district: row.district || null,
        station: row.resolved_station_name || null,
        createdAt: row.created_at,
      }),
      {
        exact: { taskNumber: row.task_number },
        names: { title: row.title },
        related: { type: row.type, priority: row.priority, status: row.status, station: row.resolved_station_name, district: row.district, assignee: row.assigned_to_name },
      },
      intent ? 55 : 0
    )
  ), limit)
}

async function searchUsers(query, auth, { limit, filters = {} }) {
  if (!hasAnyPermission(auth, [MERA_PERMISSIONS.USERS_VIEW])) return []
  const patterns = likePatterns(query)
  const scopedDistrict = districtScope(auth)
  const district = normalizeOptionalString(filters.district)
  const intent = isIntent(query, ["officer", "user", "role", "admin"])
  const condition = likeCondition(["mu.public_id", "mu.full_name", "mu.email", "mu.phone", "mu.district_scope", "mu.region_scope", "mu.account_status", "mr.code", "mr.display_name"], patterns)
  const rows = await prisma.$queryRaw`
    SELECT
      mu.public_id,
      mu.full_name,
      mu.email,
      mu.phone,
      mu.district_scope,
      mu.account_status,
      NULLIF(CAST(mu.created_at AS CHAR), '0000-00-00 00:00:00.000') AS created_at,
      mr.code AS role_code,
      mr.display_name AS role_display_name
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE (${intent} = TRUE OR ${condition})
      AND (${district === null} = TRUE OR mu.district_scope = ${district})
      AND (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict})
    ORDER BY mu.full_name ASC
    LIMIT ${limit}
  `
  return sortAndLimit((rows || []).map((row) =>
    scoreResult(
      query,
      resultBase({
        id: row.public_id,
        title: row.full_name || row.email,
        subtitle: `${row.role_display_name || row.role_code} · ${row.district_scope || "National scope"}`,
        resultType: "USER",
        route: `/users/${row.public_id}`,
        status: row.account_status,
        district: row.district_scope || null,
        createdAt: row.created_at,
      }),
      {
        exact: { publicId: row.public_id, email: row.email, phone: row.phone },
        names: { fullName: row.full_name },
        related: { role: row.role_display_name || row.role_code, district: row.district_scope, status: row.account_status },
      },
      intent ? 50 : 0
    )
  ), limit)
}

async function searchReports(query, auth, { limit }) {
  if (!hasAnyPermission(auth, [MERA_PERMISSIONS.REPORTS_VIEW])) return []
  const intent = isIntent(query, ["report", "reports", "document", "documents", "analytics", "intelligence", "export", "price"])
  const candidates = [
    {
      id: "report-monthly-regulatory",
      title: "Monthly Regulatory Reports",
      subtitle: "Complaint, inspection, flag, and enforcement monthly summaries",
      route: "/reports-intelligence",
      keywords: "monthly reports complaints inspections flags enforcement documents",
    },
    {
      id: "report-price-compliance",
      title: "Price Compliance Intelligence",
      subtitle: "Fuel price and market compliance report workspace",
      route: "/reports-intelligence",
      keywords: "price compliance overpricing market intelligence report",
    },
    {
      id: "report-data-exports",
      title: "Data Exports",
      subtitle: "Export regulator datasets and evidence-backed reports",
      route: "/reports-intelligence",
      keywords: "exports documents data report download",
    },
  ]
  const results = candidates
    .map((candidate) => {
      const match = scoreSearchFields(query, {
        names: { title: candidate.title },
        related: { subtitle: candidate.subtitle, keywords: candidate.keywords },
      })
      if (!intent && match.score <= 0) return null
      return resultBase({
        ...candidate,
        resultType: "REPORT",
        status: "AVAILABLE",
        score: Math.max(match.score, intent ? 56 : 0),
        matchedField: match.matchedField,
      })
    })
    .filter(Boolean)
  return sortAndLimit(results, limit)
}

async function collectSearchGroups(query, auth, { limit = QUICK_GROUP_LIMIT, filters = {} } = {}) {
  const scopedLimit = clamp(limit, 1, 100)
  const groups = {
    navigation: navigationResults(query, auth, scopedLimit),
    locations: await searchLocations(query, auth, { limit: scopedLimit, filters }),
    licences: await searchLicences(query, auth, { limit: scopedLimit, filters }),
    stations: await searchStations(query, auth, { limit: scopedLimit, filters }),
    stationManagers: await searchStationManagers(query, auth, { limit: scopedLimit, filters }),
    cases: await searchCases(query, auth, { limit: scopedLimit, filters }),
    complaints: await searchComplaints(query, auth, { limit: scopedLimit, filters }),
    tasks: await searchTasks(query, auth, { limit: scopedLimit, filters }),
    users: await searchUsers(query, auth, { limit: scopedLimit, filters }),
    reports: await searchReports(query, auth, { limit: scopedLimit, filters }),
  }
  return groups
}

export async function quickSearch({ q, query, limit = 10 }, auth) {
  const normalizedQuery = normalizeSearchQuery(query ?? q)
  const groupLimit = QUICK_GROUP_LIMIT
  const groups = await collectSearchGroups(normalizedQuery, auth, { limit: groupLimit })
  const orderedGroups = groupResults(groups)
  const total = orderedGroups.reduce((sum, group) => sum + group.results.length, 0)
  const visibleLimit = clamp(limit, 1, 12)
  let remaining = visibleLimit
  const visibleGroups = orderedGroups
    .map((group) => {
      const results = group.results.slice(0, remaining)
      remaining -= results.length
      return { ...group, results }
    })
    .filter((group) => group.results.length > 0)
  return {
    query: normalizedQuery,
    groups: visibleGroups,
    total,
  }
}

function filterFullResults(results, filters = {}) {
  const type = normalizeOptionalString(filters.type)
  const status = normalizeOptionalString(filters.status)?.toUpperCase()
  const district = normalizeOptionalString(filters.district)
  const from = normalizeOptionalString(filters.from)
  const to = normalizeOptionalString(filters.to)
  const fromTime = from ? new Date(from).getTime() : null
  const toTime = to ? new Date(to).getTime() : null
  return results.filter((result) => {
    if (type && type !== "all" && result.groupType !== type && result.resultType !== type.toUpperCase()) return false
    if (status && String(result.status || "").toUpperCase() !== status) return false
    if (district && lower(result.district) !== lower(district)) return false
    const dateValue = result.createdAt || result.updatedAt
    const time = dateValue ? new Date(dateValue).getTime() : null
    if (fromTime && (!time || time < fromTime)) return false
    if (toTime && (!time || time > toTime)) return false
    return true
  })
}

export async function fullSearch({ q, query, page = 1, limit = 20, type = "all", status, district, from, to }, auth) {
  const normalizedQuery = normalizeSearchQuery(query ?? q)
  const pagination = {
    page: clamp(page, 1, 500),
    limit: clamp(limit, 1, 100),
  }
  const groups = await collectSearchGroups(normalizedQuery, auth, {
    limit: 100,
    filters: { status, district, from, to },
  })
  const orderedGroups = groupResults(groups)
  const flat = orderedGroups.flatMap((group) => group.results.map((result) => ({ ...result, groupType: group.type, groupLabel: group.label })))
  const filtered = filterFullResults(flat, { type, status, district, from, to }).sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
  const offset = (pagination.page - 1) * pagination.limit
  return {
    query: normalizedQuery,
    page: pagination.page,
    limit: pagination.limit,
    type: type || "all",
    total: filtered.length,
    results: filtered.slice(offset, offset + pagination.limit),
    groups: orderedGroups,
  }
}

async function stationRowsForManager(userPublicId, auth) {
  const scopedDistrict = districtScope(auth)
  return prisma.$queryRaw`
    SELECT
      s.id,
      s.public_id,
      s.name,
      s.operator_name,
      s.city,
      s.address,
      s.is_active,
      NULLIF(CAST(ss.created_at AS CHAR), '0000-00-00 00:00:00.000') AS assigned_at,
      NULLIF(CAST(ss.updated_at AS CHAR), '0000-00-00 00:00:00.000') AS assignment_updated_at
    FROM users u
    INNER JOIN station_staff ss ON ss.user_id = u.id AND ss.is_active = 1
    INNER JOIN staff_roles sr ON sr.id = ss.role_id AND sr.code = 'MANAGER'
    INNER JOIN stations s ON s.id = ss.station_id
    WHERE u.public_id = ${userPublicId}
      AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
    ORDER BY s.name ASC
  `
}

export async function getLicenseDetail(licenseId, auth, { fromSearch = false } = {}) {
  ensurePermission(auth, [MERA_PERMISSIONS.LICENSES_VIEW])
  const numericId = Number.parseInt(String(licenseId || ""), 10)
  if (!Number.isFinite(numericId) || numericId < 1) throw badRequest("Invalid licence id")
  const rows = await prisma.$queryRaw`
    SELECT
      fsl.id,
      fsl.station_id,
      fsl.license_number,
      fsl.issue_date,
      fsl.expiry_date,
      fsl.license_status,
      fsl.compliance_conditions,
      fsl.created_at,
      fsl.updated_at,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.operator_name,
      s.city,
      s.address,
      s.is_active
    FROM fuel_station_licenses fsl
    INNER JOIN stations s ON s.id = fsl.station_id
    WHERE fsl.id = ${numericId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.id) throw notFound("Licence not found")
  ensureDistrictAccess(auth, row.city, "licence")

  const canFlags = hasAnyPermission(auth, [MERA_PERMISSIONS.FLAGS_VIEW])
  const canEnforcement = hasAnyPermission(auth, [MERA_PERMISSIONS.ENFORCEMENT_VIEW])
  const canComplaints = hasAnyPermission(auth, [MERA_PERMISSIONS.COMPLAINTS_VIEW])
  const canTasks = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE, MERA_PERMISSIONS.TASKS_WORK])

  const [stationLicenceRows, flagRows, enforcementRows, complaintRows, taskRows, evidenceRows, lastInspectionRows, auditRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT fsl.id, fsl.license_number, fsl.license_status, fsl.issue_date, fsl.expiry_date, s.name AS station_name, s.city
      FROM fuel_station_licenses fsl
      INNER JOIN stations s ON s.id = fsl.station_id
      WHERE fsl.station_id = ${row.station_id}
      ORDER BY fsl.expiry_date DESC, fsl.id DESC
      LIMIT 20
    `,
    canFlags
      ? prisma.$queryRaw`
          SELECT public_id, flag_type, severity, resolved_status, generated_reason, created_at
          FROM compliance_flags
          WHERE station_id = ${row.station_id}
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canEnforcement
      ? prisma.$queryRaw`
          SELECT public_id, action_type, action_status, action_notes, issued_at, resolved_at
          FROM enforcement_actions
          WHERE station_id = ${row.station_id}
          ORDER BY issued_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canComplaints
      ? prisma.$queryRaw`
          SELECT public_id, complaint_type, complaint_status, created_at
          FROM public_complaints
          WHERE station_id = ${row.station_id}
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canTasks
      ? prisma.$queryRaw`
          SELECT
            rt.task_number,
            rt.title,
            rt.type,
            rt.priority,
            rt.status,
            rt.due_at,
            rt.created_at,
            mu.full_name AS assigned_to_name
          FROM regulator_tasks rt
          INNER JOIN mera_users mu ON mu.id = rt.assigned_to_user_id
          WHERE rt.deleted_at IS NULL
            AND (rt.station_id = ${row.station_id} OR rt.linked_entity_id = ${String(row.id)} OR rt.linked_entity_id = ${row.license_number})
            AND (
              ${hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_ASSIGN])} = TRUE
              OR rt.assigned_to_user_id = ${auth?.userId || 0}
              OR (
                ${hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE])} = TRUE
                AND (rt.priority IN ('HIGH', 'CRITICAL') OR rt.status = 'COMPLETED')
              )
            )
          ORDER BY rt.created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canTasks
      ? prisma.$queryRaw`
          SELECT rte.id, rte.evidence_type, rte.title, rte.description, rte.file_url, rte.created_at, rt.task_number
          FROM regulator_task_evidence rte
          INNER JOIN regulator_tasks rt ON rt.id = rte.task_id
          WHERE rt.station_id = ${row.station_id}
          ORDER BY rte.created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    prisma.$queryRaw`
      SELECT created_at
      FROM inspections
      WHERE station_id = ${row.station_id}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    hasAnyPermission(auth, [MERA_PERMISSIONS.AUDIT_VIEW])
      ? prisma.$queryRaw`
          SELECT action_type, action_description, affected_entity, created_at
          FROM audit_logs_mera
          WHERE affected_entity IN (${row.license_number}, ${`LICENSE:${numericId}`}, ${row.station_public_id})
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
  ])

  const activeViolations = (flagRows || []).filter((item) => ["OPEN", "UNDER_REVIEW"].includes(String(item.resolved_status || "").toUpperCase())).length
  const pendingTasks = (taskRows || []).filter((item) => !closedTaskStatuses.has(String(item.status || "").toUpperCase())).length
  const overdueTasks = (taskRows || []).filter((item) => item.due_at && new Date(item.due_at).getTime() < Date.now() && !closedTaskStatuses.has(String(item.status || "").toUpperCase())).length

  if (fromSearch) {
    await logMeraAudit({
      actorId: auth?.userId || null,
      actorName: auth?.fullName || null,
      actorRole: auth?.role || null,
      permissionUsed: auth?.permissionUsed || MERA_PERMISSIONS.LICENSES_VIEW,
      actionType: "MERA_LICENSE_VIEWED_FROM_SEARCH",
      actionDescription: `Licence ${row.license_number} opened from global search.`,
      affectedEntity: row.license_number,
      ipAddress: auth?.ipAddress || null,
      deviceInfo: auth?.deviceInfo || null,
    }).catch(() => {})
  }

  return {
    licence: {
      id: Number(row.id),
      licenseNumber: row.license_number,
      licenceNumber: row.license_number,
      licenseType: "Fuel service licence",
      licenceType: "Fuel service licence",
      status: row.license_status,
      issueDate: row.issue_date,
      expiryDate: row.expiry_date,
      complianceConditions: row.compliance_conditions || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ownerOperator: row.operator_name || null,
      district: row.city || null,
      location: row.address || null,
    },
    station: {
      publicId: row.station_public_id,
      name: row.station_name,
      operatorName: row.operator_name || null,
      city: row.city || null,
      address: row.address || null,
      isActive: Number(row.is_active) === 1,
    },
    compliance: {
      score: Math.max(0, 100 - activeViolations * 10 - overdueTasks * 5),
      activeViolations,
      pendingTasks,
      overdueTasks,
      lastInspectionDate: lastInspectionRows?.[0]?.created_at || null,
      lastComplaintDate: complaintRows?.[0]?.created_at || null,
    },
    relatedTasks: taskRows || [],
    relatedLicences: stationLicenceRows || [],
    relatedCases: [...(flagRows || []).map((item) => ({ ...item, caseType: "COMPLIANCE_FLAG" })), ...(enforcementRows || []).map((item) => ({ ...item, caseType: "ENFORCEMENT_ACTION" }))],
    relatedComplaints: complaintRows || [],
    documents: evidenceRows || [],
    activity: [
      { action: "LICENCE_CREATED", description: `Licence ${row.license_number} created.`, createdAt: row.created_at },
      { action: "LICENCE_UPDATED", description: `Licence ${row.license_number} last updated.`, createdAt: row.updated_at },
      ...(auditRows || []).map((item) => ({
        action: item.action_type,
        description: item.action_description,
        affectedEntity: item.affected_entity,
        createdAt: item.created_at,
      })),
    ],
  }
}

export async function getStationManagerDetail(userPublicId, auth) {
  ensurePermission(auth, [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT])
  const scopedUserPublicId = normalizeOptionalString(userPublicId)
  if (!scopedUserPublicId) throw badRequest("Station manager id is required")
  const managerRows = await prisma.$queryRaw`
    SELECT
      public_id,
      full_name,
      email,
      phone_e164,
      is_active,
      NULLIF(CAST(created_at AS CHAR), '0000-00-00 00:00:00.000') AS created_at,
      NULLIF(CAST(updated_at AS CHAR), '0000-00-00 00:00:00.000') AS updated_at
    FROM users
    WHERE public_id = ${scopedUserPublicId}
    LIMIT 1
  `
  const manager = managerRows?.[0]
  if (!manager?.public_id) throw notFound("Station manager not found")
  const stations = await stationRowsForManager(scopedUserPublicId, auth)
  if (!stations?.length) throw notFound("No accessible station manager assignment found")

  const canLicences = hasAnyPermission(auth, [MERA_PERMISSIONS.LICENSES_VIEW])
  const canFlags = hasAnyPermission(auth, [MERA_PERMISSIONS.FLAGS_VIEW])
  const canEnforcement = hasAnyPermission(auth, [MERA_PERMISSIONS.ENFORCEMENT_VIEW])
  const canComplaints = hasAnyPermission(auth, [MERA_PERMISSIONS.COMPLAINTS_VIEW])
  const canTasks = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE, MERA_PERMISSIONS.TASKS_WORK])
  const scopedDistrict = districtScope(auth)

  const [licences, flags, enforcement, complaints, tasks, documents, activity] = await Promise.all([
    canLicences
      ? prisma.$queryRaw`
          SELECT fsl.id, fsl.license_number, fsl.license_status, fsl.issue_date, fsl.expiry_date, s.public_id AS station_public_id, s.name AS station_name, s.city
          FROM fuel_station_licenses fsl
          INNER JOIN stations s ON s.id = fsl.station_id
          INNER JOIN station_staff ss ON ss.station_id = s.id
          INNER JOIN staff_roles sr ON sr.id = ss.role_id AND sr.code = 'MANAGER'
          INNER JOIN users u ON u.id = ss.user_id
          WHERE u.public_id = ${scopedUserPublicId}
            AND ss.is_active = 1
            AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
          ORDER BY fsl.expiry_date ASC
          LIMIT 50
        `
      : Promise.resolve([]),
    canFlags
      ? prisma.$queryRaw`
          SELECT cf.public_id, cf.flag_type, cf.severity, cf.resolved_status, cf.created_at, s.name AS station_name, s.city
          FROM compliance_flags cf
          INNER JOIN stations s ON s.id = cf.station_id
          INNER JOIN station_staff ss ON ss.station_id = s.id
          INNER JOIN staff_roles sr ON sr.id = ss.role_id AND sr.code = 'MANAGER'
          INNER JOIN users u ON u.id = ss.user_id
          WHERE u.public_id = ${scopedUserPublicId}
            AND ss.is_active = 1
            AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
          ORDER BY cf.created_at DESC
          LIMIT 50
        `
      : Promise.resolve([]),
    canEnforcement
      ? prisma.$queryRaw`
          SELECT ea.public_id, ea.action_type, ea.action_status, ea.issued_at, s.name AS station_name, s.city
          FROM enforcement_actions ea
          INNER JOIN stations s ON s.id = ea.station_id
          INNER JOIN station_staff ss ON ss.station_id = s.id
          INNER JOIN staff_roles sr ON sr.id = ss.role_id AND sr.code = 'MANAGER'
          INNER JOIN users u ON u.id = ss.user_id
          WHERE u.public_id = ${scopedUserPublicId}
            AND ss.is_active = 1
            AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
          ORDER BY ea.issued_at DESC
          LIMIT 50
        `
      : Promise.resolve([]),
    canComplaints
      ? prisma.$queryRaw`
          SELECT pc.public_id, pc.complaint_type, pc.complaint_status, pc.created_at, s.name AS station_name, s.city
          FROM public_complaints pc
          INNER JOIN stations s ON s.id = pc.station_id
          INNER JOIN station_staff ss ON ss.station_id = s.id
          INNER JOIN staff_roles sr ON sr.id = ss.role_id AND sr.code = 'MANAGER'
          INNER JOIN users u ON u.id = ss.user_id
          WHERE u.public_id = ${scopedUserPublicId}
            AND ss.is_active = 1
            AND (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
          ORDER BY pc.created_at DESC
          LIMIT 50
        `
      : Promise.resolve([]),
    canTasks
      ? prisma.$queryRaw`
          SELECT rt.task_number, rt.title, rt.type, rt.priority, rt.status, rt.due_at, rt.created_at, COALESCE(rt.station_name, s.name) AS station_name, rt.district
          FROM regulator_tasks rt
          LEFT JOIN stations s ON s.id = rt.station_id
          INNER JOIN station_staff ss ON ss.station_id = COALESCE(rt.station_id, s.id)
          INNER JOIN staff_roles sr ON sr.id = ss.role_id AND sr.code = 'MANAGER'
          INNER JOIN users u ON u.id = ss.user_id
          WHERE u.public_id = ${scopedUserPublicId}
            AND ss.is_active = 1
            AND rt.deleted_at IS NULL
            AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict})
          ORDER BY rt.created_at DESC
          LIMIT 50
        `
      : Promise.resolve([]),
    canTasks
      ? prisma.$queryRaw`
          SELECT rte.id, rte.evidence_type, rte.title, rte.file_url, rte.created_at, rt.task_number
          FROM regulator_task_evidence rte
          INNER JOIN regulator_tasks rt ON rt.id = rte.task_id
          INNER JOIN station_staff ss ON ss.station_id = rt.station_id
          INNER JOIN staff_roles sr ON sr.id = ss.role_id AND sr.code = 'MANAGER'
          INNER JOIN users u ON u.id = ss.user_id
          WHERE u.public_id = ${scopedUserPublicId}
            AND ss.is_active = 1
            AND rt.deleted_at IS NULL
            AND (${scopedDistrict === ""} = TRUE OR rt.district = ${scopedDistrict})
          ORDER BY rte.created_at DESC
          LIMIT 30
        `
      : Promise.resolve([]),
    hasAnyPermission(auth, [MERA_PERMISSIONS.AUDIT_VIEW])
      ? prisma.$queryRaw`
          SELECT alm.action_type, alm.action_description, alm.affected_entity, alm.created_at
          FROM audit_logs_mera alm
          WHERE alm.affected_entity = ${scopedUserPublicId}
          ORDER BY alm.created_at DESC
          LIMIT 30
        `
      : Promise.resolve([]),
  ])

  return {
    manager: {
      publicId: manager.public_id,
      fullName: manager.full_name || null,
      email: manager.email || null,
      phone: manager.phone_e164 || null,
      isActive: Number(manager.is_active) === 1,
      createdAt: manager.created_at,
      updatedAt: manager.updated_at,
    },
    stations: stations || [],
    licences: licences || [],
    cases: [...(flags || []).map((item) => ({ ...item, caseType: "COMPLIANCE_FLAG" })), ...(enforcement || []).map((item) => ({ ...item, caseType: "ENFORCEMENT_ACTION" }))],
    complaints: complaints || [],
    tasks: tasks || [],
    documents: documents || [],
    activity: activity || [],
  }
}

export async function getStationDetail(publicId, auth) {
  ensurePermission(auth, [MERA_PERMISSIONS.STATIONS_VIEW, MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT])
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name, operator_name, city, address, is_active, created_at, updated_at
    FROM stations
    WHERE public_id = ${publicId}
    LIMIT 1
  `
  const station = rows?.[0]
  if (!station?.id) throw notFound("Station not found")
  ensureDistrictAccess(auth, station.city, "station")
  const [profile, managers] = await Promise.all([
    getStationRelatedData(station, auth),
    prisma.$queryRaw`
      SELECT u.public_id, u.full_name, u.email, u.phone_e164, sr.name AS role_name
      FROM station_staff ss
      INNER JOIN users u ON u.id = ss.user_id
      INNER JOIN staff_roles sr ON sr.id = ss.role_id
      WHERE ss.station_id = ${station.id}
        AND ss.is_active = 1
      ORDER BY sr.id ASC, u.full_name ASC
    `,
  ])
  return { station, managers: managers || [], ...profile }
}

async function getStationRelatedData(station, auth) {
  const canLicences = hasAnyPermission(auth, [MERA_PERMISSIONS.LICENSES_VIEW])
  const canFlags = hasAnyPermission(auth, [MERA_PERMISSIONS.FLAGS_VIEW])
  const canEnforcement = hasAnyPermission(auth, [MERA_PERMISSIONS.ENFORCEMENT_VIEW])
  const canComplaints = hasAnyPermission(auth, [MERA_PERMISSIONS.COMPLAINTS_VIEW])
  const canTasks = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE, MERA_PERMISSIONS.TASKS_WORK])
  const canAvailability = hasAnyPermission(auth, [MERA_PERMISSIONS.AVAILABILITY_VIEW, MERA_PERMISSIONS.AVAILABILITY_AUDIT])
  const canDeliveries = hasAnyPermission(auth, [MERA_PERMISSIONS.DELIVERIES_VIEW])
  const canAudit = hasAnyPermission(auth, [MERA_PERMISSIONS.AUDIT_VIEW])
  const canInspections = hasAnyPermission(auth, [MERA_PERMISSIONS.INSPECTIONS_VIEW, MERA_PERMISSIONS.INSPECTIONS_REVIEW])
  const canExecutiveTasks = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE])
  const [licences, flags, enforcement, complaints, tasks, taskDocuments, complaintMedia, currentStatusRows, statusLogs, availabilityReports, deliveryRows, operationRows, inspectionRows, activityRows] = await Promise.all([
    canLicences
      ? prisma.$queryRaw`
          SELECT fsl.id, fsl.license_number, fsl.license_status, fsl.issue_date, fsl.expiry_date, s.name AS station_name, s.city
          FROM fuel_station_licenses fsl
          INNER JOIN stations s ON s.id = fsl.station_id
          WHERE fsl.station_id = ${station.id}
          ORDER BY fsl.expiry_date DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canFlags
      ? prisma.$queryRaw`SELECT public_id, flag_type, severity, resolved_status, generated_reason, source_reference, created_at, resolved_at FROM compliance_flags WHERE station_id = ${station.id} ORDER BY created_at DESC LIMIT 20`
      : Promise.resolve([]),
    canEnforcement
      ? prisma.$queryRaw`SELECT public_id, action_type, action_status, action_notes, issued_at, resolved_at FROM enforcement_actions WHERE station_id = ${station.id} ORDER BY issued_at DESC LIMIT 20`
      : Promise.resolve([]),
    canComplaints
      ? prisma.$queryRaw`SELECT public_id, complaint_type, complaint_status, complaint_description, media_url, geo_lat, geo_lng, created_at, updated_at FROM public_complaints WHERE station_id = ${station.id} ORDER BY created_at DESC LIMIT 20`
      : Promise.resolve([]),
    canTasks
      ? prisma.$queryRaw`
          SELECT task_number, title, type, priority, status, due_at, created_at, assigned_to_user_id
          FROM regulator_tasks
          WHERE station_id = ${station.id}
            AND deleted_at IS NULL
            AND (
              ${canViewAllTaskRecords(auth)} = TRUE
              OR assigned_to_user_id = ${auth?.userId || 0}
              OR (
                ${canExecutiveTasks} = TRUE
                AND (priority IN ('HIGH', 'CRITICAL') OR status = 'COMPLETED')
              )
            )
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canTasks
      ? prisma.$queryRaw`
          SELECT
            rte.id,
            'TASK_EVIDENCE' AS document_type,
            rte.evidence_type,
            rte.title,
            rte.description,
            rte.file_url,
            rte.linked_existing_evidence_id,
            rte.created_at,
            rt.task_number,
            rt.title AS task_title,
            mu.public_id AS uploaded_by_public_id,
            mu.full_name AS uploaded_by_name
          FROM regulator_task_evidence rte
          INNER JOIN regulator_tasks rt ON rt.id = rte.task_id
          INNER JOIN mera_users mu ON mu.id = rte.uploaded_by_user_id
          WHERE rt.station_id = ${station.id}
            AND rt.deleted_at IS NULL
            AND (
              ${canViewAllTaskRecords(auth)} = TRUE
              OR rt.assigned_to_user_id = ${auth?.userId || 0}
              OR (
                ${canExecutiveTasks} = TRUE
                AND (rt.priority IN ('HIGH', 'CRITICAL') OR rt.status = 'COMPLETED')
              )
            )
          ORDER BY rte.created_at DESC
          LIMIT 30
        `
      : Promise.resolve([]),
    canComplaints
      ? prisma.$queryRaw`
          SELECT
            pc.public_id,
            pc.complaint_description,
            pc.media_url,
            pc.created_at,
            s.public_id AS station_public_id,
            s.name AS station_name,
            u.full_name AS complainant_name
          FROM public_complaints pc
          INNER JOIN stations s ON s.id = pc.station_id
          LEFT JOIN users u ON u.id = pc.user_id
          WHERE pc.station_id = ${station.id}
            AND pc.media_url IS NOT NULL
          ORDER BY pc.created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    prisma.$queryRaw`
      SELECT availability_status, diesel_status, petrol_status, petrol_live_litres, diesel_live_litres, total_live_litres, total_capacity_litres, latest_delivery_time, last_logged_at, updated_at
      FROM station_current_status
      WHERE station_id = ${station.id}
      LIMIT 1
    `.catch(() => []),
    canAvailability
      ? prisma.$queryRaw`
          SELECT availability_status, diesel_status, petrol_status, reported_source, created_at
          FROM station_status_logs
          WHERE station_id = ${station.id}
          ORDER BY created_at DESC
          LIMIT 15
        `
      : Promise.resolve([]),
    canAvailability
      ? prisma.$queryRaw`
          SELECT id, petrol_available, diesel_available, active_pumps, reported_by, created_at
          FROM station_availability_reports
          WHERE station_id = ${station.id}
          ORDER BY created_at DESC
          LIMIT 15
        `.catch(() => [])
      : Promise.resolve([]),
    canDeliveries
      ? prisma.$queryRaw`
          SELECT id, delivery_time, fuel_type, estimated_volume, source_type, reported_by, created_at
          FROM fuel_delivery_logs
          WHERE station_id = ${station.id}
          ORDER BY delivery_time DESC
          LIMIT 15
        `.catch(() => [])
      : Promise.resolve([]),
    prisma.$queryRaw`
      SELECT
        COUNT(*) AS transaction_count,
        COALESCE(SUM(litres), 0) AS dispensed_litres,
        COALESCE(SUM(total_amount), 0) AS total_sales_amount,
        MAX(occurred_at) AS last_dispensed_at
      FROM transactions
      WHERE station_id = ${station.id}
    `.catch(() => []),
    canInspections
      ? prisma.$queryRaw`
          SELECT i.public_id, i.inspection_type, i.inspection_status, i.queue_length, i.pumps_active, i.geotag_lat, i.geotag_lng, i.created_at, mu.full_name AS officer_name
          FROM inspections i
          INNER JOIN mera_users mu ON mu.id = i.officer_id
          WHERE i.station_id = ${station.id}
          ORDER BY i.created_at DESC
          LIMIT 15
        `
      : Promise.resolve([]),
    canAudit
      ? prisma.$queryRaw`
          SELECT action_type, action_description, affected_entity, created_at
          FROM audit_logs_mera
          WHERE affected_entity IN (${station.public_id || ""}, ${String(station.id)})
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
  ])
  const documents = [
    ...(taskDocuments || []).map(withDocumentRoute),
    ...(complaintMedia || []).map((row) => mapComplaintMediaDocument(row)).filter(Boolean),
  ]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 40)

  return {
    licences: licences || [],
    cases: [...(flags || []).map((item) => ({ ...item, caseType: "COMPLIANCE_FLAG" })), ...(enforcement || []).map((item) => ({ ...item, caseType: "ENFORCEMENT_ACTION" }))],
    complaints: complaints || [],
    tasks: tasks || [],
    documents,
    inspections: inspectionRows || [],
    fuelAvailability: {
      current: currentStatusRows?.[0] || null,
      statusLogs: statusLogs || [],
      reports: availabilityReports || [],
    },
    deliveries: deliveryRows || [],
    operations: operationRows?.[0] || {
      transaction_count: 0,
      dispensed_litres: 0,
      total_sales_amount: 0,
      last_dispensed_at: null,
    },
    activity: activityRows || [],
  }
}

export async function getComplaintDetail(publicId, auth) {
  ensurePermission(auth, [MERA_PERMISSIONS.COMPLAINTS_VIEW])
  const rows = await prisma.$queryRaw`
    SELECT
      pc.id,
      pc.public_id,
      pc.complaint_type,
      pc.complaint_description,
      pc.media_url,
      pc.geo_lat,
      pc.geo_lng,
      pc.complaint_status,
      pc.created_at,
      pc.updated_at,
      s.id AS station_id,
      s.public_id AS station_public_id,
      s.name AS station_name,
      s.city,
      u.public_id AS complainant_public_id,
      u.full_name AS complainant_name,
      u.email AS complainant_email,
      u.phone_e164 AS complainant_phone,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    LEFT JOIN users u ON u.id = pc.user_id
    LEFT JOIN mera_users mu ON mu.id = pc.assigned_officer_id
    WHERE pc.public_id = ${publicId}
    LIMIT 1
  `
  const complaint = rows?.[0]
  if (!complaint?.public_id) throw notFound("Complaint not found")
  ensureDistrictAccess(auth, complaint.city, "complaint")
  const canTasks = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE, MERA_PERMISSIONS.TASKS_WORK])
  const canExecutiveTasks = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE])
  const canAudit = hasAnyPermission(auth, [MERA_PERMISSIONS.AUDIT_VIEW])
  const [related, complaintTasks, complaintDocuments, auditRows] = await Promise.all([
    getStationRelatedData({ id: complaint.station_id, public_id: complaint.station_public_id }, auth),
    canTasks
      ? prisma.$queryRaw`
          SELECT task_number, title, type, priority, status, due_at, created_at, assigned_to_user_id
          FROM regulator_tasks
          WHERE deleted_at IS NULL
            AND (linked_entity_id = ${publicId} OR linked_entity_id = ${complaint.public_id})
            AND (
              ${canViewAllTaskRecords(auth)} = TRUE
              OR assigned_to_user_id = ${auth?.userId || 0}
              OR (
                ${canExecutiveTasks} = TRUE
                AND (priority IN ('HIGH', 'CRITICAL') OR status = 'COMPLETED')
              )
            )
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canTasks
      ? prisma.$queryRaw`
          SELECT
            rte.id,
            'TASK_EVIDENCE' AS document_type,
            rte.evidence_type,
            rte.title,
            rte.description,
            rte.file_url,
            rte.linked_existing_evidence_id,
            rte.created_at,
            rt.task_number,
            rt.title AS task_title,
            mu.public_id AS uploaded_by_public_id,
            mu.full_name AS uploaded_by_name
          FROM regulator_task_evidence rte
          INNER JOIN regulator_tasks rt ON rt.id = rte.task_id
          INNER JOIN mera_users mu ON mu.id = rte.uploaded_by_user_id
          WHERE rt.deleted_at IS NULL
            AND (rt.linked_entity_id = ${publicId} OR rt.linked_entity_id = ${complaint.public_id})
            AND (
              ${canViewAllTaskRecords(auth)} = TRUE
              OR rt.assigned_to_user_id = ${auth?.userId || 0}
              OR (
                ${canExecutiveTasks} = TRUE
                AND (rt.priority IN ('HIGH', 'CRITICAL') OR rt.status = 'COMPLETED')
              )
            )
          ORDER BY rte.created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canAudit
      ? prisma.$queryRaw`
          SELECT action_type, action_description, affected_entity, created_at
          FROM audit_logs_mera
          WHERE affected_entity IN (${complaint.public_id}, ${complaint.station_public_id})
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
  ])
  const taskByNumber = new Map()
  ;[...(complaintTasks || []), ...(related.tasks || [])].forEach((task) => {
    if (task?.task_number && !taskByNumber.has(task.task_number)) taskByNumber.set(task.task_number, task)
  })
  const complaintMediaDocument = mapComplaintMediaDocument(complaint)
  const documentByKey = new Map()
  ;[
    ...(complaintMediaDocument ? [complaintMediaDocument] : []),
    ...(complaintDocuments || []).map(withDocumentRoute),
    ...(related.documents || []),
  ].forEach((document) => {
    const key = document?.document_route || `${document?.document_type || "DOC"}:${document?.id || document?.file_url || document?.title}`
    if (key && !documentByKey.has(key)) documentByKey.set(key, document)
  })

  return {
    complaint,
    ...related,
    tasks: [...taskByNumber.values()],
    relatedTasks: [...taskByNumber.values()],
    documents: [...documentByKey.values()],
    activity: [
      { action: "COMPLAINT_SUBMITTED", description: "Complaint submitted.", createdAt: complaint.created_at },
      { action: "COMPLAINT_UPDATED", description: "Complaint record last updated.", createdAt: complaint.updated_at },
      ...(auditRows || []).map((item) => ({
        action: item.action_type,
        description: item.action_description,
        affectedEntity: item.affected_entity,
        createdAt: item.created_at,
      })),
      ...(related.activity || []),
    ],
  }
}

function parseCaseId(caseId) {
  const raw = String(caseId || "").trim()
  if (raw.startsWith("flag-")) return { type: "flag", publicId: raw.slice("flag-".length) }
  if (raw.startsWith("enforcement-")) return { type: "enforcement", publicId: raw.slice("enforcement-".length) }
  return { type: "unknown", publicId: raw }
}

export async function getCaseDetail(caseId, auth) {
  const parsed = parseCaseId(caseId)
  if (parsed.type === "enforcement") return getEnforcementCaseDetail(parsed.publicId, auth)
  if (parsed.type === "flag") return getFlagCaseDetail(parsed.publicId, auth)
  try {
    return await getFlagCaseDetail(parsed.publicId, auth)
  } catch {
    return getEnforcementCaseDetail(parsed.publicId, auth)
  }
}

async function getCaseLinkedData(publicId, stationPublicId, auth) {
  const canTasks = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE, MERA_PERMISSIONS.TASKS_WORK])
  const canExecutiveTasks = hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE])
  const canAudit = hasAnyPermission(auth, [MERA_PERMISSIONS.AUDIT_VIEW])
  const flagId = `flag-${publicId}`
  const enforcementId = `enforcement-${publicId}`
  const [tasks, documents, activity] = await Promise.all([
    canTasks
      ? prisma.$queryRaw`
          SELECT task_number, title, type, priority, status, due_at, created_at, assigned_to_user_id
          FROM regulator_tasks
          WHERE deleted_at IS NULL
            AND linked_entity_id IN (${publicId}, ${flagId}, ${enforcementId})
            AND (
              ${canViewAllTaskRecords(auth)} = TRUE
              OR assigned_to_user_id = ${auth?.userId || 0}
              OR (
                ${canExecutiveTasks} = TRUE
                AND (priority IN ('HIGH', 'CRITICAL') OR status = 'COMPLETED')
              )
            )
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canTasks
      ? prisma.$queryRaw`
          SELECT
            rte.id,
            'TASK_EVIDENCE' AS document_type,
            rte.evidence_type,
            rte.title,
            rte.description,
            rte.file_url,
            rte.linked_existing_evidence_id,
            rte.created_at,
            rt.task_number,
            rt.title AS task_title,
            mu.public_id AS uploaded_by_public_id,
            mu.full_name AS uploaded_by_name
          FROM regulator_task_evidence rte
          INNER JOIN regulator_tasks rt ON rt.id = rte.task_id
          INNER JOIN mera_users mu ON mu.id = rte.uploaded_by_user_id
          WHERE rt.deleted_at IS NULL
            AND rt.linked_entity_id IN (${publicId}, ${flagId}, ${enforcementId})
            AND (
              ${canViewAllTaskRecords(auth)} = TRUE
              OR rt.assigned_to_user_id = ${auth?.userId || 0}
              OR (
                ${canExecutiveTasks} = TRUE
                AND (rt.priority IN ('HIGH', 'CRITICAL') OR rt.status = 'COMPLETED')
              )
            )
          ORDER BY rte.created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
    canAudit
      ? prisma.$queryRaw`
          SELECT action_type, action_description, affected_entity, created_at
          FROM audit_logs_mera
          WHERE affected_entity IN (${publicId}, ${flagId}, ${enforcementId}, ${stationPublicId || ""})
          ORDER BY created_at DESC
          LIMIT 20
        `
      : Promise.resolve([]),
  ])
  return {
    tasks: tasks || [],
    documents: (documents || []).map(withDocumentRoute),
    activity: activity || [],
  }
}

async function getFlagCaseDetail(publicId, auth) {
  ensurePermission(auth, [MERA_PERMISSIONS.FLAGS_VIEW])
  const rows = await prisma.$queryRaw`
    SELECT cf.*, s.id AS station_id, s.public_id AS station_public_id, s.name AS station_name, s.city
    FROM compliance_flags cf
    INNER JOIN stations s ON s.id = cf.station_id
    WHERE cf.public_id = ${publicId}
    LIMIT 1
  `
  const item = rows?.[0]
  if (!item?.public_id) throw notFound("Case not found")
  ensureDistrictAccess(auth, item.city, "case")
  const [related, caseLinked] = await Promise.all([
    getStationRelatedData({ id: item.station_id, public_id: item.station_public_id }, auth),
    getCaseLinkedData(item.public_id, item.station_public_id, auth),
  ])
  const taskByNumber = new Map()
  ;[...(caseLinked.tasks || []), ...(related.tasks || [])].forEach((task) => {
    if (task?.task_number && !taskByNumber.has(task.task_number)) taskByNumber.set(task.task_number, task)
  })
  const documentByKey = new Map()
  ;[...(caseLinked.documents || []), ...(related.documents || [])].forEach((document) => {
    const key = document?.document_route || `${document?.document_type || "DOC"}:${document?.id || document?.file_url || document?.title}`
    if (key && !documentByKey.has(key)) documentByKey.set(key, document)
  })
  return {
    case: { ...item, caseType: "COMPLIANCE_FLAG" },
    ...related,
    tasks: [...taskByNumber.values()],
    relatedTasks: [...taskByNumber.values()],
    documents: [...documentByKey.values()],
    activity: [
      { action: "CASE_OPENED", description: item.generated_reason || "Compliance flag opened.", createdAt: item.created_at },
      ...(caseLinked.activity || []).map((row) => ({
        action: row.action_type,
        description: row.action_description,
        affectedEntity: row.affected_entity,
        createdAt: row.created_at,
      })),
      ...(related.activity || []),
    ],
  }
}

async function getEnforcementCaseDetail(publicId, auth) {
  ensurePermission(auth, [MERA_PERMISSIONS.ENFORCEMENT_VIEW])
  const rows = await prisma.$queryRaw`
    SELECT ea.*, s.id AS station_id, s.public_id AS station_public_id, s.name AS station_name, s.city, cf.public_id AS related_flag_public_id
    FROM enforcement_actions ea
    INNER JOIN stations s ON s.id = ea.station_id
    LEFT JOIN compliance_flags cf ON cf.id = ea.related_flag_id
    WHERE ea.public_id = ${publicId}
    LIMIT 1
  `
  const item = rows?.[0]
  if (!item?.public_id) throw notFound("Case not found")
  ensureDistrictAccess(auth, item.city, "case")
  const [related, caseLinked] = await Promise.all([
    getStationRelatedData({ id: item.station_id, public_id: item.station_public_id }, auth),
    getCaseLinkedData(item.public_id, item.station_public_id, auth),
  ])
  const taskByNumber = new Map()
  ;[...(caseLinked.tasks || []), ...(related.tasks || [])].forEach((task) => {
    if (task?.task_number && !taskByNumber.has(task.task_number)) taskByNumber.set(task.task_number, task)
  })
  const documentByKey = new Map()
  ;[...(caseLinked.documents || []), ...(related.documents || [])].forEach((document) => {
    const key = document?.document_route || `${document?.document_type || "DOC"}:${document?.id || document?.file_url || document?.title}`
    if (key && !documentByKey.has(key)) documentByKey.set(key, document)
  })
  return {
    case: { ...item, caseType: "ENFORCEMENT_ACTION" },
    ...related,
    tasks: [...taskByNumber.values()],
    relatedTasks: [...taskByNumber.values()],
    documents: [...documentByKey.values()],
    activity: [
      { action: "ENFORCEMENT_OPENED", description: item.action_notes || "Enforcement action opened.", createdAt: item.issued_at },
      ...(caseLinked.activity || []).map((row) => ({
        action: row.action_type,
        description: row.action_description,
        affectedEntity: row.affected_entity,
        createdAt: row.created_at,
      })),
      ...(related.activity || []),
    ],
  }
}

export async function getTaskEvidenceDetail(evidenceId, auth) {
  ensurePermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE, MERA_PERMISSIONS.TASKS_WORK])
  const numericId = Number.parseInt(String(evidenceId || ""), 10)
  if (!Number.isFinite(numericId) || numericId < 1) throw badRequest("Invalid evidence id")
  const rows = await prisma.$queryRaw`
    SELECT
      rte.id,
      rte.evidence_type,
      rte.title,
      rte.description,
      rte.file_url,
      rte.linked_existing_evidence_id,
      rte.created_at,
      rt.id AS task_id,
      rt.task_number,
      rt.title AS task_title,
      rt.type AS task_type,
      rt.priority,
      rt.status,
      rt.district,
      rt.station_id,
      rt.station_name,
      rt.linked_entity_type,
      rt.linked_entity_id,
      rt.assigned_to_user_id,
      rt.created_at AS task_created_at,
      s.public_id AS station_public_id,
      s.name AS resolved_station_name,
      s.city AS station_city,
      uploader.public_id AS uploaded_by_public_id,
      uploader.full_name AS uploaded_by_name
    FROM regulator_task_evidence rte
    INNER JOIN regulator_tasks rt ON rt.id = rte.task_id
    LEFT JOIN stations s ON s.id = rt.station_id
    INNER JOIN mera_users uploader ON uploader.id = rte.uploaded_by_user_id
    WHERE rte.id = ${numericId}
      AND rt.deleted_at IS NULL
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.id) throw notFound("Evidence not found")
  ensureDistrictAccess(auth, row.station_city || row.district, "evidence")
  if (!canViewTaskRecord(auth, row)) throw forbidden("You do not have access to this evidence")
  const activity = await prisma.$queryRaw`
    SELECT rtal.action, rtal.old_value, rtal.new_value, rtal.created_at, mu.full_name AS actor_name
    FROM regulator_task_activity_logs rtal
    LEFT JOIN mera_users mu ON mu.id = rtal.actor_user_id
    WHERE rtal.task_id = ${row.task_id}
    ORDER BY rtal.created_at DESC
    LIMIT 20
  `.catch(() => [])

  return {
    document: {
      id: row.id,
      documentType: "TASK_EVIDENCE",
      evidenceType: row.evidence_type,
      title: row.title,
      description: row.description || null,
      fileUrl: row.file_url || null,
      linkedExistingEvidenceId: row.linked_existing_evidence_id || null,
      createdAt: row.created_at,
      uploadedBy: row.uploaded_by_public_id
        ? {
            publicId: row.uploaded_by_public_id,
            fullName: row.uploaded_by_name,
          }
        : null,
    },
    linkedTask: {
      id: row.task_id,
      taskNumber: row.task_number,
      title: row.task_title,
      type: row.task_type,
      priority: row.priority,
      status: row.status,
      district: row.district || row.station_city || null,
      linkedEntityType: row.linked_entity_type || null,
      linkedEntityId: row.linked_entity_id || null,
      createdAt: row.task_created_at,
    },
    station: row.station_public_id
      ? {
          publicId: row.station_public_id,
          name: row.resolved_station_name || row.station_name || null,
          city: row.station_city || row.district || null,
        }
      : null,
    activity: activity || [],
  }
}

export async function getComplaintMediaDetail(publicId, auth) {
  ensurePermission(auth, [MERA_PERMISSIONS.COMPLAINTS_VIEW])
  const scopedPublicId = normalizeOptionalString(publicId)
  if (!scopedPublicId) throw badRequest("Complaint id is required")
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
      s.city,
      u.public_id AS complainant_public_id,
      u.full_name AS complainant_name,
      u.email AS complainant_email,
      u.phone_e164 AS complainant_phone,
      mu.public_id AS officer_public_id,
      mu.full_name AS officer_name
    FROM public_complaints pc
    INNER JOIN stations s ON s.id = pc.station_id
    LEFT JOIN users u ON u.id = pc.user_id
    LEFT JOIN mera_users mu ON mu.id = pc.assigned_officer_id
    WHERE pc.public_id = ${scopedPublicId}
    LIMIT 1
  `
  const row = rows?.[0]
  if (!row?.public_id) throw notFound("Complaint media not found")
  ensureDistrictAccess(auth, row.city, "complaint media")

  return {
    document: {
      id: row.public_id,
      documentType: "COMPLAINT_MEDIA",
      evidenceType: "COMPLAINT_MEDIA",
      title: `Complaint media ${row.public_id}`,
      description: row.complaint_description || null,
      fileUrl: row.media_url || null,
      createdAt: row.created_at,
      uploadedBy: row.complainant_public_id
        ? {
            publicId: row.complainant_public_id,
            fullName: row.complainant_name,
            email: row.complainant_email,
            phone: row.complainant_phone,
          }
        : null,
    },
    complaint: row,
    station: {
      publicId: row.station_public_id,
      name: row.station_name,
      city: row.city || null,
    },
    activity: [
      { action: "COMPLAINT_MEDIA_CAPTURED", description: row.media_url ? "Complaint media captured." : "No media file was uploaded for this complaint.", createdAt: row.created_at },
      { action: "COMPLAINT_UPDATED", description: "Complaint record last updated.", createdAt: row.updated_at },
    ],
  }
}

export async function getUserDetail(publicId, auth) {
  ensurePermission(auth, [MERA_PERMISSIONS.USERS_VIEW])
  const scopedDistrict = districtScope(auth)
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
      mu.updated_at,
      mr.code AS role_code,
      mr.display_name AS role_display_name
    FROM mera_users mu
    INNER JOIN mera_roles mr ON mr.id = mu.role_id
    WHERE mu.public_id = ${publicId}
      AND (${scopedDistrict === ""} = TRUE OR mu.district_scope = ${scopedDistrict})
    LIMIT 1
  `
  const user = rows?.[0]
  if (!user?.public_id) throw notFound("User not found")
  const [audit, tasks] = await Promise.all([
    hasAnyPermission(auth, [MERA_PERMISSIONS.AUDIT_VIEW])
      ? prisma.$queryRaw`
          SELECT action_type, action_description, affected_entity, created_at
          FROM audit_logs_mera
          WHERE actor_id = (
            SELECT id FROM mera_users WHERE public_id = ${publicId} LIMIT 1
          )
          ORDER BY created_at DESC
          LIMIT 30
        `
      : Promise.resolve([]),
    hasAnyPermission(auth, [MERA_PERMISSIONS.TASKS_VIEW_ALL, MERA_PERMISSIONS.TASKS_VIEW_ASSIGNED, MERA_PERMISSIONS.TASKS_VIEW_EXECUTIVE])
      ? prisma.$queryRaw`
          SELECT task_number, title, type, priority, status, due_at, created_at
          FROM regulator_tasks
          WHERE assigned_to_user_id = (
            SELECT id FROM mera_users WHERE public_id = ${publicId} LIMIT 1
          )
            AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 30
        `
      : Promise.resolve([]),
  ])
  return { user, audit: audit || [], tasks: tasks || [] }
}

export async function getTaskDetail(taskNumber, auth) {
  return getTask(taskNumber, auth)
}
