import crypto from "node:crypto"
import { prisma } from "../db/prisma.js"

export const PUBLIC_USER_ID_REGEX = /^SLU-[A-Z0-9]{6}$/

const PUBLIC_USER_ID_SPACE = 36 ** 6
const MAX_GENERATION_ATTEMPTS = 50

function randomBase36Code() {
  return crypto.randomInt(PUBLIC_USER_ID_SPACE).toString(36).toUpperCase().padStart(6, "0")
}

async function publicUserIdExists(publicUserId) {
  const rows = await prisma.$queryRaw`
    SELECT id
    FROM users
    WHERE public_id = ${publicUserId}
    LIMIT 1
  `
  return Boolean(rows?.[0]?.id)
}

export async function generatePublicUserId(options = {}) {
  const exists = typeof options.exists === "function" ? options.exists : publicUserIdExists
  const candidateFactory =
    typeof options.candidateFactory === "function"
      ? options.candidateFactory
      : () => `SLU-${randomBase36Code()}`

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = String(candidateFactory()).trim().toUpperCase()
    if (!PUBLIC_USER_ID_REGEX.test(candidate)) {
      continue
    }

    const collision = await exists(candidate)
    if (!collision) {
      return candidate
    }
  }

  throw new Error("Unable to generate unique public user id")
}
