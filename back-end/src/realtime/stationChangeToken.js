import { prisma } from "../db/prisma.js"

function normalizeTokenPart(value) {
  if (value === null || value === undefined) return "0"
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0"
    return String(value)
  }
  return String(value)
}

export async function getStationChangeToken(stationId) {
  const rows = await prisma.$queryRaw`
    SELECT
      COALESCE((SELECT UNIX_TIMESTAMP(updated_at) FROM stations WHERE id = ${stationId} LIMIT 1), 0) AS station_updated_at,

      COALESCE((SELECT COUNT(*) FROM transactions WHERE station_id = ${stationId}), 0) AS tx_count,
      COALESCE((SELECT MAX(id) FROM transactions WHERE station_id = ${stationId}), 0) AS tx_max_id,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(created_at)) FROM transactions WHERE station_id = ${stationId}), 0) AS tx_last_created_at,
      COALESCE((SELECT SUM(litres) FROM transactions WHERE station_id = ${stationId}), 0) AS tx_total_litres,
      COALESCE((SELECT SUM(total_amount) FROM transactions WHERE station_id = ${stationId}), 0) AS tx_total_amount,

      COALESCE((SELECT COUNT(*) FROM fuel_deliveries WHERE station_id = ${stationId}), 0) AS delivery_count,
      COALESCE((SELECT MAX(id) FROM fuel_deliveries WHERE station_id = ${stationId}), 0) AS delivery_max_id,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(created_at)) FROM fuel_deliveries WHERE station_id = ${stationId}), 0) AS delivery_last_created_at,
      COALESCE((SELECT SUM(litres) FROM fuel_deliveries WHERE station_id = ${stationId}), 0) AS delivery_total_litres,

      COALESCE((SELECT COUNT(*) FROM inventory_readings WHERE station_id = ${stationId}), 0) AS reading_count,
      COALESCE((SELECT MAX(id) FROM inventory_readings WHERE station_id = ${stationId}), 0) AS reading_max_id,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(created_at)) FROM inventory_readings WHERE station_id = ${stationId}), 0) AS reading_last_created_at,
      COALESCE((SELECT SUM(litres) FROM inventory_readings WHERE station_id = ${stationId}), 0) AS reading_total_litres,

      COALESCE((SELECT COUNT(*) FROM queue_entries WHERE station_id = ${stationId}), 0) AS queue_count,
      COALESCE((SELECT MAX(id) FROM queue_entries WHERE station_id = ${stationId}), 0) AS queue_max_id,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(last_moved_at)) FROM queue_entries WHERE station_id = ${stationId}), 0) AS queue_last_moved_at,
      COALESCE((SELECT SUM(position) FROM queue_entries WHERE station_id = ${stationId}), 0) AS queue_position_sum,

      COALESCE((SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM station_queue_settings WHERE station_id = ${stationId}), 0) AS queue_settings_updated_at,

      COALESCE((SELECT COUNT(*) FROM pumps WHERE station_id = ${stationId}), 0) AS pump_count,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM pumps WHERE station_id = ${stationId}), 0) AS pump_updated_at,

      COALESCE((SELECT COUNT(*) FROM pump_nozzles WHERE station_id = ${stationId}), 0) AS nozzle_count,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM pump_nozzles WHERE station_id = ${stationId}), 0) AS nozzle_updated_at,

      COALESCE((SELECT COUNT(*) FROM tanks WHERE station_id = ${stationId}), 0) AS tank_count,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM tanks WHERE station_id = ${stationId}), 0) AS tank_updated_at,

      COALESCE((SELECT COUNT(*) FROM incidents WHERE station_id = ${stationId}), 0) AS incident_count,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM incidents WHERE station_id = ${stationId}), 0) AS incident_updated_at,

      COALESCE((SELECT COUNT(*) FROM report_notes WHERE station_id = ${stationId}), 0) AS note_count,
      COALESCE((SELECT UNIX_TIMESTAMP(MAX(created_at)) FROM report_notes WHERE station_id = ${stationId}), 0) AS note_last_created_at,

      COALESCE((SELECT MAX(id) FROM audit_log WHERE station_id = ${stationId}), 0) AS audit_max_id,
      COALESCE((SELECT COUNT(*) FROM audit_log WHERE station_id = ${stationId}), 0) AS audit_count
  `

  const row = rows?.[0] || {}
  return Object.keys(row)
    .sort()
    .map((key) => `${key}:${normalizeTokenPart(row[key])}`)
    .join("|")
}

