import { useFuelStore } from "../store/fuelStore"
import { AddWalkInDialog } from "./AddWalkInDialog"
import { useKioskTheme } from "./KioskThemeContext"
import { NearbyWalletOrdersPanel } from "./NearbyWalletOrdersPanel"

function formatQueueRequest(requestedAmount?: number, requestedLitres?: number) {
  if (typeof requestedAmount === "number" && requestedAmount > 0) {
    return `MWK ${requestedAmount.toLocaleString()}`
  }
  if (typeof requestedLitres === "number" && requestedLitres > 0) {
    return `${requestedLitres}L`
  }
  return "Open request"
}

function formatPaymentLabel(paymentMethod?: "wallet" | "smartpay" | "pay_at_pump") {
  if (paymentMethod === "wallet") return "Wallet"
  if (paymentMethod === "smartpay") return "SmartPay"
  if (paymentMethod === "pay_at_pump") return "Pay at Pump"
  return ""
}

function formatHybridTargetSource(value?: string | null) {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "DIGITAL_QUEUE") return "SmartLink queue"
  if (normalized === "READY_NOW_APP") return "Ready-now app user"
  if (normalized === "RESERVATION") return "Reservation"
  if (normalized === "WALK_IN") return "Walk-in"
  return "Queue target"
}

export function QueuePanel() {
  const { queue, activeSession, hybridPilotQueue, pumps, selectCustomer, isApiMode } = useFuelStore()
  const { isNightTheme } = useKioskTheme()
  const pilotPump = pumps.find((pump) => pump.publicId === hybridPilotQueue?.pilotPumpPublicId) || null
  const hybridConfigured = Boolean(hybridPilotQueue?.enabled)
  const isDigitalQueueMode =
    hybridPilotQueue?.digitalHoldActive === true
    || hybridPilotQueue?.pilotPumpQueueState === "DIGITAL_HOLD"
  const hybridStatusTone = hybridPilotQueue?.digitalHoldActive
    ? isNightTheme
      ? "border-[#5b4733] bg-[#21180f] text-[#e9c7a3]"
      : "border-[#edd8c3] bg-[#fff7ef] text-[#8b5e3c]"
    : hybridConfigured
      ? isNightTheme
        ? "border-[#294057] bg-[#122233] text-[#c8d7e5]"
        : "border-[#d7dee7] bg-[#eef4f8] text-[#35516d]"
      : isNightTheme
        ? "border-[#3a2b2b] bg-[#1b1414] text-[#d5b0b0]"
        : "border-[#eadfd6] bg-[#faf5f0] text-[#8b5e3c]"

  const hybridStageLabel = !hybridConfigured
    ? "Hybrid Not Configured"
    : hybridPilotQueue?.digitalHoldActive
      ? "Preparing For Digital Queue"
      : "Hybrid Walk-in Mode"

  const hybridHeadline = !hybridConfigured
    ? "No hybrid SmartLink pump has been selected yet."
    : hybridPilotQueue?.digitalHoldActive
      ? `${pilotPump ? `Pump ${pilotPump.id}` : "Pilot pump"} is preparing for the next ready SmartLink user.`
      : `${pilotPump ? `Pump ${pilotPump.id}` : "Pilot pump"} is in hybrid mode and can serve walk-ins until a digital customer is ready on site.`

  const hybridSupportText = !hybridConfigured
    ? "Set a pilot pump in Station Manager to activate hybrid SmartLink queue handling."
    : hybridPilotQueue?.digitalHoldActive
      ? hybridPilotQueue.committedCarsAhead > 0
        ? `${hybridPilotQueue.committedCarsAhead} committed car${hybridPilotQueue.committedCarsAhead === 1 ? "" : "s"} still ahead before the next controllable slot.`
        : "The next controllable slot belongs to the selected digital customer."
      : hybridPilotQueue?.currentNextAssignmentTarget?.source
        ? `Next hybrid target: ${formatHybridTargetSource(hybridPilotQueue.currentNextAssignmentTarget.source)}.`
        : "Walk-ins may continue using the hybrid pump until a SmartLink driver is confirmed on site."

  return (
    <section
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border ${
        isNightTheme
          ? "border-[#213243] bg-[#0d1722] shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
          : "border-[#d7dee7] bg-[#f8fafc] shadow-[0_12px_32px_rgba(15,23,42,0.06)]"
      }`}
    >
      <header
        className={`flex items-center justify-between gap-4 border-b px-5 py-4 ${
          isNightTheme ? "border-[#1d2d3d]" : "border-[#e2e8f0]"
        }`}
      >
        <div>
          <h2 className={`text-[1.45rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
            Queue ({queue.length})
          </h2>
        </div>
        {!isDigitalQueueMode ? (
          <AddWalkInDialog
            triggerLabel={isApiMode ? "Add Walk-in" : "Create Order"}
            triggerClassName={`h-12 rounded-[14px] px-5 text-[0.95rem] font-semibold text-white transition ${
              isNightTheme
                ? "bg-[#35516d] shadow-[0_10px_24px_rgba(0,0,0,0.24)] hover:bg-[#3f6486]"
                : "bg-[#16324f] shadow-[0_10px_20px_rgba(22,50,79,0.16)] hover:bg-[#10273e]"
            }`}
          />
        ) : null}
      </header>

      <div className="min-h-0 flex-1 px-4 py-4">
        <div className="h-full space-y-3 overflow-y-auto pr-1">
          <div className={`rounded-[18px] border px-4 py-3 ${hybridStatusTone}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[0.82rem] font-semibold uppercase tracking-[0.16em]">
                {hybridStageLabel}
              </div>
              {pilotPump ? (
                <div className={`rounded-full border px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] ${
                  isNightTheme
                    ? "border-white/10 bg-black/10 text-current"
                    : "border-black/10 bg-white/60 text-current"
                }`}>
                  Pilot Pump: P{pilotPump.id}
                </div>
              ) : null}
            </div>
            <div className="mt-1 text-sm font-medium">
              {hybridHeadline}
            </div>
            <div className={`mt-2 text-xs ${isNightTheme ? "text-current/80" : "text-current/80"}`}>
              {hybridSupportText}
            </div>
            {hybridPilotQueue?.digitalHoldActive && hybridPilotQueue.walkInRedirectMessage ? (
              <div className={`mt-2 text-xs ${isNightTheme ? "text-current/90" : "text-current/90"}`}>
                {hybridPilotQueue.walkInRedirectMessage}
              </div>
            ) : null}
          </div>

          {hybridPilotQueue?.digitalHoldActive ? (
            <div
              className={`rounded-[18px] border px-4 py-3 ${
                isNightTheme
                  ? "border-[#5b4733] bg-[#21180f] text-[#e9c7a3]"
                  : "border-[#edd8c3] bg-[#fff7ef] text-[#8b5e3c]"
              }`}
            >
              <div className="text-[0.82rem] font-semibold uppercase tracking-[0.16em]">
                Hybrid Hold Active
              </div>
              <div className="mt-1 text-sm font-medium">
                {pilotPump ? `Pilot pump P${pilotPump.id}` : "Pilot pump"} is reserved for the next ready SmartLink user.
              </div>
              <div className={`mt-2 text-xs ${isNightTheme ? "text-[#c8ab8b]" : "text-[#9a6d46]"}`}>
                {hybridPilotQueue.committedCarsAhead > 0
                  ? `${hybridPilotQueue.committedCarsAhead} committed car${hybridPilotQueue.committedCarsAhead === 1 ? "" : "s"} still ahead before the next controllable slot.`
                  : "The next controllable slot belongs to the selected digital customer."}
              </div>
              {hybridPilotQueue.walkInRedirectMessage ? (
                <div className={`mt-2 text-xs ${isNightTheme ? "text-[#d8c0a7]" : "text-[#8b5e3c]"}`}>
                  {hybridPilotQueue.walkInRedirectMessage}
                </div>
              ) : null}
            </div>
          ) : null}

          {queue.map((item) => {
            const isSelected = activeSession?.customerId === item.id && activeSession.source === "queue"
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectCustomer(item.id)}
                className={`flex w-full items-center gap-3 rounded-[18px] px-4 py-3 text-left transition ${
                  isSelected
                    ? isNightTheme
                      ? "bg-[#122233] shadow-[inset_0_0_0_1px_rgba(83,111,138,0.4)]"
                      : "bg-[#e7eef6] shadow-[inset_0_0_0_1px_rgba(22,50,79,0.14)]"
                    : isNightTheme
                      ? "bg-[#111d2a] hover:bg-[#152435]"
                      : "bg-white hover:bg-[#f2f6fa]"
                }`}
              >
                <div
                  className={`flex h-12 min-w-12 items-center justify-center rounded-[12px] px-3 text-[1.05rem] font-bold ${
                    isNightTheme ? "bg-[#223447] text-[#d9e6f2]" : "bg-[#dbe3ec] text-[#16324f]"
                  }`}
                >
                  #{item.position}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[1rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#101828]"}`}>
                    {item.customerName || item.walkinId}
                  </div>
                  <div className={`mt-1 flex flex-wrap items-center gap-2 text-sm ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                    <span>{item.serviceLabel || (item.userType === "smartlink" ? "Smartlink" : "Walk-in")}</span>
                    <span className={isNightTheme ? "text-[#35516d]" : "text-[#cbd5e1]"}>•</span>
                    <span className="uppercase">{item.fuelType}</span>
                    <span className={isNightTheme ? "text-[#35516d]" : "text-[#cbd5e1]"}>•</span>
                    <span>{formatQueueRequest(item.requestedAmount, item.requestedLitres)}</span>
                  </div>
                  {item.paymentMethod ? (
                    <div className="mt-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.12em] ${
                          isNightTheme
                            ? "border-[#294057] bg-[#0f1b28] text-[#9fb6cb]"
                            : "border-[#d7dee7] bg-[#f8fafc] text-[#35516d]"
                        }`}
                      >
                        {formatPaymentLabel(item.paymentMethod)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`shrink-0 border-t px-4 py-4 ${
          isNightTheme ? "border-[#1d2d3d]" : "border-[#e2e8f0]"
        }`}
      >
        <NearbyWalletOrdersPanel embedded />
      </div>
    </section>
  );
}
