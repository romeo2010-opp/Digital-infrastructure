import { z } from "zod"

const optionalText = (max = 255) => z.string().trim().max(max).optional().or(z.literal(""))
const publicIdSchema = z.string().trim().min(8).max(64)

export const fleetRoleSchema = z.enum(["owner", "admin", "finance", "dispatcher", "driver", "auditor"])
export const fleetFuelTypeSchema = z.enum(["petrol", "diesel", "mixed", "unknown"])
export const fleetPaymentContextSchema = z.enum(["personal", "fleet_wallet", "fuel_card_manual", "fuel_card_integrated", "station_credit"])

export const fleetIdParamsSchema = z.object({
  fleetId: publicIdSchema,
})

export const memberIdParamsSchema = fleetIdParamsSchema.extend({
  memberId: publicIdSchema,
})

export const vehicleIdParamsSchema = fleetIdParamsSchema.extend({
  vehicleId: publicIdSchema,
})

export const departmentIdParamsSchema = fleetIdParamsSchema.extend({
  departmentId: publicIdSchema,
})

export const allocationIdParamsSchema = fleetIdParamsSchema.extend({
  allocationId: publicIdSchema,
})

export const fuelCardIdParamsSchema = fleetIdParamsSchema.extend({
  fuelCardId: publicIdSchema,
})

export const fuelCardProviderIdParamsSchema = fleetIdParamsSchema.extend({
  providerId: publicIdSchema,
})

export const fuelingSessionIdParamsSchema = fleetIdParamsSchema.extend({
  sessionId: publicIdSchema,
})

export const reconciliationMatchIdParamsSchema = fleetIdParamsSchema.extend({
  matchId: publicIdSchema,
})

export const requestIdParamsSchema = fleetIdParamsSchema.extend({
  requestId: publicIdSchema,
})

export const transactionIdParamsSchema = fleetIdParamsSchema.extend({
  transactionId: publicIdSchema,
})

export const policyIdParamsSchema = fleetIdParamsSchema.extend({
  policyId: publicIdSchema,
})

export const alertIdParamsSchema = fleetIdParamsSchema.extend({
  alertId: publicIdSchema,
})

export const invitationIdParamsSchema = fleetIdParamsSchema.extend({
  invitationId: publicIdSchema,
})

export const financialRecordIdParamsSchema = fleetIdParamsSchema.extend({
  recordId: publicIdSchema,
})

export const createFleetAccountSchema = z.object({
  name: z.string().trim().min(2).max(160),
  businessType: z.string().trim().min(2).max(80),
  registrationNumber: optionalText(80),
  primaryContactName: z.string().trim().min(2).max(120),
  primaryContactPhone: z.string().trim().min(4).max(32),
  billingEmail: z.string().trim().email().optional().or(z.literal("")),
})

export const updateFleetAccountSchema = z.object({
  name: optionalText(160),
  businessType: optionalText(80),
  registrationNumber: optionalText(80),
  primaryContactName: optionalText(120),
  primaryContactPhone: optionalText(32),
  billingEmail: z.string().trim().email().optional().or(z.literal("")),
})

export const requestFleetAccessSchema = z.object({
  fleetName: optionalText(160),
  contactName: optionalText(120),
  contactPhone: optionalText(32),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  message: optionalText(500),
})

export const inviteMemberSchema = z
  .object({
    name: optionalText(120),
    userPublicId: publicIdSchema.optional().or(z.literal("")),
    email: z.string().trim().email().optional().or(z.literal("")),
    phone: optionalText(32),
    role: fleetRoleSchema,
    assignedVehicleId: optionalText(64),
    dailyAmountLimit: z.coerce.number().positive().max(100000000).optional(),
    monthlyAmountLimit: z.coerce.number().positive().max(1000000000).optional(),
  })
  .refine((value) => Boolean(value.userPublicId || value.email || value.phone), {
    message: "SmartLink ID, email, or phone is required",
    path: ["userPublicId"],
  })

export const updateMemberRoleSchema = z.object({
  role: fleetRoleSchema,
})

export const updateMemberStatusSchema = z.object({
  reason: optionalText(255),
})

export const acceptInvitationSchema = z.object({
  invitationId: publicIdSchema,
})

export const fleetAllocationSchema = z
  .object({
    memberId: publicIdSchema.optional().or(z.literal("")),
    userPublicId: publicIdSchema.optional().or(z.literal("")),
    vehicleId: publicIdSchema,
    stationPublicId: optionalText(64),
    requestedAmount: z.coerce.number().positive().max(100000000).optional(),
    requestedLitres: z.coerce.number().positive().max(5000).optional(),
    odometerReading: z.coerce.number().min(0).max(10000000).optional(),
    reason: optionalText(255),
    expiresAt: z.string().trim().datetime().optional(),
  })
  .refine((value) => Boolean(value.memberId || value.userPublicId), {
    message: "memberId or userPublicId is required",
    path: ["memberId"],
  })
  .refine((value) => Boolean(value.requestedAmount || value.requestedLitres), {
    message: "requestedAmount or requestedLitres is required",
    path: ["requestedAmount"],
  })

export const vehicleSchema = z.object({
  plateNumber: z.string().trim().min(2).max(32),
  vehicleName: optionalText(120),
  vehicleType: optionalText(80),
  fuelType: fleetFuelTypeSchema.default("unknown"),
  tankCapacityLitres: z.coerce.number().positive().max(10000).optional(),
  currentOdometer: z.coerce.number().min(0).max(10000000).optional(),
  status: z.enum(["active", "maintenance", "suspended", "archived"]).optional(),
})

export const assignDriverSchema = z.object({
  userPublicId: publicIdSchema.optional(),
  memberId: publicIdSchema.optional(),
}).refine((value) => Boolean(value.userPublicId || value.memberId), {
  message: "userPublicId or memberId is required",
  path: ["userPublicId"],
})

export const walletTopupSchema = z.object({
  amount: z.coerce.number().positive().max(1000000000),
  description: optionalText(255),
  externalReference: optionalText(96),
})

export const walletTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  type: optionalText(32),
})

export const fuelRequestSchema = z
  .object({
    fleetId: publicIdSchema.optional(),
    vehicleId: publicIdSchema,
    stationPublicId: optionalText(64),
    requestedAmount: z.coerce.number().positive().max(100000000).optional(),
    requestedLitres: z.coerce.number().positive().max(5000).optional(),
    odometerReading: z.coerce.number().min(0).max(10000000).optional(),
    reason: optionalText(255),
    expiresAt: z.string().trim().datetime().optional(),
  })
  .refine((value) => Boolean(value.requestedAmount || value.requestedLitres), {
    message: "requestedAmount or requestedLitres is required",
    path: ["requestedAmount"],
  })

export const approveFuelRequestSchema = z.object({
  note: optionalText(255),
  approvedAmount: z.coerce.number().positive().max(100000000).optional(),
  approvedLitres: z.coerce.number().positive().max(5000).optional(),
})

export const rejectFuelRequestSchema = z.object({
  reason: z.string().trim().min(2).max(255),
})

export const cancelFuelRequestSchema = z.object({
  reason: optionalText(255),
})

export const fuelRequestQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "expired", "cancelled", "completed", "all"]).default("all"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const fleetTransactionSchema = z.object({
  vehicleId: publicIdSchema,
  driverUserPublicId: publicIdSchema,
  stationPublicId: publicIdSchema,
  pumpPublicId: optionalText(64),
  nozzlePublicId: optionalText(96),
  fuelRequestId: optionalText(64),
  litres: z.coerce.number().positive().max(5000),
  amount: z.coerce.number().positive().max(100000000),
  pricePerLitre: z.coerce.number().positive().max(10000000),
  fuelType: fleetFuelTypeSchema,
  odometerReading: z.coerce.number().min(0).max(10000000).optional(),
})

export const transactionQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  driverUserPublicId: optionalText(64),
  vehicleId: optionalText(64),
  stationPublicId: optionalText(64),
  fuelType: optionalText(16),
  status: optionalText(32),
  riskStatus: optionalText(32),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const policySchema = z.object({
  name: z.string().trim().min(2).max(140),
  appliesToType: z.enum(["fleet", "vehicle", "driver"]).default("fleet"),
  appliesToId: optionalText(64),
  dailyAmountLimit: z.coerce.number().positive().max(1000000000).optional(),
  weeklyAmountLimit: z.coerce.number().positive().max(1000000000).optional(),
  monthlyAmountLimit: z.coerce.number().positive().max(1000000000).optional(),
  dailyLitreLimit: z.coerce.number().positive().max(1000000).optional(),
  monthlyLitreLimit: z.coerce.number().positive().max(1000000).optional(),
  allowedFuelType: fleetFuelTypeSchema.optional(),
  allowedStationIds: z.array(z.string().trim().min(1).max(64)).max(250).optional(),
  requiresApprovalAboveAmount: z.coerce.number().positive().max(1000000000).optional(),
  active: z.boolean().optional(),
})

export const reportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  driverUserPublicId: optionalText(64),
  vehicleId: optionalText(64),
  stationPublicId: optionalText(64),
})

export const invitationQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "expired", "cancelled", "all"]).default("all"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const moneyAmountSchema = z.coerce.number().min(0).max(10000000000)
const optionalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""))
const optionalDateTimeSchema = z.string().trim().datetime().optional().or(z.literal(""))

export const financialOpsQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
})

export const financialOpsListQuerySchema = z.object({
  status: optionalText(32),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const fleetBudgetSchema = z.object({
  budgetMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fuelBudget: moneyAmountSchema.default(0),
  maintenanceBudget: moneyAmountSchema.default(0),
  otherBudget: moneyAmountSchema.default(0),
  revenueTarget: moneyAmountSchema.default(0),
  status: z.enum(["active", "locked", "archived"]).default("active"),
})

export const fleetInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(2).max(64),
  billingPeriodStart: optionalDateSchema,
  billingPeriodEnd: optionalDateSchema,
  status: z.enum(["draft", "pending", "paid", "overdue", "cancelled"]).default("pending"),
  subtotal: moneyAmountSchema.default(0),
  taxAmount: moneyAmountSchema.default(0),
  totalAmount: moneyAmountSchema.default(0),
  paidAmount: moneyAmountSchema.default(0),
  dueAt: optionalDateTimeSchema,
  paidAt: optionalDateTimeSchema,
  notes: optionalText(255),
})

export const fleetMaintenanceSchema = z.object({
  vehicleId: publicIdSchema,
  recordType: z.enum(["service", "repair", "inspection", "tyres", "other"]).default("service"),
  maintenanceType: optionalText(64),
  status: z.enum(["due", "scheduled", "completed", "overdue", "cancelled"]).default("due"),
  title: z.string().trim().min(2).max(140),
  costEstimate: moneyAmountSchema.default(0),
  costActual: moneyAmountSchema.default(0),
  odometerReading: z.coerce.number().min(0).max(10000000).optional(),
  lastServiceOdometer: z.coerce.number().min(0).max(10000000).optional(),
  nextServiceOdometer: z.coerce.number().min(0).max(10000000).optional(),
  lastServiceDate: optionalDateSchema,
  nextServiceDate: optionalDateSchema,
  dueAt: optionalDateTimeSchema,
  completedAt: optionalDateTimeSchema,
  notes: optionalText(500),
})

export const fleetRouteActivitySchema = z.object({
  vehicleId: optionalText(64),
  driverUserPublicId: optionalText(64),
  routeName: z.string().trim().min(2).max(140),
  routeStatus: z.enum(["planned", "active", "completed", "cancelled"]).default("planned"),
  distanceKm: z.coerce.number().min(0).max(1000000).default(0),
  fuelCost: moneyAmountSchema.default(0),
  otherCost: moneyAmountSchema.default(0),
  revenueAmount: moneyAmountSchema.default(0),
  startedAt: optionalDateTimeSchema,
  completedAt: optionalDateTimeSchema,
})

export const fleetVehicleLiveStateSchema = z.object({
  vehicleId: publicIdSchema,
  fuelPercent: z.coerce.number().min(0).max(100).optional(),
  operationalStatus: z.enum(["active", "idle", "in_service", "offline"]).default("offline"),
  locationLabel: optionalText(160),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  speedKph: z.coerce.number().min(0).max(400).optional(),
  lastSeenAt: optionalDateTimeSchema,
})

const allocationTargetTypeSchema = z.enum(["fleet", "department", "vehicle", "driver", "card", "trip", "emergency_reserve"])
const allocationUnitSchema = z.enum(["litres", "money", "both"])
const allocationRolloverPolicySchema = z.enum(["top_up_to_cap", "reset_no_carryover", "carryover_with_cap", "manual_review"])

export const fleetDepartmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: optionalText(32),
  managerUserPublicId: optionalText(64),
  status: z.enum(["active", "suspended", "archived"]).default("active"),
})

export const fleetAllocationV2Schema = z
  .object({
    departmentId: optionalText(64),
    vehicleId: optionalText(64),
    driverUserPublicId: optionalText(64),
    fuelCardId: optionalText(64),
    allocationTargetType: allocationTargetTypeSchema.default("fleet"),
    allocationUnit: allocationUnitSchema.default("litres"),
    monthlyLitreCap: z.coerce.number().min(0).max(10000000).optional(),
    monthlyMoneyCap: moneyAmountSchema.optional(),
    currentLitreBalance: z.coerce.number().min(0).max(10000000).optional(),
    currentMoneyBalance: moneyAmountSchema.optional(),
    usedLitresCurrentPeriod: z.coerce.number().min(0).max(10000000).optional(),
    usedMoneyCurrentPeriod: moneyAmountSchema.optional(),
    carryOverLitres: z.coerce.number().min(0).max(10000000).optional(),
    carryOverMoney: moneyAmountSchema.optional(),
    rolloverPolicy: allocationRolloverPolicySchema.default("top_up_to_cap"),
    maxCarryoverLitres: z.coerce.number().min(0).max(10000000).optional(),
    maxCarryoverMoney: moneyAmountSchema.optional(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["active", "paused", "archived"]).default("active"),
  })
  .refine((value) => value.allocationUnit !== "litres" || value.monthlyLitreCap !== undefined || value.currentLitreBalance !== undefined, {
    message: "Litres allocation requires a litre cap or balance",
    path: ["monthlyLitreCap"],
  })
  .refine((value) => value.allocationUnit !== "money" || value.monthlyMoneyCap !== undefined || value.currentMoneyBalance !== undefined, {
    message: "Money allocation requires a money cap or balance",
    path: ["monthlyMoneyCap"],
  })

export const fleetAllocationAdjustmentSchema = z
  .object({
    transactionType: z.enum(["allocation_topup", "adjustment", "carryover", "reversal"]).default("adjustment"),
    litres: z.coerce.number().min(0).max(10000000).optional(),
    amount: moneyAmountSchema.optional(),
    reference: optionalText(96),
    note: optionalText(255),
  })
  .refine((value) => value.litres !== undefined || value.amount !== undefined, {
    message: "litres or amount is required",
    path: ["litres"],
  })

export const fleetAllocationV2UpdateSchema = z.object({
  departmentId: optionalText(64),
  vehicleId: optionalText(64),
  driverUserPublicId: optionalText(64),
  fuelCardId: optionalText(64),
  allocationTargetType: allocationTargetTypeSchema.optional(),
  allocationUnit: allocationUnitSchema.optional(),
  monthlyLitreCap: z.coerce.number().min(0).max(10000000).optional(),
  monthlyMoneyCap: moneyAmountSchema.optional(),
  currentLitreBalance: z.coerce.number().min(0).max(10000000).optional(),
  currentMoneyBalance: moneyAmountSchema.optional(),
  usedLitresCurrentPeriod: z.coerce.number().min(0).max(10000000).optional(),
  usedMoneyCurrentPeriod: moneyAmountSchema.optional(),
  carryOverLitres: z.coerce.number().min(0).max(10000000).optional(),
  carryOverMoney: moneyAmountSchema.optional(),
  rolloverPolicy: allocationRolloverPolicySchema.optional(),
  maxCarryoverLitres: z.coerce.number().min(0).max(10000000).optional(),
  maxCarryoverMoney: moneyAmountSchema.optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
})

export const fleetAllocationRolloverSchema = z.object({
  allocationIds: z.array(publicIdSchema).max(100).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const fleetFuelNowSchema = z
  .object({
    fleetId: publicIdSchema.optional(),
    vehicleId: publicIdSchema,
    stationPublicId: optionalText(64),
    allocationId: optionalText(64),
    fuelCardId: optionalText(64),
    paymentContextType: fleetPaymentContextSchema.default("fleet_wallet"),
    requestedLitres: z.coerce.number().positive().max(5000).optional(),
    requestedAmount: z.coerce.number().positive().max(100000000).optional(),
    odometerReading: z.coerce.number().min(0).max(10000000),
    fuelType: fleetFuelTypeSchema.optional(),
  })
  .refine((value) => value.requestedLitres !== undefined || value.requestedAmount !== undefined, {
    message: "requestedLitres or requestedAmount is required",
    path: ["requestedLitres"],
  })

export const fleetFuelNowCompleteSchema = z.object({
  stationPublicId: optionalText(64),
  pumpPublicId: optionalText(64),
  nozzlePublicId: optionalText(96),
  litres: z.coerce.number().positive().max(5000),
  amount: z.coerce.number().positive().max(100000000),
  pricePerLitre: z.coerce.number().positive().max(10000000),
  fuelType: fleetFuelTypeSchema.optional(),
  odometerReading: z.coerce.number().min(0).max(10000000).optional(),
  externalReference: optionalText(96),
  notes: optionalText(255),
})

export const fleetFuelCardProviderSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["myfuel", "totalenergies", "manual", "fleet_wallet", "station_credit", "other"]).default("manual"),
  supportsApi: z.boolean().default(false),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
})

export const fleetFuelCardSchema = z.object({
  providerId: publicIdSchema,
  departmentId: optionalText(64),
  linkedVehicleId: optionalText(64),
  linkedDriverUserPublicId: optionalText(64),
  cardLabel: z.string().trim().min(2).max(120),
  maskedCardNumber: z.string().trim().min(2).max(32),
  status: z.enum(["active", "suspended", "archived", "blocked"]).default("active"),
  providerStatus: z.enum(["manual_tracking", "synced", "api_not_connected", "blocked"]).default("manual_tracking"),
  monthlyLitreLimit: z.coerce.number().min(0).max(10000000).optional(),
  monthlyMoneyLimit: moneyAmountSchema.optional(),
  dailyLitreLimit: z.coerce.number().min(0).max(10000000).optional(),
  dailyMoneyLimit: moneyAmountSchema.optional(),
})

export const fleetFuelCardImportSchema = z.object({
  providerId: publicIdSchema,
  fuelCardId: optionalText(64),
  fileName: optionalText(180),
  rowsTotal: z.coerce.number().int().min(0).max(1000000).default(0),
  rowsMatched: z.coerce.number().int().min(0).max(1000000).default(0),
  rowsUnmatched: z.coerce.number().int().min(0).max(1000000).default(0),
  metadata: z.record(z.unknown()).optional(),
})

export const fleetFuelCardReconciliationActionSchema = z.object({
  fleetTransactionId: optionalText(64),
  status: z.enum(["matched", "unmatched", "suspicious", "duplicate", "needs_review"]).default("matched"),
  notes: optionalText(500),
})
