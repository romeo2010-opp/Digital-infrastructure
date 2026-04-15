import { z } from "zod"

export const loginSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(4).max(20).optional(),
    password: z.string().min(5).max(128),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: "Either email or phone is required",
    path: ["email"],
  })

const base64UrlSchema = z
  .string()
  .trim()
  .min(8)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid base64url value")

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().min(4).max(20),
    password: z.string().min(5).max(128),
  })

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().max(120).optional().or(z.literal("")),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().trim().max(20).optional().or(z.literal("")),
  })
  .refine(
    (value) =>
      value.fullName !== undefined || value.email !== undefined || value.phone !== undefined,
    {
      message: "At least one profile field is required",
      path: ["fullName"],
    }
  )

export const refreshSchema = z.object({})

export const passkeyRegistrationOptionsSchema = z.object({})

export const passkeyRegistrationVerifySchema = z.object({
  challengeId: z.string().trim().length(26),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  credential: z.object({
    id: base64UrlSchema,
    rawId: base64UrlSchema,
    type: z.literal("public-key"),
    response: z.object({
      clientDataJSON: base64UrlSchema,
      attestationObject: base64UrlSchema,
    }),
    transports: z.array(z.string().trim().min(2).max(32)).max(8).optional(),
  }),
})

export const passkeyLoginOptionsSchema = z.object({})

export const passkeyLoginVerifySchema = z.object({
  challengeId: z.string().trim().length(26),
  credential: z.object({
    id: base64UrlSchema,
    rawId: base64UrlSchema,
    type: z.literal("public-key"),
    response: z.object({
      clientDataJSON: base64UrlSchema,
      authenticatorData: base64UrlSchema,
      signature: base64UrlSchema,
      userHandle: base64UrlSchema.optional().or(z.literal("")),
    }),
  }),
})

export const passkeyPublicIdParamsSchema = z.object({
  passkeyPublicId: z.string().trim().length(26),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(5).max(128),
  newPassword: z
    .string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, "New password must include an uppercase letter")
    .regex(/[a-z]/, "New password must include a lowercase letter")
    .regex(/[0-9]/, "New password must include a number"),
})

export const switchStationSchema = z.object({
  stationPublicId: z.string().trim().min(8).max(64),
})
