import { create } from "zustand"

export type UserType = "smartlink" | "walkin"
export type FuelType = "petrol" | "diesel"
export type QueueStatus = "READY" | "ARRIVED" | "NO-SHOW"
export type SessionStatus = "waiting" | "dispensing" | "completed" | "error"
export type PumpStatus = "idle" | "dispensing" | "offline"
export type WalletOrderPresence = "at_station" | "near_pump"
export type SessionPaymentMethod = "wallet" | "smartpay" | "pay_at_pump"
export type WalletOrderStatus =
  | "awaiting_station"
  | "at_station"
  | "near_pump"
  | "attached_to_session"
  | "dispensing"
  | "completed"
  | "issue"

export interface QueueItem {
  id: string
  position: number
  userType: UserType
  customerName?: string
  walkinId?: string
  vehicleLabel?: string
  serviceLabel?: string
  fuelType: FuelType
  requestedLitres?: number
  requestedAmount?: number
  paymentMethod?: SessionPaymentMethod
  waitTime: string
  status: QueueStatus
  effectiveStatus?: string | null
  timestamp: string
  backendOrderPublicId?: string | null
  backendOrderType?: "queue" | null
  selectedPumpPublicId?: string | null
  selectedPumpNumber?: number | null
  selectedNozzlePublicId?: string | null
  selectedNozzleNumber?: string | null
  pumpSessionPublicId?: string | null
  pumpSessionReference?: string | null
}

export interface NearbyWalletOrder {
  id: string
  displayCode: string
  customerName: string
  fuelType: FuelType
  requestedLitres?: number
  requestedAmountMwk?: number
  paymentMethod: "wallet"
  presence: WalletOrderPresence
  status: WalletOrderStatus
  ageLabel: string
  timestamp: string
}

export interface PumpNozzle {
  nozzlePublicId: string
  nozzleNumber: string | null
  fuelType: FuelType
  status: string
}

export interface Pump {
  id: number
  publicId?: string | null
  fuelTypes: FuelType[]
  status: PumpStatus
  qrPayload?: string | null
  qrImageDataUrl?: string | null
  isPilotPump?: boolean
  hybridQueueState?: "OPEN_TO_WALKINS" | "DIGITAL_HOLD" | null
  currentLitres?: number
  currentCustomer?: string
  nozzles: PumpNozzle[]
}

export interface HybridPilotQueueState {
  enabled: boolean
  pilotPumpPublicId?: string | null
  pilotPumpMode?: string | null
  pilotPumpState?: string | null
  pilotPumpQueueState?: "OPEN_TO_WALKINS" | "DIGITAL_HOLD" | null
  digitalHoldActive: boolean
  committedCarsAhead: number
  currentNextAssignmentTarget?: {
    jobId?: string | null
    source?: string | null
    state?: string | null
    fuelType?: string | null
    priorityScore?: number | null
  } | null
  walkInRedirectMessage?: string | null
}

export interface LivePumpSession {
  publicId: string
  sessionReference?: string | null
  status: "CREATED" | "STARTED" | "DISPENSING"
  pumpPublicId?: string | null
  pumpNumber?: number | null
  nozzlePublicId?: string | null
  nozzleNumber?: string | null
  dispensedLitres: number
  fuelOrderPublicId?: string | null
  fuelType?: FuelType | null
  customerName?: string | null
}

interface AttendantPumpSessionSnapshot {
  id: string
  pumpSessionPublicId?: string | null
  pumpSessionReference?: string | null
  pumpPublicId?: string | null
  pumpNumber?: number | null
  nozzlePublicId?: string | null
  status: "dispensing" | "reserved"
  currentLiveLitres?: number | null
  linkedOrder?: {
    orderType?: string | null
    orderPublicId?: string | null
  } | null
}

export interface ActiveSession {
  kind: "queue_draft" | "live_manual_wallet"
  customerId: string
  customerName: string
  source: "queue" | "manual_wallet"
  queueUserType?: UserType
  effectiveStatus?: string | null
  displayCode?: string
  driverVerificationLabel?: string
  vehicleLabel?: string
  fuelType: FuelType
  requestedLitres?: number
  requestedAmountMwk?: number
  paymentMethod?: SessionPaymentMethod
  assignedPump: number | null
  assignedPumpPublicId?: string | null
  assignedNozzlePublicId?: string | null
  assignedNozzleLabel?: string | null
  status: SessionStatus
  litresDispensed: number
  backendOrderType?: "queue" | null
  backendOrderPublicId?: string | null
  pumpSessionPublicId?: string | null
  pumpSessionReference?: string | null
  fuelOrderPublicId?: string | null
}

interface StationFuelPrices {
  petrol?: number | null
  diesel?: number | null
}

interface FuelStoreState {
  queue: QueueItem[]
  nearbyWalletOrders: NearbyWalletOrder[]
  activeSession: ActiveSession | null
  livePumpSession: LivePumpSession | null
  pumps: Pump[]
  hybridPilotQueue: HybridPilotQueueState | null
  stationPublicId: string | null
  stationName: string
  stationTimezone: string
  attendantName: string
  attendantRole: string
  signalLabel: string
  qrHint: string
  petrolPricePerLitre: number
  dieselPricePerLitre: number
  isOnline: boolean
  isApiMode: boolean
  isHydrating: boolean
  hasLoaded: boolean
  syncError: string | null
  completedSessionExpiresAt: number | null
  addToQueue: (item: Omit<QueueItem, "id" | "position" | "timestamp">) => void
  selectCustomer: (id: string) => void
  startDispensing: () => void
  updateDispensingProgress: (litresDispensed: number) => void
  completeSession: () => void
  cancelSession: () => void
  updateActiveSession: (payload: Partial<Pick<ActiveSession, "fuelType" | "requestedLitres" | "requestedAmountMwk" | "vehicleLabel">>) => void
  switchPump: (pumpId: number) => void
  updateQueueStatus: (id: string, status: QueueStatus) => void
  removeFromQueue: (id: string) => void
  markNearbyWalletOrderIssue: (id: string) => void
  updatePumpStatus: (pumpId: number, status: PumpStatus) => void
  setSessionContext: (payload: { attendantName?: string | null; attendantRole?: string | null }) => void
  setApiMode: (enabled: boolean) => void
  setHydrating: (loading: boolean) => void
  setSyncError: (message: string | null) => void
  holdCompletedSession: (durationMs?: number) => void
  hydrateFromServer: (payload: { kioskData: Record<string, any>; attendantDashboard?: Record<string, any> | null }) => void
}

function normalizeFuelType(value: unknown, fallback: FuelType = "petrol"): FuelType {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "diesel") return "diesel"
  if (normalized === "petrol") return "petrol"
  return fallback
}

function normalizePumpStatus(value: unknown): PumpStatus {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "dispensing" || normalized === "in_use") return "dispensing"
  if (normalized === "offline" || normalized === "inactive" || normalized === "fault") return "offline"
  return "idle"
}

export function buildHybridQueueJobId(orderType?: string | null, orderPublicId?: string | null) {
  const normalizedPublicId = String(orderPublicId || "").trim()
  if (!normalizedPublicId) return null
  const normalizedOrderType = String(orderType || "QUEUE").trim().toUpperCase() || "QUEUE"
  return `${normalizedOrderType}:${normalizedPublicId}`
}

export function isHybridTargetForQueueOrder({
  orderType,
  orderPublicId,
  hybridPilotQueue,
}: {
  orderType?: string | null
  orderPublicId?: string | null
  hybridPilotQueue?: HybridPilotQueueState | null
}) {
  const targetJobId = String(hybridPilotQueue?.currentNextAssignmentTarget?.jobId || "").trim()
  if (!targetJobId) return false
  return buildHybridQueueJobId(orderType, orderPublicId) === targetJobId
}

export function isPilotPumpBlockedForHybrid({
  pump,
  hybridPilotQueue,
  orderType,
  orderPublicId,
}: {
  pump: Pump | null | undefined
  hybridPilotQueue?: HybridPilotQueueState | null
  orderType?: string | null
  orderPublicId?: string | null
}) {
  const pilotPumpPublicId = String(hybridPilotQueue?.pilotPumpPublicId || "").trim()
  const pumpPublicId = String(pump?.publicId || "").trim()
  if (!pilotPumpPublicId || !pumpPublicId || pumpPublicId !== pilotPumpPublicId) {
    return false
  }

  const holdActive =
    hybridPilotQueue?.digitalHoldActive === true
    || hybridPilotQueue?.pilotPumpQueueState === "DIGITAL_HOLD"

  if (!holdActive) return false

  return !isHybridTargetForQueueOrder({
    orderType,
    orderPublicId,
    hybridPilotQueue,
  })
}

export function isQueueSessionCustomerUnlocked(
  session: Pick<ActiveSession, "kind" | "queueUserType" | "effectiveStatus" | "status"> | null | undefined
) {
  if (!session || session.kind !== "queue_draft" || session.queueUserType !== "smartlink") {
    return true
  }

  const effectiveStatus = String(session.effectiveStatus || "").trim().toUpperCase()
  if (["READY_ON_SITE", "ASSIGNED", "FUELING"].includes(effectiveStatus)) {
    return true
  }

  return session.status === "dispensing" || session.status === "completed"
}

function minutesAgoLabel(value: unknown) {
  const timeMs = Date.parse(String(value || ""))
  if (!Number.isFinite(timeMs)) return "Now"
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timeMs) / 60000))
  if (diffMinutes < 1) return "Now"
  if (diffMinutes < 60) return `${diffMinutes}m`
  const hours = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60
  return `${hours}h${minutes ? ` ${minutes}m` : ""}`
}

function resolveHybridAwarePumpsForQueueItem({
  pumps,
  fuelType,
  hybridPilotQueue,
  orderType,
  orderPublicId,
  selectedPumpPublicId,
  selectedPumpNumber,
}: {
  pumps: Pump[]
  fuelType: FuelType
  hybridPilotQueue?: HybridPilotQueueState | null
  orderType?: string | null
  orderPublicId?: string | null
  selectedPumpPublicId?: string | null
  selectedPumpNumber?: number | null
}) {
  const physicallyCompatible = pumps.filter(
    (pump) => pump.status !== "offline" && pump.fuelTypes.includes(fuelType)
  )

  const unrestricted = physicallyCompatible.filter(
    (pump) =>
      !isPilotPumpBlockedForHybrid({
        pump,
        hybridPilotQueue,
        orderType,
        orderPublicId,
      })
  )

  const candidatePool = unrestricted.length ? unrestricted : physicallyCompatible
  const pilotPumpPublicId = String(hybridPilotQueue?.pilotPumpPublicId || "").trim()
  const isHybridTarget = isHybridTargetForQueueOrder({
    orderType,
    orderPublicId,
    hybridPilotQueue,
  })

  return [...candidatePool].sort((left, right) => {
    const scorePump = (pump: Pump) => {
      let score = 0
      const pumpPublicId = String(pump.publicId || "").trim()
      if (
        selectedPumpPublicId
        && pumpPublicId
        && pumpPublicId === String(selectedPumpPublicId).trim()
      ) {
        score += 100
      } else if (
        selectedPumpNumber
        && Number(selectedPumpNumber) > 0
        && pump.id === Number(selectedPumpNumber)
      ) {
        score += 80
      }

      if (pilotPumpPublicId && pumpPublicId === pilotPumpPublicId) {
        score += isHybridTarget ? 60 : -20
      }

      return score
    }

    return scorePump(right) - scorePump(left) || left.id - right.id
  })
}

function toPositiveNumber(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined
  return numeric
}

function extractPumpFuelTypes(pump: Record<string, any>): FuelType[] {
  const collected = new Set<FuelType>()

  if (Array.isArray(pump?.fuelTypes)) {
    for (const value of pump.fuelTypes) {
      collected.add(normalizeFuelType(value))
    }
  }

  if (Array.isArray(pump?.nozzles)) {
    for (const nozzle of pump.nozzles) {
      collected.add(normalizeFuelType(nozzle?.fuelType))
    }
  }

  if (pump?.legacyFuelType) {
    collected.add(normalizeFuelType(pump.legacyFuelType))
  }

  return [...collected]
}

function normalizeSessionPaymentMethod(value: unknown): SessionPaymentMethod | undefined {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "WALLET") return "wallet"
  if (normalized === "PREPAY" || normalized === "SMARTPAY") return "smartpay"
  if (normalized === "PAY_AT_PUMP") return "pay_at_pump"
  return undefined
}

function humanizeQueueServiceLabel(order: Record<string, any> | null, item: Record<string, any>) {
  const effectiveStatus = String(item?.effectiveStatus || item?.hybrid?.state || "").trim().toUpperCase()
  if (effectiveStatus === "READY_ON_SITE") return "Ready on site"
  if (effectiveStatus === "ASSIGNED") return "Assigned to pump"
  if (effectiveStatus === "FUELING") return "Fueling"
  if (effectiveStatus === "MISSED_CALL") return "Missed call"
  if (order?.state) {
    const normalizedState = String(order.state).replace(/_/g, " ").toLowerCase()
    return normalizedState.charAt(0).toUpperCase() + normalizedState.slice(1)
  }
  if (String(item?.status || "").trim().toUpperCase() === "CALLED") return "Called to station"
  return "SmartLink queue"
}

function mapQueueStatus(item: Record<string, any>, order: Record<string, any> | null): QueueStatus {
  const orderState = String(order?.state || "").trim().toLowerCase()
  if (orderState === "customer_arrived") return "ARRIVED"
  const effectiveStatus = String(item?.effectiveStatus || item?.hybrid?.state || "").trim().toUpperCase()
  if (["READY_ON_SITE", "ASSIGNED", "FUELING"].includes(effectiveStatus)) return "ARRIVED"
  const rowStatus = String(item?.status || "").trim().toUpperCase()
  if (rowStatus.includes("NO_SHOW")) return "NO-SHOW"
  return "READY"
}

function isOngoingQueueItem(item: Record<string, any>, order: Record<string, any> | null) {
  const rowStatus = String(item?.status || "").trim().toUpperCase()
  const effectiveStatus = String(item?.effectiveStatus || item?.hybrid?.state || "").trim().toUpperCase()
  const orderState = String(order?.state || "").trim().toLowerCase()

  if (["completed", "rejected", "refunded", "refund_approved", "refund_denied"].includes(orderState)) {
    return false
  }

  if (["accepted", "customer_arrived", "pump_assigned", "dispensing"].includes(orderState)) {
    return true
  }

  if (["READY_ON_SITE", "ASSIGNED", "FUELING"].includes(effectiveStatus)) {
    return true
  }

  return ["WAITING", "CALLED", "LATE"].includes(rowStatus)
}

function mapQueueItems(queueSnapshot: Record<string, any>, attendantDashboard?: Record<string, any> | null) {
  const queueEntries = Array.isArray(queueSnapshot?.entries) ? queueSnapshot.entries : []
  const orderIndex = new Map<string, Record<string, any>>(
    (Array.isArray(attendantDashboard?.liveOrders) ? attendantDashboard?.liveOrders : [])
      .filter((item: Record<string, any>) => String(item?.orderType || "").trim().toLowerCase() === "queue")
      .map((item: Record<string, any>) => [String(item.orderPublicId || "").trim(), item])
  )

  return queueEntries
    .map((item: Record<string, any>, index: number) => {
      const order = orderIndex.get(String(item?.entryPublicId || "").trim()) || null
      return {
        item,
        index,
        order,
      }
    })
    .filter(({ item, order }) => isOngoingQueueItem(item, order))
    .map(({ item, index, order }, visibleIndex) => ({
      id: String(item?.entryPublicId || `queue-${index}`),
      position: visibleIndex + 1,
      userType: order?.customerPublicId ? ("smartlink" as UserType) : ("walkin" as UserType),
      customerName: String(order?.customerName || item?.maskedPlate || `Queue ${visibleIndex + 1}`),
      walkinId: order?.customerPublicId ? undefined : String(item?.maskedPlate || "").trim() || undefined,
      vehicleLabel: String(order?.vehicleLabel || item?.maskedPlate || "").trim() || undefined,
      serviceLabel: humanizeQueueServiceLabel(order, item),
      fuelType: normalizeFuelType(item?.fuelType || order?.fuelType),
      requestedLitres: toPositiveNumber(order?.requestedLitres),
      requestedAmount: toPositiveNumber(order?.amountMwk),
      paymentMethod: normalizeSessionPaymentMethod(order?.servicePaymentMode),
      waitTime: minutesAgoLabel(item?.joinedAt || item?.calledAt),
      status: mapQueueStatus(item, order),
      effectiveStatus: String(item?.effectiveStatus || item?.hybrid?.state || "").trim().toUpperCase() || null,
      timestamp: String(item?.joinedAt || item?.calledAt || new Date().toISOString()),
      backendOrderPublicId: String(item?.entryPublicId || "").trim() || null,
      backendOrderType: "queue",
      selectedPumpPublicId: String(order?.selectedPump?.pumpPublicId || "").trim() || null,
      selectedPumpNumber: Number(order?.selectedPump?.pumpNumber || 0) || null,
      selectedNozzlePublicId: String(order?.selectedPump?.nozzlePublicId || "").trim() || null,
      selectedNozzleNumber: String(order?.selectedPump?.nozzleNumber || "").trim() || null,
      pumpSessionPublicId: String(order?.workflow?.pumpSession?.publicId || "").trim() || null,
      pumpSessionReference: String(order?.workflow?.pumpSession?.sessionReference || "").trim() || null,
    }))
}

function mapNearbyWalletOrders(items: Array<Record<string, any>>) {
  return (items || []).map((item) => {
    const presence = String(item?.latestPresence?.proximityLevel || "").trim().toLowerCase()
    return {
      id: String(item?.publicId || ""),
      displayCode: String(item?.displayCode || item?.publicId || ""),
      customerName: String(item?.customerName || "Wallet customer"),
      fuelType: normalizeFuelType(item?.fuelType),
      requestedLitres: toPositiveNumber(item?.requestedLitres),
      requestedAmountMwk: toPositiveNumber(item?.requestedAmountMwk),
      paymentMethod: "wallet" as const,
      presence: presence === "pump" ? "near_pump" : "at_station",
      status: (String(item?.status || "").trim().toLowerCase() || "awaiting_station") as WalletOrderStatus,
      ageLabel: minutesAgoLabel(item?.createdAt),
      timestamp: String(item?.createdAt || new Date().toISOString()),
    }
  })
}

function mapLivePumpSession(session: Record<string, any> | null): LivePumpSession | null {
  if (!session?.publicId) return null
  return {
    publicId: String(session.publicId),
    sessionReference: String(session.sessionReference || "").trim() || null,
    status: String(session.status || "CREATED").trim().toUpperCase() as LivePumpSession["status"],
    pumpPublicId: String(session.pumpPublicId || "").trim() || null,
    pumpNumber: Number(session.pumpNumber || 0) || null,
    nozzlePublicId: String(session.nozzlePublicId || "").trim() || null,
    nozzleNumber: String(session.nozzleNumber || "").trim() || null,
    dispensedLitres: Number(session.dispensedLitres || 0) || 0,
    fuelOrderPublicId: String(session.fuelOrderPublicId || "").trim() || null,
    fuelType: session.fuelType ? normalizeFuelType(session.fuelType) : null,
    customerName: String(session.customerName || "").trim() || null,
  }
}

function mapPumps(
  attendantDashboard: Record<string, any> | null | undefined,
  livePumpSession: LivePumpSession | null,
  queueSnapshot?: Record<string, any> | null
) {
  const rawPumps = Array.isArray(attendantDashboard?.pumps) ? attendantDashboard.pumps : []
  const queuePumpIndex = new Map<string, Record<string, any>>(
    (Array.isArray(queueSnapshot?.pumps) ? queueSnapshot?.pumps : [])
      .map((pump: Record<string, any>) => [String(pump?.id || "").trim(), pump])
  )
  return rawPumps.map((pump: Record<string, any>, index: number) => {
    const pumpNumber = Number(pump?.pumpNumber || 0) || index + 1
    const liveSessionIsDispensing = livePumpSession?.status === "DISPENSING"
    const isLiveDispensing =
      liveSessionIsDispensing
      && (
        livePumpSession?.pumpPublicId
          ? livePumpSession.pumpPublicId === String(pump?.pumpPublicId || "").trim()
          : livePumpSession?.pumpNumber === pumpNumber
      )
    const queuePump = queuePumpIndex.get(String(pump?.pumpPublicId || "").trim()) || null
    return {
      id: pumpNumber,
      publicId: String(pump?.pumpPublicId || "").trim() || null,
      fuelTypes: extractPumpFuelTypes(pump),
      status: isLiveDispensing ? "dispensing" : normalizePumpStatus(pump?.status),
      qrPayload:
        String(queuePump?.qrPayload || pump?.qrPayload || "").trim()
        || null,
      qrImageDataUrl:
        String(queuePump?.qrImageDataUrl || pump?.qrImageDataUrl || "").trim()
        || null,
      isPilotPump: Boolean(queuePump?.isPilotPump),
      hybridQueueState: (String(queuePump?.hybridQueueState || "").trim() || null) as Pump["hybridQueueState"],
      currentLitres: isLiveDispensing ? livePumpSession?.dispensedLitres : undefined,
      currentCustomer: isLiveDispensing ? livePumpSession?.customerName || undefined : undefined,
      nozzles: Array.isArray(pump?.nozzles)
        ? pump.nozzles.map((nozzle: Record<string, any>) => ({
            nozzlePublicId: String(nozzle?.nozzlePublicId || ""),
            nozzleNumber: String(nozzle?.nozzleNumber || "").trim() || null,
            fuelType: normalizeFuelType(nozzle?.fuelType),
            status: String(nozzle?.status || "").trim().toLowerCase(),
          }))
        : [],
    }
  })
}

function mapHybridPilotQueue(kioskData: Record<string, any>) {
  const hybrid = kioskData?.hybridPilotQueue || kioskData?.mainQueue?.hybridPilotQueue || null
  if (!hybrid || hybrid.enabled === false) return null

  return {
    enabled: true,
    pilotPumpPublicId: String(hybrid?.pilotPumpPublicId || "").trim() || null,
    pilotPumpMode: String(hybrid?.kioskState?.pilotPumpMode || hybrid?.pilotPumpMode || "").trim() || null,
    pilotPumpState: String(hybrid?.kioskState?.pilotPumpState || hybrid?.pilotPumpState || "").trim() || null,
    pilotPumpQueueState: (
      String(hybrid?.kioskState?.pilotPumpQueueState || hybrid?.queueState || "").trim()
      || null
    ) as HybridPilotQueueState["pilotPumpQueueState"],
    digitalHoldActive: Boolean(hybrid?.kioskState?.digitalHoldActive),
    committedCarsAhead: Number(hybrid?.kioskState?.committedCarsAhead || 0) || 0,
    currentNextAssignmentTarget: hybrid?.kioskState?.currentNextAssignmentTarget || null,
    walkInRedirectMessage: String(hybrid?.kioskState?.walkInRedirectMessage || "").trim() || null,
  }
}

function mapAttendantPumpSessions(attendantDashboard: Record<string, any> | null | undefined): AttendantPumpSessionSnapshot[] {
  const rows = Array.isArray(attendantDashboard?.activePumpSessions) ? attendantDashboard.activePumpSessions : []
  return rows.map((item: Record<string, any>) => ({
    id: String(item?.id || ""),
    pumpSessionPublicId: String(item?.pumpSessionPublicId || "").trim() || null,
    pumpSessionReference: String(item?.pumpSessionReference || "").trim() || null,
    pumpPublicId: String(item?.pumpPublicId || "").trim() || null,
    pumpNumber: Number(item?.pumpNumber || 0) || null,
    nozzlePublicId: String(item?.nozzlePublicId || "").trim() || null,
    status: String(item?.status || "").trim().toLowerCase() === "dispensing" ? "dispensing" : "reserved",
    currentLiveLitres: Number(item?.currentLiveLitres || 0) || 0,
    linkedOrder: item?.linkedOrder
      ? {
          orderType: String(item.linkedOrder.orderType || "").trim() || null,
          orderPublicId: String(item.linkedOrder.orderPublicId || "").trim() || null,
        }
      : null,
  }))
}

function findTelemetryPumpSessionForLiveSession(
  livePumpSession: LivePumpSession | null,
  telemetrySessions: AttendantPumpSessionSnapshot[]
) {
  if (!livePumpSession) return null
  return (
    telemetrySessions.find(
      (item) =>
        (item.pumpSessionPublicId && item.pumpSessionPublicId === livePumpSession.publicId)
        || (item.pumpSessionReference && item.pumpSessionReference === livePumpSession.sessionReference)
    )
    || telemetrySessions.find(
      (item) =>
        (item.nozzlePublicId && item.nozzlePublicId === livePumpSession.nozzlePublicId)
        || (item.pumpPublicId && item.pumpPublicId === livePumpSession.pumpPublicId)
        || (item.pumpNumber && item.pumpNumber === livePumpSession.pumpNumber)
    )
    || null
  )
}

function applyTelemetryToLivePumpSession(
  livePumpSession: LivePumpSession | null,
  telemetrySessions: AttendantPumpSessionSnapshot[]
) {
  if (!livePumpSession) return null
  const telemetrySession = findTelemetryPumpSessionForLiveSession(livePumpSession, telemetrySessions)
  if (!telemetrySession) return livePumpSession
  const currentLiveLitres = Number(telemetrySession.currentLiveLitres || 0) || 0
  return {
    ...livePumpSession,
    status: telemetrySession.status === "dispensing" ? "DISPENSING" : livePumpSession.status,
    dispensedLitres: currentLiveLitres > 0 ? currentLiveLitres : livePumpSession.dispensedLitres,
  }
}

function applyTelemetryToActiveSession(
  session: ActiveSession | null,
  telemetrySessions: AttendantPumpSessionSnapshot[]
) {
  if (!session) return null

  const linkedQueueTelemetrySession =
    session.kind === "queue_draft"
      ? telemetrySessions.find(
          (item) =>
            (session.pumpSessionPublicId && item.pumpSessionPublicId === session.pumpSessionPublicId)
            || (session.pumpSessionReference && item.pumpSessionReference === session.pumpSessionReference)
        ) || telemetrySessions.find(
          (item) =>
            item.linkedOrder?.orderType?.toLowerCase() === "queue"
            && item.linkedOrder?.orderPublicId
            && item.linkedOrder.orderPublicId === session.backendOrderPublicId
        ) || null
      : null

  const fallbackQueueTelemetrySession =
    session.kind === "queue_draft" && session.status === "dispensing"
      ? telemetrySessions.find((item) => {
          const currentLiveLitres = Number(item.currentLiveLitres || 0) || 0
          if (item.status !== "dispensing" || currentLiveLitres <= 0) return false
          return (
            (item.nozzlePublicId && item.nozzlePublicId === session.assignedNozzlePublicId)
            || (item.pumpPublicId && item.pumpPublicId === session.assignedPumpPublicId)
            || (item.pumpNumber && item.pumpNumber === session.assignedPump)
          )
        }) || null
      : null

  const telemetrySession =
    session.kind === "queue_draft"
      ? linkedQueueTelemetrySession || fallbackQueueTelemetrySession
      : telemetrySessions.find(
          (item) =>
            (item.nozzlePublicId && item.nozzlePublicId === session.assignedNozzlePublicId)
            || (item.pumpPublicId && item.pumpPublicId === session.assignedPumpPublicId)
            || (item.pumpNumber && item.pumpNumber === session.assignedPump)
        ) || null

  if (!telemetrySession) return session

  const currentLiveLitres = Number(telemetrySession.currentLiveLitres || 0) || 0
  return {
    ...session,
    status:
      session.status === "completed"
        ? session.status
        : telemetrySession.status === "dispensing"
          ? "dispensing"
          : session.status,
    litresDispensed: currentLiveLitres > 0 ? currentLiveLitres : session.litresDispensed,
  }
}

function mapActiveSessionFromLiveSession(livePumpSession: LivePumpSession, fuelOrder: Record<string, any> | null): ActiveSession | null {
  if (!livePumpSession?.fuelOrderPublicId || !fuelOrder?.publicId) return null
  return {
    kind: "live_manual_wallet",
    customerId: String(fuelOrder.publicId),
    customerName: String(fuelOrder.customerName || livePumpSession.customerName || "Wallet customer"),
    source: "manual_wallet",
    displayCode: String(fuelOrder.displayCode || fuelOrder.publicId || ""),
    driverVerificationLabel: "Nearby Wallet Order",
    vehicleLabel: "Attached to live pump session",
    fuelType: normalizeFuelType(fuelOrder.fuelType || livePumpSession.fuelType),
    requestedLitres: toPositiveNumber(fuelOrder.requestedLitres),
    requestedAmountMwk: toPositiveNumber(fuelOrder.requestedAmountMwk),
    paymentMethod: normalizeSessionPaymentMethod(fuelOrder?.paymentIntent?.paymentMethod),
    assignedPump: Number(livePumpSession.pumpNumber || 0) || 1,
    assignedPumpPublicId: livePumpSession.pumpPublicId || null,
    assignedNozzlePublicId: livePumpSession.nozzlePublicId || null,
    assignedNozzleLabel: livePumpSession.nozzleNumber || null,
    status: livePumpSession.status === "DISPENSING" ? "dispensing" : "waiting",
    litresDispensed: Number(livePumpSession.dispensedLitres || 0) || 0,
    pumpSessionPublicId: livePumpSession.publicId,
    pumpSessionReference: livePumpSession.sessionReference || null,
    fuelOrderPublicId: livePumpSession.fuelOrderPublicId || null,
  }
}

function resolveFuelPrices(nextPrices: StationFuelPrices | undefined, currentPetrol: number, currentDiesel: number) {
  return {
    petrol: Number(nextPrices?.petrol || 0) || currentPetrol,
    diesel: Number(nextPrices?.diesel || 0) || currentDiesel,
  }
}

function buildQueueDraft(
  queueItem: QueueItem,
  pumps: Pump[],
  hybridPilotQueue?: HybridPilotQueueState | null
): ActiveSession | null {
  const hasExistingPumpAssignment =
    Boolean(String(queueItem.selectedPumpPublicId || "").trim())
    || (Number(queueItem.selectedPumpNumber || 0) > 0)
  const shouldAutoAssignPump = queueItem.userType !== "walkin" || hasExistingPumpAssignment
  const preferredPump =
    shouldAutoAssignPump
      ? resolveHybridAwarePumpsForQueueItem({
          pumps,
          fuelType: queueItem.fuelType,
          hybridPilotQueue,
          orderType: queueItem.backendOrderType,
          orderPublicId: queueItem.backendOrderPublicId,
          selectedPumpPublicId: queueItem.selectedPumpPublicId,
          selectedPumpNumber: queueItem.selectedPumpNumber,
        })[0]
        || null
      : null

  const preferredNozzle =
    preferredPump?.nozzles.find((nozzle) => nozzle.nozzlePublicId === queueItem.selectedNozzlePublicId)
    || preferredPump?.nozzles.find((nozzle) => nozzle.fuelType === queueItem.fuelType)
    || null

  return {
    kind: "queue_draft",
    customerId: queueItem.id,
    customerName: queueItem.customerName || queueItem.walkinId || "Queue customer",
    source: "queue",
    queueUserType: queueItem.userType,
    effectiveStatus: queueItem.effectiveStatus || null,
    driverVerificationLabel: "Queue Customer",
    vehicleLabel: queueItem.vehicleLabel || "Vehicle details pending",
    fuelType: queueItem.fuelType,
    requestedLitres: queueItem.requestedLitres,
    requestedAmountMwk: queueItem.requestedAmount,
    paymentMethod: queueItem.paymentMethod,
    assignedPump: preferredPump?.id || null,
    assignedPumpPublicId: preferredPump?.publicId || null,
    assignedNozzlePublicId: preferredNozzle?.nozzlePublicId || null,
    assignedNozzleLabel: preferredNozzle?.nozzleNumber || null,
    status: "waiting",
    litresDispensed: 0,
    backendOrderType: queueItem.backendOrderType || null,
    backendOrderPublicId: queueItem.backendOrderPublicId || null,
    pumpSessionPublicId: queueItem.pumpSessionPublicId || null,
    pumpSessionReference: queueItem.pumpSessionReference || null,
  }
}

function refreshQueueDraftFromQueueItem(
  session: ActiveSession | null,
  queue: QueueItem[],
  pumps: Pump[],
  hybridPilotQueue?: HybridPilotQueueState | null
) {
  if (!session || session.kind !== "queue_draft") return null

  const nextQueueItem = queue.find((item) => item.id === session.customerId) || null
  if (!nextQueueItem) return null

  const refreshedDraft = buildQueueDraft(nextQueueItem, pumps, hybridPilotQueue)
  if (!refreshedDraft) return null

  return {
    ...session,
    ...refreshedDraft,
    status: session.status === "completed" ? "completed" : refreshedDraft.status,
    litresDispensed: session.status === "completed" ? session.litresDispensed : refreshedDraft.litresDispensed,
  }
}

const initialPumps: Pump[] = [
  { id: 1, publicId: null, fuelTypes: ["petrol", "diesel"], status: "idle", nozzles: [] },
  { id: 2, publicId: null, fuelTypes: ["petrol"], status: "idle", nozzles: [] },
  { id: 3, publicId: null, fuelTypes: ["diesel"], status: "dispensing", currentLitres: 23.5, currentCustomer: "John Doe", nozzles: [] },
  { id: 4, publicId: null, fuelTypes: ["petrol", "diesel"], status: "idle", nozzles: [] },
]

export const useFuelStore = create<FuelStoreState>((set) => ({
  queue: [],
  nearbyWalletOrders: [],
  activeSession: null,
  livePumpSession: null,
  pumps: initialPumps,
  hybridPilotQueue: null,
  stationPublicId: null,
  stationName: "SmartLink Station",
  stationTimezone: "Africa/Blantyre",
  attendantName: "Station Attendant",
  attendantRole: "Attendant",
  signalLabel: "Good",
  qrHint: "Scan QR code if auto load fails to capture",
  petrolPricePerLitre: 4990,
  dieselPricePerLitre: 4980,
  isOnline: true,
  isApiMode: true,
  isHydrating: false,
  hasLoaded: false,
  syncError: null,
  completedSessionExpiresAt: null,

  addToQueue: (item) => set((state) => {
    const newPosition = state.queue.length + 1
    return {
      queue: [
        ...state.queue,
        {
          ...item,
          id: Math.random().toString(36).slice(2, 11),
          position: newPosition,
          timestamp: new Date().toISOString(),
        },
      ],
    }
  }),

  selectCustomer: (id) => set((state) => {
    const selected = state.queue.find((item) => item.id === id)
    if (!selected) return state
    const draft = buildQueueDraft(selected, state.pumps, state.hybridPilotQueue)
    if (!draft) return state
    return { activeSession: draft }
  }),

  startDispensing: () => set((state) => {
    if (!state.activeSession) return state
    return {
      activeSession: {
        ...state.activeSession,
        status: "dispensing",
      },
      pumps: state.pumps.map((pump) =>
        pump.id === state.activeSession?.assignedPump
          ? {
              ...pump,
              status: "dispensing",
              currentLitres: state.activeSession?.litresDispensed || 0,
              currentCustomer: state.activeSession?.customerName,
            }
          : pump
      ),
    }
  }),

  updateDispensingProgress: (litresDispensed) => set((state) => {
    if (!state.activeSession) return state
    const normalizedLitres = Number.isFinite(Number(litresDispensed)) ? Math.max(0, Number(litresDispensed)) : 0
    return {
      activeSession: {
        ...state.activeSession,
        litresDispensed: normalizedLitres,
      },
      pumps: state.pumps.map((pump) =>
        pump.id === state.activeSession?.assignedPump
          ? {
              ...pump,
              currentLitres: normalizedLitres,
              currentCustomer: state.activeSession?.customerName,
            }
          : pump
      ),
    }
  }),

  completeSession: () => set((state) => {
    if (!state.activeSession) {
      return {
        completedSessionExpiresAt: null,
      }
    }
    const completedSession = state.activeSession
    return {
      activeSession: null,
      completedSessionExpiresAt: null,
      pumps: state.pumps.map((pump) =>
        pump.id === completedSession.assignedPump
          ? { ...pump, status: "idle", currentLitres: undefined, currentCustomer: undefined }
          : pump
      ),
    }
  }),

  cancelSession: () => set((state) => {
    if (!state.activeSession || state.activeSession.kind !== "queue_draft") return state
    return {
      activeSession: null,
      pumps: state.pumps.map((pump) =>
        pump.id === state.activeSession?.assignedPump
          ? { ...pump, status: "idle", currentLitres: undefined, currentCustomer: undefined }
          : pump
      ),
    }
  }),

  updateActiveSession: (payload) => set((state) => {
    if (!state.activeSession || state.activeSession.kind !== "queue_draft") return state
    const hasRequestedAmount = Object.prototype.hasOwnProperty.call(payload, "requestedAmountMwk")
    const hasRequestedLitres = Object.prototype.hasOwnProperty.call(payload, "requestedLitres")
    const nextFuelType = payload.fuelType || state.activeSession.fuelType
    const currentAssignedPump =
      state.pumps.find((pump) => pump.id === state.activeSession?.assignedPump)
      || null
    const pumpSupportsFuel = currentAssignedPump?.fuelTypes.includes(nextFuelType) || false
    const hybridAwarePumps = resolveHybridAwarePumpsForQueueItem({
      pumps: state.pumps,
      fuelType: nextFuelType,
      hybridPilotQueue: state.hybridPilotQueue,
      orderType: state.activeSession.backendOrderType,
      orderPublicId: state.activeSession.backendOrderPublicId,
      selectedPumpPublicId: pumpSupportsFuel ? currentAssignedPump?.publicId : state.activeSession.assignedPumpPublicId,
      selectedPumpNumber: pumpSupportsFuel ? currentAssignedPump?.id : state.activeSession.assignedPump,
    })
    const hasCurrentAssignment =
      Boolean(String(state.activeSession.assignedPumpPublicId || "").trim())
      || (Number(state.activeSession.assignedPump || 0) > 0)
    const nextPump =
      hasCurrentAssignment
        ? hybridAwarePumps[0] || currentAssignedPump || null
        : null
    const nextNozzle =
      nextPump?.nozzles.find((nozzle) => nozzle.fuelType === nextFuelType)
      || null
    return {
      activeSession: {
        ...state.activeSession,
        fuelType: nextFuelType,
        vehicleLabel: payload.vehicleLabel ?? state.activeSession.vehicleLabel,
        requestedAmountMwk: hasRequestedAmount
          ? toPositiveNumber(payload.requestedAmountMwk)
          : state.activeSession.requestedAmountMwk,
        requestedLitres: hasRequestedLitres
          ? toPositiveNumber(payload.requestedLitres)
          : state.activeSession.requestedLitres,
        assignedPump: nextPump?.id || null,
        assignedPumpPublicId: nextPump?.publicId || null,
        assignedNozzlePublicId: nextNozzle?.nozzlePublicId || null,
        assignedNozzleLabel: nextNozzle?.nozzleNumber || null,
      },
    }
  }),

  switchPump: (pumpId) => set((state) => {
    if (!state.activeSession || state.activeSession.kind !== "queue_draft") return state
    const nextPump = state.pumps.find((pump) => pump.id === pumpId && pump.status !== "offline")
    if (!nextPump) return state
    if (
      isPilotPumpBlockedForHybrid({
        pump: nextPump,
        hybridPilotQueue: state.hybridPilotQueue,
        orderType: state.activeSession.backendOrderType,
        orderPublicId: state.activeSession.backendOrderPublicId,
      })
    ) {
      return state
    }
    const matchingNozzle = nextPump.nozzles.find((nozzle) => nozzle.fuelType === state.activeSession?.fuelType) || null
    return {
      activeSession: {
        ...state.activeSession,
        assignedPump: nextPump.id,
        assignedPumpPublicId: nextPump.publicId || null,
        assignedNozzlePublicId: matchingNozzle?.nozzlePublicId || null,
        assignedNozzleLabel: matchingNozzle?.nozzleNumber || null,
      },
    }
  }),

  updateQueueStatus: (id, status) => set((state) => ({
    queue: state.queue.map((item) => (item.id === id ? { ...item, status } : item)),
  })),

  removeFromQueue: (id) => set((state) => {
    const filteredQueue = state.queue.filter((item) => item.id !== id)
    return {
      queue: filteredQueue.map((item, index) => ({ ...item, position: index + 1 })),
      activeSession:
        state.activeSession?.kind === "queue_draft" && state.activeSession.customerId === id
          ? null
          : state.activeSession,
    }
  }),

  markNearbyWalletOrderIssue: (id) => set((state) => ({
    nearbyWalletOrders: state.nearbyWalletOrders.map((item) =>
      item.id === id ? { ...item, status: "issue" } : item
    ),
  })),

  updatePumpStatus: (pumpId, status) => set((state) => ({
    pumps: state.pumps.map((pump) => (pump.id === pumpId ? { ...pump, status } : pump)),
  })),

  setSessionContext: (payload) => set(() => ({
    attendantName: String(payload?.attendantName || "").trim() || "Station Attendant",
    attendantRole: String(payload?.attendantRole || "").trim() || "Attendant",
  })),

  setApiMode: (enabled) => set(() => ({ isApiMode: enabled })),
  setHydrating: (loading) => set(() => ({ isHydrating: loading })),
  setSyncError: (message) => set(() => ({
    syncError: message,
    isOnline: !message,
  })),

  holdCompletedSession: (durationMs = 60000) => set((state) => {
    if (!state.activeSession) return state
    return {
      activeSession: {
        ...state.activeSession,
        status: "completed",
      },
      completedSessionExpiresAt: Date.now() + Math.max(0, Number(durationMs || 0)),
    }
  }),

  hydrateFromServer: ({ kioskData, attendantDashboard }) => set((state) => {
    const telemetrySessions = mapAttendantPumpSessions(attendantDashboard)
    const nextLivePumpSession = applyTelemetryToLivePumpSession(
      mapLivePumpSession(kioskData?.currentActiveSession || null),
      telemetrySessions
    )
    const nextPumps = mapPumps(attendantDashboard, nextLivePumpSession, kioskData?.mainQueue || null)
    const nextQueue = mapQueueItems(kioskData?.mainQueue || {}, attendantDashboard)
    const nextHybridPilotQueue = mapHybridPilotQueue(kioskData || {})
    const nextNearbyWalletOrders = mapNearbyWalletOrders(
      Array.isArray(kioskData?.nearbyWalletOrders) ? kioskData.nearbyWalletOrders : []
    )
    const nextActiveFromLive = applyTelemetryToActiveSession(mapActiveSessionFromLiveSession(
      nextLivePumpSession as LivePumpSession,
      kioskData?.currentActiveSession?.fuelOrder || null
    ), telemetrySessions)

    const currentDraft =
      state.activeSession?.kind === "queue_draft" ? state.activeSession : null
    const heldCompletedSession =
      state.activeSession?.status === "completed"
      && Number(state.completedSessionExpiresAt || 0) > Date.now()
        ? state.activeSession
        : null
    const preservedDraft =
      !nextActiveFromLive
      && currentDraft
        ? applyTelemetryToActiveSession(
            refreshQueueDraftFromQueueItem(
              currentDraft,
              nextQueue,
              nextPumps.length ? nextPumps : state.pumps,
              nextHybridPilotQueue
            ),
            telemetrySessions
          )
        : null

    const prices = resolveFuelPrices(kioskData?.fuelPrices, state.petrolPricePerLitre, state.dieselPricePerLitre)

    return {
      queue: nextQueue,
      nearbyWalletOrders: nextNearbyWalletOrders,
      livePumpSession: nextLivePumpSession,
      activeSession: heldCompletedSession || nextActiveFromLive || preservedDraft || null,
      pumps: nextPumps.length ? nextPumps : state.pumps,
      hybridPilotQueue: nextHybridPilotQueue,
      stationPublicId: String(kioskData?.stationPublicId || state.stationPublicId || "").trim() || null,
      stationName: String(kioskData?.stationName || state.stationName),
      stationTimezone: String(kioskData?.stationTimezone || state.stationTimezone || "Africa/Blantyre"),
      petrolPricePerLitre: prices.petrol,
      dieselPricePerLitre: prices.diesel,
      signalLabel: "Good",
      isOnline: true,
      hasLoaded: true,
      syncError: null,
      completedSessionExpiresAt: heldCompletedSession ? state.completedSessionExpiresAt : null,
    }
  }),
}))
