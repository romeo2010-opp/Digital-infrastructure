self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {
      body: event.data ? event.data.text() : "You have a new SmartLink alert.",
    }
  }

  const title = payload?.title || "SmartLink Alert"
  const options = {
    body: payload?.body || "You have a new SmartLink alert.",
    icon: payload?.icon || "/smartlogo.png",
    badge: payload?.badge || "/smartlogo.png",
    tag: payload?.tag || "smartlink-alert",
    data: {
      url: payload?.url || "/m/alerts",
      payload: payload?.data || null,
    },
    renotify: true,
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const hasVisibleSmartLinkClient = clients.some((client) => {
        if (!client || typeof client.url !== "string") return false
        if (!client.url.startsWith(self.location.origin)) return false
        return client.visibilityState === "visible" || client.focused === true
      })

      if (hasVisibleSmartLinkClient) {
        return undefined
      }

      return self.registration.showNotification(title, options)
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const relativeUrl = String(event.notification?.data?.url || "/m/alerts").trim() || "/m/alerts"
  const targetUrl = new URL(relativeUrl, self.location.origin).toString()

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (!client || typeof client.url !== "string") continue
        if (client.url.startsWith(self.location.origin)) {
          if (typeof client.focus === "function") {
            client.focus()
          }
          if (typeof client.navigate === "function") {
            return client.navigate(targetUrl)
          }
          return client
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return undefined
    })
  )
})
