const CHANNEL_ENV = Object.freeze({
  facebook: ["FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
  instagram: ["INSTAGRAM_BUSINESS_ACCOUNT_ID", "INSTAGRAM_ACCESS_TOKEN"],
  x: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"],
  linkedIn: ["LINKEDIN_PAGE_ID", "LINKEDIN_ACCESS_TOKEN"],
  youtube: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
  tikTok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"],
})

function configured(keys = []) {
  return keys.every((key) => String(process.env[key] || "").trim())
}

function notConfigured(channel) {
  return {
    channel,
    status: "not_configured",
    configured: false,
    externalPostId: null,
    message: `${channel} publishing is not configured for this MERA environment.`,
  }
}

function configuredPlaceholder(channel) {
  return {
    channel,
    status: "configured_placeholder",
    configured: true,
    externalPostId: null,
    message: `${channel} credentials are present, but external posting is intentionally disabled until the integration is enabled.`,
  }
}

function publish(channel, payload = {}) {
  const keys = CHANNEL_ENV[channel] || []
  if (!configured(keys)) return notConfigured(channel)
  return {
    ...configuredPlaceholder(channel),
    title: payload?.title || null,
  }
}

export async function publishToFacebook(payload) {
  return publish("facebook", payload)
}

export async function publishToInstagram(payload) {
  return publish("instagram", payload)
}

export async function publishToX(payload) {
  return publish("x", payload)
}

export async function publishToLinkedIn(payload) {
  return publish("linkedIn", payload)
}

export async function publishToYouTube(payload) {
  return publish("youtube", payload)
}

export async function publishToTikTok(payload) {
  return publish("tikTok", payload)
}

export async function publishPublicNoticeToChannels(payload = {}, channels = []) {
  const selected = Array.isArray(channels) ? channels : []
  const handlers = {
    FACEBOOK_PAGE: publishToFacebook,
    INSTAGRAM_BUSINESS: publishToInstagram,
    X_TWITTER: publishToX,
    LINKEDIN_PAGE: publishToLinkedIn,
    YOUTUBE_COMMUNITY: publishToYouTube,
    TIKTOK: publishToTikTok,
  }

  const results = []
  for (const channel of selected) {
    const handler = handlers[String(channel || "").trim().toUpperCase()]
    if (!handler) {
      results.push({ channel, status: "unsupported", configured: false, externalPostId: null })
    } else {
      results.push(await handler(payload))
    }
  }
  return results
}
