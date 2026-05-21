import "dotenv/config"
import http from "node:http"
import { app } from "./app.js"
import { attachStationChangesWebSocket } from "./realtime/stationChangesWebSocket.js"
import { startStationChangeWatcher } from "./realtime/stationChangeWatcher.js"
import { attachMonitoringWebSocket } from "./realtime/monitoringWebSocket.js"
import { attachUserQueueWebSocket } from "./realtime/userQueueWebSocket.js"
import { attachUserStationChangesWebSocket } from "./realtime/userStationChangesWebSocket.js"
import { attachUserAlertsWebSocket } from "./realtime/userAlertsWebSocket.js"
import { attachInternalChatWebSocket } from "./realtime/internalChatWebSocket.js"
import { attachMeraDashboardWebSocket } from "./realtime/meraDashboardWebSocket.js"
import { startMonitoringStateWatcher } from "./modules/monitoring/monitoring.service.js"
import { startQueueLiveUpdateWatcher } from "./realtime/queueLiveUpdateWatcher.js"
import { isTwilioVoiceConfigured } from "./modules/assistant/twilio-voice.service.js"
import { startMeraStationStatusLogger } from "./modules/mera/services/statusLogger.service.js"

const port = Number(process.env.PORT || 4000)
const host = process.env.HOST || "0.0.0.0"
const server = http.createServer(app)

async function bootstrap() {
  const wsState = await attachStationChangesWebSocket(server)
  const monitoringWsState = await attachMonitoringWebSocket(server)
  const userQueueWsState = await attachUserQueueWebSocket(server)
  const userStationWsState = await attachUserStationChangesWebSocket(server)
  const userAlertsWsState = await attachUserAlertsWebSocket(server)
  const internalChatWsState = await attachInternalChatWebSocket(server)
  const meraDashboardWsState = await attachMeraDashboardWebSocket(server)
  const stopWatcher = startStationChangeWatcher()
  const stopMonitoringWatcher = startMonitoringStateWatcher()
  const stopQueueLiveUpdateWatcher = startQueueLiveUpdateWatcher()
  const stopMeraStationStatusLogger = startMeraStationStatusLogger()
  const shutdown = () => {
    stopWatcher()
    stopMonitoringWatcher()
    stopQueueLiveUpdateWatcher()
    stopMeraStationStatusLogger()
  }
  process.on("exit", shutdown)
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`SmartLink API listening on http://${host}:${port}`)
    // eslint-disable-next-line no-console
    console.log("[voice-update] startup config", {
      liveUpdateProvider: process.env.LIVE_UPDATE_PROVIDER || null,
      twilioConfigured: isTwilioVoiceConfigured(),
      publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
      webhookValidationEnabled: String(process.env.TWILIO_VALIDATE_WEBHOOKS || "true").trim().toLowerCase() !== "false",
      watchIntervalMs: Number(process.env.QUEUE_LIVE_UPDATE_WATCH_INTERVAL_MS || 5000),
    })
    if (wsState?.enabled) {
      // eslint-disable-next-line no-console
      console.log(`SmartLink realtime feed listening on ws://${host}:${port}${wsState.path}`)
    }
    if (monitoringWsState?.enabled) {
      // eslint-disable-next-line no-console
      console.log(`SmartLink monitoring feed listening on ws://${host}:${port}${monitoringWsState.path}`)
    }
    if (userQueueWsState?.enabled) {
      // eslint-disable-next-line no-console
      console.log(`SmartLink user queue feed listening on ws://${host}:${port}${userQueueWsState.path}`)
    }
    if (userStationWsState?.enabled) {
      // eslint-disable-next-line no-console
      console.log(`SmartLink user station feed listening on ws://${host}:${port}${userStationWsState.path}`)
    }
    if (userAlertsWsState?.enabled) {
      // eslint-disable-next-line no-console
      console.log(`SmartLink user alerts feed listening on ws://${host}:${port}${userAlertsWsState.path}`)
    }
    if (internalChatWsState?.enabled) {
      // eslint-disable-next-line no-console
      console.log(`SmartLink internal chat feed listening on ws://${host}:${port}${internalChatWsState.path}`)
    }
    if (meraDashboardWsState?.enabled) {
      // eslint-disable-next-line no-console
      console.log(`SmartLink MERA dashboard feed listening on ws://${host}:${port}${meraDashboardWsState.path}`)
    }
  })
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[boot] Failed to start server", error)
  process.exit(1)
})
