import { z } from "zod"

export const pumpParamsSchema = z.object({
  pumpId: z.string().min(1).max(64),
})

export const simulateBodySchema = z.object({
  pumpId: z.string().min(1).max(64),
  nozzleId: z.string().min(1).max(64),
  status: z.enum(["DISPENSING", "IDLE", "OFFLINE"]),
  litres: z.number().min(0).nullable().optional(),
})

export const telemetryEventBodySchema = z.object({
  eventId: z.string().trim().min(1).max(128).optional(),
  transactionPublicId: z.string().trim().min(1).max(64).optional(),
  sessionPublicId: z.string().trim().min(1).max(64).optional(),
  sessionReference: z.string().trim().min(1).max(64).optional(),
  telemetryCorrelationId: z.string().trim().min(1).max(96).optional(),
  pumpId: z.string().min(1).max(64),
  nozzleId: z.string().min(1).max(64),
  eventType: z.string().trim().min(1).max(64),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  litresValue: z.number().min(0).nullable().optional(),
  dispensedLitres: z.number().min(0).nullable().optional(),
  flowRate: z.number().min(0).nullable().optional(),
  rawErrorCode: z.string().trim().max(64).nullable().optional(),
  message: z.string().trim().min(1).max(255).optional(),
  sourceType: z.string().trim().min(1).max(64).optional(),
  happenedAt: z.string().datetime().optional(),
  payload: z.any().optional(),
})

export const edgeTelemetryEventBodySchema = telemetryEventBodySchema.refine(
  (body) => Boolean(body.sessionPublicId || body.sessionReference || body.telemetryCorrelationId),
  {
    message: "Edge telemetry requires sessionPublicId, sessionReference, or telemetryCorrelationId.",
  }
)
