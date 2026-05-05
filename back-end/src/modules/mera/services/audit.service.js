import { prisma } from "../../../db/prisma.js"

export async function logMeraAudit({ actorId = null, actorRole = null, actionType, actionDescription }) {
  const scopedActionType = String(actionType || "").trim()
  const scopedDescription = String(actionDescription || "").trim()
  if (!scopedActionType || !scopedDescription) return

  await prisma.$executeRaw`
    INSERT INTO audit_logs_mera (actor_id, actor_role, action_type, action_description)
    VALUES (${actorId || null}, ${actorRole || null}, ${scopedActionType}, ${scopedDescription})
  `
}
