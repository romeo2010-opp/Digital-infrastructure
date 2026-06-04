import { Router } from "express"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { toFleetCsv } from "./reports.js"
import {
  acceptInvitationSchema,
  alertIdParamsSchema,
  allocationIdParamsSchema,
  approveFuelRequestSchema,
  assignDriverSchema,
  cancelFuelRequestSchema,
  createFleetAccountSchema,
  departmentIdParamsSchema,
  fleetIdParamsSchema,
  fleetAllocationAdjustmentSchema,
  fleetAllocationRolloverSchema,
  fleetAllocationV2Schema,
  fleetAllocationV2UpdateSchema,
  fleetAllocationSchema,
  financialOpsListQuerySchema,
  financialOpsQuerySchema,
  financialRecordIdParamsSchema,
  fleetBudgetSchema,
  fleetDepartmentSchema,
  fleetFuelCardImportSchema,
  fleetFuelCardProviderSchema,
  fleetFuelCardReconciliationActionSchema,
  fleetFuelCardSchema,
  fleetFuelNowCompleteSchema,
  fleetFuelNowSchema,
  fleetInvoiceSchema,
  fleetMaintenanceSchema,
  fleetRouteActivitySchema,
  fleetTransactionSchema,
  fleetVehicleLiveStateSchema,
  fuelRequestQuerySchema,
  fuelRequestSchema,
  fuelingSessionIdParamsSchema,
  fuelCardIdParamsSchema,
  invitationQuerySchema,
  invitationIdParamsSchema,
  inviteMemberSchema,
  memberIdParamsSchema,
  policyIdParamsSchema,
  policySchema,
  reconciliationMatchIdParamsSchema,
  rejectFuelRequestSchema,
  reportQuerySchema,
  requestFleetAccessSchema,
  requestIdParamsSchema,
  transactionQuerySchema,
  updateFleetAccountSchema,
  updateMemberRoleSchema,
  updateMemberStatusSchema,
  vehicleIdParamsSchema,
  vehicleSchema,
  walletTopupSchema,
  walletTransactionsQuerySchema,
} from "./schemas.js"
import * as fleetService from "./service.js"

const router = Router()

router.get(
  "/fleet/memberships/me",
  asyncHandler(async (req, res) => {
    const data = await fleetService.listCurrentUserFleetMemberships(req.auth)
    return ok(res, data)
  })
)

router.post(
  "/fleet/access-requests",
  asyncHandler(async (req, res) => {
    const body = requestFleetAccessSchema.parse(req.body || {})
    const data = await fleetService.requestFleetAccess({ auth: req.auth, payload: body, req })
    return ok(res, data, 201)
  })
)

router.post(
  "/fleet/invitations/accept",
  asyncHandler(async (req, res) => {
    const body = acceptInvitationSchema.parse(req.body || {})
    const data = await fleetService.acceptFleetInvitation({ auth: req.auth, invitationId: body.invitationId, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts",
  asyncHandler(async (req, res) => {
    const body = createFleetAccountSchema.parse(req.body || {})
    const data = await fleetService.createFleetAccount({ auth: req.auth, payload: body, req })
    return ok(res, data, 201)
  })
)

router.get(
  "/fleet/accounts/:fleetId",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.getFleetAccountDetails({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.patch(
  "/fleet/accounts/:fleetId",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = updateFleetAccountSchema.parse(req.body || {})
    const data = await fleetService.updateFleetAccount({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/suspend",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.updateFleetStatus({ auth: req.auth, fleetId: params.fleetId, status: "suspended", req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/archive",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.updateFleetStatus({ auth: req.auth, fleetId: params.fleetId, status: "archived", req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/dashboard",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.getFleetDashboardSummary({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/financial-ops",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = financialOpsQuerySchema.parse(req.query || {})
    const data = await fleetService.getFleetFinancialOps({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/departments",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetDepartments({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/departments",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetDepartmentSchema.parse(req.body || {})
    const data = await fleetService.saveFleetDepartment({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/departments/:departmentId",
  asyncHandler(async (req, res) => {
    const params = departmentIdParamsSchema.parse(req.params || {})
    const body = fleetDepartmentSchema.partial().parse(req.body || {})
    const data = await fleetService.saveFleetDepartment({ auth: req.auth, fleetId: params.fleetId, departmentId: params.departmentId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/departments/:departmentId/archive",
  asyncHandler(async (req, res) => {
    const params = departmentIdParamsSchema.parse(req.params || {})
    const data = await fleetService.archiveFleetDepartment({ auth: req.auth, fleetId: params.fleetId, departmentId: params.departmentId, req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/allocations",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetAllocations({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/allocations",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetAllocationV2Schema.parse(req.body || {})
    const data = await fleetService.saveFleetAllocation({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/allocations/:allocationId",
  asyncHandler(async (req, res) => {
    const params = allocationIdParamsSchema.parse(req.params || {})
    const body = fleetAllocationV2UpdateSchema.parse(req.body || {})
    const data = await fleetService.saveFleetAllocation({ auth: req.auth, fleetId: params.fleetId, allocationId: params.allocationId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/allocations/:allocationId/adjustments",
  asyncHandler(async (req, res) => {
    const params = allocationIdParamsSchema.parse(req.params || {})
    const body = fleetAllocationAdjustmentSchema.parse(req.body || {})
    const data = await fleetService.adjustFleetAllocation({ auth: req.auth, fleetId: params.fleetId, allocationId: params.allocationId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.post(
  "/fleet/accounts/:fleetId/allocations/rollover-preview",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetAllocationRolloverSchema.parse(req.body || {})
    const data = await fleetService.previewFleetAllocationRollover({ auth: req.auth, fleetId: params.fleetId, payload: body })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/allocations/rollover-execute",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetAllocationRolloverSchema.parse(req.body || {})
    const data = await fleetService.executeFleetAllocationRollover({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/allocations/usage-summary",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.getFleetAllocationUsageSummary({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/fuel-card-providers",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetFuelCardProviders({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-card-providers",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetFuelCardProviderSchema.parse(req.body || {})
    const data = await fleetService.saveFleetFuelCardProvider({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.get(
  "/fleet/accounts/:fleetId/fuel-cards",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetFuelCards({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-cards",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetFuelCardSchema.parse(req.body || {})
    const data = await fleetService.saveFleetFuelCard({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/fuel-cards/:fuelCardId",
  asyncHandler(async (req, res) => {
    const params = fuelCardIdParamsSchema.parse(req.params || {})
    const body = fleetFuelCardSchema.partial().parse(req.body || {})
    const data = await fleetService.saveFleetFuelCard({ auth: req.auth, fleetId: params.fleetId, fuelCardId: params.fuelCardId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-card-imports",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetFuelCardImportSchema.parse(req.body || {})
    const data = await fleetService.createFleetFuelCardImport({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.get(
  "/fleet/accounts/:fleetId/fuel-card-reconciliation",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetFuelCardReconciliation({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-card-reconciliation/:matchId/match",
  asyncHandler(async (req, res) => {
    const params = reconciliationMatchIdParamsSchema.parse(req.params || {})
    const body = fleetFuelCardReconciliationActionSchema.parse({ ...(req.body || {}), status: "matched" })
    const data = await fleetService.updateFleetFuelCardReconciliation({ auth: req.auth, fleetId: params.fleetId, matchId: params.matchId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-card-reconciliation/:matchId/flag",
  asyncHandler(async (req, res) => {
    const params = reconciliationMatchIdParamsSchema.parse(req.params || {})
    const body = fleetFuelCardReconciliationActionSchema.parse({ status: "needs_review", ...(req.body || {}) })
    const data = await fleetService.updateFleetFuelCardReconciliation({ auth: req.auth, fleetId: params.fleetId, matchId: params.matchId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/members/invite",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = inviteMemberSchema.parse(req.body || {})
    const data = await fleetService.inviteFleetMember({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.get(
  "/fleet/accounts/:fleetId/members",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetMembers({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/invitations",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = invitationQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetInvitations({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/invitations/:invitationId/resend",
  asyncHandler(async (req, res) => {
    const params = invitationIdParamsSchema.parse(req.params || {})
    const data = await fleetService.resendFleetInvitation({ auth: req.auth, fleetId: params.fleetId, invitationId: params.invitationId, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/invitations/:invitationId/cancel",
  asyncHandler(async (req, res) => {
    const params = invitationIdParamsSchema.parse(req.params || {})
    const data = await fleetService.cancelFleetInvitation({ auth: req.auth, fleetId: params.fleetId, invitationId: params.invitationId, req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/members/:memberId",
  asyncHandler(async (req, res) => {
    const params = memberIdParamsSchema.parse(req.params || {})
    const data = await fleetService.getFleetMemberDetails({
      auth: req.auth,
      fleetId: params.fleetId,
      memberId: params.memberId,
    })
    return ok(res, data)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/members/:memberId/role",
  asyncHandler(async (req, res) => {
    const params = memberIdParamsSchema.parse(req.params || {})
    const body = updateMemberRoleSchema.parse(req.body || {})
    const data = await fleetService.updateFleetMemberRole({
      auth: req.auth,
      fleetId: params.fleetId,
      memberId: params.memberId,
      role: body.role,
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/members/:memberId/suspend",
  asyncHandler(async (req, res) => {
    const params = memberIdParamsSchema.parse(req.params || {})
    const body = updateMemberStatusSchema.parse(req.body || {})
    const data = await fleetService.updateFleetMemberStatus({
      auth: req.auth,
      fleetId: params.fleetId,
      memberId: params.memberId,
      status: "suspended",
      reason: body.reason || "",
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/members/:memberId/remove",
  asyncHandler(async (req, res) => {
    const params = memberIdParamsSchema.parse(req.params || {})
    const body = updateMemberStatusSchema.parse(req.body || {})
    const data = await fleetService.updateFleetMemberStatus({
      auth: req.auth,
      fleetId: params.fleetId,
      memberId: params.memberId,
      status: "removed",
      reason: body.reason || "",
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/invitations/:invitationId/accept",
  asyncHandler(async (req, res) => {
    const params = invitationIdParamsSchema.parse(req.params || {})
    const data = await fleetService.acceptFleetInvitation({ auth: req.auth, invitationId: params.invitationId, req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/vehicles",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetVehicles({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/vehicles",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = vehicleSchema.parse(req.body || {})
    const data = await fleetService.addFleetVehicle({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.get(
  "/fleet/accounts/:fleetId/vehicles/:vehicleId",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const data = await fleetService.getFleetVehicleDetails({ auth: req.auth, fleetId: params.fleetId, vehicleId: params.vehicleId })
    return ok(res, data)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/vehicles/:vehicleId",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const body = vehicleSchema.partial().parse(req.body || {})
    const data = await fleetService.updateFleetVehicle({ auth: req.auth, fleetId: params.fleetId, vehicleId: params.vehicleId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/vehicles/:vehicleId/suspend",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const data = await fleetService.updateFleetVehicleStatus({ auth: req.auth, fleetId: params.fleetId, vehicleId: params.vehicleId, status: "suspended", req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/vehicles/:vehicleId/archive",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const data = await fleetService.updateFleetVehicleStatus({ auth: req.auth, fleetId: params.fleetId, vehicleId: params.vehicleId, status: "archived", req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/vehicles/:vehicleId/assignments",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.parse(req.params || {})
    const body = assignDriverSchema.parse(req.body || {})
    const data = await fleetService.assignDriverToVehicle({ auth: req.auth, fleetId: params.fleetId, vehicleId: params.vehicleId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.delete(
  "/fleet/accounts/:fleetId/vehicles/:vehicleId/assignments/:userPublicId",
  asyncHandler(async (req, res) => {
    const params = vehicleIdParamsSchema.extend({ userPublicId: invitationIdParamsSchema.shape.invitationId }).parse(req.params || {})
    const data = await fleetService.removeDriverAssignment({
      auth: req.auth,
      fleetId: params.fleetId,
      vehicleId: params.vehicleId,
      userPublicId: params.userPublicId,
      req,
    })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/wallet",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.getFleetWallet({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/wallet/transactions",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = walletTransactionsQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetWalletTransactions({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/wallet/topups",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = walletTopupSchema.parse(req.body || {})
    const data = await fleetService.createFleetWalletTopup({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-allocations",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetAllocationSchema.parse(req.body || {})
    const data = await fleetService.createFleetFuelAllocation({
      auth: req.auth,
      fleetId: params.fleetId,
      payload: body,
      req,
    })
    return ok(res, data, 201)
  })
)

router.get(
  "/fleet/accounts/:fleetId/fuel-requests",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = fuelRequestQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetFuelRequests({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-requests/:requestId/approve",
  asyncHandler(async (req, res) => {
    const params = requestIdParamsSchema.parse(req.params || {})
    const body = approveFuelRequestSchema.parse(req.body || {})
    const data = await fleetService.approveFleetFuelRequest({ auth: req.auth, fleetId: params.fleetId, requestId: params.requestId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-requests/:requestId/reject",
  asyncHandler(async (req, res) => {
    const params = requestIdParamsSchema.parse(req.params || {})
    const body = rejectFuelRequestSchema.parse(req.body || {})
    const data = await fleetService.rejectFleetFuelRequest({
      auth: req.auth,
      fleetId: params.fleetId,
      requestId: params.requestId,
      reason: body.reason,
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-requests/:requestId/cancel",
  asyncHandler(async (req, res) => {
    const params = requestIdParamsSchema.parse(req.params || {})
    const body = cancelFuelRequestSchema.parse(req.body || {})
    const data = await fleetService.cancelFleetFuelRequest({
      auth: req.auth,
      fleetId: params.fleetId,
      requestId: params.requestId,
      reason: body.reason || "",
      req,
    })
    return ok(res, data)
  })
)

router.post(
  "/fleet/fuel-requests/expire",
  asyncHandler(async (_req, res) => {
    const data = await fleetService.expireStaleFleetFuelRequests()
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/transactions",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = transactionQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetTransactions({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/transactions",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetTransactionSchema.parse(req.body || {})
    const data = await fleetService.createFleetTransaction({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.get(
  "/fleet/accounts/:fleetId/transactions/export.csv",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = transactionQuerySchema.parse({ ...(req.query || {}), page: 1, limit: 500 })
    const data = await fleetService.listFleetTransactions({ auth: req.auth, fleetId: params.fleetId, filters: query })
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", "attachment; filename=\"fleet-transactions.csv\"")
    return res.status(200).send(toFleetCsv(data.items))
  })
)

router.get(
  "/fleet/accounts/:fleetId/policies",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetPolicies({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/policies",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = policySchema.parse(req.body || {})
    const data = await fleetService.upsertFleetPolicy({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/policies/:policyId",
  asyncHandler(async (req, res) => {
    const params = policyIdParamsSchema.parse(req.params || {})
    const body = policySchema.parse(req.body || {})
    const data = await fleetService.upsertFleetPolicy({ auth: req.auth, fleetId: params.fleetId, policyId: params.policyId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/policies/validate",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fuelRequestSchema.omit({ fleetId: true }).parse(req.body || {})
    const data = await fleetService.validateFleetPolicyForRequest({ auth: req.auth, fleetId: params.fleetId, payload: body })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/alerts",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetAlerts({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/alerts/:alertId/read",
  asyncHandler(async (req, res) => {
    const params = alertIdParamsSchema.parse(req.params || {})
    const data = await fleetService.markFleetAlertRead({ auth: req.auth, fleetId: params.fleetId, alertId: params.alertId })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/reports/:reportType",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.extend({ reportType: invitationIdParamsSchema.shape.invitationId }).parse(req.params || {})
    const query = reportQuerySchema.parse(req.query || {})
    const data = await fleetService.getFleetReport({ auth: req.auth, fleetId: params.fleetId, reportType: params.reportType, filters: query })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/audit-logs",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const data = await fleetService.listFleetAuditLogs({ auth: req.auth, fleetId: params.fleetId })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/budgets",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = financialOpsListQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetBudgets({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/budgets",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetBudgetSchema.parse(req.body || {})
    const data = await fleetService.saveFleetBudget({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/budgets/:recordId",
  asyncHandler(async (req, res) => {
    const params = financialRecordIdParamsSchema.parse(req.params || {})
    const body = fleetBudgetSchema.partial().parse(req.body || {})
    const data = await fleetService.saveFleetBudget({ auth: req.auth, fleetId: params.fleetId, recordId: params.recordId, payload: body, req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/invoices",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = financialOpsListQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetInvoices({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/invoices",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetInvoiceSchema.parse(req.body || {})
    const data = await fleetService.saveFleetInvoice({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/invoices/:recordId",
  asyncHandler(async (req, res) => {
    const params = financialRecordIdParamsSchema.parse(req.params || {})
    const body = fleetInvoiceSchema.partial().parse(req.body || {})
    const data = await fleetService.saveFleetInvoice({ auth: req.auth, fleetId: params.fleetId, recordId: params.recordId, payload: body, req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/maintenance",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = financialOpsListQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetMaintenanceRecords({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/maintenance",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetMaintenanceSchema.parse(req.body || {})
    const data = await fleetService.saveFleetMaintenanceRecord({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/maintenance/:recordId",
  asyncHandler(async (req, res) => {
    const params = financialRecordIdParamsSchema.parse(req.params || {})
    const body = fleetMaintenanceSchema.partial().parse(req.body || {})
    const data = await fleetService.saveFleetMaintenanceRecord({ auth: req.auth, fleetId: params.fleetId, recordId: params.recordId, payload: body, req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/route-activity",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = financialOpsListQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetRouteActivity({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/route-activity",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetRouteActivitySchema.parse(req.body || {})
    const data = await fleetService.saveFleetRouteActivity({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/route-activity/:recordId",
  asyncHandler(async (req, res) => {
    const params = financialRecordIdParamsSchema.parse(req.params || {})
    const body = fleetRouteActivitySchema.partial().parse(req.body || {})
    const data = await fleetService.saveFleetRouteActivity({ auth: req.auth, fleetId: params.fleetId, recordId: params.recordId, payload: body, req })
    return ok(res, data)
  })
)

router.get(
  "/fleet/accounts/:fleetId/vehicle-live-states",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const query = financialOpsListQuerySchema.parse(req.query || {})
    const data = await fleetService.listFleetVehicleLiveStates({ auth: req.auth, fleetId: params.fleetId, filters: query })
    return ok(res, data)
  })
)

router.post(
  "/fleet/accounts/:fleetId/vehicle-live-states",
  asyncHandler(async (req, res) => {
    const params = fleetIdParamsSchema.parse(req.params || {})
    const body = fleetVehicleLiveStateSchema.parse(req.body || {})
    const data = await fleetService.saveFleetVehicleLiveState({ auth: req.auth, fleetId: params.fleetId, payload: body, req })
    return ok(res, data, 201)
  })
)

router.patch(
  "/fleet/accounts/:fleetId/vehicle-live-states/:recordId",
  asyncHandler(async (req, res) => {
    const params = financialRecordIdParamsSchema.parse(req.params || {})
    const body = fleetVehicleLiveStateSchema.partial().parse(req.body || {})
    const data = await fleetService.saveFleetVehicleLiveState({ auth: req.auth, fleetId: params.fleetId, recordId: params.recordId, payload: body, req })
    return ok(res, data)
  })
)

router.post(
  "/fleet/driver/fuel-now/validate",
  asyncHandler(async (req, res) => {
    const body = fleetFuelNowSchema.parse(req.body || {})
    const data = await fleetService.validateFleetFuelNow({ auth: req.auth, payload: body })
    return ok(res, data)
  })
)

router.post(
  "/fleet/driver/fuel-now/sessions",
  asyncHandler(async (req, res) => {
    const body = fleetFuelNowSchema.parse(req.body || {})
    const data = await fleetService.createFleetFuelNowSession({ auth: req.auth, payload: body, req })
    return ok(res, data, data.allowed === false ? 200 : 201)
  })
)

router.post(
  "/fleet/accounts/:fleetId/fuel-now/sessions/:sessionId/complete",
  asyncHandler(async (req, res) => {
    const params = fuelingSessionIdParamsSchema.parse(req.params || {})
    const body = fleetFuelNowCompleteSchema.parse(req.body || {})
    const data = await fleetService.completeFleetFuelNowSession({
      auth: req.auth,
      fleetId: params.fleetId,
      sessionId: params.sessionId,
      payload: body,
      req,
    })
    return ok(res, data)
  })
)

router.get(
  "/fleet/driver/summary",
  asyncHandler(async (req, res) => {
    const data = await fleetService.getDriverFleetSummary({ auth: req.auth })
    return ok(res, data)
  })
)

router.post(
  "/fleet/driver/fuel-requests",
  asyncHandler(async (req, res) => {
    const body = fuelRequestSchema.parse(req.body || {})
    const data = await fleetService.createFleetFuelRequest({ auth: req.auth, payload: body, req })
    return ok(res, data, 201)
  })
)

router.post(
  "/fleet/driver/fuel-requests/:fleetId/:requestId/cancel",
  asyncHandler(async (req, res) => {
    const params = requestIdParamsSchema.parse(req.params || {})
    const body = cancelFuelRequestSchema.parse(req.body || {})
    const data = await fleetService.cancelFleetFuelRequest({
      auth: req.auth,
      fleetId: params.fleetId,
      requestId: params.requestId,
      reason: body.reason || "",
      req,
    })
    return ok(res, data)
  })
)

router.get(
  "/fleet/driver/history",
  asyncHandler(async (req, res) => {
    const data = await fleetService.listDriverFuelHistory({ auth: req.auth })
    return ok(res, data)
  })
)

export default router
