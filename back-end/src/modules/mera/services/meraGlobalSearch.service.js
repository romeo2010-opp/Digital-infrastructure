import { prisma } from "../../../db/prisma.js"

const MALAWI_LOCATIONS = [
  "Lilongwe",
  "Blantyre",
  "Mzuzu",
  "Zomba",
  "Limbe",
  "Area 25",
  "Kameza",
  "Nyambadwe",
  "Kasungu",
  "Salima",
  "Mangochi",
  "Mchinji",
]

const INTENT_SYNONYMS = {
  hoarding: ["hoarding", "hiding fuel", "withholding fuel", "fuel reserved", "not selling", "artificial shortage"],
  queue_manipulation: ["queue manipulation", "jumping queue", "favouritism", "corruption", "skipping", "priority abuse"],
  shortage: ["shortage", "no fuel", "dry", "unavailable", "fuel shortage"],
  price_violation: ["overcharging", "price violation", "expensive", "above official price", "illegal price", "price issue"],
  complaint: ["complaint", "complaints", "reported", "public report"],
  inspection: ["inspection", "inspect", "overdue inspection", "field visit"],
  delivery: ["delivery", "tanker", "offload", "depot", "delivery-to-sale"],
  report_lookup: ["report", "reports", "export", "evidence pack"],
  station_lookup: ["station", "stations", "fuel station", "service station"],
  case_lookup: ["case", "cases", "investigation", "enforcement"],
}

const NAV_DESTINATIONS = [
  { title: "Command Centre", route: "/dashboard", keywords: ["command centre", "dashboard", "national overview", "home"] },
  { title: "Live Map", route: "/national-heat-intelligence-map", keywords: ["fuel map", "live map", "map", "heatmap"] },
  { title: "Fuel Supply", route: "/fuel-deliveries", keywords: ["fuel supply", "deliveries", "delivery", "tanker"] },
  { title: "Stations", route: "/station-regulatory-profiles", keywords: ["stations", "station profiles", "station registry"] },
  { title: "Risk Watchlist", route: "/hoarding-watchlist", keywords: ["watchlist", "risk", "alerts", "hoarding"] },
  { title: "Complaints", route: "/complaints-center", keywords: ["complaints", "complaint center"] },
  { title: "Cases", route: "/compliance-flags", keywords: ["cases", "case management"] },
  { title: "Inspections", route: "/field-inspections", keywords: ["inspections", "inspection board"] },
  { title: "Price Compliance", route: "/price-compliance", keywords: ["price compliance", "price violation", "prices"] },
  { title: "Reports", route: "/reports-intelligence", keywords: ["reports", "exports"] },
  { title: "Public Notices", route: "/public-notices", keywords: ["public notices", "notices", "communication"] },
  { title: "Analytics", route: "/analytics", keywords: ["analytics", "fuel stress"] },
  { title: "Users & Roles", route: "/settings/users", keywords: ["users", "roles", "access"] },
  { title: "Audit Logs", route: "/settings/audit", keywords: ["audit logs", "audit", "logs"] },
  { title: "Settings", route: "/settings/preferences", keywords: ["settings", "preferences"] },
]

function lower(value) {
  return String(value || "").trim().toLowerCase()
}

function includesAny(query, phrases = []) {
  return phrases.some((phrase) => lower(query).includes(lower(phrase)))
}

function firstIntent(query) {
  for (const [intent, phrases] of Object.entries(INTENT_SYNONYMS)) {
    if (includesAny(query, phrases)) return intent
  }
  return null
}

function locationFromQuery(query) {
  const normalized = lower(query)
  return MALAWI_LOCATIONS.find((location) => normalized.includes(lower(location))) || null
}

function fuelTypeFromQuery(query) {
  const normalized = lower(query)
  if (normalized.includes("petrol") || normalized.includes("gasoline")) return "PETROL"
  if (normalized.includes("diesel")) return "DIESEL"
  if (normalized.includes("paraffin") || normalized.includes("kerosene")) return "PARAFFIN"
  return null
}

function severityFromQuery(query) {
  const normalized = lower(query)
  if (normalized.includes("critical") || normalized.includes("crisis") || normalized.includes("severe")) return "critical"
  if (normalized.includes("high")) return "high"
  if (normalized.includes("medium") || normalized.includes("moderate")) return "medium"
  if (normalized.includes("low")) return "low"
  return null
}

function dateHintFromQuery(query) {
  const normalized = lower(query)
  if (normalized.includes("today")) return "today"
  if (normalized.includes("yesterday")) return "yesterday"
  if (normalized.includes("this week")) return "this_week"
  if (normalized.includes("last week")) return "last_week"
  const isoDate = normalized.match(/\b\d{4}-\d{2}-\d{2}\b/)
  return isoDate?.[0] || null
}

async function stationNameFromQuery(query) {
  const like = `%${String(query || "").trim().replace(/\s+/g, "%")}%`
  const rows = await prisma.$queryRaw`
    SELECT public_id, name
    FROM stations
    WHERE name LIKE ${like}
    ORDER BY LENGTH(name) ASC
    LIMIT 1
  `.catch(() => [])
  return rows?.[0] ? { stationId: rows[0].public_id, stationName: rows[0].name } : null
}

export async function parseMeraSearchQuery(query) {
  const station = await stationNameFromQuery(query)
  return {
    intent: firstIntent(query),
    location: locationFromQuery(query),
    stationName: station?.stationName || null,
    stationId: station?.stationId || null,
    fuelType: fuelTypeFromQuery(query),
    severity: severityFromQuery(query),
    dateHint: dateHintFromQuery(query),
  }
}

function routeResult({ id, title, subtitle, route, resultType, status = null, district = null, station = null, score = 60 }) {
  return {
    id,
    title,
    subtitle,
    route,
    resultType,
    status,
    district,
    station,
    score,
    matchedField: "MERA command search",
  }
}

async function extraGroupResults(query, parsedIntent, auth, limit = 5) {
  const like = `%${String(query || "").trim().replace(/\s+/g, "%")}%`
  const location = parsedIntent.location
  const scopedDistrict = String(auth?.districtScope || "").trim()
  const [alerts, cases, inspections, deliveries, prices, notices] = await Promise.all([
    prisma.$queryRaw`
      SELECT ma.public_id, ma.type, ma.severity, ma.title, ma.status, s.name AS station_name, COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
      FROM mera_alerts ma
      LEFT JOIN stations s ON s.id = ma.station_id
      WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
        AND (ma.title LIKE ${like} OR ma.type LIKE ${like} OR s.name LIKE ${like} OR s.city LIKE ${like})
      ORDER BY ma.created_at DESC
      LIMIT ${limit}
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT mc.public_id, mc.title, mc.type, mc.status, mc.severity, s.name AS station_name, COALESCE(NULLIF(s.city, ''), mc.district, 'Unknown') AS district
      FROM mera_cases mc
      LEFT JOIN stations s ON s.id = mc.station_id
      WHERE (${scopedDistrict === ""} = TRUE OR COALESCE(s.city, mc.district) = ${scopedDistrict})
        AND (mc.title LIKE ${like} OR mc.type LIKE ${like} OR mc.public_id LIKE ${like} OR s.name LIKE ${like} OR s.city LIKE ${like})
      ORDER BY mc.updated_at DESC
      LIMIT ${limit}
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT i.public_id, i.reason, i.priority, COALESCE(i.status, LOWER(i.inspection_status)) AS status, s.name AS station_name, COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
      FROM inspections i
      INNER JOIN stations s ON s.id = i.station_id
      WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
        AND (i.public_id LIKE ${like} OR i.reason LIKE ${like} OR s.name LIKE ${like} OR s.city LIKE ${like})
      ORDER BY i.updated_at DESC
      LIMIT ${limit}
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT fdl.public_id, fdl.id, fdl.fuel_type, fdl.status, fdl.delivery_time, s.name AS station_name, COALESCE(NULLIF(s.city, ''), 'Unknown') AS district
      FROM fuel_delivery_logs fdl
      INNER JOIN stations s ON s.id = fdl.station_id
      WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
        AND (fdl.fuel_type LIKE ${like} OR fdl.status LIKE ${like} OR s.name LIKE ${like} OR s.city LIKE ${like})
      ORDER BY fdl.delivery_time DESC
      LIMIT ${limit}
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT s.public_id AS station_public_id, s.name AS station_name, COALESCE(NULLIF(s.city, ''), 'Unknown') AS district, fpr.petrol_price, fpr.diesel_price, fpr.created_at
      FROM fuel_price_reports fpr
      INNER JOIN stations s ON s.id = fpr.station_id
      WHERE (${scopedDistrict === ""} = TRUE OR s.city = ${scopedDistrict})
        AND (s.name LIKE ${like} OR s.city LIKE ${like})
      ORDER BY fpr.created_at DESC
      LIMIT ${limit}
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT public_id, title, category, status, target_district, created_at
      FROM public_notices
      WHERE title LIKE ${like} OR category LIKE ${like} OR target_district LIKE ${like}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `.catch(() => []),
  ])

  const navigation = NAV_DESTINATIONS
    .filter((item) => includesAny(query, [item.title, ...item.keywords]))
    .slice(0, limit)
    .map((item) => routeResult({
      id: `nav-${item.route}`,
      title: item.title,
      subtitle: "Open MERA command-centre destination",
      route: item.route,
      resultType: "NAVIGATION",
      score: 95,
    }))

  return {
    alerts: (alerts || []).map((row) => routeResult({
      id: row.public_id,
      title: row.title || row.type,
      subtitle: `${row.type} at ${row.station_name || "station"}`,
      route: "/hoarding-watchlist",
      resultType: "ALERT",
      status: row.status,
      district: row.district,
      station: row.station_name,
      score: 88,
    })),
    casesExtra: (cases || []).map((row) => routeResult({
      id: row.public_id,
      title: row.title,
      subtitle: row.type,
      route: `/cases/${encodeURIComponent(row.public_id)}`,
      resultType: "CASE",
      status: row.status,
      district: row.district,
      station: row.station_name,
      score: 86,
    })),
    inspections: (inspections || []).map((row) => routeResult({
      id: row.public_id,
      title: row.reason || `Inspection ${row.public_id}`,
      subtitle: row.station_name,
      route: "/field-inspections",
      resultType: "INSPECTION",
      status: row.status,
      district: row.district,
      station: row.station_name,
      score: parsedIntent.intent === "inspection" ? 92 : 72,
    })),
    deliveries: (deliveries || []).map((row) => routeResult({
      id: row.public_id || `FDL-${row.id}`,
      title: `${row.fuel_type} delivery - ${row.station_name}`,
      subtitle: row.delivery_time,
      route: "/fuel-deliveries",
      resultType: "DELIVERY",
      status: row.status,
      district: row.district,
      station: row.station_name,
      score: parsedIntent.intent === "delivery" ? 92 : 70,
    })),
    prices: (prices || []).map((row) => routeResult({
      id: `price-${row.station_public_id}-${row.created_at}`,
      title: `Price record - ${row.station_name}`,
      subtitle: `Petrol ${row.petrol_price ?? "-"} / Diesel ${row.diesel_price ?? "-"}`,
      route: "/price-compliance",
      resultType: "PRICE",
      district: row.district,
      station: row.station_name,
      score: parsedIntent.intent === "price_violation" ? 92 : 68,
    })),
    notices: (notices || []).map((row) => routeResult({
      id: row.public_id,
      title: row.title,
      subtitle: row.category,
      route: "/public-notices",
      resultType: "NOTICE",
      status: row.status,
      district: row.target_district,
      score: 66,
    })),
    navigation,
    parsedLocation: location,
  }
}

function mergeGroups(existingGroups = [], extra = {}) {
  const groupsByType = new Map(existingGroups.map((group) => [group.type, { ...group, results: [...(group.results || [])] }]))
  const upsert = (type, label, results = []) => {
    if (!results.length) return
    const current = groupsByType.get(type) || { type, label, results: [] }
    const seen = new Set(current.results.map((item) => `${item.resultType}:${item.id}`))
    results.forEach((item) => {
      const key = `${item.resultType}:${item.id}`
      if (!seen.has(key)) {
        current.results.push(item)
        seen.add(key)
      }
    })
    current.count = current.results.length
    groupsByType.set(type, current)
  }

  upsert("navigation", "Navigation", extra.navigation)
  upsert("cases", "Regulatory Cases", extra.casesExtra)
  upsert("alerts", "Alerts / Watchlist", extra.alerts)
  upsert("inspections", "Inspections", extra.inspections)
  upsert("deliveries", "Fuel Deliveries", extra.deliveries)
  upsert("prices", "Price Records", extra.prices)
  upsert("publicNotices", "Public Notices", extra.notices)
  return [...groupsByType.values()].filter((group) => group.results.length)
}

export async function augmentSearchResponse(payload = {}, query, auth, { limit = 5 } = {}) {
  const parsedIntent = await parseMeraSearchQuery(query)
  const extra = await extraGroupResults(query, parsedIntent, auth, limit)
  const groups = mergeGroups(payload.groups || [], extra)
  const total = groups.reduce((sum, group) => sum + (group.results?.length || 0), 0)
  return { ...payload, parsedIntent, groups, total }
}

export async function searchSuggestions({ q = "", limit = 8 } = {}, auth = null) {
  const query = String(q || "").trim()
  if (!query) return { query, suggestions: [] }
  const parsedIntent = await parseMeraSearchQuery(query)
  const extra = await extraGroupResults(query, parsedIntent, auth, Number(limit) || 8)
  const suggestions = [
    ...extra.navigation,
    ...extra.alerts,
    ...extra.casesExtra,
    ...extra.inspections,
    ...extra.deliveries,
  ].slice(0, Number(limit) || 8)
  return { query, parsedIntent, suggestions }
}
