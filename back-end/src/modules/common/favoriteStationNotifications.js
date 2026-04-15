import { prisma } from "../../db/prisma.js"
import { getAppTimeZone } from "../../utils/dateTime.js"
import { createUserAlert, ensureUserAlertsTableReady } from "./userAlerts.js"
import { sendPushAlertToUser } from "./pushNotifications.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"

function normalizeFavoriteStationPublicIds(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
  }

  if (typeof value !== "string") return []

  try {
    const parsed = JSON.parse(value)
    return normalizeFavoriteStationPublicIds(parsed)
  } catch {
    return []
  }
}

async function listFavoriteStationAlertRecipients(stationPublicId) {
  const scopedStationPublicId = String(stationPublicId || "").trim()
  if (!scopedStationPublicId) return []

  const rows = await prisma.$queryRaw`
    SELECT user_id, favorite_station_public_ids_json, notify_in_app
    FROM user_preferences
    WHERE notify_in_app = 1
  `

  return (rows || [])
    .filter((row) => normalizeFavoriteStationPublicIds(row.favorite_station_public_ids_json).includes(scopedStationPublicId))
    .map((row) => Number(row.user_id || 0))
    .filter((userId) => Number.isFinite(userId) && userId > 0)
}

function formatRestockDateTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: getAppTimeZone(),
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

export async function notifyUsersOfScheduledStationRestock({
  station,
  fuelType = null,
  arrivalTime,
  deliveredLitres = null,
  supplierName = null,
}) {
  const arrivalDate = arrivalTime instanceof Date ? arrivalTime : new Date(arrivalTime)
  if (Number.isNaN(arrivalDate.getTime())) return []
  if (arrivalDate.getTime() <= Date.now()) return []

  const recipients = await listFavoriteStationAlertRecipients(station?.public_id)
  if (!recipients.length) return []

  try {
    await ensureUserAlertsTableReady()
  } catch {
    return []
  }

  const stationName = String(station?.name || "Station").trim() || "Station"
  const fuelLabel = String(fuelType || "Fuel").trim() || "Fuel"
  const arrivalLabel = formatRestockDateTime(arrivalDate)
  if (!arrivalLabel) return []

  const litresValue = Number(deliveredLitres || 0)

  const title = `Restock Scheduled at ${stationName}`
  const body = `${fuelLabel} is expected to restock at ${arrivalLabel}.`
  const path = station?.public_id ? `/m/stations/${station.public_id}` : "/m/alerts"
  const alertTag = `station-restock-${station?.public_id || "station"}-${fuelLabel.toLowerCase()}-${arrivalDate.getTime()}`
  const alerts = []

  for (const userId of recipients) {
    try {
      const alert = await createUserAlert({
        userId,
        stationId: Number(station?.id || 0) || null,
        category: "SYSTEM",
        title,
        body,
        metadata: {
          event: "station_restock_scheduled",
          stationPublicId: station?.public_id || null,
          stationName: station?.name || null,
          fuelType: fuelLabel,
          deliveredLitres: Number.isFinite(litresValue) && litresValue > 0 ? litresValue : null,
          supplierName: String(supplierName || "").trim() || null,
          arrivalTime: arrivalDate.toISOString(),
          path,
        },
      })

      publishUserAlert({
        userId,
        eventType: "user_alert:new",
        data: alert,
      })

      await sendPushAlertToUser({
        userId,
        notification: {
          title: alert.title,
          body: alert.message,
          tag: alert.publicId || alertTag,
          url: path,
          icon: "/smartlogo.png",
          badge: "/smartlogo.png",
        },
        data: {
          alertPublicId: alert.publicId || null,
          stationPublicId: station?.public_id || null,
          fuelType: fuelLabel,
          arrivalTime: arrivalDate.toISOString(),
          path,
        },
      }).catch(() => {})

      alerts.push(alert)
    } catch {
      // Best-effort delivery should not block delivery record writes.
    }
  }

  return alerts
}
