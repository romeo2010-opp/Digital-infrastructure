import { z } from "zod"

const complaintTypes = [
  "HOARDING",
  "ILLEGAL_VENDING",
  "OVERPRICING",
  "REFUSAL_TO_SELL",
  "SUSPICIOUS_QUEUE_MANIPULATION",
  "OTHER",
]

export const meraLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(120),
})

export const verifyRoleQuerySchema = z.object({
  roles: z.string().trim().min(1),
})

export const publicStationsQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const createComplaintSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  complaintType: z.enum(complaintTypes),
  complaintDescription: z.string().trim().min(10).max(4000),
  userPublicId: z.string().trim().max(64).optional().nullable(),
  geoLat: z.coerce.number().min(-90).max(90).optional().nullable(),
  geoLng: z.coerce.number().min(-180).max(180).optional().nullable(),
})

export const complaintListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().trim().max(64).optional(),
  complaintType: z.string().trim().max(64).optional(),
  district: z.string().trim().max(80).optional(),
})

export const complaintAssignSchema = z.object({
  officerPublicId: z.string().trim().min(1).max(64),
})

export const complaintStatusSchema = z.object({
  complaintStatus: z.enum(["NEW", "TRIAGED", "ASSIGNED", "UNDER_INVESTIGATION", "RESOLVED", "DISMISSED"]),
})

export const inspectionCreateSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  officerPublicId: z.string().trim().min(1).max(64).optional().nullable(),
  inspectionType: z.enum(["ROUTINE", "FOLLOW_UP", "SPOT_CHECK", "SHORTAGE_RESPONSE", "COMPLAINT_RESPONSE"]),
  queueLength: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  stockVisible: z.coerce.boolean(),
  pumpsActive: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  displayedPrice: z.coerce.number().min(0).max(1000000).optional().nullable(),
  illegalVendingDetected: z.coerce.boolean(),
  geotagLat: z.coerce.number().min(-90).max(90).optional().nullable(),
  geotagLng: z.coerce.number().min(-180).max(180).optional().nullable(),
  officerNotes: z.string().trim().max(4000).optional().nullable(),
  inspectionStatus: z.enum(["OPEN", "PASSED", "FAILED", "ESCALATED", "CLOSED"]),
})

export const inspectionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().trim().max(64).optional(),
})

export const flagCreateSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  flagType: z.enum([
    "COMPLAINT_SURGE",
    "REFUSAL_MISMATCH",
    "REPEATED_INSPECTION_FAILURE",
    "PROLONGED_DRY_STATUS",
    "MANUAL_REVIEW",
    "PRICE_ANOMALY",
    "LICENSE_RISK",
    "POSSIBLE_HOARDING",
  ]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  generatedReason: z.string().trim().min(10).max(4000),
  sourceReference: z.string().trim().max(255).optional().nullable(),
})

export const flagListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().trim().max(64).optional(),
  severity: z.string().trim().max(64).optional(),
})

export const flagResolveSchema = z.object({
  resolvedStatus: z.enum(["UNDER_REVIEW", "RESOLVED", "DISMISSED"]),
})

export const enforcementCreateSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  relatedFlagPublicId: z.string().trim().max(64).optional().nullable(),
  actionType: z.enum(["WARNING", "FINE", "SUSPENSION", "CLOSURE_NOTICE", "FOLLOW_UP_DIRECTIVE"]),
  actionNotes: z.string().trim().max(4000).optional().nullable(),
  actionStatus: z.enum(["OPEN", "IN_PROGRESS", "COMPLIED", "ESCALATED", "CLOSED"]),
})

export const enforcementListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.string().trim().max(64).optional(),
})

export const licenseCreateSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  licenseNumber: z.string().trim().min(3).max(96),
  issueDate: z.string().trim().min(10).max(10),
  expiryDate: z.string().trim().min(10).max(10),
  licenseStatus: z.enum(["ACTIVE", "EXPIRED", "SUSPENDED", "REVOKED", "PENDING_RENEWAL"]),
  complianceConditions: z.string().trim().max(4000).optional().nullable(),
})

export const licenseUpdateSchema = licenseCreateSchema.omit({
  stationPublicId: true,
  licenseNumber: true,
})

export const expiryAlertQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
})

export const licenseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.string().trim().max(64).optional(),
})

export const stationStatusLogSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  reportedSource: z.enum(["STATION", "USER", "MERA_INSPECTION", "SYSTEM"]),
  availabilityStatus: z.enum(["AVAILABLE", "LIMITED", "DRY", "UNKNOWN"]),
  dieselStatus: z.enum(["AVAILABLE", "LIMITED", "DRY", "UNKNOWN"]),
  petrolStatus: z.enum(["AVAILABLE", "LIMITED", "DRY", "UNKNOWN"]),
})

export const fuelPriceReportSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  petrolPrice: z.coerce.number().min(0).max(1000000).optional().nullable(),
  dieselPrice: z.coerce.number().min(0).max(1000000).optional().nullable(),
})

export const fuelDeliveryLogSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  deliveryTime: z.string().trim().min(10).max(40),
  fuelType: z.string().trim().min(2).max(32),
  estimatedVolume: z.coerce.number().min(0).max(100000000).optional().nullable(),
  sourceType: z.string().trim().min(2).max(64),
  reportedBy: z.string().trim().max(120).optional().nullable(),
})

export const fuelDeliveryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  district: z.string().trim().max(80).optional(),
  station: z.string().trim().max(120).optional(),
})

export const availabilityReportCreateSchema = z.object({
  stationPublicId: z.string().trim().min(1).max(64),
  petrolAvailable: z.coerce.boolean(),
  dieselAvailable: z.coerce.boolean(),
  activePumps: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  reportedBy: z.string().trim().max(120).optional().nullable(),
})

export const availabilityReportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  district: z.string().trim().max(80).optional(),
  station: z.string().trim().max(120).optional(),
})

export const hoardingWatchlistQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  district: z.string().trim().max(80).optional(),
  query: z.string().trim().max(120).optional(),
  risk: z.string().trim().max(32).optional(),
})

export const meraUserCreateSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  email: z.string().trim().email(),
  phone: z.string().trim().max(24).optional().nullable(),
  password: z.string().min(8).max(120),
  roleName: z.enum([
    "SUPER_ADMIN",
    "COMPLIANCE_OFFICER",
    "LEGAL_ENFORCEMENT",
    "PUBLIC_COMPLAINT_ANALYST",
    "MARKET_ANALYST",
  ]),
  district: z.string().trim().max(80).optional().nullable(),
  accountStatus: z.enum(["ACTIVE", "INVITED", "SUSPENDED", "DISABLED"]).optional(),
})

export const meraUserStatusSchema = z.object({
  accountStatus: z.enum(["ACTIVE", "INVITED", "SUSPENDED", "DISABLED"]),
})

export const meraProfilePatchSchema = z
  .object({
    fullName: z.string().trim().min(3).max(120).optional(),
    email: z.string().trim().email().max(160).optional(),
    phone: z.string().trim().max(24).optional().nullable(),
  })
  .refine((value) => value.fullName !== undefined || value.email !== undefined || value.phone !== undefined, {
    message: "At least one profile field is required",
    path: ["fullName"],
  })

export const meraPreferencesPatchSchema = z
  .object({
    appearance: z.enum(["light", "system", "dark"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    landingPage: z.enum(["dashboard", "complaints", "hoarding", "audit"]).optional(),
    compactTables: z.coerce.boolean().optional(),
    shortageAlerts: z.coerce.boolean().optional(),
    complaintsAlerts: z.coerce.boolean().optional(),
    dailyDigest: z.coerce.boolean().optional(),
    browserNotifications: z.coerce.boolean().optional(),
    sessionTimeout: z.enum(["15", "30", "60"]).optional(),
    requireStepUp: z.coerce.boolean().optional(),
    trustedDevice: z.coerce.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one preference field is required",
    path: ["appearance"],
  })

export const meraChangePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, "New password must include an uppercase letter")
    .regex(/[a-z]/, "New password must include a lowercase letter")
    .regex(/[0-9]/, "New password must include a number"),
})

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const publicIdParamSchema = z.object({
  publicId: z.string().trim().min(1).max(64),
})

export const licenseIdParamSchema = z.object({
  licenseId: z.coerce.number().int().min(1),
})
