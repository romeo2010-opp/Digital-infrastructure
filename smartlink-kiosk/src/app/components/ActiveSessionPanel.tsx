import {
  CircleDot,
  CreditCard,
  Fuel,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { isQueueSessionCustomerUnlocked, useFuelStore } from "../store/fuelStore";
import { EditSessionDialog } from "./EditSessionDialog";
import { useKioskTheme } from "./KioskThemeContext";
import { PumpAuthorizationDialog } from "./PumpAuthorizationDialog";
import { SwitchPumpDialog } from "./SwitchPumpDialog";

function formatRequestedValue(amount?: number, litres?: number, fuelType?: string) {
  const fuelLabel = String(fuelType || "").trim();
  if (typeof amount === "number" && amount > 0) {
    return `MWK ${amount.toLocaleString()} ${fuelLabel}`;
  }
  if (typeof litres === "number" && litres > 0) {
    return `${litres}L ${fuelLabel}`;
  }
  return `Fuel request ${fuelLabel}`.trim();
}

function formatStatusLabel(status: string) {
  switch (status) {
    case "dispensing":
      return "Dispensing";
    case "completed":
      return "Receipt Review";
    case "waiting":
      return "Awaiting Pump Authorization";
    case "error":
      return "Attention Required";
    default:
      return "Session Open";
  }
}

function formatSourceLabel(source: "queue" | "manual_wallet") {
  return source === "manual_wallet" ? "Nearby Wallet Order" : "Queue Session";
}

function formatPaymentLabel(paymentMethod?: "wallet" | "smartpay" | "pay_at_pump") {
  if (paymentMethod === "wallet") return "Wallet"
  if (paymentMethod === "smartpay") return "SmartPay"
  if (paymentMethod === "pay_at_pump") return "Pay at Pump"
  return "Station Settlement"
}

function statusToneClass(status: string, isNightTheme: boolean) {
  switch (status) {
    case "dispensing":
      return isNightTheme
        ? "border-[#294057] bg-[#122233] text-[#a9c0d3]"
        : "border-[#d4e1e8] bg-[#eef4f8] text-[#35516d]";
    case "completed":
      return isNightTheme
        ? "border-[#214033] bg-[#11241b] text-[#9bd0ae]"
        : "border-[#d5e9dc] bg-[#eef8f1] text-[#217346]";
    case "error":
      return isNightTheme
        ? "border-[#533a2b] bg-[#221913] text-[#d2ad8f]"
        : "border-[#eadfd6] bg-[#faf5f0] text-[#8b5e3c]";
    default:
      return isNightTheme
        ? "border-[#213243] bg-[#111d2a] text-[#9ab0c5]"
        : "border-[#d7dee7] bg-white text-[#475569]";
  }
}

interface SummaryMetricProps {
  label: string;
  value: string;
  muted?: boolean;
}

function SummaryMetric({ label, value, muted = false }: SummaryMetricProps) {
  const { isNightTheme } = useKioskTheme();
  return (
    <div
      className={`rounded-[16px] border px-4 py-4 ${
        isNightTheme
          ? muted
            ? "border-[#213243] bg-[#0f1b28]"
            : "border-[#294057] bg-[#111d2a]"
          : muted
            ? "border-[#e2e8f0] bg-[#f8fafc]"
            : "border-[#d7dee7] bg-white"
      }`}
    >
      <div className={`text-[0.72rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
        {label}
      </div>
      <div className={`mt-2 text-[1.05rem] font-semibold leading-tight ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
        {value}
      </div>
    </div>
  );
}

interface ChecklistItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
}

function ChecklistItem({ icon: Icon, label, detail }: ChecklistItemProps) {
  const { isNightTheme } = useKioskTheme();
  return (
    <div
      className={`flex items-start gap-3 rounded-[16px] border px-4 py-4 ${
        isNightTheme ? "border-[#213243] bg-[#111d2a]" : "border-[#e2e8f0] bg-white"
      }`}
    >
      <div className={`mt-0.5 rounded-full p-2 ${isNightTheme ? "bg-[#122233] text-[#a9c0d3]" : "bg-[#eef4f8] text-[#35516d]"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className={`text-sm font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>{label}</div>
        <div className={`mt-1 text-sm leading-relaxed ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>{detail}</div>
      </div>
    </div>
  );
}

export function ActiveSessionPanel() {
  const { activeSession, livePumpSession, cancelSession } = useFuelStore()
  const { isNightTheme } = useKioskTheme()

  if (!activeSession) {
    return (
      <section
        className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border ${
          isNightTheme
            ? "border-[#213243] bg-[#0d1722] shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
            : "border-[#d7dee7] bg-[#f8fafc] shadow-[0_12px_32px_rgba(15,23,42,0.06)]"
        }`}
      >
        <header className={`border-b px-6 py-4 ${isNightTheme ? "border-[#1d2d3d]" : "border-[#e2e8f0]"}`}>
          <h2 className={`text-[1.55rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>Current Session</h2>
        </header>
        <div className={`flex flex-1 items-center justify-center px-10 text-center ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
          {livePumpSession?.publicId
            ? `Pump ${livePumpSession.pumpNumber || "--"} is live and ready for wallet-order attachment.`
            : "Select a queue customer or attach a nearby wallet order to begin."}
        </div>
      </section>
    )
  }

  const canEditSession = activeSession.kind === "queue_draft" && activeSession.status === "waiting"
  const canCancelSession = activeSession.kind === "queue_draft" && activeSession.status === "waiting"
  const autoOpenWalkInEditorKey =
    activeSession.kind === "queue_draft"
    && activeSession.status === "waiting"
    && activeSession.queueUserType === "walkin"
      ? activeSession.customerId
      : null
  const assignedPumpLabel = activeSession.assignedPump ? `Pump ${activeSession.assignedPump}` : "Not assigned"

  const requestedValue = formatRequestedValue(
    activeSession.requestedAmountMwk,
    activeSession.requestedLitres,
    activeSession.fuelType.charAt(0).toUpperCase() + activeSession.fuelType.slice(1)
  )
  const statusLabel = formatStatusLabel(activeSession.status)
  const sourceLabel = formatSourceLabel(activeSession.source)
  const paymentLabel = formatPaymentLabel(activeSession.paymentMethod)
  const requiresCustomerUnlock =
    activeSession.kind === "queue_draft" && activeSession.queueUserType === "smartlink"
  const customerUnlockReady = isQueueSessionCustomerUnlocked(activeSession)

  return (
    <section
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border ${
        isNightTheme
          ? "border-[#213243] bg-[#0d1722] shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
          : "border-[#d7dee7] bg-[#f8fafc] shadow-[0_12px_32px_rgba(15,23,42,0.06)]"
      }`}
    >
      <header className={`border-b px-6 py-4 ${isNightTheme ? "border-[#1d2d3d]" : "border-[#e2e8f0]"}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className={`text-[1.55rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>Current Session</h2>
          <div className={`rounded-full border px-4 py-2 text-sm font-semibold ${statusToneClass(activeSession.status, isNightTheme)}`}>
            {statusLabel}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div
          className={`space-y-4 rounded-[20px] border px-5 py-5 md:px-6 md:py-6 ${
            isNightTheme
              ? "border-[#213243] bg-[#111d2a] shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
              : "border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]"
          }`}
        >
          <div className={`flex flex-wrap items-start justify-between gap-4 border-b pb-4 ${isNightTheme ? "border-[#1d2d3d]" : "border-[#e2e8f0]"}`}>
            <div className="min-w-0">
              <div className={`text-[0.82rem] font-semibold uppercase tracking-[0.16em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                {activeSession.driverVerificationLabel || "Driver Verification"}
              </div>
              <div className={`mt-2 text-[1.8rem] font-semibold leading-tight ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
                {activeSession.customerName}
              </div>
              <div className={`mt-1 text-[1.05rem] leading-snug ${isNightTheme ? "text-[#9ab0c5]" : "text-[#475569]"}`}>
                {activeSession.vehicleLabel || "Vehicle details pending"}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${
                  isNightTheme
                    ? "border-[#294057] bg-[#0f1b28] text-[#9fb6cb]"
                    : "border-[#d7dee7] bg-[#f8fafc] text-[#35516d]"
                }`}
              >
                {sourceLabel}
              </span>
              {activeSession.displayCode ? (
                <span
                  className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] ${
                    isNightTheme
                      ? "border-[#294057] bg-[#0f1b28] text-[#9fb6cb]"
                      : "border-[#d7dee7] bg-[#f8fafc] text-[#35516d]"
                  }`}
                >
                  {activeSession.displayCode}
                </span>
              ) : null}
            </div>
          </div>

          <div className={`flex items-end justify-between gap-4 border-b pb-4 ${isNightTheme ? "border-[#1d2d3d]" : "border-[#e2e8f0]"}`}>
            <div>
              <div className={`text-[0.75rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                Requested Fuel
              </div>
              <div className={`mt-2 text-[1.8rem] font-semibold leading-tight md:text-[2.2rem] ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
                {requestedValue}
              </div>
            </div>
            {canEditSession ? <EditSessionDialog autoOpenKey={autoOpenWalkInEditorKey} /> : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SummaryMetric label="Assigned Pump" value={assignedPumpLabel} />
            <SummaryMetric label="Payment" value={paymentLabel} />
            <SummaryMetric label="Fuel Type" value={activeSession.fuelType.toUpperCase()} muted />
            <SummaryMetric
              label="Dispensed"
              value={`${Number(activeSession.litresDispensed || 0).toFixed(activeSession.litresDispensed ? 2 : 0)} L`}
              muted
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              <div className={`text-[0.82rem] font-semibold uppercase tracking-[0.16em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                Operator Checks
              </div>
              <ChecklistItem
                icon={UserRoundCheck}
                label="Customer Identity"
                detail={activeSession.driverVerificationLabel || "Identity status not recorded yet."}
              />
                <ChecklistItem
                icon={CreditCard}
                label="Funding Route"
                detail={
                  activeSession.paymentMethod === "wallet"
                    ? "Wallet payment linked to this session. Capture should happen after actual dispensing."
                    : activeSession.paymentMethod === "pay_at_pump"
                      ? "Customer is expected to complete payment at the pump before final service settlement."
                      : activeSession.paymentMethod === "smartpay"
                        ? "SmartPay prepay is linked to this session and should be reconciled from the confirmed service request."
                    : "Queue service selected. Final settlement will follow the station payment flow."
                }
              />
              <ChecklistItem
                icon={Fuel}
                label="Pump Assignment"
                detail={
                  activeSession.assignedPump
                    ? `Pump ${activeSession.assignedPump} is assigned for this ${activeSession.fuelType} session.`
                    : `Choose a pump for this ${activeSession.fuelType} session before authorization.`
                }
              />
              <ChecklistItem
                icon={ShieldCheck}
                label="Authorization Readiness"
                detail={
                  requiresCustomerUnlock && !customerUnlockReady
                    ? "Waiting for the customer to scan the assigned pump QR code in SmartLink before authorization unlocks."
                    : activeSession.status === "dispensing"
                    ? "Pump authorization has been issued and dispensing is in progress."
                    : activeSession.status === "completed"
                      ? "Dispensing is complete. Keep the receipt modal open for customer confirmation or clear the driver for the next session."
                    : "Confirm driver, nozzle, and fuel type before authorizing the pump."
                }
              />
            </div>

            <div className={`rounded-[18px] border px-4 py-4 ${isNightTheme ? "border-[#213243] bg-[#0f1b28]" : "border-[#e2e8f0] bg-[#f8fafc]"}`}>
              <div className={`flex items-center gap-2 text-[0.82rem] font-semibold uppercase tracking-[0.16em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                <CircleDot className="h-4 w-4" />
                Session Control
              </div>
              <div className="mt-4 space-y-3">
                <div className={`rounded-[14px] border px-4 py-3 text-sm font-medium ${statusToneClass(activeSession.status, isNightTheme)}`}>
                  {statusLabel}
                </div>
                {canEditSession ? (
                  <SwitchPumpDialog
                    currentPump={activeSession.assignedPump}
                    fuelType={activeSession.fuelType}
                  />
                ) : null}
                <PumpAuthorizationDialog />
                <button
                  type="button"
                  onClick={cancelSession}
                  disabled={!canCancelSession}
                  className={`w-full rounded-[14px] border px-5 py-4 text-[1.05rem] font-semibold transition ${
                    isNightTheme
                      ? "border-[#294057] bg-[#111d2a] text-[#c2cfdb] shadow-[0_8px_18px_rgba(0,0,0,0.16)] hover:bg-[#162434]"
                      : "border-[#d7dee7] bg-white text-[#475569] shadow-[0_8px_18px_rgba(15,23,42,0.04)] hover:bg-[#f8fafc]"
                  } ${!canCancelSession ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  {canCancelSession ? "Cancel Session" : activeSession.status === "completed" ? "Receipt Awaiting Clear" : "Live Session Locked"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
