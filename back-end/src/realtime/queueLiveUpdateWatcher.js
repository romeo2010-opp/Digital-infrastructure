import { buildUserQueueStatusSnapshot } from "../modules/userQueue/service.js"
import {
  deactivateSubscriptionByPublicId,
  dispatchQueueLiveUpdate,
  listActiveQueueLiveUpdateSubscriptions,
  recordQueueLiveUpdateDispatch,
  shouldDispatchQueueLiveUpdate,
} from "../modules/assistant/live-updates.service.js"

const DEFAULT_INTERVAL_MS = Number(process.env.QUEUE_LIVE_UPDATE_WATCH_INTERVAL_MS || 5000)

export function startQueueLiveUpdateWatcher() {
  let running = false
  let stopped = false
  let hasLoggedStartup = false

  async function tick() {
    if (running || stopped) return
    running = true
    try {
      const subscriptions = await listActiveQueueLiveUpdateSubscriptions().catch((error) => {
        const message = String(error?.message || "")
        if (message.includes("057_queue_live_update_subscriptions.sql")) return []
        throw error
      })

      if (!hasLoggedStartup) {
        hasLoggedStartup = true
        // eslint-disable-next-line no-console
        console.info("[voice-update] watcher started", {
          intervalMs: Math.max(2000, DEFAULT_INTERVAL_MS),
          activeSubscriptions: subscriptions.length,
        })
      }

      for (const subscription of subscriptions) {
        try {
          const snapshot = await buildUserQueueStatusSnapshot({
            queueJoinId: subscription.queueJoinId,
            auth: {
              userId: subscription.userId,
            },
          })

          const shouldDispatch = shouldDispatchQueueLiveUpdate(subscription, snapshot)
          if (!shouldDispatch) {
            continue
          }

          // eslint-disable-next-line no-console
          console.info("[voice-update] dispatching live update", {
            subscriptionPublicId: subscription.publicId,
            queueJoinId: subscription.queueJoinId,
            providerCode: subscription.providerCode,
            phoneNumber: subscription.phoneNumber ? `***${String(subscription.phoneNumber).replace(/\D+/g, "").slice(-4)}` : null,
            previousPosition: subscription.lastKnownPosition ?? null,
            previousStatus: subscription.lastKnownStatus ?? null,
            nextPosition: snapshot?.position ?? null,
            nextStatus: snapshot?.queueStatus || null,
          })

          const result = await dispatchQueueLiveUpdate({
            subscription,
            snapshot,
          })

          await recordQueueLiveUpdateDispatch({
            subscriptionPublicId: subscription.publicId,
            snapshot,
            providerReference: result.providerReference,
          })

          // eslint-disable-next-line no-console
          console.info("[voice-update] live update dispatched", {
            subscriptionPublicId: subscription.publicId,
            providerReference: result.providerReference || null,
            nextPosition: snapshot?.position ?? null,
            nextStatus: snapshot?.queueStatus || null,
          })
        } catch (error) {
          const message = String(error?.message || "")
          if (message.includes("Queue entry was not found") || message.includes("Queue status was not found")) {
            await deactivateSubscriptionByPublicId(subscription.publicId).catch(() => {})
            // eslint-disable-next-line no-console
            console.warn("[voice-update] deactivated stale subscription", {
              subscriptionPublicId: subscription.publicId,
              queueJoinId: subscription.queueJoinId,
              reason: message,
            })
            continue
          }
          // eslint-disable-next-line no-console
          console.error("[voice-update] live update tick failed", {
            subscriptionPublicId: subscription.publicId,
            queueJoinId: subscription.queueJoinId,
            providerCode: subscription.providerCode,
            phoneNumber: subscription.phoneNumber ? `***${String(subscription.phoneNumber).replace(/\D+/g, "").slice(-4)}` : null,
            errorMessage: message || "Unknown live update error",
            errorCode: error?.code ?? null,
            errorStatus: error?.status ?? null,
            stack: error?.stack || null,
          })
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[voice-update] watcher tick failed", {
        errorMessage: error?.message || "Unknown watcher error",
        errorCode: error?.code ?? null,
        errorStatus: error?.status ?? null,
        stack: error?.stack || null,
      })
    } finally {
      running = false
    }
  }

  const intervalId = setInterval(tick, Math.max(2000, DEFAULT_INTERVAL_MS))
  tick()

  return () => {
    stopped = true
    clearInterval(intervalId)
  }
}
