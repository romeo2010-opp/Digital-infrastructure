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

  async function tick() {
    if (running || stopped) return
    running = true
    try {
      const subscriptions = await listActiveQueueLiveUpdateSubscriptions().catch((error) => {
        const message = String(error?.message || "")
        if (message.includes("057_queue_live_update_subscriptions.sql")) return []
        throw error
      })

      for (const subscription of subscriptions) {
        try {
          const snapshot = await buildUserQueueStatusSnapshot({
            queueJoinId: subscription.queueJoinId,
            auth: {
              userId: subscription.userId,
            },
          })

          if (!shouldDispatchQueueLiveUpdate(subscription, snapshot)) {
            continue
          }

          const result = await dispatchQueueLiveUpdate({
            subscription,
            snapshot,
          })

          await recordQueueLiveUpdateDispatch({
            subscriptionPublicId: subscription.publicId,
            snapshot,
            providerReference: result.providerReference,
          })
        } catch (error) {
          const message = String(error?.message || "")
          if (message.includes("Queue entry was not found") || message.includes("Queue status was not found")) {
            await deactivateSubscriptionByPublicId(subscription.publicId).catch(() => {})
            continue
          }
          // eslint-disable-next-line no-console
          console.error("[voice-update] live update tick failed", message || error)
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[voice-update] watcher tick failed", error?.message || error)
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
