import { Router } from "express"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import { contentDispositionAttachment, safeFilenamePart } from "../reports/reports.export.service.js"
import { renderPdfBufferFromHtml } from "../reports/pdf/reportRenderer.js"
import {
  acknowledgeOperationalAlert,
  addOperationalIncidentNote,
  attachRefundEvidence,
  approveWalletAdjustmentRequest,
  approveFinanceRefund,
  approveHighRiskOverride,
  approveSettlement,
  approveSupportRefund,
  cancelTransactionFinancialError,
  completeFinanceReconciliation,
  createSettlementBatch,
  createComplianceCase,
  createInternalSupportCase,
  createSupportRefundRequest,
  createWalletAdjustmentRequest,
  buildAnalyticsExportReport,
  acknowledgeSystemHealthEvent,
  assignOperationalIncident,
  assignInternalRole,
  changeInternalRole,
  createInternalUser,
  createInternalStationNozzle,
  createInternalStationPump,
  createInternalStationTank,
  createSystemHealthBugNote,
  createFieldStationSetupRequest,
  createStationSetup,
  escalateOperationalIncident,
  escalateRefundToCompliance,
  escalateSupportCase,
  freezeComplianceCase,
  freezeComplianceAccount,
  freezeComplianceStation,
  forceSignOutInternalUser,
  flagTransactionForReview,
  flagSuspiciousStation,
  getAnalyticsData,
  getAuditLogData,
  getFieldOperationsData,
  getFieldStationSetupData,
  getFinanceData,
  getInternalStaffData,
  getNetworkOperationsData,
  getOnboardingData,
  getStationSetupData,
  getOverviewSummary,
  getPumpSessionByTransaction,
  getRiskData,
  getRefundInvestigation,
  getSettingsData,
  getStationsData,
  getSupportData,
  getTelemetryTimelineBySession,
  listSupportEscalationRequests,
  linkIncidentToSystemHealthEvent,
  getSupportCaseContext,
  getSystemHealthData,
  lockInternalAccount,
  markSettlementPaid,
  markSettlementProcessing,
  markOperationalIncidentUnderReview,
  markStationNeedsReview,
  rejectFinanceRefund,
  rejectSettlement,
  rejectSupportRefund,
  reactivateInternalUser,
  reopenOperationalIncident,
  respondSupportCase,
  respondToEscalatedSupportCase,
  requestStationDeletion,
  requestNetworkFieldVisit,
  requestTechnicalInvestigation,
  resolveOperationalIncident,
  resolveSupportCase,
  sendSupportCaseMessage,
  listStationDeactivationRequests,
  decideStationDeactivationRequest,
  resetInternalAccess,
  revokeInternalRole,
  raiseFinanceReconciliationException,
  requestTransactionCancellationReview,
  startFinanceReconciliation,
  submitStationForReview,
  suspendInternalUser,
  unfreezeComplianceCase,
  unfreezeComplianceAccount,
  unfreezeComplianceStation,
  handleRiskTransactionAction,
  updateComplianceCaseWorkflow,
  updateOnboardingWorkflow,
  updateInternalSetting,
  updateSupportCaseWorkflow,
  updateFieldVisitWorkflow,
  updateStationSetupProfile,
  updateStationSubscription,
  updateSubscriptionBillingState,
  assignStationStaffMember,
  searchAssignableStationManagers,
  updateStationStaffMember,
  deleteStationStaffMember,
  resetStationStaffAccess,
  patchInternalStationTank,
  patchInternalStationPump,
  patchInternalStationNozzle,
  deleteInternalStationPump,
  deleteInternalStationNozzle,
  updateStationActivation,
} from "./service.js"
import { requireAnyInternalPermission, requireInternalPermission } from "./middleware.js"
import { INTERNAL_PERMISSIONS } from "./permissions.js"
import {
  nozzleCreateSchema,
  nozzlePatchSchema,
  pumpCreateSchema,
  pumpPatchSchema,
  tankCreateSchema,
  tankPatchSchema,
} from "../settings/settings.schemas.js"
import { buildAnalyticsPdfFooterTemplate, renderAnalyticsExportHtml } from "./analytics.export.pdf.js"
import {
  approveWalletOperationRequest,
  createWalletBalanceTransferRequest,
  createWalletCreditRequest,
  createWalletLedgerAdjustmentRequest,
  createWalletPointsAdjustment,
  createWalletRefundRequest,
  exportWalletStatement,
  freezeWallet,
  getWalletConsole,
  getWalletOperationRequest,
  listWalletAuditLogs,
  listWalletOperationRequests,
  listWalletPointsHistory,
  listWalletTransactions,
  lookupWalletByDisplayId,
  markWalletUnderReview,
  placeWalletHold,
  rejectWalletOperationRequest,
  releaseWalletHold,
  unfreezeWallet,
} from "./walletLookup.service.js"

const router = Router()

const stationActivationSchema = z.object({
  isActive: z.boolean(),
})

const assignRoleSchema = z.object({
  roleCode: z.string().trim().min(3).max(64),
})

const createInternalUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().max(32).nullish(),
  roleCode: z.string().trim().min(3).max(64),
  password: z.string().trim().min(8).max(120).optional(),
})

const assignOperationalIncidentSchema = z.object({
  ownerRoleCode: z.string().trim().min(3).max(64),
})

const onboardingWorkflowActionSchema = z.object({
  action: z.enum([
    "APPROVE_READINESS",
    "RETURN_FOR_CORRECTION",
    "MARK_INCOMPLETE",
    "MARK_VERIFICATION_PENDING",
    "ACTIVATE_STATION",
  ]),
})

const deactivationDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
})

const noteSchema = z.object({
  note: z.string().trim().min(1).max(1000),
})

const incidentLinkSchema = z.object({
  incidentPublicId: z.string().trim().min(3).max(64),
})

const supportResponseSchema = z.object({
  message: z.string().trim().min(1).max(4000),
})

const createSupportCaseSchema = z.object({
  caseType: z.enum(["TICKET", "DISPUTE"]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  category: z.string().trim().min(3).max(64),
  subject: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(5).max(4000),
  stationPublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
  userPublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
  assigneeUserPublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
})

const supportWorkflowActionSchema = z.object({
  action: z.enum([
    "ASSIGN_TICKET",
    "REASSIGN_TICKET",
    "ADD_INTERNAL_NOTE",
    "MARK_IN_PROGRESS",
    "MARK_WAITING_ON_USER",
    "REOPEN_TICKET",
    "ESCALATE_TO_FINANCE",
    "ESCALATE_TO_OPERATIONS",
    "APPROVE_ESCALATION_RESPONSE",
    "REJECT_ESCALATION_RESPONSE",
    "CLOSE_DISPUTE",
  ]),
  note: z.string().trim().max(4000).optional().or(z.literal("")),
  assigneeUserPublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
  escalationTarget: z.string().trim().max(64).optional().or(z.literal("")),
})

const supportRefundCreateSchema = z.object({
  supportCasePublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
  stationPublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
  userPublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
  amountMwk: z.coerce.number().positive(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  reason: z.string().trim().min(3).max(255),
  mode: z.enum(["ISSUE", "SUBMIT_APPROVAL"]),
  transactionPublicId: z.string().trim().max(64).optional().or(z.literal("")),
})

const supportRefundRejectSchema = z.object({
  reason: z.string().trim().min(3).max(255),
})

const refundEvidenceAttachSchema = z.object({
  evidenceType: z.string().trim().min(3).max(64),
  sourceType: z.string().trim().max(64).optional().or(z.literal("")),
  sourceId: z.string().trim().max(96).optional().or(z.literal("")),
  summary: z.string().trim().min(3).max(2000),
  confidenceWeight: z.coerce.number().min(0).max(1).optional().nullable(),
})

const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
})

const analyticsExportQuerySchema = z.object({
  periodDays: z.coerce.number().int().min(1).max(30).optional(),
  region: z.string().trim().max(80).optional().or(z.literal("")),
  fuelType: z.string().trim().max(32).optional().or(z.literal("")),
})

const walletLookupQuerySchema = z.object({
  displayId: z.string().trim().min(4).max(32),
})

const walletTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  transactionType: z.string().trim().max(64).optional().or(z.literal("")),
  transactionStatus: z.string().trim().max(64).optional().or(z.literal("")),
})

const walletPointsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const walletAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const walletStatementQuerySchema = z.object({
  dateFrom: z.string().trim().max(10).optional().or(z.literal("")),
  dateTo: z.string().trim().max(10).optional().or(z.literal("")),
})

const walletMutationEnvelopeSchema = z.object({
  reasonCode: z.string().trim().min(2).max(96),
  note: z.string().trim().min(3).max(2000),
  requestKey: z.string().trim().min(6).max(96),
})

const walletPointsAdjustmentSchema = walletMutationEnvelopeSchema.extend({
  deltaPoints: z.coerce.number().int(),
})

const walletRefundRequestSchema = walletMutationEnvelopeSchema.extend({
  sourceTransactionPublicId: z.string().trim().min(8).max(96),
  amountMwk: z.coerce.number().positive(),
})

const walletCreditSchema = walletMutationEnvelopeSchema.extend({
  amountMwk: z.coerce.number().positive(),
})

const walletLedgerAdjustmentSchema = walletMutationEnvelopeSchema.extend({
  amountMwk: z.coerce.number().positive(),
  direction: z.enum(["CREDIT", "DEBIT"]),
})

const walletBalanceTransferSchema = walletMutationEnvelopeSchema.extend({
  amountMwk: z.coerce.number().positive(),
  destinationWalletDisplayId: z.string().trim().max(32).optional().or(z.literal("")),
  destinationSystemAccountCode: z.string().trim().max(64).optional().or(z.literal("")),
}).refine((value) => value.destinationWalletDisplayId || value.destinationSystemAccountCode, {
  message: "A destination wallet or system account is required.",
  path: ["destinationWalletDisplayId"],
})

const walletHoldSchema = walletMutationEnvelopeSchema.extend({
  amountMwk: z.coerce.number().positive(),
})

const walletRejectOperationSchema = z.object({
  rejectionReason: z.string().trim().min(3).max(2000),
})

function escapeDelimitedCell(value, delimiter = ",") {
  const text = String(value ?? "")
  if (delimiter === "\t") return text.replace(/\t/g, " ").replace(/\r?\n/g, " ")
  return `"${text.replace(/"/g, '""')}"`
}

function buildDelimitedExport(sections, delimiter = ",") {
  const lines = []
  sections.forEach((section, index) => {
    if (index > 0) lines.push("")
    lines.push(escapeDelimitedCell(section.title, delimiter))
    lines.push(section.headers.map((header) => escapeDelimitedCell(header, delimiter)).join(delimiter))
    section.rows.forEach((row) => lines.push(row.map((cell) => escapeDelimitedCell(cell, delimiter)).join(delimiter)))
  })
  return lines.join("\n")
}

function money(value) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

function numberText(value) {
  return Number(value || 0).toLocaleString()
}

const stationSetupCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  operatorName: z.string().trim().max(120).optional(),
  countryCode: z.string().trim().min(2).max(2).default("MW"),
  city: z.string().trim().min(1).max(80),
  address: z.string().trim().max(255).optional(),
  timezone: z.string().trim().min(1).max(64).default("Africa/Blantyre"),
  open24h: z.boolean().optional(),
  openingTime: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  closingTime: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  subscriptionPlanCode: z.string().trim().max(64).optional(),
  subscriptionPlanName: z.string().trim().max(120).optional(),
  subscriptionStatus: z.enum(["ACTIVE", "OVERDUE", "GRACE", "PAUSED", "TRIAL"]).optional(),
  monthlyFeeMwk: z.coerce.number().min(0).optional(),
  renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  submitForReview: z.boolean().optional(),
})

const stationSetupProfileSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const value = input
  return {
    name: value.name,
    operatorName: value.operatorName ?? value.operator_name,
    countryCode: value.countryCode ?? value.country_code,
    city: value.city,
    address: value.address,
    timezone: value.timezone,
    open24h: value.open24h ?? value.open_24h,
    openingTime: value.openingTime ?? value.opening_time,
    closingTime: value.closingTime ?? value.closing_time,
  }
}, z.object({
  name: z.string().trim().min(1).max(120),
  operatorName: z.string().trim().max(120).optional(),
  countryCode: z.string().trim().min(2).max(2).default("MW"),
  city: z.string().trim().min(1).max(80),
  address: z.string().trim().max(255).optional(),
  timezone: z.string().trim().min(1).max(64).default("Africa/Blantyre"),
  open24h: z.boolean().optional(),
  openingTime: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  closingTime: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
}))

const stationSubscriptionSchema = z.object({
  planCode: z.string().trim().min(1).max(64),
  planName: z.string().trim().min(1).max(120),
  status: z.enum(["ACTIVE", "OVERDUE", "GRACE", "PAUSED", "TRIAL"]),
  monthlyFeeMwk: z.coerce.number().min(0).optional(),
  renewalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

const stationStaffAssignmentSchema = z.object({
  existingUserPublicId: z.string().trim().max(32).optional().or(z.literal("")),
  fullName: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  roleCode: z.enum(["MANAGER", "ATTENDANT", "VIEWER"]),
}).superRefine((value, ctx) => {
  const existingUserPublicId = String(value.existingUserPublicId || "").trim()
  if (existingUserPublicId) {
    if (value.roleCode !== "MANAGER") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roleCode"],
        message: "Existing user assignment is only available for MANAGER",
      })
    }
    return
  }

  if (!String(value.fullName || "").trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fullName"],
      message: "Staff full name is required",
    })
  }

  if (!String(value.email || "").trim() && !String(value.phone || "").trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["email"],
      message: "Staff email or phone is required",
    })
  }
})

const stationManagerSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
})

const stationStaffPatchSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  roleCode: z.enum(["MANAGER", "ATTENDANT", "VIEWER"]).optional(),
})

const fieldSetupRequestSchema = stationSetupCreateSchema.extend({
  note: z.string().trim().max(1000).optional().or(z.literal("")),
})

const fieldVisitActionSchema = z.object({
  action: z.enum([
    "START_VISIT",
    "SUBMIT_VISIT_REPORT",
    "UPLOAD_STATION_PHOTOS",
    "UPLOAD_VERIFICATION_EVIDENCE",
    "ADD_FIELD_NOTES",
    "MARK_HARDWARE_INSTALLED",
    "MARK_HARDWARE_MISSING",
    "MARK_TRAINING_COMPLETED",
    "MARK_TRAINING_PENDING",
    "RECORD_CONNECTIVITY_STATUS",
    "MARK_VISIT_COMPLETED",
    "MARK_VISIT_FAILED",
    "REQUEST_FOLLOW_UP_VISIT",
    "ESCALATE_ONBOARDING_ISSUE",
  ]),
  note: z.string().trim().max(4000).optional().or(z.literal("")),
  evidenceUrl: z.string().trim().max(1000).optional().or(z.literal("")),
  connectivityStatus: z.enum(["GOOD", "LIMITED", "OFFLINE"]).optional().or(z.literal("")),
})

const financeSubscriptionActionSchema = z.object({
  action: z.enum(["MARK_INVOICE_PAID", "SUSPEND_SUBSCRIPTION", "RESUME_SUBSCRIPTION"]),
})

const createSettlementBatchSchema = z.object({
  stationPublicId: z.string().trim().min(3).max(64),
  batchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grossAmount: z.coerce.number().positive(),
  feeAmount: z.coerce.number().min(0).default(0),
})

const transactionReviewSchema = z.object({
  note: z.string().trim().max(1000).optional().or(z.literal("")),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
})

const financeTransactionReviewActionSchema = z.object({
  action: z.enum(["REQUEST_CANCELLATION_REVIEW", "ATTACH_FINANCIAL_NOTE", "ESCALATE_TO_COMPLIANCE"]),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("HIGH"),
})

const financeTransactionCancelSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal("")),
  reasonCode: z.enum(["DUPLICATE_PAYMENT", "PAYMENT_GATEWAY_FAILURE", "INCORRECT_TRANSACTION_CAPTURE"]),
})

const financeRefundDecisionSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal("")),
})

const refundComplianceEscalationSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal("")),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("HIGH"),
})

const reconciliationStartSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal("")),
})

const reconciliationCompleteSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal("")),
})

const reconciliationExceptionSchema = z.object({
  exceptionType: z.string().trim().min(3).max(64),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  summary: z.string().trim().min(3).max(255),
  detail: z.string().trim().max(4000).optional().or(z.literal("")),
})

const walletAdjustmentRequestSchema = z.object({
  stationPublicId: z.string().trim().max(64).optional().or(z.literal("")),
  amountMwk: z.coerce.number().positive(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  reason: z.string().trim().min(3).max(255),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
})

const walletAdjustmentDecisionSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal("")),
})

const createComplianceCaseSchema = z.object({
  category: z.string().trim().min(3).max(64),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  summary: z.string().trim().min(3).max(255),
  stationPublicId: z.string().trim().max(64).optional().or(z.literal("")),
  userPublicId: z.string().trim().max(64).optional().or(z.literal("")),
  assigneeUserPublicId: z.string().trim().max(64).optional().or(z.literal("")),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
})

const suspiciousStationSchema = z.object({
  note: z.string().trim().max(2000).optional().or(z.literal("")),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("HIGH"),
})

const complianceCaseWorkflowSchema = z.object({
  action: z.enum([
    "ASSIGN_CASE",
    "ADD_CASE_NOTE",
    "ESCALATE_CASE",
    "RESOLVE_CASE",
    "REOPEN_CASE",
    "MARK_CONFIRMED",
    "MARK_FALSE_POSITIVE",
  ]),
  note: z.string().trim().max(4000).optional().or(z.literal("")),
  assigneeUserPublicId: z.string().trim().max(64).optional().or(z.literal("")),
})

const riskTransactionActionSchema = z.object({
  action: z.enum([
    "CANCEL_TRANSACTION",
    "REVERSE_TRANSACTION",
    "MARK_TRANSACTION_FRAUDULENT",
    "ATTACH_COMPLIANCE_NOTES",
    "FREEZE_RELATED_TRANSACTIONS",
    "OPEN_COMPLIANCE_CASE",
    "FORCE_CANCEL_TRANSACTION",
    "REVERSE_SETTLEMENT",
    "OVERRIDE_CASE_STATUS",
  ]),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
  reasonCode: z.string().trim().max(64).optional().or(z.literal("")),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("HIGH"),
  confirmationText: z.string().trim().max(64).optional().or(z.literal("")),
  overrideStatus: z.enum(["OPEN", "INVESTIGATING", "FROZEN", "FRAUD_CONFIRMED", "RESOLVED"]).optional().or(z.literal("")),
})

router.get(
  "/overview",
  requireInternalPermission(INTERNAL_PERMISSIONS.OVERVIEW_VIEW),
  asyncHandler(async (req, res) => ok(res, await getOverviewSummary(req.internalAuth)))
)

router.get(
  "/network-operations",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getNetworkOperationsData()))
)

router.post(
  "/network-operations/incidents/:alertPublicId/acknowledge",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_INCIDENT_MANAGE),
  asyncHandler(async (req, res) =>
    ok(res, await acknowledgeOperationalAlert({ actor: req.internalAuth, alertPublicId: String(req.params.alertPublicId || "").trim() }))
  )
)

router.post(
  "/network-operations/incidents/:alertPublicId/under-review",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_INCIDENT_MANAGE),
  asyncHandler(async (req, res) =>
    ok(res, await markOperationalIncidentUnderReview({ actor: req.internalAuth, alertPublicId: String(req.params.alertPublicId || "").trim() }))
  )
)

router.post(
  "/network-operations/incidents/:alertPublicId/resolve",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_INCIDENT_MANAGE),
  asyncHandler(async (req, res) =>
    ok(res, await resolveOperationalIncident({ actor: req.internalAuth, alertPublicId: String(req.params.alertPublicId || "").trim() }))
  )
)

router.post(
  "/network-operations/incidents/:alertPublicId/reopen",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_INCIDENT_MANAGE),
  asyncHandler(async (req, res) =>
    ok(res, await reopenOperationalIncident({ actor: req.internalAuth, alertPublicId: String(req.params.alertPublicId || "").trim() }))
  )
)

router.post(
  "/network-operations/incidents/:alertPublicId/escalate",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_INCIDENT_MANAGE),
  asyncHandler(async (req, res) =>
    ok(res, await escalateOperationalIncident({ actor: req.internalAuth, alertPublicId: String(req.params.alertPublicId || "").trim() }))
  )
)

router.post(
  "/network-operations/incidents/:alertPublicId/assign",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_INCIDENT_MANAGE),
  asyncHandler(async (req, res) => {
    const body = assignOperationalIncidentSchema.parse(req.body || {})
    return ok(
      res,
      await assignOperationalIncident({
        actor: req.internalAuth,
        alertPublicId: String(req.params.alertPublicId || "").trim(),
        ownerRoleCode: body.ownerRoleCode,
      })
    )
  })
)

router.post(
  "/network-operations/incidents/:alertPublicId/note",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_INCIDENT_MANAGE),
  asyncHandler(async (req, res) => {
    const body = noteSchema.parse(req.body || {})
    return ok(
      res,
      await addOperationalIncidentNote({
        actor: req.internalAuth,
        alertPublicId: String(req.params.alertPublicId || "").trim(),
        note: body.note,
      })
    )
  })
)

router.post(
  "/network-operations/stations/:stationPublicId/needs-review",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_STATION_ACTION),
  asyncHandler(async (req, res) =>
    ok(res, await markStationNeedsReview({ actor: req.internalAuth, stationPublicId: String(req.params.stationPublicId || "").trim() }))
  )
)

router.post(
  "/network-operations/stations/:stationPublicId/request-field-visit",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_STATION_ACTION),
  asyncHandler(async (req, res) => {
    const body = noteSchema.parse(req.body || {})
    return ok(
      res,
      await requestNetworkFieldVisit({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        note: body.note,
      })
    )
  })
)

router.post(
  "/network-operations/stations/:stationPublicId/request-technical-investigation",
  requireInternalPermission(INTERNAL_PERMISSIONS.NETWORK_STATION_ACTION),
  asyncHandler(async (req, res) => {
    const body = noteSchema.partial().parse(req.body || {})
    return ok(
      res,
      await requestTechnicalInvestigation({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        note: body.note || "",
      })
    )
  })
)

router.get(
  "/stations",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getStationsData()))
)

router.post(
  "/stations",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = stationSetupCreateSchema.parse(req.body || {})
    return ok(res, await createStationSetup({ actor: req.internalAuth, payload: body }), 201)
  })
)

router.get(
  "/stations/:stationPublicId/setup",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) =>
    ok(res, await getStationSetupData({ stationPublicId: String(req.params.stationPublicId || "").trim() }))
  )
)

router.patch(
  "/stations/:stationPublicId/profile",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = stationSetupProfileSchema.parse(req.body || {})
    return ok(
      res,
      await updateStationSetupProfile({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.post(
  "/stations/:stationPublicId/submit-review",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await submitStationForReview({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
      })
    )
  )
)

router.patch(
  "/stations/:stationPublicId/subscription",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = stationSubscriptionSchema.parse(req.body || {})
    return ok(
      res,
      await updateStationSubscription({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.post(
  "/stations/:stationPublicId/staff",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = stationStaffAssignmentSchema.parse(req.body || {})
    return ok(
      res,
      await assignStationStaffMember({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.get(
  "/stations/:stationPublicId/staff/manager-candidates",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const query = stationManagerSearchQuerySchema.parse(req.query || {})
    return ok(
      res,
      await searchAssignableStationManagers({
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        search: query.q || "",
        limit: query.limit || 12,
      })
    )
  })
)

router.patch(
  "/stations/:stationPublicId/staff/:staffId",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = stationStaffPatchSchema.parse(req.body || {})
    return ok(
      res,
      await updateStationStaffMember({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        staffId: String(req.params.staffId || "").trim(),
        payload: body,
      })
    )
  })
)

router.delete(
  "/stations/:stationPublicId/staff/:staffId",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await deleteStationStaffMember({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        staffId: String(req.params.staffId || "").trim(),
      })
    )
  )
)

router.post(
  "/stations/:stationPublicId/staff/:staffId/reset-access",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await resetStationStaffAccess({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        staffId: String(req.params.staffId || "").trim(),
      })
    )
  )
)

router.post(
  "/stations/:stationPublicId/tanks",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = tankCreateSchema.parse(req.body || {})
    return ok(
      res,
      await createInternalStationTank({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.patch(
  "/stations/:stationPublicId/tanks/:tankPublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = tankPatchSchema.parse(req.body || {})
    return ok(
      res,
      await patchInternalStationTank({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        tankPublicId: String(req.params.tankPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.post(
  "/stations/:stationPublicId/pumps",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = pumpCreateSchema.parse(req.body || {})
    return ok(
      res,
      await createInternalStationPump({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.patch(
  "/stations/:stationPublicId/pumps/:pumpPublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = pumpPatchSchema.parse(req.body || {})
    return ok(
      res,
      await patchInternalStationPump({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        pumpPublicId: String(req.params.pumpPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.delete(
  "/stations/:stationPublicId/pumps/:pumpPublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await deleteInternalStationPump({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        pumpPublicId: String(req.params.pumpPublicId || "").trim(),
      })
    )
  )
)

router.post(
  "/stations/:stationPublicId/pumps/:pumpPublicId/nozzles",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = nozzleCreateSchema.parse(req.body || {})
    return ok(
      res,
      await createInternalStationNozzle({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        pumpPublicId: String(req.params.pumpPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.patch(
  "/stations/:stationPublicId/nozzles/:nozzlePublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) => {
    const body = nozzlePatchSchema.parse(req.body || {})
    return ok(
      res,
      await patchInternalStationNozzle({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        nozzlePublicId: String(req.params.nozzlePublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.delete(
  "/stations/:stationPublicId/nozzles/:nozzlePublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await deleteInternalStationNozzle({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        nozzlePublicId: String(req.params.nozzlePublicId || "").trim(),
      })
    )
  )
)

router.patch(
  "/stations/:stationPublicId/activation",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_ACTIVATE),
  asyncHandler(async (req, res) => {
    const body = stationActivationSchema.parse(req.body || {})
    return ok(
      res,
      await updateStationActivation({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        isActive: body.isActive,
      })
    )
  })
)

router.post(
  "/stations/:stationPublicId/delete-request",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_CONFIGURE),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await requestStationDeletion({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
      })
    )
  )
)

router.get(
  "/stations/deactivation-requests",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_ACTIVATE),
  asyncHandler(async (req, res) => ok(res, await listStationDeactivationRequests({ actor: req.internalAuth })))
)

router.post(
  "/stations/deactivation-requests/:requestPublicId/decision",
  requireInternalPermission(INTERNAL_PERMISSIONS.STATIONS_ACTIVATE),
  asyncHandler(async (req, res) => {
    const body = deactivationDecisionSchema.parse(req.body || {})
    return ok(
      res,
      await decideStationDeactivationRequest({
        actor: req.internalAuth,
        requestPublicId: String(req.params.requestPublicId || "").trim(),
        decision: body.decision,
      })
    )
  })
)

router.get(
  "/station-onboarding",
  requireInternalPermission(INTERNAL_PERMISSIONS.ONBOARDING_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getOnboardingData()))
)

router.post(
  "/station-onboarding/:onboardingPublicId/action",
  requireInternalPermission(INTERNAL_PERMISSIONS.ONBOARDING_MANAGE),
  asyncHandler(async (req, res) => {
    const body = onboardingWorkflowActionSchema.parse(req.body || {})
    return ok(
      res,
      await updateOnboardingWorkflow({
        actor: req.internalAuth,
        onboardingPublicId: String(req.params.onboardingPublicId || "").trim(),
        action: body.action,
      })
    )
  })
)

router.get(
  "/field-operations",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getFieldOperationsData()))
)

router.post(
  "/field-operations/setup-requests",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const body = fieldSetupRequestSchema.parse(req.body || {})
    return ok(res, await createFieldStationSetupRequest({ actor: req.internalAuth, payload: body }), 201)
  })
)

router.get(
  "/field-operations/stations/:stationPublicId/setup",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_VIEW),
  asyncHandler(async (req, res) =>
    ok(res, await getFieldStationSetupData({ stationPublicId: String(req.params.stationPublicId || "").trim() }))
  )
)

router.post(
  "/field-operations/visits/:fieldVisitPublicId/action",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const body = fieldVisitActionSchema.parse(req.body || {})
    return ok(
      res,
      await updateFieldVisitWorkflow({
        actor: req.internalAuth,
        fieldVisitPublicId: String(req.params.fieldVisitPublicId || "").trim(),
        action: body.action,
        note: body.note || "",
        evidenceUrl: body.evidenceUrl || "",
        connectivityStatus: body.connectivityStatus || "",
      })
    )
  })
)

router.post(
  "/field-operations/stations/:stationPublicId/staff",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const body = stationStaffAssignmentSchema.parse(req.body || {})
    return ok(
      res,
      await assignStationStaffMember({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.get(
  "/field-operations/stations/:stationPublicId/staff/manager-candidates",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const query = stationManagerSearchQuerySchema.parse(req.query || {})
    return ok(
      res,
      await searchAssignableStationManagers({
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        search: query.q || "",
        limit: query.limit || 12,
      })
    )
  })
)

router.patch(
  "/field-operations/stations/:stationPublicId/staff/:staffId",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const body = stationStaffPatchSchema.parse(req.body || {})
    return ok(
      res,
      await updateStationStaffMember({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        staffId: String(req.params.staffId || "").trim(),
        payload: body,
      })
    )
  })
)

router.delete(
  "/field-operations/stations/:stationPublicId/staff/:staffId",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await deleteStationStaffMember({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        staffId: String(req.params.staffId || "").trim(),
      })
    )
  )
)

router.post(
  "/field-operations/stations/:stationPublicId/staff/:staffId/reset-access",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await resetStationStaffAccess({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        staffId: String(req.params.staffId || "").trim(),
      })
    )
  )
)

router.post(
  "/field-operations/stations/:stationPublicId/pumps",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const body = pumpCreateSchema.parse(req.body || {})
    return ok(
      res,
      await createInternalStationPump({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.patch(
  "/field-operations/stations/:stationPublicId/pumps/:pumpPublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const body = pumpPatchSchema.parse(req.body || {})
    return ok(
      res,
      await patchInternalStationPump({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        pumpPublicId: String(req.params.pumpPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.post(
  "/field-operations/stations/:stationPublicId/pumps/:pumpPublicId/nozzles",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const body = nozzleCreateSchema.parse(req.body || {})
    return ok(
      res,
      await createInternalStationNozzle({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        pumpPublicId: String(req.params.pumpPublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.patch(
  "/field-operations/stations/:stationPublicId/nozzles/:nozzlePublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.FIELD_MANAGE),
  asyncHandler(async (req, res) => {
    const body = nozzlePatchSchema.parse(req.body || {})
    return ok(
      res,
      await patchInternalStationNozzle({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        nozzlePublicId: String(req.params.nozzlePublicId || "").trim(),
        payload: body,
      })
    )
  })
)

router.get(
  "/support",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getSupportData()))
)

router.get(
  "/support/escalation-requests",
  asyncHandler(async (req, res) => ok(res, await listSupportEscalationRequests({ actor: req.internalAuth })))
)

router.post(
  "/support/cases",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_RESOLVE),
  asyncHandler(async (req, res) => {
    const body = createSupportCaseSchema.parse(req.body || {})
    return ok(res, await createInternalSupportCase({ actor: req.internalAuth, payload: body }), 201)
  })
)

router.get(
  "/support/cases/:casePublicId/context",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_VIEW),
  asyncHandler(async (req, res) =>
    ok(res, await getSupportCaseContext({ casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/support/cases/:casePublicId/action",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_RESOLVE),
  asyncHandler(async (req, res) => {
    const body = supportWorkflowActionSchema.parse(req.body || {})
    return ok(
      res,
      await updateSupportCaseWorkflow({
        actor: req.internalAuth,
        casePublicId: String(req.params.casePublicId || "").trim(),
        action: body.action,
        note: body.note || "",
        assigneeUserPublicId: body.assigneeUserPublicId || "",
        escalationTarget: body.escalationTarget || "",
      })
    )
  })
)

router.post(
  "/support/cases/:casePublicId/messages",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_RESOLVE),
  asyncHandler(async (req, res) => {
    const body = supportResponseSchema.parse(req.body || {})
    return ok(
      res,
      await sendSupportCaseMessage({
        actor: req.internalAuth,
        casePublicId: String(req.params.casePublicId || "").trim(),
        message: body.message,
      })
    )
  })
)

router.post(
  "/support/cases/:casePublicId/respond",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_RESOLVE),
  asyncHandler(async (req, res) => {
    const body = supportResponseSchema.parse(req.body || {})
    return ok(
      res,
      await respondSupportCase({
        actor: req.internalAuth,
        casePublicId: String(req.params.casePublicId || "").trim(),
        message: body.message,
      })
    )
  })
)

router.post(
  "/support/escalation-requests/:alertPublicId/respond",
  asyncHandler(async (req, res) => {
    const body = supportResponseSchema.parse(req.body || {})
    return ok(
      res,
      await respondToEscalatedSupportCase({
        actor: req.internalAuth,
        alertPublicId: String(req.params.alertPublicId || "").trim(),
        message: body.message,
      })
    )
  })
)

router.post(
  "/support/cases/:casePublicId/resolve",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_RESOLVE),
  asyncHandler(async (req, res) =>
    ok(res, await resolveSupportCase({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/support/cases/:casePublicId/escalate",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_ESCALATE),
  asyncHandler(async (req, res) =>
    ok(res, await escalateSupportCase({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/support/refunds/:refundPublicId/approve",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_REFUND_LIMITED),
  asyncHandler(async (req, res) =>
    ok(res, await approveSupportRefund({ actor: req.internalAuth, refundPublicId: String(req.params.refundPublicId || "").trim() }))
  )
)

router.post(
  "/support/refunds",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_REFUND_LIMITED),
  asyncHandler(async (req, res) => {
    const body = supportRefundCreateSchema.parse(req.body || {})
    return ok(res, await createSupportRefundRequest({ actor: req.internalAuth, ...body }), 201)
  })
)

router.post(
  "/support/refunds/:refundPublicId/reject",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_REFUND_LIMITED),
  asyncHandler(async (req, res) => {
    const body = supportRefundRejectSchema.parse(req.body || {})
    return ok(
      res,
      await rejectSupportRefund({
        actor: req.internalAuth,
        refundPublicId: String(req.params.refundPublicId || "").trim(),
        reason: body.reason,
      })
    )
  })
)

router.post(
  "/support/refunds/:refundPublicId/escalate-compliance",
  requireInternalPermission(INTERNAL_PERMISSIONS.SUPPORT_ESCALATE),
  asyncHandler(async (req, res) => {
    const body = refundComplianceEscalationSchema.parse(req.body || {})
    return ok(
      res,
      await escalateRefundToCompliance({
        actor: req.internalAuth,
        refundPublicId: String(req.params.refundPublicId || "").trim(),
        note: body.note || "",
        severity: body.severity,
      })
    )
  })
)

router.get(
  "/refunds/:refundPublicId/investigation",
  requireAnyInternalPermission([
    INTERNAL_PERMISSIONS.SUPPORT_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.RISK_VIEW,
  ]),
  asyncHandler(async (req, res) =>
    ok(res, await getRefundInvestigation({ actor: req.internalAuth, refundPublicId: String(req.params.refundPublicId || "").trim() }))
  )
)

router.post(
  "/refunds/:refundPublicId/evidence",
  requireAnyInternalPermission([
    INTERNAL_PERMISSIONS.SUPPORT_REFUND_LIMITED,
    INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE,
    INTERNAL_PERMISSIONS.RISK_VIEW,
  ]),
  asyncHandler(async (req, res) => {
    const body = refundEvidenceAttachSchema.parse(req.body || {})
    return ok(
      res,
      await attachRefundEvidence({
        actor: req.internalAuth,
        refundPublicId: String(req.params.refundPublicId || "").trim(),
        evidenceType: body.evidenceType,
        sourceType: body.sourceType || "",
        sourceId: body.sourceId || "",
        summary: body.summary,
        confidenceWeight: body.confidenceWeight ?? null,
      })
    )
  })
)

router.get(
  "/transactions/:transactionPublicId/pump-session",
  requireAnyInternalPermission([
    INTERNAL_PERMISSIONS.SUPPORT_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.RISK_VIEW,
  ]),
  asyncHandler(async (req, res) =>
    ok(res, await getPumpSessionByTransaction({ transactionPublicId: String(req.params.transactionPublicId || "").trim() }))
  )
)

router.get(
  "/transactions/:transactionPublicId/telemetry",
  requireAnyInternalPermission([
    INTERNAL_PERMISSIONS.SUPPORT_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.RISK_VIEW,
  ]),
  asyncHandler(async (req, res) =>
    ok(res, await getTelemetryTimelineBySession({ transactionPublicId: String(req.params.transactionPublicId || "").trim() }))
  )
)

router.get(
  "/pump-sessions/:sessionReference/telemetry",
  requireAnyInternalPermission([
    INTERNAL_PERMISSIONS.SUPPORT_VIEW,
    INTERNAL_PERMISSIONS.FINANCE_VIEW,
    INTERNAL_PERMISSIONS.RISK_VIEW,
  ]),
  asyncHandler(async (req, res) =>
    ok(res, await getTelemetryTimelineBySession({ sessionReference: String(req.params.sessionReference || "").trim() }))
  )
)

router.get(
  "/finance",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getFinanceData()))
)

router.post(
  "/finance/settlements",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) => {
    const body = createSettlementBatchSchema.parse(req.body || {})
    return ok(
      res,
      await createSettlementBatch({
        actor: req.internalAuth,
        stationPublicId: body.stationPublicId,
        batchDate: body.batchDate,
        grossAmount: body.grossAmount,
        feeAmount: body.feeAmount,
      }),
      201
    )
  })
)

router.post(
  "/finance/settlements/:batchPublicId/processing",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) =>
    ok(res, await markSettlementProcessing({ actor: req.internalAuth, batchPublicId: String(req.params.batchPublicId || "").trim() }))
  )
)

router.post(
  "/finance/settlements/:batchPublicId/approve",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) =>
    ok(res, await approveSettlement({ actor: req.internalAuth, batchPublicId: String(req.params.batchPublicId || "").trim() }))
  )
)

router.post(
  "/finance/settlements/:batchPublicId/reject",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLEMENT_REJECT),
  asyncHandler(async (req, res) =>
    ok(res, await rejectSettlement({ actor: req.internalAuth, batchPublicId: String(req.params.batchPublicId || "").trim() }))
  )
)

router.post(
  "/finance/settlements/:batchPublicId/paid",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) =>
    ok(res, await markSettlementPaid({ actor: req.internalAuth, batchPublicId: String(req.params.batchPublicId || "").trim() }))
  )
)

router.post(
  "/finance/refunds/:refundPublicId/approve",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE),
  asyncHandler(async (req, res) => {
    const body = financeRefundDecisionSchema.parse(req.body || {})
    return ok(
      res,
      await approveFinanceRefund({
        actor: req.internalAuth,
        refundPublicId: String(req.params.refundPublicId || "").trim(),
        note: body.note || "",
      })
    )
  })
)

router.post(
  "/finance/refunds/:refundPublicId/reject",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE),
  asyncHandler(async (req, res) => {
    const body = financeRefundDecisionSchema.parse(req.body || {})
    return ok(
      res,
      await rejectFinanceRefund({
        actor: req.internalAuth,
        refundPublicId: String(req.params.refundPublicId || "").trim(),
        note: body.note || "",
      })
    )
  })
)

router.post(
  "/finance/refunds/:refundPublicId/escalate-compliance",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_REFUND_APPROVE),
  asyncHandler(async (req, res) => {
    const body = refundComplianceEscalationSchema.parse(req.body || {})
    return ok(
      res,
      await escalateRefundToCompliance({
        actor: req.internalAuth,
        refundPublicId: String(req.params.refundPublicId || "").trim(),
        note: body.note || "",
        severity: body.severity,
      })
    )
  })
)

router.post(
  "/finance/subscriptions/:stationPublicId/action",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) => {
    const body = financeSubscriptionActionSchema.parse(req.body || {})
    return ok(
      res,
      await updateSubscriptionBillingState({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        action: body.action,
      })
    )
  })
)

router.post(
  "/finance/transactions/:transactionPublicId/review",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_VIEW),
  asyncHandler(async (req, res) => {
    const body = transactionReviewSchema.parse(req.body || {})
    return ok(
      res,
      await flagTransactionForReview({
        actor: req.internalAuth,
        transactionPublicId: String(req.params.transactionPublicId || "").trim(),
        note: body.note || "",
        severity: body.severity,
      })
    )
  })
)

router.post(
  "/finance/transactions/:transactionPublicId/request-cancellation-review",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_VIEW),
  asyncHandler(async (req, res) => {
    const body = financeTransactionReviewActionSchema.parse(req.body || {})
    return ok(
      res,
      await requestTransactionCancellationReview({
        actor: req.internalAuth,
        transactionPublicId: String(req.params.transactionPublicId || "").trim(),
        action: body.action,
        note: body.note || "",
        severity: body.severity,
      })
    )
  })
)

router.post(
  "/finance/transactions/:transactionPublicId/cancel-financial-error",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_VIEW),
  asyncHandler(async (req, res) => {
    const body = financeTransactionCancelSchema.parse(req.body || {})
    return ok(
      res,
      await cancelTransactionFinancialError({
        actor: req.internalAuth,
        transactionPublicId: String(req.params.transactionPublicId || "").trim(),
        note: body.note || "",
        reasonCode: body.reasonCode,
      })
    )
  })
)

router.post(
  "/finance/reconciliation/start",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) => {
    const body = reconciliationStartSchema.parse(req.body || {})
    return ok(res, await startFinanceReconciliation({ actor: req.internalAuth, note: body.note || "" }), 201)
  })
)

router.post(
  "/finance/reconciliation/:runPublicId/complete",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) => {
    const body = reconciliationCompleteSchema.parse(req.body || {})
    return ok(
      res,
      await completeFinanceReconciliation({
        actor: req.internalAuth,
        runPublicId: String(req.params.runPublicId || "").trim(),
        note: body.note || "",
      })
    )
  })
)

router.post(
  "/finance/reconciliation/:runPublicId/exceptions",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) => {
    const body = reconciliationExceptionSchema.parse(req.body || {})
    return ok(
      res,
      await raiseFinanceReconciliationException({
        actor: req.internalAuth,
        runPublicId: String(req.params.runPublicId || "").trim(),
        exceptionType: body.exceptionType,
        severity: body.severity,
        summary: body.summary,
        detail: body.detail || "",
      }),
      201
    )
  })
)

router.post(
  "/finance/wallet-adjustments",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) => {
    const body = walletAdjustmentRequestSchema.parse(req.body || {})
    return ok(
      res,
      await createWalletAdjustmentRequest({
        actor: req.internalAuth,
        stationPublicId: body.stationPublicId || "",
        amountMwk: body.amountMwk,
        direction: body.direction,
        reason: body.reason,
        note: body.note || "",
      }),
      201
    )
  })
)

router.post(
  "/finance/wallet-adjustments/:requestPublicId/approve",
  requireInternalPermission(INTERNAL_PERMISSIONS.FINANCE_SETTLE),
  asyncHandler(async (req, res) => {
    const body = walletAdjustmentDecisionSchema.parse(req.body || {})
    return ok(
      res,
      await approveWalletAdjustmentRequest({
        actor: req.internalAuth,
        requestPublicId: String(req.params.requestPublicId || "").trim(),
        note: body.note || "",
      })
    )
  })
)

router.get(
  "/risk-compliance",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getRiskData()))
)

router.post(
  "/risk-compliance/cases",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_VIEW),
  asyncHandler(async (req, res) => {
    const body = createComplianceCaseSchema.parse(req.body || {})
    return ok(
      res,
      await createComplianceCase({
        actor: req.internalAuth,
        category: body.category,
        severity: body.severity,
        summary: body.summary,
        stationPublicId: body.stationPublicId || "",
        userPublicId: body.userPublicId || "",
        assigneeUserPublicId: body.assigneeUserPublicId || "",
        note: body.note || "",
      }),
      201
    )
  })
)

router.post(
  "/risk-compliance/transactions/:transactionPublicId/action",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_VIEW),
  asyncHandler(async (req, res) => {
    const body = riskTransactionActionSchema.parse(req.body || {})
    return ok(
      res,
      await handleRiskTransactionAction({
        actor: req.internalAuth,
        transactionPublicId: String(req.params.transactionPublicId || "").trim(),
        action: body.action,
        note: body.note || "",
        reasonCode: body.reasonCode || "",
        severity: body.severity,
        confirmationText: body.confirmationText || "",
        overrideStatus: body.overrideStatus || "",
      })
    )
  })
)

router.post(
  "/risk-compliance/stations/:stationPublicId/flag",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_VIEW),
  asyncHandler(async (req, res) => {
    const body = suspiciousStationSchema.parse(req.body || {})
    return ok(
      res,
      await flagSuspiciousStation({
        actor: req.internalAuth,
        stationPublicId: String(req.params.stationPublicId || "").trim(),
        note: body.note || "",
        severity: body.severity,
      })
    )
  })
)

router.post(
  "/risk-compliance/cases/:casePublicId/action",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_VIEW),
  asyncHandler(async (req, res) => {
    const body = complianceCaseWorkflowSchema.parse(req.body || {})
    return ok(
      res,
      await updateComplianceCaseWorkflow({
        actor: req.internalAuth,
        casePublicId: String(req.params.casePublicId || "").trim(),
        action: body.action,
        note: body.note || "",
        assigneeUserPublicId: body.assigneeUserPublicId || "",
      })
    )
  })
)

router.post(
  "/risk-compliance/cases/:casePublicId/freeze",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_FREEZE),
  asyncHandler(async (req, res) =>
    ok(res, await freezeComplianceCase({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/risk-compliance/cases/:casePublicId/freeze-account",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_FREEZE),
  asyncHandler(async (req, res) =>
    ok(res, await freezeComplianceAccount({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/risk-compliance/cases/:casePublicId/freeze-station",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_FREEZE),
  asyncHandler(async (req, res) =>
    ok(res, await freezeComplianceStation({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/risk-compliance/cases/:casePublicId/unfreeze",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_UNFREEZE),
  asyncHandler(async (req, res) =>
    ok(res, await unfreezeComplianceCase({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/risk-compliance/cases/:casePublicId/unfreeze-account",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_UNFREEZE),
  asyncHandler(async (req, res) =>
    ok(res, await unfreezeComplianceAccount({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/risk-compliance/cases/:casePublicId/unfreeze-station",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_UNFREEZE),
  asyncHandler(async (req, res) =>
    ok(res, await unfreezeComplianceStation({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.post(
  "/risk-compliance/cases/:casePublicId/override-approve",
  requireInternalPermission(INTERNAL_PERMISSIONS.RISK_OVERRIDE_APPROVE),
  asyncHandler(async (req, res) =>
    ok(res, await approveHighRiskOverride({ actor: req.internalAuth, casePublicId: String(req.params.casePublicId || "").trim() }))
  )
)

router.get(
  "/wallets/lookup",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_LOOKUP),
  asyncHandler(async (req, res) => {
    const query = walletLookupQuerySchema.parse(req.query || {})
    return ok(res, await lookupWalletByDisplayId({ displayId: query.displayId }))
  })
)

router.get(
  "/wallets/:walletId",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_LOOKUP),
  asyncHandler(async (req, res) =>
    ok(res, await getWalletConsole({ walletId: String(req.params.walletId || "").trim() }))
  )
)

router.get(
  "/wallets/:walletId/transactions",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_TRANSACTIONS_VIEW),
  asyncHandler(async (req, res) => {
    const query = walletTransactionsQuerySchema.parse(req.query || {})
    return ok(
      res,
      await listWalletTransactions({
        walletId: String(req.params.walletId || "").trim(),
        page: query.page,
        limit: query.limit,
        transactionType: query.transactionType || "",
        transactionStatus: query.transactionStatus || "",
      })
    )
  })
)

router.get(
  "/wallets/:walletId/points-history",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_POINTS_VIEW),
  asyncHandler(async (req, res) => {
    const query = walletPointsQuerySchema.parse(req.query || {})
    return ok(
      res,
      await listWalletPointsHistory({
        walletId: String(req.params.walletId || "").trim(),
        limit: query.limit,
      })
    )
  })
)

router.get(
  "/wallets/:walletId/audit-logs",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_AUDIT_VIEW),
  asyncHandler(async (req, res) => {
    const query = walletAuditQuerySchema.parse(req.query || {})
    return ok(
      res,
      await listWalletAuditLogs({
        walletId: String(req.params.walletId || "").trim(),
        limit: query.limit,
      })
    )
  })
)

router.get(
  "/wallets/:walletId/statement",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_STATEMENT_EXPORT),
  asyncHandler(async (req, res) => {
    const query = walletStatementQuerySchema.parse(req.query || {})
    const exportPayload = await exportWalletStatement({
      walletId: String(req.params.walletId || "").trim(),
      dateFrom: query.dateFrom || "",
      dateTo: query.dateTo || "",
    })

    res.status(200)
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", contentDispositionAttachment(safeFilenamePart(exportPayload.filename)))
    res.end(exportPayload.content)
  })
)

router.post(
  "/wallets/:walletId/points-adjustments",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_POINTS_ADJUST),
  asyncHandler(async (req, res) => {
    const body = walletPointsAdjustmentSchema.parse(req.body || {})
    return ok(
      res,
      await createWalletPointsAdjustment({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        deltaPoints: body.deltaPoints,
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
        auditContext: {
          ipAddress: req.ip || null,
          userAgent: req.header("user-agent") || null,
        },
      })
    )
  })
)

router.post(
  "/wallets/:walletId/refund-requests",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_REFUND_REQUEST),
  asyncHandler(async (req, res) => {
    const body = walletRefundRequestSchema.parse(req.body || {})
    return ok(
      res,
      await createWalletRefundRequest({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        sourceTransactionPublicId: body.sourceTransactionPublicId,
        amountMwk: body.amountMwk,
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
      }),
      201
    )
  })
)

router.post(
  "/wallets/:walletId/wallet-credits",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_WALLET_CREDIT_ISSUE),
  asyncHandler(async (req, res) => {
    const body = walletCreditSchema.parse(req.body || {})
    return ok(
      res,
      await createWalletCreditRequest({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        amountMwk: body.amountMwk,
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
      }),
      201
    )
  })
)

router.post(
  "/wallets/:walletId/ledger-adjustments",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_LEDGER_ADJUST),
  asyncHandler(async (req, res) => {
    const body = walletLedgerAdjustmentSchema.parse(req.body || {})
    return ok(
      res,
      await createWalletLedgerAdjustmentRequest({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        amountMwk: body.amountMwk,
        direction: body.direction,
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
      }),
      201
    )
  })
)

router.post(
  "/wallets/:walletId/balance-transfers",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER),
  asyncHandler(async (req, res) => {
    const body = walletBalanceTransferSchema.parse(req.body || {})
    return ok(
      res,
      await createWalletBalanceTransferRequest({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        amountMwk: body.amountMwk,
        destinationWalletDisplayId: body.destinationWalletDisplayId || "",
        destinationSystemAccountCode: body.destinationSystemAccountCode || "",
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
      }),
      201
    )
  })
)

router.post(
  "/wallets/:walletId/freeze",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_FREEZE),
  asyncHandler(async (req, res) => {
    const body = walletMutationEnvelopeSchema.parse(req.body || {})
    return ok(
      res,
      await freezeWallet({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
        auditContext: {
          ipAddress: req.ip || null,
          userAgent: req.header("user-agent") || null,
        },
      })
    )
  })
)

router.post(
  "/wallets/:walletId/unfreeze",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_UNFREEZE),
  asyncHandler(async (req, res) => {
    const body = walletMutationEnvelopeSchema.parse(req.body || {})
    return ok(
      res,
      await unfreezeWallet({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
        auditContext: {
          ipAddress: req.ip || null,
          userAgent: req.header("user-agent") || null,
        },
      })
    )
  })
)

router.post(
  "/wallets/:walletId/mark-under-review",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_REVIEW_MARK),
  asyncHandler(async (req, res) => {
    const body = walletMutationEnvelopeSchema.parse(req.body || {})
    return ok(
      res,
      await markWalletUnderReview({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
        auditContext: {
          ipAddress: req.ip || null,
          userAgent: req.header("user-agent") || null,
        },
      })
    )
  })
)

router.post(
  "/wallets/:walletId/holds",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_HOLD_PLACE),
  asyncHandler(async (req, res) => {
    const body = walletHoldSchema.parse(req.body || {})
    return ok(
      res,
      await placeWalletHold({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        amountMwk: body.amountMwk,
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
        auditContext: {
          ipAddress: req.ip || null,
          userAgent: req.header("user-agent") || null,
        },
      })
    )
  })
)

router.post(
  "/wallets/:walletId/holds/:holdId/release",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_HOLD_RELEASE),
  asyncHandler(async (req, res) => {
    const body = walletMutationEnvelopeSchema.parse(req.body || {})
    return ok(
      res,
      await releaseWalletHold({
        actor: req.internalAuth,
        walletId: String(req.params.walletId || "").trim(),
        holdId: String(req.params.holdId || "").trim(),
        reasonCode: body.reasonCode,
        note: body.note,
        requestKey: body.requestKey,
        auditContext: {
          ipAddress: req.ip || null,
          userAgent: req.header("user-agent") || null,
        },
      })
    )
  })
)

router.get(
  "/wallet-operation-requests",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_LOOKUP),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await listWalletOperationRequests({
        actor: req.internalAuth,
        walletId: String(req.query.walletId || "").trim(),
        status: String(req.query.status || "").trim(),
      })
    )
  )
)

router.get(
  "/wallet-operation-requests/:id",
  requireInternalPermission(INTERNAL_PERMISSIONS.WALLET_LOOKUP),
  asyncHandler(async (req, res) =>
    ok(res, await getWalletOperationRequest({ actor: req.internalAuth, requestId: String(req.params.id || "").trim() }))
  )
)

router.post(
  "/wallet-operation-requests/:id/approve",
  requireAnyInternalPermission([
    INTERNAL_PERMISSIONS.WALLET_REFUND_REQUEST,
    INTERNAL_PERMISSIONS.WALLET_WALLET_CREDIT_ISSUE,
    INTERNAL_PERMISSIONS.WALLET_LEDGER_ADJUST,
    INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER,
  ]),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await approveWalletOperationRequest({
        actor: req.internalAuth,
        requestId: String(req.params.id || "").trim(),
        auditContext: {
          ipAddress: req.ip || null,
          userAgent: req.header("user-agent") || null,
        },
      })
    )
  )
)

router.post(
  "/wallet-operation-requests/:id/reject",
  requireAnyInternalPermission([
    INTERNAL_PERMISSIONS.WALLET_REFUND_REQUEST,
    INTERNAL_PERMISSIONS.WALLET_WALLET_CREDIT_ISSUE,
    INTERNAL_PERMISSIONS.WALLET_LEDGER_ADJUST,
    INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER,
  ]),
  asyncHandler(async (req, res) => {
    const body = walletRejectOperationSchema.parse(req.body || {})
    return ok(
      res,
      await rejectWalletOperationRequest({
        actor: req.internalAuth,
        requestId: String(req.params.id || "").trim(),
        rejectionReason: body.rejectionReason,
      })
    )
  })
)

router.get(
  "/analytics-forecasting",
  requireInternalPermission(INTERNAL_PERMISSIONS.ANALYTICS_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getAnalyticsData()))
)

router.get(
  "/analytics-forecasting/export/:format",
  requireInternalPermission(INTERNAL_PERMISSIONS.ANALYTICS_EXPORT),
  asyncHandler(async (req, res) => {
    const format = String(req.params.format || "").trim().toLowerCase()
    if (!["csv", "pdf", "xlsx"].includes(format)) {
      throw badRequest("Unsupported analytics export format")
    }

    const query = analyticsExportQuerySchema.parse(req.query || {})
    const report = await buildAnalyticsExportReport({
      periodDays: query.periodDays,
      region: query.region || "ALL",
      fuelType: query.fuelType || "ALL",
    })

    const fileStem = `smartlink_analytics_${safeFilenamePart(report.filters.regionLabel || "all_regions")}_${safeFilenamePart(report.filters.fuelLabel || "all_fuels")}_${report.filters.periodDays}d_${String(report.generatedAt || "").slice(0, 10)}`
    const sections = [
      {
        title: "Summary",
        headers: ["Metric", "Value"],
        rows: [
          ["Period", report.filters.periodLabel],
          ["Region", report.filters.regionLabel],
          ["Fuel Type", report.filters.fuelLabel],
          ["Total Value", money(report.summary.totalValue)],
          ["Total Litres", numberText(report.summary.totalLitres)],
          ["Transactions", numberText(report.summary.transactionCount)],
          ["Best Station", report.summary.bestStation],
          ["Regional Leader", report.summary.regionalLeader],
          ["Previous Period Value", money(report.summary.previousValue)],
          ["Period Delta", `${Number(report.summary.periodDeltaPct || 0).toFixed(1)}%`],
        ],
      },
      {
        title: "Station Comparison",
        headers: ["Station", "Region", "Transactions", "Litres", "Value"],
        rows: report.stationRows.map((row) => [
          row.stationName,
          row.region,
          numberText(row.transactionCount),
          numberText(row.litresSold),
          money(row.transactionValue),
        ]),
      },
      {
        title: "Regional Analysis",
        headers: ["City", "Region", "Stations", "Litres", "Value"],
        rows: report.regionalRows.map((row) => [
          row.city,
          row.region,
          numberText(row.stationCount),
          numberText(row.litresSold),
          money(row.transactionValue),
        ]),
      },
      {
        title: "Demand Trend",
        headers: ["Date", "Transactions", "Litres", "Value"],
        rows: report.trendRows.map((row) => [
          row.activityDate,
          numberText(row.transactionCount),
          numberText(row.litresSold),
          money(row.transactionValue),
        ]),
      },
      {
        title: "Demand Forecast",
        headers: ["Date", "Forecast Transactions", "Forecast Litres", "Forecast Value"],
        rows: report.forecastRows.map((row) => [
          row.activityDate,
          numberText(row.forecastTransactions),
          numberText(row.forecastLitres),
          money(row.forecastValue),
        ]),
      },
    ]

    res.status(200)
    res.setHeader("Cache-Control", "no-store")

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8")
      res.setHeader("Content-Disposition", contentDispositionAttachment(`${fileStem}.csv`))
      res.end(buildDelimitedExport(sections, ","))
      return
    }

    if (format === "xlsx") {
      res.setHeader("Content-Type", "application/vnd.ms-excel")
      res.setHeader("Content-Disposition", contentDispositionAttachment(`${fileStem}.xls`))
      res.end(buildDelimitedExport(sections, "\t"))
      return
    }

    const html = renderAnalyticsExportHtml(report)
    const buffer = await renderPdfBufferFromHtml({
      html,
      footerTemplate: buildAnalyticsPdfFooterTemplate(report),
    })

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", contentDispositionAttachment(`${fileStem}.pdf`))
    res.setHeader("X-Report-Renderer", "puppeteer")
    res.end(buffer)
  })
)

router.get(
  "/audit-logs",
  requireInternalPermission(INTERNAL_PERMISSIONS.AUDIT_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getAuditLogData()))
)

router.get(
  "/staff",
  requireInternalPermission(INTERNAL_PERMISSIONS.STAFF_VIEW),
  asyncHandler(async (req, res) => ok(res, await getInternalStaffData(req.internalPermissions)))
)

router.post(
  "/staff",
  requireInternalPermission(INTERNAL_PERMISSIONS.STAFF_CREATE),
  asyncHandler(async (req, res) => {
    const body = createInternalUserSchema.parse(req.body || {})
    return ok(
      res,
      await createInternalUser({
        actor: req.internalAuth,
        fullName: body.fullName,
        email: body.email,
        phone: body.phone ?? null,
        roleCode: body.roleCode,
        password: body.password,
      })
    )
  })
)

router.post(
  "/staff/:userPublicId/role",
  requireInternalPermission(INTERNAL_PERMISSIONS.STAFF_MANAGE),
  asyncHandler(async (req, res) => {
    const body = assignRoleSchema.parse(req.body || {})
    return ok(
      res,
      await assignInternalRole({
        actor: req.internalAuth,
        userPublicId: String(req.params.userPublicId || "").trim(),
        roleCode: body.roleCode,
      })
    )
  })
)

router.post(
  "/staff/:userPublicId/role/change",
  requireInternalPermission(INTERNAL_PERMISSIONS.STAFF_MANAGE),
  asyncHandler(async (req, res) => {
    const body = assignRoleSchema.parse(req.body || {})
    return ok(
      res,
      await changeInternalRole({
        actor: req.internalAuth,
        userPublicId: String(req.params.userPublicId || "").trim(),
        roleCode: body.roleCode,
      })
    )
  })
)

router.post(
  "/staff/:userPublicId/role/revoke",
  requireInternalPermission(INTERNAL_PERMISSIONS.STAFF_MANAGE),
  asyncHandler(async (req, res) => {
    const body = assignRoleSchema.parse(req.body || {})
    return ok(
      res,
      await revokeInternalRole({
        actor: req.internalAuth,
        userPublicId: String(req.params.userPublicId || "").trim(),
        roleCode: body.roleCode,
      })
    )
  })
)

router.post(
  "/staff/:userPublicId/suspend",
  requireInternalPermission(INTERNAL_PERMISSIONS.STAFF_SUSPEND),
  asyncHandler(async (req, res) =>
    ok(res, await suspendInternalUser({ actor: req.internalAuth, userPublicId: String(req.params.userPublicId || "").trim() }))
  )
)

router.post(
  "/staff/:userPublicId/reactivate",
  requireInternalPermission(INTERNAL_PERMISSIONS.STAFF_SUSPEND),
  asyncHandler(async (req, res) =>
    ok(res, await reactivateInternalUser({ actor: req.internalAuth, userPublicId: String(req.params.userPublicId || "").trim() }))
  )
)

router.post(
  "/staff/:userPublicId/force-sign-out",
  requireInternalPermission(INTERNAL_PERMISSIONS.SECURITY_FORCE_SIGN_OUT),
  asyncHandler(async (req, res) =>
    ok(res, await forceSignOutInternalUser({ actor: req.internalAuth, userPublicId: String(req.params.userPublicId || "").trim() }))
  )
)

router.post(
  "/staff/:userPublicId/lock",
  requireInternalPermission(INTERNAL_PERMISSIONS.SECURITY_LOCK_ACCOUNT),
  asyncHandler(async (req, res) =>
    ok(res, await lockInternalAccount({ actor: req.internalAuth, userPublicId: String(req.params.userPublicId || "").trim() }))
  )
)

router.post(
  "/staff/:userPublicId/reset-access",
  requireInternalPermission(INTERNAL_PERMISSIONS.STAFF_RESET_ACCESS),
  asyncHandler(async (req, res) =>
    ok(res, await resetInternalAccess({ actor: req.internalAuth, userPublicId: String(req.params.userPublicId || "").trim() }))
  )
)

router.get(
  "/system-health",
  requireInternalPermission(INTERNAL_PERMISSIONS.SYSTEM_HEALTH_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getSystemHealthData()))
)

router.post(
  "/system-health/events/:eventPublicId/acknowledge",
  requireInternalPermission(INTERNAL_PERMISSIONS.ENGINEERING_LOGS_VIEW),
  asyncHandler(async (req, res) =>
    ok(res, await acknowledgeSystemHealthEvent({ actor: req.internalAuth, eventPublicId: String(req.params.eventPublicId || "").trim() }))
  )
)

router.post(
  "/system-health/events/:eventPublicId/bug-note",
  requireInternalPermission(INTERNAL_PERMISSIONS.ENGINEERING_LOGS_VIEW),
  asyncHandler(async (req, res) => {
    const body = noteSchema.parse(req.body || {})
    return ok(
      res,
      await createSystemHealthBugNote({
        actor: req.internalAuth,
        eventPublicId: String(req.params.eventPublicId || "").trim(),
        note: body.note,
      })
    )
  })
)

router.post(
  "/system-health/events/:eventPublicId/link-incident",
  requireInternalPermission(INTERNAL_PERMISSIONS.ENGINEERING_LOGS_VIEW),
  asyncHandler(async (req, res) => {
    const body = incidentLinkSchema.parse(req.body || {})
    return ok(
      res,
      await linkIncidentToSystemHealthEvent({
        actor: req.internalAuth,
        eventPublicId: String(req.params.eventPublicId || "").trim(),
        incidentPublicId: body.incidentPublicId,
      })
    )
  })
)

router.get(
  "/settings",
  requireInternalPermission(INTERNAL_PERMISSIONS.SETTINGS_VIEW),
  asyncHandler(async (_req, res) => ok(res, await getSettingsData()))
)

router.patch(
  "/settings/:settingKey",
  requireInternalPermission(INTERNAL_PERMISSIONS.SETTINGS_EDIT),
  asyncHandler(async (req, res) => {
    const body = updateSettingSchema.parse(req.body || {})
    return ok(
      res,
      await updateInternalSetting({
        actor: req.internalAuth,
        settingKey: String(req.params.settingKey || "").trim(),
        settingValue: body.value,
      })
    )
  })
)

export default router
