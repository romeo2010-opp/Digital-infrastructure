import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleDot, Fuel, LoaderCircle, QrCode, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useKioskOperations } from "../hooks/useKioskOperations";
import {
  isHybridTargetForQueueOrder,
  isPilotPumpBlockedForHybrid,
  isQueueSessionCustomerUnlocked,
  useFuelStore,
  type FuelType,
} from "../store/fuelStore";
import { useKioskTheme } from "./KioskThemeContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

type AuthorizationScreen = "setup" | "dispensing" | "complete";
const COMPLETE_RETENTION_MS = 60_000;

function getPricePerLitre(fuelType: FuelType, petrolPricePerLitre: number, dieselPricePerLitre: number) {
  return fuelType === "diesel" ? dieselPricePerLitre : petrolPricePerLitre;
}

function formatCurrency(amount: number) {
  return `MWK ${Math.round(amount).toLocaleString()}`;
}

function formatTargetFromSession({
  fuelType,
  requestedAmountMwk,
  requestedLitres,
  petrolPricePerLitre,
  dieselPricePerLitre,
}: {
  fuelType: FuelType;
  requestedAmountMwk?: number;
  requestedLitres?: number;
  petrolPricePerLitre: number;
  dieselPricePerLitre: number;
}) {
  const pricePerLitre = getPricePerLitre(fuelType, petrolPricePerLitre, dieselPricePerLitre);
  const amountMwk =
    typeof requestedAmountMwk === "number" && requestedAmountMwk > 0
      ? requestedAmountMwk
      : typeof requestedLitres === "number" && requestedLitres > 0
        ? requestedLitres * pricePerLitre
        : 0;
  const litres =
    typeof requestedLitres === "number" && requestedLitres > 0
      ? requestedLitres
      : amountMwk > 0 && pricePerLitre > 0
        ? amountMwk / pricePerLitre
        : 0;

  return {
    pricePerLitre,
    amountMwk,
    litres,
  };
}

export function PumpAuthorizationDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreen] = useState<AuthorizationScreen>("setup");
  const [selectedFuel, setSelectedFuel] = useState<FuelType>("petrol");
  const [liveLitres, setLiveLitres] = useState(0);
  const [receiptTime, setReceiptTime] = useState("");
  const [secondsRemaining, setSecondsRemaining] = useState(Math.ceil(COMPLETE_RETENTION_MS / 1000));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoFinalizeTriggeredRef = useRef("");
  const completeTimeoutRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<number | null>(null);
  const {
    activeSession,
    pumps,
    hybridPilotQueue,
    petrolPricePerLitre,
    dieselPricePerLitre,
    startDispensing,
    updateDispensingProgress,
    completeSession,
    updateActiveSession,
    holdCompletedSession,
  } = useFuelStore();
  const { startCurrentSession, finalizeCurrentSession, refreshData } = useKioskOperations();
  const { isNightTheme } = useKioskTheme();

  useEffect(() => {
    if (!isOpen || !activeSession) return;
    setScreen(
      activeSession.status === "dispensing"
        ? "dispensing"
        : activeSession.status === "completed"
          ? "complete"
          : "setup"
    );
    setSelectedFuel(activeSession.fuelType);
    setLiveLitres(
      activeSession.status === "dispensing" || activeSession.status === "completed"
        ? activeSession.litresDispensed
        : 0
    );
    if (activeSession.status !== "completed") {
      setReceiptTime("");
      setSecondsRemaining(Math.ceil(COMPLETE_RETENTION_MS / 1000));
    }
    setIsSubmitting(false);
  }, [activeSession?.customerId, activeSession?.status, activeSession?.fuelType, activeSession?.litresDispensed, isOpen]);

  useEffect(() => {
    return () => {
      if (completeTimeoutRef.current) {
        window.clearTimeout(completeTimeoutRef.current);
      }
      if (countdownIntervalRef.current) {
        window.clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  const target = useMemo(() => {
    if (!activeSession) {
      return { pricePerLitre: 0, amountMwk: 0, litres: 0 };
    }
    return formatTargetFromSession({
      fuelType: selectedFuel,
      requestedAmountMwk: activeSession.requestedAmountMwk,
      requestedLitres: activeSession.requestedLitres,
      petrolPricePerLitre,
      dieselPricePerLitre,
    });
  }, [activeSession, dieselPricePerLitre, petrolPricePerLitre, selectedFuel]);

  if (!activeSession) return null;

  const amountValue = Math.round(target.amountMwk);
  const targetLitres = target.litres;
  const progressPercent = targetLitres > 0 ? Math.min(100, Math.round((liveLitres / targetLitres) * 100)) : 0;
  const liveAmount = Math.round(liveLitres * target.pricePerLitre);
  const paymentLabel =
    activeSession.paymentMethod === "wallet"
      ? "Wallet"
      : activeSession.paymentMethod === "smartpay"
        ? "SmartPay"
        : activeSession.paymentMethod === "pay_at_pump"
          ? "Pay at Pump"
          : "Station Settlement";
  const canChangeFuelType = activeSession.kind === "queue_draft";
  const hasAssignedPump = Number(activeSession.assignedPump || 0) > 0;
  const sessionCompletionKey = `${activeSession.customerId}:${activeSession.pumpSessionPublicId || activeSession.backendOrderPublicId || "draft"}`;
  const assignedPump =
    pumps.find((pump) => pump.publicId && pump.publicId === activeSession.assignedPumpPublicId)
    || pumps.find((pump) => pump.id === activeSession.assignedPump)
    || null;
  const pilotPump =
    pumps.find((pump) => pump.publicId && pump.publicId === hybridPilotQueue?.pilotPumpPublicId)
    || null;
  const isHybridTarget =
    activeSession.kind === "queue_draft"
    && isHybridTargetForQueueOrder({
      orderType: activeSession.backendOrderType,
      orderPublicId: activeSession.backendOrderPublicId,
      hybridPilotQueue,
    });
  const isAssignedPumpBlocked =
    activeSession.kind === "queue_draft"
    && isPilotPumpBlockedForHybrid({
      pump: assignedPump,
      hybridPilotQueue,
      orderType: activeSession.backendOrderType,
      orderPublicId: activeSession.backendOrderPublicId,
    });
  const hybridNotice =
    isAssignedPumpBlocked
      ? hybridPilotQueue?.walkInRedirectMessage
        || "Pilot pump reserved for the next ready SmartLink user. This session cannot use that pump yet."
      : isHybridTarget && pilotPump
        ? `Hybrid priority is active for this driver. Use Pump ${pilotPump.id} for the next controllable slot.`
        : null;
  const requiresCustomerUnlock =
    activeSession.kind === "queue_draft" && activeSession.queueUserType === "smartlink";
  const customerUnlockReady = isQueueSessionCustomerUnlocked(activeSession);
  const showCustomerUnlockScreen = screen === "setup" && requiresCustomerUnlock && !customerUnlockReady;
  const unlockPump = assignedPump || (isHybridTarget ? pilotPump : null);
  const unlockPumpLabel =
    unlockPump?.id
      ? `Pump ${unlockPump.id}`
      : hasAssignedPump
        ? `Pump ${activeSession.assignedPump}`
        : "the assigned pump";
  const unlockPumpQrImage = String(unlockPump?.qrImageDataUrl || "").trim() || null;
  const unlockPumpQrPayload = String(unlockPump?.qrPayload || "").trim() || null;

  const closeDialog = () => {
    if (completeTimeoutRef.current) {
      window.clearTimeout(completeTimeoutRef.current);
      completeTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsOpen(false);
  };

  const dismissCompletedSession = async ({ showToast }: { showToast: boolean }) => {
    completeSession();
    try {
      await refreshData({ silent: true });
      if (showToast) {
        toast.success("Pump session closed. Kiosk ready for the next driver.");
      }
    } catch (error) {
      if (showToast) {
        toast.error(error instanceof Error ? error.message : "Unable to refresh kiosk data.");
      }
    } finally {
      closeDialog();
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && screen === "dispensing") return;
    if (!nextOpen) {
      if (screen === "complete") {
        void dismissCompletedSession({ showToast: false });
        return;
      }
      closeDialog();
      return;
    }
    setIsOpen(true);
  };

  const showComplete = (finalLitres: number) => {
    updateDispensingProgress(finalLitres);
    holdCompletedSession(COMPLETE_RETENTION_MS);
    const now = new Date();
    setReceiptTime(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    );
    setLiveLitres(finalLitres);
    setSecondsRemaining(Math.ceil(COMPLETE_RETENTION_MS / 1000));
    setScreen("complete");
    toast.success("Transaction complete. Receipt sent to SmartLink app.");
  };

  useEffect(() => {
    if (screen !== "complete" || !isOpen || !activeSession) return;

    const deadline = Date.now() + COMPLETE_RETENTION_MS;
    setSecondsRemaining(Math.ceil(COMPLETE_RETENTION_MS / 1000));

    if (completeTimeoutRef.current) {
      window.clearTimeout(completeTimeoutRef.current);
    }
    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
    }

    completeTimeoutRef.current = window.setTimeout(() => {
      void dismissCompletedSession({ showToast: false });
    }, COMPLETE_RETENTION_MS);

    countdownIntervalRef.current = window.setInterval(() => {
      const remainingMs = Math.max(0, deadline - Date.now());
      setSecondsRemaining(Math.ceil(remainingMs / 1000));
    }, 1000);

    return () => {
      if (completeTimeoutRef.current) {
        window.clearTimeout(completeTimeoutRef.current);
        completeTimeoutRef.current = null;
      }
      if (countdownIntervalRef.current) {
        window.clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [activeSession, isOpen, screen]);

  useEffect(() => {
    if (screen !== "dispensing") {
      autoFinalizeTriggeredRef.current = "";
      return;
    }

    if (isSubmitting || progressPercent < 100 || liveLitres <= 0) return;
    if (autoFinalizeTriggeredRef.current === sessionCompletionKey) return;

    autoFinalizeTriggeredRef.current = sessionCompletionKey;
    void finalizeAndShowComplete(liveLitres);
  }, [isSubmitting, liveLitres, progressPercent, screen, sessionCompletionKey]);

  useEffect(() => {
    if (!isOpen || screen !== "dispensing" || !activeSession) return undefined;

    const intervalId = window.setInterval(() => {
      void refreshData({ silent: true });
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeSession, isOpen, refreshData, screen]);

  useEffect(() => {
    if (!isOpen || !showCustomerUnlockScreen) return undefined;

    const intervalId = window.setInterval(() => {
      void refreshData({ silent: true });
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOpen, refreshData, showCustomerUnlockScreen]);

  const handleStartDispense = async () => {
    if (requiresCustomerUnlock && !customerUnlockReady) {
      toast.error("Customer must unlock this SmartLink session by scanning the pump QR code first.");
      return;
    }
    if (!hasAssignedPump) {
      toast.error("Assign a pump before authorizing this session.");
      return;
    }
    if (isAssignedPumpBlocked) {
      toast.error(hybridNotice || "This pump is reserved by the hybrid SmartLink queue.");
      return;
    }
    if (amountValue < 1000 || targetLitres <= 0) {
      toast.error("Session amount is too low to authorize.");
      return;
    }

    setIsSubmitting(true);
    try {
      await startCurrentSession();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to authorize this session.");
      setIsSubmitting(false);
      return;
    }

    if (activeSession.kind === "queue_draft") {
      updateActiveSession({
        fuelType: selectedFuel,
      });
      updateDispensingProgress(0);
    }
    startDispensing();
    setScreen("dispensing");
    setLiveLitres(0);
    setIsSubmitting(false);
  };

  const finalizeAndShowComplete = async (finalLitres: number) => {
    setIsSubmitting(true);
    try {
      await finalizeCurrentSession({
        litres: finalLitres,
        amountMwk: Math.round(finalLitres * target.pricePerLitre),
        refreshAfter: false,
      });
      showComplete(finalLitres);
      await refreshData({ silent: true });
    } catch (error) {
      autoFinalizeTriggeredRef.current = "";
      toast.error(error instanceof Error ? error.message : "Unable to finalize this session.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStopDispense = async () => {
    await finalizeAndShowComplete(liveLitres);
  };

  const handleNextDriver = async () => {
    await dismissCompletedSession({ showToast: true });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={isSubmitting}
          className={`w-full rounded-[14px] px-5 py-4 text-[1.05rem] font-semibold text-white transition ${
            isNightTheme
              ? "bg-[#35516d] shadow-[0_12px_24px_rgba(0,0,0,0.24)] hover:bg-[#3f6486]"
              : "bg-[#16324f] shadow-[0_12px_24px_rgba(22,50,79,0.18)] hover:bg-[#10273e]"
          } ${isSubmitting ? "cursor-not-allowed opacity-70" : ""}`}
        >
          {showCustomerUnlockScreen ? "Await Customer QR" : "Authorize Pump"}
        </button>
      </DialogTrigger>
      <DialogContent
        className={`w-[calc(100vw-2rem)] max-w-xl border shadow-[0_24px_60px_rgba(15,23,42,0.22)] sm:w-full ${
          isNightTheme
            ? "border-[#213243] bg-[#0b1621] text-[#ecf3fb]"
            : "border-[#d7dee7] bg-[#f8fafc] text-[#0f172a]"
        }`}
      >
        {screen === "setup" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold tracking-tight">
                {showCustomerUnlockScreen ? "Customer QR Unlock" : "Pump Authorization"}
              </DialogTitle>
              <DialogDescription className={isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}>
                {showCustomerUnlockScreen
                  ? "The driver must scan the pump QR code in SmartLink before kiosk authorization becomes available."
                  : "Confirm fuel selection and authorize the live pump session."}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 space-y-4">
              {showCustomerUnlockScreen ? (
                <>
                  <div
                    className={`rounded-[18px] border px-4 py-4 ${
                      isNightTheme ? "border-[#213243] bg-[#111d2a]" : "border-[#d7dee7] bg-white"
                    }`}
                  >
                    <div className={`text-[0.72rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                      Waiting For Customer Unlock
                    </div>
                    <div className={`mt-2 text-lg font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
                      {activeSession.customerName}
                    </div>
                    <div className={`mt-1 text-sm ${isNightTheme ? "text-[#9ab0c5]" : "text-[#475569]"}`}>
                      Ask the driver to scan the QR code for {unlockPumpLabel} in the SmartLink app.
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                          isNightTheme
                            ? "border-[#294057] bg-[#0f1b28] text-[#9fb6cb]"
                            : "border-[#d7dee7] bg-[#f8fafc] text-[#35516d]"
                        }`}
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        {paymentLabel}
                      </span>
                      <span
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                          isNightTheme
                            ? "border-[#294057] bg-[#0f1b28] text-[#9fb6cb]"
                            : "border-[#d7dee7] bg-[#f8fafc] text-[#35516d]"
                        }`}
                      >
                        {hasAssignedPump ? `Assigned ${unlockPumpLabel}` : "Assign pump to generate QR"}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`rounded-[18px] border px-5 py-5 text-center ${
                      isNightTheme ? "border-[#294057] bg-[#111d2a]" : "border-[#d7dee7] bg-[#f8fafc]"
                    }`}
                  >
                    <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${isNightTheme ? "bg-[#122233]" : "bg-[#eef4f8]"}`}>
                      <LoaderCircle className={`h-8 w-8 animate-spin ${isNightTheme ? "text-[#9fb6cb]" : "text-[#35516d]"}`} />
                    </div>
                    <div className={`mt-4 text-lg font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
                      Waiting for SmartLink QR scan
                    </div>
                    <div className={`mt-2 text-sm leading-relaxed ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                      The kiosk is polling for the customer unlock. Authorization stays locked until the scan is confirmed.
                    </div>

                    <div className="mt-5 flex justify-center">
                      {unlockPumpQrImage ? (
                        <div
                          className={`rounded-[24px] border p-4 ${
                            isNightTheme
                              ? "border-[#213243] bg-[#0f1b28]"
                              : "border-[#d7dee7] bg-white"
                          }`}
                        >
                          <img
                            src={unlockPumpQrImage}
                            alt={`QR code for ${unlockPumpLabel}`}
                            className="h-[210px] w-[210px] rounded-[18px] bg-white p-3"
                          />
                        </div>
                      ) : (
                        <div
                          className={`flex h-[210px] w-[210px] flex-col items-center justify-center rounded-[24px] border border-dashed ${
                            isNightTheme
                              ? "border-[#294057] bg-[#0f1b28] text-[#8ea1b5]"
                              : "border-[#cbd5e1] bg-white text-[#64748b]"
                          }`}
                        >
                          <QrCode className="h-12 w-12" />
                          <div className="mt-3 max-w-[150px] text-sm leading-relaxed">
                            QR code will appear once the assigned pump is available.
                          </div>
                        </div>
                      )}
                    </div>

                    {unlockPumpQrPayload ? (
                      <div className={`mt-4 break-all text-xs leading-relaxed ${isNightTheme ? "text-[#6f879d]" : "text-[#64748b]"}`}>
                        {unlockPumpQrPayload}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => void refreshData()}
                      disabled={isSubmitting}
                      className={`rounded-[14px] px-5 py-4 text-base font-semibold text-white transition ${
                        isNightTheme ? "bg-[#35516d] hover:bg-[#3f6486]" : "bg-[#16324f] hover:bg-[#10273e]"
                      } ${isSubmitting ? "cursor-not-allowed opacity-70" : ""}`}
                    >
                      Refresh Status
                    </button>
                    <button
                      type="button"
                      onClick={closeDialog}
                      className={`rounded-[14px] border px-5 py-4 text-base font-semibold transition ${
                        isNightTheme
                          ? "border-[#294057] bg-[#111d2a] text-[#c2cfdb] hover:bg-[#162434]"
                          : "border-[#d7dee7] bg-white text-[#475569] hover:bg-[#f8fafc]"
                      }`}
                    >
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <>
              {hybridNotice ? (
                <div
                  className={`rounded-[16px] border px-4 py-3 text-sm font-medium ${
                    isAssignedPumpBlocked
                      ? isNightTheme
                        ? "border-[#5b4733] bg-[#21180f] text-[#e9c7a3]"
                        : "border-[#edd8c3] bg-[#fff7ef] text-[#8b5e3c]"
                      : isNightTheme
                        ? "border-[#294057] bg-[#122233] text-[#c8d7e5]"
                        : "border-[#d7dee7] bg-[#eef4f8] text-[#35516d]"
                  }`}
                >
                  {hybridNotice}
                </div>
              ) : null}
              <div
                className={`rounded-[18px] border px-4 py-4 ${
                  isNightTheme ? "border-[#213243] bg-[#111d2a]" : "border-[#d7dee7] bg-white"
                }`}
              >
                <div className={`text-[0.72rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                  {activeSession.driverVerificationLabel || "Verified Driver"}
                </div>
                <div className={`mt-2 text-lg font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
                  {activeSession.customerName}
                </div>
                <div className={`mt-1 text-sm ${isNightTheme ? "text-[#9ab0c5]" : "text-[#475569]"}`}>
                  {activeSession.vehicleLabel || "Vehicle details pending"}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                      isNightTheme
                        ? "border-[#294057] bg-[#0f1b28] text-[#9fb6cb]"
                        : "border-[#d7dee7] bg-[#f8fafc] text-[#35516d]"
                    }`}
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    {paymentLabel}
                  </span>
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                      isNightTheme
                        ? "border-[#294057] bg-[#0f1b28] text-[#9fb6cb]"
                        : "border-[#d7dee7] bg-[#f8fafc] text-[#35516d]"
                    }`}
                  >
                    {hasAssignedPump ? `Pump ${activeSession.assignedPump}` : "Pump not assigned"}
                  </span>
                </div>
              </div>

              <div>
                <div className={`mb-2 text-[0.75rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                  Fuel Type
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(["petrol", "diesel"] as FuelType[]).map((fuel) => {
                    const isSelected = selectedFuel === fuel;
                    const price = getPricePerLitre(fuel, petrolPricePerLitre, dieselPricePerLitre);
                    return (
                      <button
                        key={fuel}
                        type="button"
                        onClick={() => canChangeFuelType ? setSelectedFuel(fuel) : undefined}
                        disabled={!canChangeFuelType}
                        className={`rounded-[16px] border px-4 py-4 text-left transition ${
                          isSelected
                            ? isNightTheme
                              ? "border-[#4a6b8b] bg-[#122233]"
                              : "border-[#16324f] bg-[#e7eef6]"
                            : isNightTheme
                              ? "border-[#213243] bg-[#111d2a] hover:border-[#35516d]"
                              : "border-[#d7dee7] bg-white hover:border-[#9fb0c1]"
                        } ${!canChangeFuelType ? "cursor-not-allowed opacity-70" : ""}`}
                      >
                        <div className={`text-sm font-semibold uppercase ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
                          {fuel}
                        </div>
                        <div className={`mt-1 text-sm ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                          {formatCurrency(price)} / L
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className={`rounded-[18px] border px-4 py-5 text-center ${
                  isNightTheme ? "border-[#294057] bg-[#111d2a]" : "border-[#d7dee7] bg-[#16324f]"
                }`}
              >
                <div className={`text-[0.72rem] font-semibold uppercase tracking-[0.16em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#9fb0c1]"}`}>
                  Requested Amount
                </div>
                <div className={`mt-2 text-[2rem] font-semibold tracking-[0.04em] ${isNightTheme ? "text-[#ecf3fb]" : "text-white"}`}>
                  {formatCurrency(amountValue)}
                </div>
                <div className={`mt-1 text-sm ${isNightTheme ? "text-[#8ea1b5]" : "text-[#c8d3df]"}`}>
                  Approx. {targetLitres.toFixed(1)} L
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => void handleStartDispense()}
                  disabled={isSubmitting || isAssignedPumpBlocked || !hasAssignedPump}
                  className={`rounded-[14px] px-5 py-4 text-base font-semibold text-white transition ${
                    isNightTheme ? "bg-[#35516d] hover:bg-[#3f6486]" : "bg-[#16324f] hover:bg-[#10273e]"
                  } ${isSubmitting || isAssignedPumpBlocked || !hasAssignedPump ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  {!hasAssignedPump
                    ? "Assign Pump First"
                    : isAssignedPumpBlocked
                    ? "Pump Reserved by Hybrid Queue"
                    : isSubmitting
                      ? "Authorizing..."
                      : "Authorize Pump"}
                </button>
                <button
                  type="button"
                  onClick={closeDialog}
                  className={`rounded-[14px] border px-5 py-4 text-base font-semibold transition ${
                    isNightTheme
                      ? "border-[#294057] bg-[#111d2a] text-[#c2cfdb] hover:bg-[#162434]"
                      : "border-[#d7dee7] bg-white text-[#475569] hover:bg-[#f8fafc]"
                  }`}
                >
                  Cancel
                </button>
              </div>
                </>
              )}
            </div>
          </>
        ) : null}

        {screen === "dispensing" ? (
          <div className="px-2 py-2">
            <div className="flex flex-col items-center text-center">
              <div className={`mb-5 flex h-18 w-18 items-center justify-center rounded-full ${isNightTheme ? "bg-[#122233]" : "bg-[#eef4f8]"}`}>
                <Fuel className={`h-8 w-8 ${isNightTheme ? "text-[#9fb6cb] animate-pulse" : "text-[#35516d] animate-pulse"}`} />
              </div>
              <div className={`text-lg font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>Dispensing fuel...</div>
              <div className={`mt-1 text-sm ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>Pump authorized · live values from telemetry logs</div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <MetricCard label="Dispensed" value={`${liveLitres.toFixed(1)} L`} isNightTheme={isNightTheme} />
              <MetricCard label="Amount" value={formatCurrency(liveAmount)} isNightTheme={isNightTheme} />
            </div>

            <div className={`mt-6 h-2.5 w-full overflow-hidden rounded-full ${isNightTheme ? "bg-[#162434]" : "bg-[#dde5ee]"}`}>
              <div
                className={`h-full rounded-full transition-all duration-500 ${isNightTheme ? "bg-[#4a6b8b]" : "bg-[#35516d]"}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className={`mt-2 text-center text-xs font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
              {progressPercent}% complete
            </div>

            <button
              type="button"
              onClick={() => void handleStopDispense()}
              disabled={isSubmitting}
              className={`mt-6 w-full rounded-[14px] border px-5 py-4 text-base font-semibold transition ${
                isNightTheme
                  ? "border-[#294057] bg-[#111d2a] text-[#c2cfdb] hover:bg-[#162434]"
                  : "border-[#d7dee7] bg-white text-[#475569] hover:bg-[#f8fafc]"
              } ${isSubmitting ? "cursor-not-allowed opacity-70" : ""}`}
            >
              {isSubmitting ? "Finalizing..." : "Stop / Close Nozzle"}
            </button>
          </div>
        ) : null}

        {screen === "complete" ? (
          <div className="px-2 py-2">
            <div className="flex flex-col items-center text-center">
              <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full ${isNightTheme ? "bg-[#13271b]" : "bg-[#ecf9f0]"}`}>
                <Check className="h-8 w-8 text-[#16a34a]" />
              </div>
              <div className={`text-lg font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>Transaction complete</div>
              <div className={`mt-1 text-sm ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>Receipt sent to SmartLink app</div>
              <div className={`mt-2 text-xs font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#7f95aa]" : "text-[#64748b]"}`}>
                Auto-close in {secondsRemaining}s
              </div>
            </div>

            <div
              className={`mt-5 rounded-[16px] border px-4 py-4 text-center ${
                isNightTheme
                  ? "border-[#294057] bg-[#122233] text-[#d7e5f2]"
                  : "border-[#d4e1e8] bg-[#eef4f8] text-[#35516d]"
              }`}
            >
              <div className="text-sm font-semibold uppercase tracking-[0.12em]">Completed</div>
              <div className="mt-2 text-sm leading-relaxed">
                Fuel delivery is complete. Confirm the receipt details below, then continue with the next driver.
              </div>
            </div>

            <div
              className={`mt-5 rounded-[18px] border px-4 py-4 ${
                isNightTheme ? "border-[#213243] bg-[#111d2a]" : "border-[#e2e8f0] bg-white"
              }`}
            >
              <ReceiptRow label="Driver" value={activeSession.customerName} isNightTheme={isNightTheme} />
              <ReceiptRow label="Fuel Type" value={selectedFuel.toUpperCase()} isNightTheme={isNightTheme} />
              <ReceiptRow label="Litres Dispensed" value={`${liveLitres.toFixed(2)} L`} isNightTheme={isNightTheme} />
              <ReceiptRow
                label="Pump"
                value={hasAssignedPump ? `0${activeSession.assignedPump} · Nozzle A` : "Not assigned"}
                isNightTheme={isNightTheme}
              />
              <ReceiptRow label="Time" value={receiptTime || "--:--"} isNightTheme={isNightTheme} />
              <ReceiptRow label="Total Charged" value={formatCurrency(Math.round(liveLitres * target.pricePerLitre))} isNightTheme={isNightTheme} total />
            </div>

            <button
              type="button"
              onClick={() => void handleNextDriver()}
              disabled={isSubmitting}
              className={`mt-6 w-full rounded-[14px] px-5 py-4 text-base font-semibold text-white transition ${
                isNightTheme ? "bg-[#35516d] hover:bg-[#3f6486]" : "bg-[#16324f] hover:bg-[#10273e]"
              } ${isSubmitting ? "cursor-not-allowed opacity-70" : ""}`}
            >
              Next Driver
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({
  label,
  value,
  isNightTheme,
}: {
  label: string;
  value: string;
  isNightTheme: boolean;
}) {
  return (
    <div
      className={`rounded-[16px] border px-4 py-4 ${
        isNightTheme ? "border-[#213243] bg-[#111d2a]" : "border-[#e2e8f0] bg-white"
      }`}
    >
      <div className={`text-[0.72rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
        {label}
      </div>
      <div className={`mt-2 text-xl font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>{value}</div>
    </div>
  );
}

function ReceiptRow({
  label,
  value,
  isNightTheme,
  total = false,
}: {
  label: string;
  value: string;
  isNightTheme: boolean;
  total?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 border-b py-2 last:border-b-0 ${
        isNightTheme ? "border-[#1d2d3d]" : "border-[#e2e8f0]"
      }`}
    >
      <span className={isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}>{label}</span>
      <span className={`font-semibold ${total ? (isNightTheme ? "text-[#c8d7e5]" : "text-[#35516d]") : isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
        {value}
      </span>
    </div>
  );
}
