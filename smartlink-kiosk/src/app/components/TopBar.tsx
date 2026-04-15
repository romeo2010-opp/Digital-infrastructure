import { useFuelStore } from "../store/fuelStore";
import { useKioskTheme } from "./KioskThemeContext";

interface TopBarProps {
  currentTime: Date;
}

export function TopBar({ currentTime }: TopBarProps) {
  const { stationName, isOnline, isHydrating, syncError, hasLoaded, hybridPilotQueue } = useFuelStore();
  const { isNightTheme } = useKioskTheme();

  const signalState = !isOnline || syncError
    ? {
        value: "Offline",
        detail: "Network unavailable",
        tone: "offline" as const,
      }
    : isHydrating && hasLoaded
      ? {
          value: "Refreshing",
          detail: "Sync in progress",
          tone: "warning" as const,
        }
      : isHydrating
        ? {
            value: "Connecting",
            detail: "Loading station data",
            tone: "warning" as const,
          }
        : {
            value: "Online",
            detail: "Live network",
            tone: "online" as const,
          };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const turnState = !hybridPilotQueue?.enabled
    ? {
        value: "Standard Queue",
        detail: "Hybrid mode not enabled",
        tone: "default" as const,
      }
    : hybridPilotQueue.digitalHoldActive
      ? {
          value: "Digital Queue",
          detail:
            hybridPilotQueue.currentNextAssignmentTarget?.source === "RESERVATION"
              ? "Reservation has the next controllable slot"
              : hybridPilotQueue.currentNextAssignmentTarget?.source === "READY_NOW_APP"
                ? "Ready-now app user has the next slot"
                : "SmartLink driver has the next turn",
          tone: "warning" as const,
        }
      : {
          value: "Walk-in Turn",
          detail: "Pilot pump is open to walk-ins",
          tone: "info" as const,
        };

  return (
    <div className="grid gap-5 lg:grid-cols-4">
      <SummaryCard label="Station Name" value={stationName} isNightTheme={isNightTheme} />
      <SummaryCard
        label="Time"
        value={formatTime(currentTime)}
        valueClassName="font-semibold tracking-[0.08em]"
        isNightTheme={isNightTheme}
      />
      <SummaryCard
        label="Turn"
        value={turnState.value}
        detail={turnState.detail}
        tone={turnState.tone}
        isNightTheme={isNightTheme}
      />
      <SummaryCard
        label="Signal"
        value={signalState.value}
        detail={signalState.detail}
        tone={signalState.tone}
        isNightTheme={isNightTheme}
      />
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "online" | "warning" | "offline" | "info";
  valueClassName?: string;
  isNightTheme: boolean;
}

function SummaryCard({
  label,
  value,
  detail,
  tone = "default",
  valueClassName = "",
  isNightTheme,
}: SummaryCardProps) {
  const toneClass =
    tone === "online"
      ? isNightTheme
        ? "border-[#1d4d35] bg-[#0f2218] shadow-[0_12px_28px_rgba(3,18,10,0.3)]"
        : "border-[#cfe9d7] bg-[#eff9f2] shadow-[0_10px_26px_rgba(21,128,61,0.08)]"
      : tone === "info"
        ? isNightTheme
          ? "border-[#294057] bg-[#122233] shadow-[0_12px_28px_rgba(8,18,31,0.3)]"
          : "border-[#d4e1e8] bg-[#eef4f8] shadow-[0_10px_26px_rgba(53,81,109,0.08)]"
      : tone === "warning"
        ? isNightTheme
          ? "border-[#5b4733] bg-[#21180f] shadow-[0_12px_28px_rgba(28,18,8,0.3)]"
          : "border-[#edd8c3] bg-[#fff7ef] shadow-[0_10px_26px_rgba(180,83,9,0.08)]"
        : tone === "offline"
          ? isNightTheme
            ? "border-[#533a2b] bg-[#221913] shadow-[0_12px_28px_rgba(29,13,10,0.3)]"
            : "border-[#eadfd6] bg-[#faf5f0] shadow-[0_10px_26px_rgba(153,27,27,0.08)]"
          : isNightTheme
            ? "border-[#213243] bg-[#0f1b28] shadow-[0_12px_28px_rgba(0,0,0,0.28)]"
            : "border-[#d9e1ea] bg-[#f8fafc] shadow-[0_10px_26px_rgba(15,23,42,0.05)]";
  const valueToneClass =
    tone === "online"
      ? isNightTheme ? "text-[#86efac]" : "text-[#15803d]"
      : tone === "info"
        ? isNightTheme ? "text-[#c8d7e5]" : "text-[#35516d]"
      : tone === "warning"
        ? isNightTheme ? "text-[#f7c58b]" : "text-[#b45309]"
        : tone === "offline"
          ? isNightTheme ? "text-[#f0b4a8]" : "text-[#b42318]"
          : isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]";
  const detailToneClass =
    tone === "online"
      ? isNightTheme ? "text-[#6dd39b]" : "text-[#2f855a]"
      : tone === "info"
        ? isNightTheme ? "text-[#9fb6cb]" : "text-[#54728f]"
      : tone === "warning"
        ? isNightTheme ? "text-[#d8b189]" : "text-[#9a6d46]"
        : tone === "offline"
          ? isNightTheme ? "text-[#d2ad8f]" : "text-[#8b5e3c]"
          : isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]";

  return (
    <section
      className={`rounded-[20px] border px-8 py-5 text-center transition-all duration-300 ease-out ${toneClass}`}
    >
      <div
        className={`text-[0.94rem] font-semibold uppercase tracking-[0.12em] ${
          isNightTheme ? "text-[#7f94a8]" : "text-[#5f6b7a]"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-2 text-[1.9rem] font-semibold leading-tight transition-all duration-300 ease-out ${valueToneClass} ${valueClassName}`}
      >
        {value}
      </div>
      {detail ? (
        <div className={`mt-2 text-sm font-medium transition-all duration-300 ease-out ${detailToneClass}`}>
          {detail}
        </div>
      ) : null}
    </section>
  )
}
