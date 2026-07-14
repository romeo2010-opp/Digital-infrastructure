import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const root = new URL("../../", import.meta.url)
const source = (path) => readFile(new URL(path, root), "utf8")

test("unfinished payroll is hidden from navigation and aware-search discovery", async () => {
  const [sidebar, search] = await Promise.all([
    source("client/src/app/components/Sidebar.tsx"),
    source("server/src/services/schoolSearchService.js"),
  ])
  assert.doesNotMatch(sidebar, /label:\s*['"]Payroll['"]/)
  assert.doesNotMatch(search, /id:\s*["']payroll["']/)
})

test("staff leave self-service is owner-scoped and separately routed from leadership review", async () => {
  const [routes, service, client, app] = await Promise.all([
    source("server/src/routes/index.js"),
    source("server/src/services/hrOperationsService.js"),
    source("client/src/app/pages/HrOperationsPage.tsx"),
    source("client/src/app/App.tsx"),
  ])
  assert.match(routes, /\/staff\/leave\/me/)
  assert.match(service, /lr\.staff_user_id=\?/)
  assert.match(service, /You can only cancel your own leave request/)
  assert.match(client, /export function MyLeavePage/)
  assert.match(app, /path="\/my-leave"/)
})

test("leadership KPI strips keep four unique cards", async () => {
  const [strip, analytics] = await Promise.all([
    source("client/src/app/components/SectionKpiStrip.tsx"),
    source("server/src/services/directorAnalyticsService.js"),
  ])
  assert.match(strip, /new Map<string, SectionKpiItem>/)
  assert.match(strip, /slice\(0, 4\)/)
  assert.match(analytics, /selectedKpis/)
  assert.match(analytics, /slice\(0, 4\)/)
})

test("director navigation is an accordion and blank syllabus creation is explicit", async () => {
  const [sidebar, syllabus] = await Promise.all([
    source("client/src/app/components/Sidebar.tsx"),
    source("client/src/app/pages/SyllabusIntelligencePage.tsx"),
  ])
  assert.match(sidebar, /current\[label\] \? \{\} : \{ \[label\]: true \}/)
  assert.match(syllabus, /New blank document/)
  assert.match(syllabus, /Uploading material is optional/)
  assert.match(syllabus, /navigate\('\/syllabus\/create'\)/)
})
