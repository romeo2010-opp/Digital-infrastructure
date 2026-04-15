import {
  QueueJobState,
  ReadinessSignalType,
  cloneQueueJob,
  toIsoString,
  isTerminalQueueJobState,
} from "./domain.js"

const READINESS_CHANNELS = Object.freeze([
  {
    type: ReadinessSignalType.ATTENDANT_KIOSK,
    label: "Attendant confirmation",
    description: "Forecourt attendant confirms the vehicle is physically on site.",
  },
  {
    type: ReadinessSignalType.QR_SCAN,
    label: "QR scan",
    description: "Customer scans a kiosk or forecourt QR marker near the station.",
  },
  {
    type: ReadinessSignalType.BLE_NFC,
    label: "BLE/NFC proximity",
    description: "A station-side short-range hardware event confirms close proximity.",
  },
  {
    type: ReadinessSignalType.GEOFENCE,
    label: "Geofence confirmation",
    description: "The backend receives a station geofence confirmation that passes policy checks.",
  },
])

export class ReadinessService {
  getSupportedSignals() {
    return READINESS_CHANNELS.map((channel) => ({ ...channel }))
  }

  applySignal({ queueJobs = [], jobId, signalType, occurredAt = new Date(), metadata = {} }) {
    const normalizedSignalType = String(signalType || "").trim().toUpperCase()
    const supportedSignal = READINESS_CHANNELS.find((item) => item.type === normalizedSignalType)
    if (!supportedSignal) {
      throw new Error(`Unsupported readiness signal: ${signalType}`)
    }

    const timestamp = toIsoString(occurredAt)
    let updatedJob = null
    const nextQueueJobs = queueJobs.map((job) => {
      if (job.id !== jobId) return cloneQueueJob(job)
      if (isTerminalQueueJobState(job.state)) {
        updatedJob = cloneQueueJob(job)
        return updatedJob
      }

      updatedJob = {
        ...job,
        state: QueueJobState.READY_ON_SITE,
        readyAt: timestamp,
        priorityScore: Number(job.priorityScore || 0),
      }
      return updatedJob
    })

    return {
      queueJobs: nextQueueJobs,
      updatedJob,
      signal: {
        type: supportedSignal.type,
        occurredAt: timestamp,
        metadata: { ...metadata },
      },
    }
  }
}
