import { z } from "zod"

export const createChallengeSchema = z.object({
  kioskId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
  deviceFingerprint: z.string().trim().min(8).max(255),
  requestedAccessLevel: z.string().trim().min(2).max(64).optional().or(z.literal("")),
})

export const createRegistrationChallengeSchema = z.object({
  deviceFingerprint: z.string().trim().min(8).max(255),
})

export const challengeParamsSchema = z.object({
  challengeId: z.string().trim().length(26),
})

export const registrationChallengeParamsSchema = z.object({
  challengeId: z.string().trim().length(26),
})

export const approveRegistrationChallengeSchema = z.object({
  stationPublicId: z.string().trim().min(8).max(64),
  name: z.string().trim().min(2).max(120),
  locationLabel: z.string().trim().max(120).optional().or(z.literal("")),
})

export const sessionParamsSchema = z.object({
  sessionId: z.string().trim().length(26),
})
