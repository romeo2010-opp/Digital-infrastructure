import {
  deactivatePushSubscriptionByEndpoint,
  listActivePushSubscriptionsByUserId,
} from "./userPushSubscriptions.js"

let webPushRuntime = null
let webPushRuntimeAttempted = false
let vapidConfigured = false
let vapidAttempted = false

async function loadWebPushRuntime() {
  if (webPushRuntimeAttempted) return webPushRuntime
  webPushRuntimeAttempted = true
  try {
    const moduleRuntime = await import("web-push")
    webPushRuntime = moduleRuntime?.default || moduleRuntime
  } catch {
    webPushRuntime = null
  }
  return webPushRuntime
}

async function configureVapid() {
  if (vapidAttempted) return vapidConfigured
  vapidAttempted = true

  const runtime = await loadWebPushRuntime()
  if (!runtime) {
    vapidConfigured = false
    return false
  }

  const subject = String(process.env.PUSH_VAPID_SUBJECT || "").trim()
  const publicKey = String(process.env.PUSH_VAPID_PUBLIC_KEY || "").trim()
  const privateKey = String(process.env.PUSH_VAPID_PRIVATE_KEY || "").trim()
  if (!subject || !publicKey || !privateKey) {
    vapidConfigured = false
    return false
  }

  try {
    runtime.setVapidDetails(subject, publicKey, privateKey)
    vapidConfigured = true
  } catch {
    vapidConfigured = false
  }
  return vapidConfigured
}

export function getPushPublicKeyConfig() {
  const publicKey = String(process.env.PUSH_VAPID_PUBLIC_KEY || "").trim()
  const subject = String(process.env.PUSH_VAPID_SUBJECT || "").trim()
  const privateKey = String(process.env.PUSH_VAPID_PRIVATE_KEY || "").trim()
  return {
    enabled: Boolean(publicKey && subject && privateKey),
    publicKey: publicKey || null,
  }
}

export async function sendPushAlertToUser({ userId, notification = {}, data = {} }) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return { sent: 0, failed: 0, skipped: 0 }
  }
  const runtime = await loadWebPushRuntime()
  if (!runtime) {
    return { sent: 0, failed: 0, skipped: 1 }
  }
  if (!(await configureVapid())) {
    return { sent: 0, failed: 0, skipped: 1 }
  }

  const subscriptions = await listActivePushSubscriptionsByUserId(normalizedUserId)
  if (!subscriptions.length) {
    return { sent: 0, failed: 0, skipped: 1 }
  }

  const payload = JSON.stringify({
    title: String(notification?.title || "SmartLink Alert").trim() || "SmartLink Alert",
    body: String(notification?.body || "You have a new alert.").trim() || "You have a new alert.",
    icon: String(notification?.icon || "/smartlogo.png").trim() || "/smartlogo.png",
    badge: String(notification?.badge || "/smartlogo.png").trim() || "/smartlogo.png",
    tag: String(notification?.tag || `smartlink-alert-${Date.now()}`).trim(),
    url: String(notification?.url || "/m/alerts").trim() || "/m/alerts",
    data: data || {},
  })

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const subscription of subscriptions) {
    const endpoint = String(subscription?.endpoint || "").trim()
    const p256dh = String(subscription?.keys?.p256dh || "").trim()
    const auth = String(subscription?.keys?.auth || "").trim()
    if (!endpoint || !p256dh || !auth) {
      skipped += 1
      continue
    }

    try {
      await runtime.sendNotification(
        {
          endpoint,
          keys: {
            p256dh,
            auth,
          },
        },
        payload
      )
      sent += 1
    } catch (error) {
      failed += 1
      const statusCode = Number(error?.statusCode || 0)
      if (statusCode === 404 || statusCode === 410) {
        await deactivatePushSubscriptionByEndpoint(endpoint)
      }
    }
  }

  return { sent, failed, skipped }
}
