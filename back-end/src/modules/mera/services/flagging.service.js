import { prisma } from "../../../db/prisma.js"
import { createComplianceFlagRecord } from "./portal.service.js"

export async function evaluateComplaintDrivenFlags({ stationId, actor = null }) {
  const [surgeRows, mismatchRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM public_complaints
      WHERE station_id = ${stationId}
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 6 HOUR)
    `,
    prisma.$queryRaw`
      SELECT COUNT(*) AS total
      FROM public_complaints pc
      WHERE pc.station_id = ${stationId}
        AND pc.complaint_type = 'REFUSAL_TO_SELL'
        AND pc.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 12 HOUR)
        AND EXISTS (
          SELECT 1
          FROM station_status_logs status_log
          WHERE status_log.station_id = pc.station_id
            AND status_log.availability_status = 'AVAILABLE'
            AND status_log.created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 12 HOUR)
        )
    `,
  ])

  const createdFlags = []

  if (Number(surgeRows?.[0]?.total || 0) >= 3) {
    createdFlags.push(
      await createComplianceFlagRecord({
        stationId,
        flagType: "COMPLAINT_SURGE",
        severity: "HIGH",
        generatedReason: "Multiple complaints were reported against the same station within a short time window.",
        sourceReference: "public_complaints:6h",
        actor,
      })
    )
  }

  if (Number(mismatchRows?.[0]?.total || 0) >= 2) {
    createdFlags.push(
      await createComplianceFlagRecord({
        stationId,
        flagType: "REFUSAL_MISMATCH",
        severity: "CRITICAL",
        generatedReason: "Users reported refusal to sell while station logs indicated fuel was available.",
        sourceReference: "public_complaints+station_status_logs:12h",
        actor,
      })
    )
  }

  return createdFlags
}

export async function evaluateInspectionDrivenFlags({ stationId, actor = null }) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total
    FROM inspections
    WHERE station_id = ${stationId}
      AND inspection_status IN ('FAILED', 'ESCALATED')
      AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
  `

  if (Number(rows?.[0]?.total || 0) < 2) return []

  return [
    await createComplianceFlagRecord({
      stationId,
      flagType: "REPEATED_INSPECTION_FAILURE",
      severity: "HIGH",
      generatedReason: "The station has repeated failed or escalated inspections within the past 30 days.",
      sourceReference: "inspections:30d",
      actor,
    }),
  ]
}

export async function evaluateDryStatusFlags({ stationId, actor = null }) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total
    FROM station_status_logs
    WHERE station_id = ${stationId}
      AND availability_status = 'DRY'
      AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 48 HOUR)
  `

  if (Number(rows?.[0]?.total || 0) < 3) return []

  return [
    await createComplianceFlagRecord({
      stationId,
      flagType: "PROLONGED_DRY_STATUS",
      severity: "MEDIUM",
      generatedReason: "The station has remained in repeated dry status for a prolonged period.",
      sourceReference: "station_status_logs:48h",
      actor,
    }),
  ]
}
