import { prisma } from "../../db/prisma.js"
import { resolveStationOrThrow, writeAuditLog } from "../common/db.js"

function normalizeDatePart(value) {
  const date = String(value || "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function toUtcMysqlDateTime(ms) {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 19).replace("T", " ")
}

function getTimeZoneOffsetMs(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })

  const parts = formatter.formatToParts(date)
  const values = {}
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value)
    }
  }

  const asUtcMs = Date.UTC(
    values.year || 0,
    (values.month || 1) - 1,
    values.day || 1,
    values.hour || 0,
    values.minute || 0,
    values.second || 0
  )

  return asUtcMs - date.getTime()
}

function zonedDateTimeToUtcMs(datePart, timePart, timeZone) {
  const [year, month, day] = datePart.split("-").map((chunk) => Number(chunk))
  const [hour, minute, second] = timePart.split(":").map((chunk) => Number(chunk))
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), timeZone)
  return utcGuess - offsetMs
}

function toDateRange(filters, stationTimeZone = "UTC") {
  const from = filters.from
  const to = filters.to
  const parsedFrom = normalizeDatePart(from)
  const parsedTo = normalizeDatePart(to)
  const timezone = stationTimeZone || "UTC"

  let fromDt = `${from} 00:00:00`
  let toDt = `${to} 23:59:59`

  if (parsedFrom && parsedTo) {
    try {
      const fromUtcMs = zonedDateTimeToUtcMs(parsedFrom, "00:00:00", timezone)
      const toUtcMs = zonedDateTimeToUtcMs(parsedTo, "23:59:59", timezone)
      const nextFrom = toUtcMysqlDateTime(fromUtcMs)
      const nextTo = toUtcMysqlDateTime(toUtcMs)
      if (nextFrom && nextTo) {
        fromDt = nextFrom
        toDt = nextTo
      }
    } catch {
      // Fallback to raw date-range window when timezone conversion is not available.
    }
  }

  return { from, to, fromDt, toDt }
}

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function applyCommonFilters({ fuelType, pumpPublicId, shiftStart, shiftEnd }) {
  return {
    fuelFilter: fuelType && fuelType !== "ALL" ? fuelType : null,
    pumpPublicId: pumpPublicId || null,
    shiftStart: shiftStart || null,
    shiftEnd: shiftEnd || null,
  }
}

export function safeFilenamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function contentDispositionAttachment(filename) {
  const safeAscii = safeFilenamePart(filename) || "download"
  const encoded = encodeURIComponent(filename)
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`
}

export async function resolveExportContext(stationPublicId, authUserId) {
  const baseStation = await resolveStationOrThrow(stationPublicId)
  const stationRows = await prisma.$queryRaw`
    SELECT id, public_id, name, city, address, timezone
    FROM stations
    WHERE id = ${baseStation.id}
    LIMIT 1
  `
  const station = stationRows?.[0] || baseStation

  let actorStaffId = null
  let generatedBy = "Manager"
  if (authUserId) {
    const staffRows = await prisma.$queryRaw`
      SELECT ss.id, u.full_name
      FROM station_staff ss
      INNER JOIN users u ON u.id = ss.user_id
      WHERE ss.station_id = ${station.id}
        AND ss.user_id = ${authUserId}
        AND ss.is_active = 1
      LIMIT 1
    `
    actorStaffId = staffRows?.[0]?.id || null
    generatedBy = staffRows?.[0]?.full_name || generatedBy
  }
  return { station, actorStaffId, generatedBy }
}

export async function fetchSectionRows(stationId, filters, section, options = {}) {
  const range = toDateRange(filters, options.timezone || "UTC")
  const common = applyCommonFilters(filters)
  const normalizedSection = section === "pump_rollup" ? "pumps" : section
  const isSingleDayReport = range.from === range.to

  if (normalizedSection === "sales") {
    const rows = isSingleDayReport
      ? await prisma.$queryRaw`
          SELECT
            DATE_FORMAT(t.occurred_at, '%Y-%m-%d %H:00:00') AS sale_hour,
            ft.code AS fuel_code,
            SUM(t.litres) AS litres_sold,
            SUM(t.total_amount) AS revenue,
            COUNT(*) AS tx_count
          FROM transactions t
          INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
          LEFT JOIN pumps p ON p.id = t.pump_id
          WHERE t.station_id = ${stationId}
            AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
            AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
            AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
            AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
            AND (${common.shiftStart} IS NULL OR TIME(t.occurred_at) >= ${common.shiftStart})
            AND (${common.shiftEnd} IS NULL OR TIME(t.occurred_at) <= ${common.shiftEnd})
          GROUP BY DATE_FORMAT(t.occurred_at, '%Y-%m-%d %H:00:00'), ft.code
          ORDER BY sale_hour ASC, fuel_code ASC
        `
      : await prisma.$queryRaw`
          SELECT
            DATE(t.occurred_at) AS sale_date,
            ft.code AS fuel_code,
            SUM(t.litres) AS litres_sold,
            SUM(t.total_amount) AS revenue,
            COUNT(*) AS tx_count
          FROM transactions t
          INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
          LEFT JOIN pumps p ON p.id = t.pump_id
          WHERE t.station_id = ${stationId}
            AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
            AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
            AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
            AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
            AND (${common.shiftStart} IS NULL OR TIME(t.occurred_at) >= ${common.shiftStart})
            AND (${common.shiftEnd} IS NULL OR TIME(t.occurred_at) <= ${common.shiftEnd})
          GROUP BY DATE(t.occurred_at), ft.code
          ORDER BY sale_date ASC, fuel_code ASC
        `
    return {
      columns: [
        { key: isSingleDayReport ? "sale_hour" : "sale_date", header: isSingleDayReport ? "Sale Hour" : "Sale Date" },
        { key: "fuel_code", header: "Fuel Type" },
        { key: "litres_sold", header: "Litres Sold" },
        { key: "revenue", header: "Revenue" },
        { key: "tx_count", header: "Transactions" },
      ],
      rows,
    }
  }

  if (normalizedSection === "reconciliation") {
    const rows = await prisma.$queryRaw`
      SELECT
        ft.code AS fuel_code,
        t.public_id AS tank_public_id,
        t.name AS tank_name,
        COALESCE(opening.opening_litres, fallback_opening.fallback_opening_litres) AS opening_litres,
        COALESCE(opening.opening_time, fallback_opening.fallback_opening_time) AS opening_time,
        COALESCE(del.delivery_litres, 0) AS delivered_litres,
        closing.closing_litres,
        closing.closing_time,
        COALESCE(tx.recorded_litres, 0) AS recorded_litres
      FROM tanks t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN (
        SELECT ir.tank_id, ir.litres AS opening_litres, ir.reading_time AS opening_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MIN(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'OPENING'
            AND reading_time BETWEEN ${range.fromDt} AND ${range.toDt}
          GROUP BY tank_id
        ) x ON x.tank_id = ir.tank_id AND x.reading_time = ir.reading_time
      ) opening ON opening.tank_id = t.id
      LEFT JOIN (
        SELECT ir.tank_id, ir.litres AS fallback_opening_litres, ir.reading_time AS fallback_opening_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'CLOSING'
            AND reading_time < ${range.fromDt}
          GROUP BY tank_id
        ) prev ON prev.tank_id = ir.tank_id AND prev.reading_time = ir.reading_time
        WHERE ir.station_id = ${stationId}
          AND ir.reading_type = 'CLOSING'
      ) fallback_opening ON fallback_opening.tank_id = t.id
      LEFT JOIN (
        SELECT tank_id, SUM(litres) AS delivery_litres
        FROM fuel_deliveries
        WHERE station_id = ${stationId}
          AND delivered_time BETWEEN ${range.fromDt} AND ${range.toDt}
        GROUP BY tank_id
      ) del ON del.tank_id = t.id
      LEFT JOIN (
        SELECT ir.tank_id, ir.litres AS closing_litres, ir.reading_time AS closing_time
        FROM inventory_readings ir
        INNER JOIN (
          SELECT tank_id, MAX(reading_time) AS reading_time
          FROM inventory_readings
          WHERE station_id = ${stationId}
            AND reading_type = 'CLOSING'
            AND reading_time BETWEEN ${range.fromDt} AND ${range.toDt}
          GROUP BY tank_id
        ) y ON y.tank_id = ir.tank_id AND y.reading_time = ir.reading_time
      ) closing ON closing.tank_id = t.id
      LEFT JOIN (
        SELECT COALESCE(pn.tank_id, p.tank_id) AS tank_id, SUM(tx.litres) AS recorded_litres
        FROM transactions tx
        LEFT JOIN pump_nozzles pn ON pn.id = tx.nozzle_id
        LEFT JOIN pumps p ON p.id = tx.pump_id
        LEFT JOIN fuel_types ft2 ON ft2.id = tx.fuel_type_id
        WHERE tx.station_id = ${stationId}
          AND tx.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
          AND COALESCE(tx.status, 'RECORDED') = 'RECORDED'
          AND (${common.fuelFilter} IS NULL OR ft2.code = ${common.fuelFilter})
        GROUP BY COALESCE(pn.tank_id, p.tank_id)
      ) tx ON tx.tank_id = t.id
      WHERE t.station_id = ${stationId}
        AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
      ORDER BY ft.code ASC, t.name ASC
    `

    const normalizedRows = rows.map((row) => {
      const opening = row.opening_litres == null ? null : toNumber(row.opening_litres)
      const deliveries = row.delivered_litres == null ? null : toNumber(row.delivered_litres)
      const closing = row.closing_litres == null ? null : toNumber(row.closing_litres)
      const recorded = toNumber(row.recorded_litres)
      const openingRecorded = row.opening_time != null && opening != null
      const closingRecorded = row.closing_time != null && closing != null
      const hasMissing = !openingRecorded || deliveries == null || !closingRecorded
      const bookSales = hasMissing ? null : opening + deliveries - closing
      const varianceLitres = bookSales == null ? null : bookSales - recorded
      const variancePct = bookSales && bookSales !== 0 ? (varianceLitres / bookSales) * 100 : null
      const attentionNeeded = variancePct == null ? false : Math.abs(variancePct) > 0.5
      return {
        ...row,
        book_sales: bookSales,
        variance_litres: varianceLitres,
        variance_pct: variancePct,
        attention_needed: attentionNeeded,
        data_missing: hasMissing,
      }
    })

    return {
      columns: [
        { key: "fuel_code", header: "Fuel Type" },
        { key: "tank_name", header: "Tank Name" },
        { key: "opening_litres", header: "Opening Litres" },
        { key: "delivered_litres", header: "Deliveries Litres" },
        { key: "closing_litres", header: "Closing Litres" },
        { key: "book_sales", header: "Book Sales" },
        { key: "recorded_litres", header: "Recorded Sales" },
        { key: "variance_litres", header: "Variance L" },
        { key: "variance_pct", header: "Variance %" },
        { key: "attention_needed", header: "Attention Needed" },
      ],
      rows: normalizedRows,
    }
  }

  if (normalizedSection === "pumps") {
    const rows = await prisma.$queryRaw`
      SELECT
        p.public_id AS pump_public_id,
        p.pump_number,
        CASE
          WHEN COUNT(DISTINCT nft.code) = 0 THEN NULL
          WHEN COUNT(DISTINCT nft.code) = 1 THEN MAX(nft.code)
          ELSE 'MIXED'
        END AS fuel_code,
        COALESCE(
          CASE
            WHEN p.status = 'OFFLINE' THEN 'OFFLINE'
            WHEN p.status = 'PAUSED' THEN 'PAUSED'
            WHEN p.status = 'IDLE' THEN 'IDLE'
            WHEN SUM(CASE WHEN pn.status = 'DISPENSING' THEN 1 ELSE 0 END) > 0 THEN 'DISPENSING'
            WHEN COUNT(pn.id) = 0 THEN 'OFFLINE'
            WHEN COUNT(pn.id) > 0 AND SUM(CASE WHEN pn.status = 'OFFLINE' THEN 1 ELSE 0 END) = COUNT(pn.id) THEN 'OFFLINE'
            WHEN COUNT(pn.id) > 0 AND SUM(CASE WHEN pn.status = 'PAUSED' THEN 1 ELSE 0 END) = COUNT(pn.id) THEN 'PAUSED'
            WHEN SUM(CASE WHEN pn.status IN ('OFFLINE', 'PAUSED') THEN 1 ELSE 0 END) > 0 THEN 'DEGRADED'
            ELSE 'ACTIVE'
          END,
          p.status
        ) AS status,
        COUNT(t.id) AS tx_count,
        COALESCE(SUM(t.litres), 0) AS litres_dispensed,
        COALESCE(SUM(t.total_amount), 0) AS revenue,
        (
          SELECT COUNT(*)
          FROM audit_log al
          WHERE al.station_id = ${stationId}
            AND al.action_type = 'PUMP_STATUS_UPDATE'
            AND al.created_at BETWEEN ${range.fromDt} AND ${range.toDt}
            AND al.payload LIKE CONCAT('%"pumpPublicId":"', p.public_id, '"%')
            AND al.payload LIKE '%"status":"PAUSED"%'
        ) AS paused_count,
        (
          SELECT COUNT(*)
          FROM audit_log al
          WHERE al.station_id = ${stationId}
            AND al.action_type = 'PUMP_STATUS_UPDATE'
            AND al.created_at BETWEEN ${range.fromDt} AND ${range.toDt}
            AND al.payload LIKE CONCAT('%"pumpPublicId":"', p.public_id, '"%')
            AND al.payload LIKE '%"status":"OFFLINE"%'
          ) AS offline_count
      FROM pumps p
      LEFT JOIN pump_nozzles pn ON pn.pump_id = p.id AND pn.station_id = p.station_id
      LEFT JOIN fuel_types nft ON nft.id = pn.fuel_type_id
      LEFT JOIN transactions t
        ON t.pump_id = p.id
       AND t.station_id = ${stationId}
       AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
       AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
      LEFT JOIN fuel_types tft ON tft.id = t.fuel_type_id
      WHERE p.station_id = ${stationId}
        AND (${common.fuelFilter} IS NULL OR tft.code = ${common.fuelFilter} OR nft.code = ${common.fuelFilter})
        AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
      GROUP BY p.id, p.public_id, p.pump_number, p.status
      ORDER BY p.pump_number ASC
    `
    return {
      columns: [
        { key: "pump_number", header: "Pump Number" },
        { key: "fuel_code", header: "Fuel Type" },
        { key: "litres_dispensed", header: "Litres" },
        { key: "revenue", header: "Revenue" },
        { key: "tx_count", header: "Tx Count" },
        { key: "status", header: "Current Status" },
        { key: "paused_count", header: "Times Paused" },
        { key: "offline_count", header: "Times Offline" },
      ],
      rows,
    }
  }

  if (normalizedSection === "nozzle_breakdown") {
    const rows = await prisma.$queryRaw`
      SELECT
        p.pump_number,
        pn.nozzle_number,
        pn.side,
        ft.code AS fuel_code,
        pn.status,
        COUNT(t.id) AS tx_count,
        COALESCE(SUM(t.litres), 0) AS litres_dispensed,
        COALESCE(SUM(t.total_amount), 0) AS revenue
      FROM pump_nozzles pn
      INNER JOIN pumps p ON p.id = pn.pump_id
      LEFT JOIN fuel_types ft ON ft.id = pn.fuel_type_id
      LEFT JOIN transactions t
        ON t.nozzle_id = pn.id
       AND t.station_id = ${stationId}
       AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
       AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
      WHERE pn.station_id = ${stationId}
        AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
        AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
      GROUP BY pn.id, p.pump_number, pn.nozzle_number, pn.side, ft.code, pn.status
      ORDER BY p.pump_number ASC, pn.nozzle_number ASC
    `
    return {
      columns: [
        { key: "pump_number", header: "Pump" },
        { key: "nozzle_number", header: "Nozzle" },
        { key: "side", header: "Side" },
        { key: "fuel_code", header: "Fuel Type" },
        { key: "status", header: "Status" },
        { key: "tx_count", header: "Tx Count" },
        { key: "litres_dispensed", header: "Litres" },
        { key: "revenue", header: "Revenue" },
      ],
      rows,
    }
  }

  if (normalizedSection === "fuel_summary") {
    const rows = await prisma.$queryRaw`
      SELECT
        ft.code AS fuel_code,
        SUM(t.litres) AS litres,
        SUM(t.total_amount) AS revenue,
        COUNT(*) AS tx_count,
        COALESCE(SUM(t.total_amount) / NULLIF(SUM(t.litres), 0), 0) AS avg_price_per_litre
      FROM transactions t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN pumps p ON p.id = t.pump_id
      WHERE t.station_id = ${stationId}
        AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
        AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
        AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
        AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
      GROUP BY ft.code
      ORDER BY ft.code ASC
    `
    return {
      columns: [
        { key: "fuel_code", header: "Fuel Type" },
        { key: "litres", header: "Litres" },
        { key: "revenue", header: "Revenue" },
        { key: "tx_count", header: "Tx Count" },
        { key: "avg_price_per_litre", header: "Avg Price/Litre" },
      ],
      rows,
    }
  }

  if (normalizedSection === "exceptions") {
    const rows = await prisma.$queryRaw`
      SELECT
        'OFFLINE_NOZZLES' AS exception_type,
        COUNT(*) AS exception_count
      FROM pump_nozzles
      WHERE station_id = ${stationId}
        AND status = 'OFFLINE'

      UNION ALL

      SELECT
        'MISSING_NOZZLE_TX' AS exception_type,
        COUNT(*) AS exception_count
      FROM transactions
      WHERE station_id = ${stationId}
        AND occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
        AND pump_id IS NOT NULL
        AND nozzle_id IS NULL
    `
    return {
      columns: [
        { key: "exception_type", header: "Exception Type" },
        { key: "exception_count", header: "Count" },
      ],
      rows,
    }
  }

  if (normalizedSection === "settlements") {
    const rows = await prisma.$queryRaw`
      SELECT
        sb.public_id,
        sb.source_reference,
        sb.batch_date,
        sb.status,
        sb.gross_amount,
        sb.fee_amount,
        sb.net_amount,
        sb.source_transaction_reference,
        sb.related_entity_id AS reservation_public_id,
        u.public_id AS user_public_id,
        u.full_name AS user_full_name,
        u.phone_e164 AS user_phone,
        ur.requested_litres,
        ft.code AS fuel_code
      FROM settlement_batches sb
      LEFT JOIN user_reservations ur
        ON sb.related_entity_type = 'RESERVATION'
       AND ur.public_id = sb.related_entity_id
      LEFT JOIN users u ON u.id = ur.user_id
      LEFT JOIN fuel_types ft ON ft.id = ur.fuel_type_id
      WHERE sb.station_id = ${stationId}
        AND sb.batch_date BETWEEN ${range.from} AND ${range.to}
        AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
      ORDER BY sb.batch_date DESC, sb.created_at DESC
    `
    return {
      columns: [
        { key: "public_id", header: "Batch ID" },
        { key: "source_reference", header: "Source Reference" },
        { key: "batch_date", header: "Batch Date" },
        { key: "status", header: "Status" },
        { key: "net_amount", header: "Net Amount" },
        { key: "reservation_public_id", header: "Reservation ID" },
        { key: "user_public_id", header: "User ID" },
        { key: "user_full_name", header: "User Name" },
        { key: "requested_litres", header: "Requested Litres" },
        { key: "fuel_code", header: "Fuel Type" },
        { key: "source_transaction_reference", header: "Wallet Reference" },
      ],
      rows,
    }
  }

  if (normalizedSection === "queue") {
    const rows = await prisma.$queryRaw`
      SELECT
        DATE_FORMAT(joined_at, '%Y-%m-%d %H:00') AS hour_bucket,
        COUNT(*) AS joined_count,
        SUM(status = 'SERVED') AS served_count,
        SUM(status = 'NO_SHOW') AS no_show_count,
        COALESCE(AVG(TIMESTAMPDIFF(MINUTE, joined_at, served_at)), 0) AS avg_wait_min
      FROM queue_entries
      WHERE station_id = ${stationId}
        AND joined_at BETWEEN ${range.fromDt} AND ${range.toDt}
      GROUP BY DATE_FORMAT(joined_at, '%Y-%m-%d %H:00')
      ORDER BY hour_bucket ASC
    `
    return {
      columns: [
        { key: "hour_bucket", header: "Hour Bucket" },
        { key: "joined_count", header: "Joined" },
        { key: "served_count", header: "Served" },
        { key: "no_show_count", header: "No-show" },
        { key: "avg_wait_min", header: "Avg Wait Min" },
      ],
      rows,
    }
  }

  if (normalizedSection === "audit") {
    const rows = await prisma.$queryRaw`
      SELECT id, action_type, payload, created_at, actor_staff_id
      FROM audit_log
      WHERE station_id = ${stationId}
        AND created_at BETWEEN ${range.fromDt} AND ${range.toDt}
      ORDER BY created_at DESC
      LIMIT 5000
    `
    return {
      columns: [
        { key: "created_at", header: "Time" },
        { key: "action_type", header: "Action Type" },
        { key: "payload", header: "Details" },
        { key: "actor_staff_id", header: "Actor" },
      ],
      rows,
    }
  }

  if (normalizedSection === "incidents") {
    const rows = await prisma.$queryRaw`
      SELECT public_id, severity, category, title, description, status, created_at
      FROM incidents
      WHERE station_id = ${stationId}
        AND created_at BETWEEN ${range.fromDt} AND ${range.toDt}
      ORDER BY created_at DESC
      LIMIT 5000
    `
    return {
      columns: [
        { key: "severity", header: "Severity" },
        { key: "category", header: "Category" },
        { key: "title", header: "Title" },
        { key: "status", header: "Status" },
        { key: "created_at", header: "Created At" },
        { key: "description", header: "Description" },
      ],
      rows,
    }
  }

  const rows = await prisma.$queryRaw`
    SELECT
      t.public_id,
      t.occurred_at,
      p.public_id AS pump_public_id,
      pn.public_id AS nozzle_public_id,
      pn.nozzle_number,
      pn.side AS nozzle_side,
      ft.code AS fuel_code,
      t.litres,
      t.price_per_litre,
      t.total_amount,
      t.payment_method,
      t.status,
      t.settlement_impact_status,
      t.workflow_reason_code
    FROM transactions t
    INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
    LEFT JOIN pumps p ON p.id = t.pump_id
    LEFT JOIN pump_nozzles pn ON pn.id = t.nozzle_id
    WHERE t.station_id = ${stationId}
      AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
      AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
      AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
      AND (${common.shiftStart} IS NULL OR TIME(t.occurred_at) >= ${common.shiftStart})
      AND (${common.shiftEnd} IS NULL OR TIME(t.occurred_at) <= ${common.shiftEnd})
    ORDER BY t.occurred_at DESC
    LIMIT 10000
  `
  return {
    columns: [
      { key: "public_id", header: "Transaction ID" },
      { key: "occurred_at", header: "Occurred At" },
      { key: "pump_public_id", header: "Pump Public ID" },
      { key: "nozzle_public_id", header: "Nozzle Public ID" },
      { key: "nozzle_number", header: "Nozzle Number" },
      { key: "nozzle_side", header: "Nozzle Side" },
      { key: "fuel_code", header: "Fuel Type" },
      { key: "litres", header: "Litres" },
      { key: "price_per_litre", header: "Price Per Litre" },
      { key: "total_amount", header: "Total Amount" },
      { key: "payment_method", header: "Payment Method" },
      { key: "status", header: "Transaction Status" },
      { key: "settlement_impact_status", header: "Settlement Impact" },
      { key: "workflow_reason_code", header: "Workflow Reason" },
    ],
    rows,
  }
}

export async function buildPdfSummary(station, filters, generatedBy = "Manager") {
  const stationId = station.id
  const range = toDateRange(filters, station.timezone || "UTC")
  const common = applyCommonFilters(filters)
  const isSingleDayReport = range.from === range.to

  const [
    queueSettingsRows,
    kpiRows,
    reconciliationSection,
    salesSection,
    pumpsSection,
    nozzleSection,
    exceptionsSection,
    queueSection,
    incidentsSection,
    auditRows,
    notesRows,
    paymentRows,
    dailyRows,
    fuelTypeRows,
    movementRows,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT is_queue_enabled
      FROM station_queue_settings
      WHERE station_id = ${stationId}
      LIMIT 1
    `,
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(t.litres), 0) AS total_litres,
        COALESCE(SUM(t.total_amount), 0) AS revenue,
        COUNT(t.id) AS transactions,
        COALESCE(SUM(t.total_amount) / NULLIF(SUM(t.litres), 0), 0) AS weighted_avg_price
      FROM transactions t
      LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN pumps p ON p.id = t.pump_id
      WHERE t.station_id = ${stationId}
        AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
        AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
        AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
        AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
        AND (${common.shiftStart} IS NULL OR TIME(t.occurred_at) >= ${common.shiftStart})
        AND (${common.shiftEnd} IS NULL OR TIME(t.occurred_at) <= ${common.shiftEnd})
    `,
    fetchSectionRows(stationId, filters, "reconciliation", { timezone: station.timezone || "UTC" }),
    fetchSectionRows(stationId, filters, "sales", { timezone: station.timezone || "UTC" }),
    fetchSectionRows(stationId, filters, "pumps", { timezone: station.timezone || "UTC" }),
    fetchSectionRows(stationId, filters, "nozzle_breakdown", { timezone: station.timezone || "UTC" }),
    fetchSectionRows(stationId, filters, "exceptions", { timezone: station.timezone || "UTC" }),
    fetchSectionRows(stationId, filters, "queue", { timezone: station.timezone || "UTC" }),
    fetchSectionRows(stationId, filters, "incidents", { timezone: station.timezone || "UTC" }),
    prisma.$queryRaw`
      SELECT
        al.created_at,
        al.action_type,
        al.payload,
        u.full_name AS actor_name
      FROM audit_log al
      LEFT JOIN station_staff ss ON ss.id = al.actor_staff_id
      LEFT JOIN users u ON u.id = ss.user_id
      WHERE al.station_id = ${stationId}
        AND al.created_at BETWEEN ${range.fromDt} AND ${range.toDt}
      ORDER BY al.created_at DESC
      LIMIT 300
    `,
    prisma.$queryRaw`
      SELECT rn.note_text, rn.created_at, u.full_name
      FROM report_notes rn
      LEFT JOIN station_staff ss ON ss.id = rn.created_by_staff_id
      LEFT JOIN users u ON u.id = ss.user_id
      WHERE rn.station_id = ${stationId}
        AND rn.note_date BETWEEN ${range.from} AND ${range.to}
      ORDER BY rn.note_date DESC, rn.created_at DESC
      LIMIT 30
    `,
    prisma.$queryRaw`
      SELECT t.payment_method, SUM(t.litres) AS litres, SUM(t.total_amount) AS revenue, COUNT(*) AS tx_count
      FROM transactions t
      LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN pumps p ON p.id = t.pump_id
      WHERE t.station_id = ${stationId}
        AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
        AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
        AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
        AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
      GROUP BY t.payment_method
      ORDER BY tx_count DESC
    `,
    isSingleDayReport
      ? prisma.$queryRaw`
          SELECT
            DATE_FORMAT(t.occurred_at, '%Y-%m-%d %H:00:00') AS day_date,
            SUM(t.litres) AS litres,
            SUM(t.total_amount) AS revenue,
            COUNT(*) AS tx_count
          FROM transactions t
          LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
          LEFT JOIN pumps p ON p.id = t.pump_id
          WHERE t.station_id = ${stationId}
            AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
            AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
            AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
            AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
          GROUP BY DATE_FORMAT(t.occurred_at, '%Y-%m-%d %H:00:00')
          ORDER BY day_date ASC
        `
      : prisma.$queryRaw`
          SELECT DATE(t.occurred_at) AS day_date, SUM(t.litres) AS litres, SUM(t.total_amount) AS revenue, COUNT(*) AS tx_count
          FROM transactions t
          LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
          LEFT JOIN pumps p ON p.id = t.pump_id
          WHERE t.station_id = ${stationId}
            AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
            AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
            AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
            AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
          GROUP BY DATE(t.occurred_at)
          ORDER BY day_date ASC
        `,
    prisma.$queryRaw`
      SELECT
        ft.code AS fuel_code,
        SUM(t.litres) AS litres,
        SUM(t.total_amount) AS revenue,
        COUNT(*) AS tx_count,
        COALESCE(SUM(t.total_amount) / NULLIF(SUM(t.litres), 0), 0) AS avg_price
      FROM transactions t
      INNER JOIN fuel_types ft ON ft.id = t.fuel_type_id
      LEFT JOIN pumps p ON p.id = t.pump_id
      WHERE t.station_id = ${stationId}
        AND t.occurred_at BETWEEN ${range.fromDt} AND ${range.toDt}
        AND COALESCE(t.status, 'RECORDED') <> 'CANCELLED'
        AND (${common.fuelFilter} IS NULL OR ft.code = ${common.fuelFilter})
        AND (${common.pumpPublicId} IS NULL OR p.public_id = ${common.pumpPublicId})
      GROUP BY ft.code
      ORDER BY ft.code ASC
    `,
    prisma.$queryRaw`
      SELECT
        m.event_time,
        m.event_type,
        m.tank_name,
        m.litres,
        m.recorded_by,
        m.supplier_name
      FROM (
        SELECT
          ir.reading_time AS event_time,
          CASE WHEN ir.reading_type = 'OPENING' THEN 'Opening' ELSE 'Closing' END AS event_type,
          t.name AS tank_name,
          ir.litres AS litres,
          u.full_name AS recorded_by,
          NULL AS supplier_name
        FROM inventory_readings ir
        INNER JOIN tanks t ON t.id = ir.tank_id
        LEFT JOIN station_staff ss ON ss.id = ir.recorded_by_staff_id
        LEFT JOIN users u ON u.id = ss.user_id
        WHERE ir.station_id = ${stationId}
          AND ir.reading_time BETWEEN ${range.fromDt} AND ${range.toDt}

        UNION ALL

        SELECT
          fd.delivered_time AS event_time,
          'Delivery' AS event_type,
          t.name AS tank_name,
          fd.litres AS litres,
          u.full_name AS recorded_by,
          fd.supplier_name AS supplier_name
        FROM fuel_deliveries fd
        INNER JOIN tanks t ON t.id = fd.tank_id
        LEFT JOIN station_staff ss ON ss.id = fd.recorded_by_staff_id
        LEFT JOIN users u ON u.id = ss.user_id
        WHERE fd.station_id = ${stationId}
          AND fd.delivered_time BETWEEN ${range.fromDt} AND ${range.toDt}
      ) m
      ORDER BY m.event_time DESC
      LIMIT 500
    `,
  ])

  const queueEnabled = Boolean(Number(queueSettingsRows?.[0]?.is_queue_enabled ?? 1))
  const kpi = kpiRows?.[0] || {}
  const reconciliationRows = reconciliationSection.rows || []
  const bookSales = reconciliationRows.reduce((sum, row) => sum + (row.book_sales == null ? 0 : toNumber(row.book_sales)), 0)
  const recordedSales = reconciliationRows.reduce((sum, row) => sum + toNumber(row.recorded_litres), 0)
  const varianceLitres = bookSales - recordedSales
  const variancePct = bookSales > 0 ? (varianceLitres / bookSales) * 100 : 0

  const queueRows = queueSection.rows || []
  const servedCount = queueRows.reduce((sum, row) => sum + toNumber(row.served_count), 0)
  const noShowCount = queueRows.reduce((sum, row) => sum + toNumber(row.no_show_count), 0)
  const joinedCount = queueRows.reduce((sum, row) => sum + toNumber(row.joined_count), 0)
  const avgWaitMin =
    queueRows.length > 0
      ? queueRows.reduce((sum, row) => sum + toNumber(row.avg_wait_min), 0) / queueRows.length
      : null
  const noShowRate = joinedCount > 0 ? (noShowCount / joinedCount) * 100 : 0
  const peakQueueLength = queueRows.length
    ? Math.max(...queueRows.map((row) => toNumber(row.joined_count)))
    : null

  const callsMadeRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS count_calls
    FROM audit_log
    WHERE station_id = ${stationId}
      AND created_at BETWEEN ${range.fromDt} AND ${range.toDt}
      AND action_type IN ('QUEUE_CALL_NEXT','QUEUE_RECALL','QUEUE_CALL_POSITION')
  `
  const callsMade = toNumber(callsMadeRows?.[0]?.count_calls)

  const reportType = range.from === range.to ? "Daily" : "Custom range"
  const location =
    [station.city, station.address].filter(Boolean).join(", ") || "N/A"

  return {
    reportHeader: {
      stationName: station.name,
      stationPublicId: station.public_id,
      location,
      timezone: station.timezone || "Africa/Blantyre",
      reportType,
      fromDate: range.from,
      toDate: range.to,
      generatedAt: new Date().toISOString(),
      generatedBy,
    },
    kpis: {
      totalRevenue: toNumber(kpi.revenue),
      totalLitresSold: toNumber(kpi.total_litres),
      totalTransactions: toNumber(kpi.transactions),
      weightedAvgPricePerLitre: toNumber(kpi.weighted_avg_price),
      bookSales,
      recordedSales,
      varianceLitres,
      variancePct,
      queueEnabled,
      servedCount,
      noShowCount,
      noShowRate,
      avgWaitMin,
    },
    reconciliationRows,
    salesByFuelTypeRows: fuelTypeRows || [],
    salesByDayRows: dailyRows || [],
    salesTrendGranularity: isSingleDayReport ? "HOUR" : "DAY",
    salesByPaymentRows: paymentRows || [],
    pumpRows: pumpsSection.rows || [],
    nozzleRows: nozzleSection.rows || [],
    exceptionRows: exceptionsSection.rows || [],
    queueSummary: {
      queueEnabled,
      servedCount,
      noShowCount,
      noShowRate,
      callsMade,
      peakQueueLength: peakQueueLength == null ? "Not available yet" : peakQueueLength,
      avgWaitMin: avgWaitMin == null ? "Not available yet" : avgWaitMin,
    },
    inventoryMovementRows: movementRows || [],
    incidentRows: incidentsSection.rows || [],
    auditTrailRows: auditRows || [],
    noteRows: notesRows || [],
    signOff: {
      preparedBy: generatedBy || "Manager",
      reviewedBy: "________________",
      date: range.to,
    },
    rowCounts: {
      reconciliation: reconciliationRows.length,
      salesByFuelType: (fuelTypeRows || []).length,
      salesByDay: (dailyRows || []).length,
      salesByPayment: (paymentRows || []).length,
      pumps: (pumpsSection.rows || []).length,
      nozzles: (nozzleSection.rows || []).length,
      exceptions: (exceptionsSection.rows || []).length,
      queue: queueRows.length,
      inventoryMovement: (movementRows || []).length,
      incidents: (incidentsSection.rows || []).length,
      auditTrail: (auditRows || []).length,
      notes: (notesRows || []).length,
    },
  }
}

export async function appendExportAudit({
  stationId,
  actorStaffId,
  actionType,
  section = null,
  filters,
  rowCount,
  rowCounts,
  generatedBy,
}) {
  await writeAuditLog({
    stationId,
    actorStaffId,
    actionType,
    payload: {
      station_id: Number(stationId),
      section,
      filters,
      generated_by: generatedBy || null,
      rowCount: rowCount ?? null,
      rowCounts: rowCounts || null,
      exportedAt: new Date().toISOString(),
    },
  })
}
