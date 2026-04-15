import { useCallback } from "react"
import { toast } from "sonner"
import { attendantApi } from "../api/attendantApi"
import { kioskApi } from "../api/kioskApi"
import { useAuth } from "../auth/AuthContext"
import {
  isHybridTargetForQueueOrder,
  isPilotPumpBlockedForHybrid,
  isQueueSessionCustomerUnlocked,
  useFuelStore,
} from "../store/fuelStore"

function resolveQueueAmountMwk({
  requestedAmountMwk,
  requestedLitres,
  fuelType,
  petrolPricePerLitre,
  dieselPricePerLitre,
}: {
  requestedAmountMwk?: number
  requestedLitres?: number
  fuelType: "petrol" | "diesel"
  petrolPricePerLitre: number
  dieselPricePerLitre: number
}) {
  if (typeof requestedAmountMwk === "number" && requestedAmountMwk > 0) {
    return Math.round(requestedAmountMwk)
  }
  if (typeof requestedLitres === "number" && requestedLitres > 0) {
    const pricePerLitre = fuelType === "diesel" ? dieselPricePerLitre : petrolPricePerLitre
    return Math.round(requestedLitres * pricePerLitre)
  }
  return undefined
}

export function useKioskOperations() {
  const { session, logout } = useAuth()
  const {
    activeSession,
    livePumpSession,
    pumps,
    hybridPilotQueue,
    petrolPricePerLitre,
    dieselPricePerLitre,
    hydrateFromServer,
    setHydrating,
    setSyncError,
    setSessionContext,
  } = useFuelStore()

  const refreshData = useCallback(async (options?: { silent?: boolean }) => {
    if (!session?.station?.publicId) return

    if (!options?.silent) {
      setHydrating(true)
    }

    try {
      setSessionContext({
        attendantName: session?.user?.fullName || "Station Attendant",
        attendantRole: session?.role || "Attendant",
      })

      const [kioskResult, attendantResult] = await Promise.allSettled([
        kioskApi.getOperationsKioskData(),
        attendantApi.getDashboard(),
      ])

      if (kioskResult.status !== "fulfilled") {
        throw kioskResult.reason
      }

      hydrateFromServer({
        kioskData: kioskResult.value,
        attendantDashboard: attendantResult.status === "fulfilled" ? attendantResult.value : null,
      })
      setSyncError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load kiosk data."
      setSyncError(message)
      if (!options?.silent) {
        toast.error(message)
      }
    } finally {
      if (!options?.silent) {
        setHydrating(false)
      }
    }
  }, [hydrateFromServer, session, setHydrating, setSessionContext, setSyncError])

  const attachNearbyWalletOrder = useCallback(async (fuelOrderId: string) => {
    const sessionId = livePumpSession?.publicId
    if (!sessionId) {
      throw new Error("A live pump session is required before attaching a nearby wallet order.")
    }
    if (livePumpSession?.fuelOrderPublicId) {
      throw new Error("The live pump session is already attached to a fuel order.")
    }

    await kioskApi.attachFuelOrderToPumpSession(sessionId, { fuelOrderId })
    await refreshData({ silent: true })
  }, [livePumpSession, refreshData])

  const startCurrentSession = useCallback(async () => {
    if (!activeSession) {
      throw new Error("No active session is selected.")
    }

    if (activeSession.kind === "live_manual_wallet") {
      if (!activeSession.pumpSessionPublicId) {
        throw new Error("The live manual wallet session is missing a pump-session reference.")
      }
      await kioskApi.startFuelOrderDispensing(activeSession.pumpSessionPublicId)
      await refreshData({ silent: true })
      return
    }

    if (!activeSession.backendOrderPublicId || !activeSession.backendOrderType) {
      throw new Error("Queue order reference is missing from the selected session.")
    }

    if (!isQueueSessionCustomerUnlocked(activeSession)) {
      throw new Error("Customer must unlock this SmartLink session by scanning the pump QR code first.")
    }

    const selectedPump =
      pumps.find((pump) => pump.publicId && pump.publicId === activeSession.assignedPumpPublicId)
      || pumps.find((pump) => pump.id === activeSession.assignedPump)
      || null
    const pilotPump =
      pumps.find(
        (pump) =>
          pump.publicId
          && pump.publicId === hybridPilotQueue?.pilotPumpPublicId
          && pump.status !== "offline"
          && pump.fuelTypes.includes(activeSession.fuelType)
      )
      || null
    const shouldPreferPilotPump =
      activeSession.kind === "queue_draft"
      && isHybridTargetForQueueOrder({
        orderType: activeSession.backendOrderType,
        orderPublicId: activeSession.backendOrderPublicId,
        hybridPilotQueue,
      })
    const effectivePump = shouldPreferPilotPump ? pilotPump || selectedPump : selectedPump

    if (!effectivePump?.publicId) {
      throw new Error("Assign a valid pump before authorizing this queue session.")
    }
    if (
      activeSession.kind === "queue_draft"
      && isPilotPumpBlockedForHybrid({
        pump: effectivePump,
        hybridPilotQueue,
        orderType: activeSession.backendOrderType,
        orderPublicId: activeSession.backendOrderPublicId,
      })
    ) {
      throw new Error(
        hybridPilotQueue?.walkInRedirectMessage
        || "Pilot pump reserved for next ready SmartLink user. Please use another pump."
      )
    }

    const selectedNozzle =
      effectivePump.nozzles.find((nozzle) => nozzle.nozzlePublicId === activeSession.assignedNozzlePublicId)
      || effectivePump.nozzles.find((nozzle) => nozzle.fuelType === activeSession.fuelType)
      || null

    try {
      await attendantApi.acceptOrder(activeSession.backendOrderType, activeSession.backendOrderPublicId)
    } catch {
      // Order may already be accepted.
    }

    try {
      if (activeSession.queueUserType !== "smartlink") {
        await attendantApi.markCustomerArrived(activeSession.backendOrderType, activeSession.backendOrderPublicId)
      }
    } catch {
      // Order may already be marked as arrived.
    }

    try {
      await attendantApi.assignPump(activeSession.backendOrderType, activeSession.backendOrderPublicId, {
        pumpPublicId: effectivePump.publicId,
        nozzlePublicId: selectedNozzle?.nozzlePublicId || undefined,
        note: "Assigned from SmartLink kiosk.",
      })
    } catch {
      // Order may already be pump-assigned. Start service will still validate the current assignment.
    }

    await attendantApi.startService(activeSession.backendOrderType, activeSession.backendOrderPublicId, {
      manualMode: true,
      manualReason: "kiosk_authorization",
    })
    await refreshData({ silent: true })
  }, [activeSession, hybridPilotQueue, pumps, refreshData])

  const finalizeCurrentSession = useCallback(async ({
    litres,
    amountMwk,
    refreshAfter = true,
  }: {
    litres: number
    amountMwk?: number
    refreshAfter?: boolean
  }) => {
    if (!activeSession) {
      throw new Error("No active session is selected.")
    }

    if (activeSession.kind === "live_manual_wallet") {
      if (!activeSession.pumpSessionPublicId) {
        throw new Error("The live manual wallet session is missing a pump-session reference.")
      }
      await kioskApi.finalizeFuelOrder(activeSession.pumpSessionPublicId, {
        dispensedLitres: typeof litres === "number" && litres > 0 ? litres : undefined,
        amountMwk: typeof amountMwk === "number" && amountMwk > 0 ? amountMwk : undefined,
        note: "Completed from SmartLink kiosk authorization flow.",
      })
      if (refreshAfter) {
        await refreshData({ silent: true })
      }
      return
    }

    if (!activeSession.backendOrderPublicId || !activeSession.backendOrderType) {
      throw new Error("Queue order reference is missing from the selected session.")
    }

    const derivedAmount =
      typeof amountMwk === "number" && amountMwk > 0
        ? amountMwk
        : resolveQueueAmountMwk({
            requestedAmountMwk: activeSession.requestedAmountMwk,
            requestedLitres: litres,
            fuelType: activeSession.fuelType,
            petrolPricePerLitre,
            dieselPricePerLitre,
          })

    await attendantApi.completeService(activeSession.backendOrderType, activeSession.backendOrderPublicId, {
      litres: typeof litres === "number" && litres > 0 ? litres : undefined,
      amount: typeof derivedAmount === "number" && derivedAmount > 0 ? derivedAmount : undefined,
      note: "Completed from SmartLink kiosk pump authorization flow.",
    })
    if (refreshAfter) {
      await refreshData({ silent: true })
    }
  }, [activeSession, dieselPricePerLitre, petrolPricePerLitre, refreshData])

  const updateCurrentSessionDetails = useCallback(async ({
    fuelType,
    requestedLitres,
    amountMwk,
    vehicleLabel,
  }: {
    fuelType?: "petrol" | "diesel"
    requestedLitres?: number
    amountMwk?: number
    vehicleLabel?: string
  }) => {
    if (!activeSession || activeSession.kind !== "queue_draft") {
      throw new Error("Only queue sessions can be edited from the kiosk.")
    }

    if (!activeSession.backendOrderPublicId || !activeSession.backendOrderType) {
      throw new Error("Queue order reference is missing from the selected session.")
    }

    await attendantApi.updateServiceRequest(activeSession.backendOrderType, activeSession.backendOrderPublicId, {
      fuelType,
      requestedLitres,
      amountMwk,
      vehicleLabel,
    })
    await refreshData({ silent: true })
  }, [activeSession, refreshData])

  return {
    refreshData,
    attachNearbyWalletOrder,
    startCurrentSession,
    finalizeCurrentSession,
    updateCurrentSessionDetails,
    logout,
  }
}
