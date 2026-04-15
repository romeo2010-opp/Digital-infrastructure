import { toast } from "sonner"
import { useKioskOperations } from "../hooks/useKioskOperations"
import { useFuelStore } from "../store/fuelStore"
import { useKioskTheme } from "./KioskThemeContext"

function formatRequestedValue(amount?: number, litres?: number) {
  if (typeof amount === "number" && amount > 0) {
    return `MWK ${amount.toLocaleString()}`
  }
  if (typeof litres === "number" && litres > 0) {
    return `${litres} L`
  }
  return "Request pending"
}

interface NearbyWalletOrdersPanelProps {
  embedded?: boolean;
}

export function NearbyWalletOrdersPanel({ embedded = false }: NearbyWalletOrdersPanelProps) {
  const {
    nearbyWalletOrders,
    activeSession,
    livePumpSession,
    markNearbyWalletOrderIssue,
  } = useFuelStore()
  const { attachNearbyWalletOrder } = useKioskOperations()
  const { isNightTheme } = useKioskTheme()

  const visibleOrders = nearbyWalletOrders.filter((item) =>
    ["at_station", "near_pump", "issue"].includes(item.status)
  )

  async function handleAttach(orderId: string) {
    try {
      await attachNearbyWalletOrder(orderId)
      toast.success("Nearby wallet order attached to the live pump session.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to attach nearby wallet order.")
    }
  }

  return (
    <section
      className={
        embedded
          ? "space-y-3"
          : `rounded-[24px] border p-5 ${
              isNightTheme
                ? "border-[#213243] bg-[#0d1722] shadow-[0_12px_30px_rgba(0,0,0,0.28)]"
                : "border-[#d7dee7] bg-[#f8fafc] shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
            }`
      }
    >
      {!embedded ? (
        <div className="mb-4">
          <h3 className={`text-[1.15rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
            Nearby Wallet Orders
          </h3>
          <p className={`mt-1 text-sm ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
            Separate from the main queue. Attach only after physical verification.
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className={`text-[1rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
              Nearby Wallet Orders
            </h3>
            <p className={`text-xs ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>Separate from queue access</p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.12em] ${
              isNightTheme
                ? "border-[#294057] bg-[#111d2a] text-[#9fb6cb]"
                : "border-[#d6e0ea] bg-white text-[#35516d]"
            }`}
          >
            Wallet
          </span>
        </div>
      )}

      <div className="space-y-3">
        {visibleOrders.length === 0 ? (
          <div
            className={`rounded-[18px] px-4 py-5 text-sm ${
              isNightTheme
                ? "bg-[#111d2a] text-[#8ea1b5] shadow-[inset_0_0_0_1px_rgba(41,64,87,0.9)]"
                : "bg-white text-[#64748b] shadow-[inset_0_0_0_1px_rgba(215,222,231,0.8)]"
            }`}
          >
            No nearby wallet orders detected.
          </div>
        ) : (
          visibleOrders.map((order) => {
            const canAttach =
              !activeSession
              && Boolean(livePumpSession?.publicId)
              && !livePumpSession?.fuelOrderPublicId
              && order.status !== "issue"
            const presenceLabel = order.presence === "near_pump" ? "Near Pump" : "At Station"
            const presenceClassName =
              order.presence === "near_pump"
                ? isNightTheme
                  ? "border-[#294057] bg-[#122233] text-[#a9c0d3]"
                  : "border-[#d4e1e8] bg-[#eef4f8] text-[#35516d]"
                : isNightTheme
                  ? "border-[#213243] bg-[#111d2a] text-[#9ab0c5]"
                  : "border-[#e2e8f0] bg-white text-[#475569]";

            return (
              <article
                key={order.id}
                className={`rounded-[18px] border px-4 py-4 ${
                  isNightTheme
                    ? "border-[#213243] bg-[#111d2a] shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
                    : "border-[#dde5ee] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`text-[0.78rem] font-semibold uppercase tracking-[0.16em] ${isNightTheme ? "text-[#9fb6cb]" : "text-[#35516d]"}`}>
                      {order.displayCode}
                    </div>
                    <div className={`mt-1 text-[1rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#101828]"}`}>{order.customerName}</div>
                    <div className={`mt-1 text-sm ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                      {order.fuelType.toUpperCase()} · {formatRequestedValue(order.requestedAmountMwk, order.requestedLitres)}
                    </div>
                  </div>
                  <div className={`text-right text-xs ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
                    <div className={`rounded-full border px-3 py-1 font-semibold ${presenceClassName}`}>{presenceLabel}</div>
                    <div className="mt-2">Age {order.ageLabel}</div>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => void handleAttach(order.id)}
                    disabled={!canAttach}
                    className={`flex-1 rounded-[14px] px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed ${
                      isNightTheme
                        ? "bg-[#35516d] hover:bg-[#3f6486] disabled:bg-[#2a3847]"
                        : "bg-[#16324f] hover:bg-[#10273e] disabled:bg-[#a8b8c8]"
                    }`}
                  >
                    {!livePumpSession?.publicId
                      ? "Waiting for Pump"
                      : livePumpSession?.fuelOrderPublicId || activeSession
                        ? "Busy"
                        : "Attach"}
                  </button>
                  <button
                    type="button"
                    onClick={() => markNearbyWalletOrderIssue(order.id)}
                    className={`rounded-[14px] px-4 py-3 text-sm font-semibold transition ${
                      isNightTheme
                        ? "bg-[#16202b] text-[#c7a98a] shadow-[inset_0_0_0_1px_rgba(139,94,60,0.28)] hover:bg-[#1b2834]"
                        : "bg-[#f8fafc] text-[#8b5e3c] shadow-[inset_0_0_0_1px_rgba(139,94,60,0.18)] hover:bg-[#f1f5f9]"
                    }`}
                  >
                    Issue
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
