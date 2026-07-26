import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { signSession } from "../src/middleware/auth.js"
import { signTeamSession, verifyTeamSessionToken } from "../src/middleware/teamAuth.js"
import { TEAM_PERMISSIONS, hasTeamPermission } from "../src/services/teamAccessService.js"
import {
  deriveSubscriptionStatus,
  recalculateOnboardingProgress,
  validateCriticalStageInput,
} from "../src/services/teamSuiteService.js"
import { splitSqlStatements } from "../scripts/lib/portableSql.mjs"

const source = (path) => readFile(new URL(path, import.meta.url), "utf8")

test("Team Suite JWTs are audience-separated from school tenant sessions", () => {
  const teamToken = signTeamSession({ id: 42 })
  assert.deepEqual(verifyTeamSessionToken(teamToken), { id: 42, workspace: "team" })
  const schoolToken = signSession({ id: 42, schoolId: 1, role: "school_owner", email: "owner@example.test", fullName: "Owner" })
  assert.throws(() => verifyTeamSessionToken(schoolToken))
})

test("Team permissions are explicit and never inferred from a school role", () => {
  const outreach = { permissions: [TEAM_PERMISSIONS.SCHOOLS_VIEW_ASSIGNED, TEAM_PERMISSIONS.SCHOOLS_CREATE] }
  assert.equal(hasTeamPermission(outreach, TEAM_PERMISSIONS.SCHOOLS_CREATE), true)
  assert.equal(hasTeamPermission(outreach, TEAM_PERMISSIONS.DISCOUNTS_APPROVE), false)
  assert.equal(hasTeamPermission({ role: "school_owner", permissions: [] }, TEAM_PERMISSIONS.SCHOOLS_VIEW_ALL), false)
})

test("Closed Lost requires a stored loss reason", () => {
  assert.throws(() => validateCriticalStageInput("closed_lost", {}), /Loss reason is required/)
  assert.deepEqual(validateCriticalStageInput("closed_lost", { loss_reason: "no_budget" }), { lossReason: "no_budget" })
})

test("Contract Signed and Closed Won require commercial handoff evidence", () => {
  assert.throws(() => validateCriticalStageInput("contract_signed", {}), /Contract attachment or reference is required/)
  const signed = validateCriticalStageInput("contract_signed", {
    contract_reference: "contract-evidence-ref",
    signing_date: "2026-07-26",
    final_price: 1800000,
    payment_schedule: "Two instalments",
    implementation_owner_ref: "00000000-0000-0000-0000-000000000001",
    planned_onboarding_date: "2026-08-01",
  })
  assert.equal(signed.finalPrice, 1800000)
  assert.throws(() => validateCriticalStageInput("closed_won", { contract_reference: "ref" }), /Final agreement value is required/)
})

test("onboarding progress derives from checklist records", async () => {
  const calls = []
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (String(sql).startsWith("SELECT")) return [[{ total_items: 19, completed_items: 5 }]]
      return [{ affectedRows: 1 }]
    },
  }
  assert.equal(await recalculateOnboardingProgress(connection, 7), 26.32)
  assert.match(calls[1].sql, /UPDATE team_onboarding_projects SET completion_percentage=\? WHERE id=\?/)
})

test("subscription alert status is deterministic and never suspends a school", () => {
  const now = new Date("2026-07-26T12:00:00Z")
  assert.equal(deriveSubscriptionStatus({ expires_on: "2026-08-09", payment_status: "paid", status: "active", grace_period_days: 7 }, now), "renewal_approaching")
  assert.equal(deriveSubscriptionStatus({ expires_on: "2026-07-20", payment_status: "paid", status: "active", grace_period_days: 10 }, now), "grace_period")
  assert.equal(deriveSubscriptionStatus({ expires_on: "2026-09-20", payment_status: "overdue", status: "active" }, now), "payment_overdue")
})

test("Team Suite migration is additive, tenant-separated, indexed, and relational", async () => {
  const migration = await source("../database/066_smartlink_team_suite.sql")
  const statements = splitSqlStatements(migration)
  assert.ok(statements.length >= 30)
  for (const table of ["team_users", "team_user_roles", "team_school_prospects", "team_school_contacts", "team_sales_opportunities", "team_opportunity_stage_history", "team_tasks", "team_meetings", "team_proposals", "team_onboarding_projects", "team_subscriptions", "team_support_tickets", "team_notifications", "team_audit_logs"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`))
  }
  assert.match(migration, /tenant_school_id BIGINT UNSIGNED NULL/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM (?:users|schools)\b/i)
  assert.match(migration, /KEY idx_team_school_assignment/)
  assert.match(migration, /CONSTRAINT fk_team_school_tenant FOREIGN KEY/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS team_contact_classifications/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS team_proposal_modules/)
})

test("backend routes enforce authentication and permissions before Team Suite workflows", async () => {
  const [routes, rootRoutes, access, crm, commercial, work] = await Promise.all([
    source("../src/routes/team.routes.js"),
    source("../src/routes/index.js"),
    source("../src/services/teamAccessService.js"),
    source("../src/controllers/teamCrmController.js"),
    source("../src/controllers/teamCommercialController.js"),
    source("../src/controllers/teamWorkController.js"),
  ])
  assert.match(rootRoutes, /router\.use\("\/team", teamRoutes\)/)
  assert.match(routes, /router\.use\(requireTeamAuth\)/)
  assert.match(routes, /router\.use\(requireTeamPasswordReady\)/)
  assert.match(routes, /DISCOUNTS_APPROVE/)
  assert.match(routes, /ONBOARDING_APPROVE_GO_LIVE/)
  assert.match(access, /return 404 so record existence is not disclosed across assignments/)
  assert.match(crm, /team_opportunity_stage_history/)
  assert.match(crm, /Proposal Sent requires an approved proposal/)
  assert.match(commercial, /You cannot approve your own restricted discount request/)
  assert.match(commercial, /Onboarding can only be created for a Closed Won opportunity/)
  assert.match(work, /CASE WHEN task\.due_at<CURRENT_TIMESTAMP/)
})

test("audit records have no application update or delete route", async () => {
  const [routes, management] = await Promise.all([source("../src/routes/team.routes.js"), source("../src/controllers/teamManagementController.js")])
  assert.match(routes, /router\.get\("\/audit-log"/)
  assert.doesNotMatch(routes, /router\.(?:patch|put|delete)\("\/audit-log/)
  assert.doesNotMatch(management, /UPDATE team_audit_logs|DELETE FROM team_audit_logs/)
})

test("the client isolates /team before the school PortalProvider", async () => {
  const [app, teamApp, shell, api] = await Promise.all([
    source("../../client/src/app/App.tsx"),
    source("../../client/src/app/team/TeamSuiteApp.tsx"),
    source("../../client/src/app/team/TeamShell.tsx"),
    source("../../client/src/app/team/teamApi.ts"),
  ])
  const teamBranch = app.indexOf("window.location.pathname.startsWith('/team')")
  const schoolProvider = app.indexOf("<PortalProvider>")
  assert.ok(teamBranch > 0 && teamBranch < schoolProvider)
  assert.match(teamApp, /path="\/team\/dashboard"/)
  assert.match(teamApp, /path="\/team\/schools\/:schoolRef"/)
  assert.match(teamApp, /path="\/team\/audit-log"/)
  assert.match(shell, /SmartLink Team Suite/)
  assert.match(api, /smartlink\.team\.session\.v1/)
  assert.doesNotMatch(api, /smartlink.*school.*session/i)
})

test("demo seeding is opt-in, fictional, and does not commit a password", async () => {
  const seed = await source("../scripts/seed-team-suite.mjs")
  assert.match(seed, /ALLOW_TEAM_DEMO_SEED/)
  assert.match(seed, /ALLOW_PRODUCTION_DEMO_SEED/)
  assert.match(seed, /TEAM_DEMO_PASSWORD/)
  assert.match(seed, /example\.test/)
  assert.doesNotMatch(seed, /TEAM_DEMO_PASSWORD\s*\|\|\s*["'][^"']{10}/)
  assert.match(seed, /must change the temporary password/i)
})
