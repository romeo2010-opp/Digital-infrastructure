import test from "node:test"
import assert from "node:assert/strict"
import {
  expandSearchTerms,
  fullSearch,
  navigationResults,
  normalizeSearchQuery,
  quickSearch,
  scoreSearchFields,
} from "../modules/mera/services/search.service.js"
import { MERA_PERMISSIONS } from "../modules/mera/permissions.js"
import { prisma } from "../db/prisma.js"

test("MERA search normalizes query whitespace and length", () => {
  assert.equal(normalizeSearchQuery("  puma   blantyre  "), "puma blantyre")
  assert.throws(() => normalizeSearchQuery("   "), /search query is required/i)
})

test("MERA search expands licence and license spellings", () => {
  const terms = expandSearchTerms("licence")
  assert.equal(terms.includes("licence"), true)
  assert.equal(terms.includes("license"), true)
  assert.equal(terms.includes("permit"), true)
})

test("MERA search scoring prioritizes exact identifiers over related fields", () => {
  const exact = scoreSearchFields("LIC-2026-00041", {
    exact: { licenseNumber: "LIC-2026-00041" },
    related: { district: "Blantyre" },
  })
  const related = scoreSearchFields("Blantyre", {
    exact: { licenseNumber: "LIC-2026-00041" },
    related: { district: "Blantyre" },
  })

  assert.equal(exact.score, 100)
  assert.equal(exact.matchedField, "licenseNumber")
  assert.equal(related.score < exact.score, true)
})

test("MERA search scoring matches multi-word names across separators", () => {
  const hyphenated = scoreSearchFields("Puma kanengo", {
    names: { stationName: "Puma - Kanengo" },
  })
  const spaced = scoreSearchFields("Puma kanengo", {
    names: { stationName: "Puma Kanengo" },
  })

  assert.equal(hyphenated.score >= 74, true)
  assert.equal(spaced.score >= 94, true)
})

test("MERA navigation search is permission aware", () => {
  const noLicenseUser = { permissions: [MERA_PERMISSIONS.STATIONS_VIEW] }
  const licenseUser = { permissions: [MERA_PERMISSIONS.LICENSES_VIEW] }

  assert.equal(navigationResults("license", noLicenseUser).some((item) => item.id === "nav-licences"), false)
  assert.equal(navigationResults("license", licenseUser).some((item) => item.id === "nav-licences"), true)
})

test("MERA station manager search honors station permissions and district scope", async () => {
  const originalQueryRaw = prisma.$queryRaw
  const calls = []

  prisma.$queryRaw = async (strings, ...values) => {
    const sql = Array.from(strings || []).join(" ")
    calls.push(values)
    if (sql.includes("FROM users u") && sql.includes("station_staff ss")) return [
      {
        public_id: "USER-MANAGER-001",
        full_name: "Inspector Banda",
        email: "banda@example.com",
        phone_e164: "+265991000001",
        is_active: 1,
        station_count: 2,
        primary_district: "Blantyre",
        station_names: "Puma Nyambadwe, Puma Limbe",
        districts: "Blantyre",
        updated_at: new Date("2026-01-01T00:00:00Z"),
      },
    ]
    return []
  }

  try {
    const result = await quickSearch(
      { q: "Banda", limit: 10 },
      {
        permissions: [MERA_PERMISSIONS.STATIONS_VIEW_DISTRICT],
        districtScope: "Blantyre",
      }
    )
    const managers = result.groups.find((group) => group.type === "stationManagers")

    assert.ok(calls.some((values) => values.includes("Blantyre")))
    assert.equal(managers?.results?.[0]?.resultType, "STATION_MANAGER")
    assert.equal(managers?.results?.[0]?.district, "Blantyre")
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("MERA search returns district and region location results", async () => {
  const originalQueryRaw = prisma.$queryRaw

  prisma.$queryRaw = async (strings) => {
    const sql = Array.from(strings || []).join(" ")
    if (sql.includes("GROUP BY s.city")) {
      return [
        {
          district: "Blantyre",
          station_count: 4,
          licence_count: 3,
          active_station_count: 4,
        },
      ]
    }
    return []
  }

  try {
    const result = await quickSearch(
      { q: "Bla", limit: 10 },
      {
        permissions: [MERA_PERMISSIONS.STATIONS_VIEW],
      }
    )
    const locations = result.groups.find((group) => group.type === "locations")

    assert.equal(locations?.results?.some((item) => item.resultType === "DISTRICT" && item.district === "Blantyre"), true)
    assert.equal(locations?.results?.some((item) => item.resultType === "REGION" && item.title === "Southern Region"), true)
  } finally {
    prisma.$queryRaw = originalQueryRaw
  }
})

test("MERA full search accepts the API q parameter", async () => {
  const result = await fullSearch({ q: "settings", type: "all", page: 1, limit: 20 }, { permissions: [] })

  assert.equal(result.query, "settings")
  assert.equal(result.results.some((item) => item.id === "nav-settings"), true)
})
