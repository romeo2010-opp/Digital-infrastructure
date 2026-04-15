import { z } from "zod"

const nozzleNumberSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => value.length > 0, {
    message: "Nozzle number is required",
  })

const fuelPriceEntrySchema = z.object({
  label: z.string().trim().min(1).max(32),
  pricePerLitre: z.number().positive().max(100000),
})

export const stationParamsSchema = z.object({
  stationPublicId: z.string().min(8).max(64),
})

export const stationPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    operator_name: z.string().max(120).nullable().optional(),
    city: z.string().max(80).nullable().optional(),
    address: z.string().max(255).nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
    is_active: z.boolean().optional(),
    fuel_prices: z.array(fuelPriceEntrySchema).max(12).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one station field is required",
  })

export const tankCreateSchema = z.object({
  name: z.string().min(1).max(80),
  fuelType: z.enum(["PETROL", "DIESEL"]),
  capacityLitres: z.number().positive(),
  isActive: z.boolean().optional(),
})

export const tankPatchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    capacityLitres: z.number().positive().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one tank field is required",
  })

export const nozzleCreateSchema = z.object({
  nozzleNumber: nozzleNumberSchema,
  side: z.string().max(8).optional(),
  fuelType: z.enum(["PETROL", "DIESEL"]),
  tankPublicId: z.string().min(8).max(64).nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "DISPENSING"]).optional(),
  hardwareChannel: z.string().max(64).optional(),
  isActive: z.boolean().optional(),
})

export const nozzlePatchSchema = z
  .object({
    nozzleNumber: nozzleNumberSchema.optional(),
    side: z.string().max(8).nullable().optional(),
    fuelType: z.enum(["PETROL", "DIESEL"]).optional(),
    tankPublicId: z.string().min(8).max(64).nullable().optional(),
    status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "DISPENSING"]).optional(),
    hardwareChannel: z.string().max(64).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one nozzle field is required",
  })

export const pumpCreateSchema = z.object({
  pumpNumber: z.number().int().positive(),
  // Legacy compatibility: auto-creates nozzle #1 from these fields when provided.
  fuelType: z.enum(["PETROL", "DIESEL"]).optional(),
  tankPublicId: z.string().min(8).max(64).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "IDLE"]).optional(),
  statusReason: z.string().max(120).optional(),
  isActive: z.boolean().optional(),
  quickSetup: z.enum(["MALAWI_2_NOZZLES", "MALAWI_4_NOZZLES"]).optional(),
  nozzles: z.array(nozzleCreateSchema).max(8).optional(),
})

export const pumpPatchSchema = z
  .object({
    pumpNumber: z.number().int().positive().optional(),
    // Legacy compatibility.
    fuelType: z.enum(["PETROL", "DIESEL"]).optional(),
    tankPublicId: z.string().min(8).max(64).nullable().optional(),
    status: z.enum(["ACTIVE", "PAUSED", "OFFLINE", "IDLE"]).optional(),
    statusReason: z.string().max(120).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one pump field is required",
  })

export const staffPatchSchema = z
  .object({
    role: z.enum(["MANAGER", "ATTENDANT", "VIEWER"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one staff field is required",
  })

export const userMePatchSchema = z.object({
  fullName: z.string().min(1).max(120),
})

export const userPreferencesPatchSchema = z
  .object({
    theme: z.enum(["SYSTEM", "LIGHT", "DARK"]).optional(),
    defaultReportRange: z.enum(["TODAY", "LAST_7_DAYS", "LAST_30_DAYS"]).optional(),
    defaultFuelType: z.enum(["ALL", "PETROL", "DIESEL"]).optional(),
    notifyInApp: z.boolean().optional(),
    notifyEmail: z.boolean().optional(),
    completedWelcomeTour: z.boolean().optional(),
    favoriteStationPublicIds: z.array(z.string().trim().min(8).max(64)).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one preference field is required",
  })

export const userDeleteRequestSchema = z.object({
  reason: z.string().max(255).optional(),
})

export const queuePatchSchema = z
  .object({
    is_queue_enabled: z.boolean().optional(),
    grace_minutes: z.number().int().positive().max(180).optional(),
    capacity: z.number().int().positive().max(10000).optional(),
    joins_paused: z.boolean().optional(),
    priority_mode: z.enum(["OFF", "ON", "HYBRID"]).optional(),
    hybrid_queue_n: z.number().int().positive().optional(),
    hybrid_walkin_n: z.number().int().positive().optional(),
    petrol_enabled: z.boolean().optional(),
    diesel_enabled: z.boolean().optional(),
    anomaly_warning_z: z.number().positive().max(20).optional(),
    anomaly_critical_z: z.number().positive().max(30).optional(),
    anomaly_ewma_alpha: z.number().positive().max(0.99).optional(),
    anomaly_persistence_minutes: z.number().int().positive().max(120).optional(),
    anomaly_enable_cusum: z.boolean().optional(),
    anomaly_cusum_threshold: z.number().positive().max(100).optional(),
    hybrid_pilot_enabled: z.boolean().optional(),
    pilot_pump_public_id: z.string().trim().max(64).nullable().optional(),
    digital_hold_timeout_seconds: z.number().int().positive().max(3600).optional(),
    kiosk_walkin_redirect_message: z.string().trim().max(255).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one queue field is required",
  })
