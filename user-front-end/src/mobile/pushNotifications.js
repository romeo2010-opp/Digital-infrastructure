function toUint8Array(base64String) {
  const normalized = String(base64String || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  const rawData = window.atob(padded)
  const outputArray = new Uint8Array(rawData.length)
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }
  return outputArray
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.Notification === "function" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  )
}

export async function registerSmartlinkServiceWorker() {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported in this browser.")
  }
  const registration = await navigator.serviceWorker.register("/sw.js")
  return registration
}

export async function ensurePushSubscription({ vapidPublicKey }) {
  const registration = await registerSmartlinkServiceWorker()
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toUint8Array(vapidPublicKey),
    })
  }
  return subscription
}

export async function unsubscribePushSubscription() {
  if (!isPushSupported()) return { unsubscribed: false, endpoint: null }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return { unsubscribed: false, endpoint: null }
  const endpoint = String(subscription.endpoint || "").trim() || null
  const result = await subscription.unsubscribe().catch(() => false)
  return {
    unsubscribed: Boolean(result),
    endpoint,
  }
}
