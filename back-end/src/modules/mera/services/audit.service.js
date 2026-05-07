import { prisma } from "../../../db/prisma.js"

export async function logMeraAudit({
  actorId = null,
  actorRole = null,
  actorName = null,
  permissionUsed = null,
  actionType,
  actionDescription = null,
  affectedEntity = null,
  ipAddress = null,
  deviceInfo = null,
}) {
  const scopedActionType = String(actionType || "").trim()
  const scopedDescription = String(actionDescription || "").trim() || null
  const scopedAffectedEntity = String(affectedEntity || "").trim() || null
  const scopedPermission = String(permissionUsed || "").trim().toUpperCase() || null
  const scopedIp = String(ipAddress || "").trim() || null
  const scopedDevice = String(deviceInfo || "").trim() || null
  const scopedActorRole = String(actorRole || "").trim().toUpperCase() || null
  const scopedActorName = String(actorName || "").trim() || null

  if (!scopedActionType) return

  await prisma.$executeRaw`
    INSERT INTO audit_logs_mera (
      actor_id,
      actor_name,
      actor_role,
      permission_code,
      action_type,
      action_description,
      affected_entity,
      ip_address,
      device_info
    )
    VALUES (
      ${actorId || null},
      ${scopedActorName},
      ${scopedActorRole},
      ${scopedPermission},
      ${scopedActionType},
      ${scopedDescription},
      ${scopedAffectedEntity},
      ${scopedIp},
      ${scopedDevice}
    )
  `
}
