import { z } from "zod"

const dateRegex = /^\d{4}-\d{2}-\d{2}$/
const timeRegex = /^\d{2}:\d{2}$/
const trueValues = new Set(["true", "1", "yes", "y"])
const falseValues = new Set(["false", "0", "no", "n"])

function coerceBooleanQuery(value) {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase()
  if (trueValues.has(normalized)) return true
  if (falseValues.has(normalized)) return false
  return value
}

export const exportQuerySchema = z.object({
  from: z.string().regex(dateRegex),
  to: z.string().regex(dateRegex),
  section: z
    .enum([
      "sales",
      "reconciliation",
      "pumps",
      "pump_rollup",
      "nozzle_breakdown",
      "fuel_summary",
      "settlements",
      "queue",
      "audit",
      "exceptions",
      "incidents",
      "transactions",
    ])
    .optional(),
  fuelType: z.enum(["PETROL", "DIESEL", "ALL"]).optional(),
  pumpPublicId: z.string().min(1).max(64).optional(),
  shiftStart: z.string().regex(timeRegex).optional(),
  shiftEnd: z.string().regex(timeRegex).optional(),
  includeAudit: z.preprocess(coerceBooleanQuery, z.boolean()).optional(),
})

export function parseExportQuery(query, { requireSection = false } = {}) {
  const parsed = exportQuerySchema.parse(query)
  if (requireSection && !parsed.section) {
    const error = new Error("section query is required")
    error.status = 400
    throw error
  }
  return {
    ...parsed,
    fuelType: parsed.fuelType || "ALL",
    includeAudit: parsed.includeAudit !== false,
  }
}
