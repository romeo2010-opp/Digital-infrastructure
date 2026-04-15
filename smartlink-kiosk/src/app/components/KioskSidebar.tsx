import { Smartphone, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useFuelStore } from "../store/fuelStore";
import { useKioskTheme } from "./KioskThemeContext";
import { QrMatrix } from "./QrMatrix";

export function KioskSidebar() {
  const { logout, session } = useAuth();
  const {
    attendantName,
    attendantRole,
    petrolPricePerLitre,
    dieselPricePerLitre,
    hybridPilotQueue,
    pumps,
    qrHint,
    isOnline,
  } = useFuelStore();
  const { isNightTheme } = useKioskTheme();
  const pilotPump = pumps.find((pump) => pump.publicId === hybridPilotQueue?.pilotPumpPublicId) || null;
  const pilotPumpQrImage = String(pilotPump?.qrImageDataUrl || "").trim() || null;
  const pilotPumpQrPayload = String(pilotPump?.qrPayload || "").trim() || null;

  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden border-l px-6 py-5 xl:px-8 xl:py-6 ${
        isNightTheme ? "border-[#1d2d3d] bg-[#09131d]" : "border-[#d7dee7] bg-[#f7f9fc]"
      }`}
    >
      <div
        className={`rounded-[18px] border px-4 py-4 ${
          isNightTheme
            ? "border-[#213243] bg-[#0f1b28] shadow-[0_8px_20px_rgba(0,0,0,0.2)]"
            : "border-[#d7dee7] bg-white shadow-[0_8px_20px_rgba(15,23,42,0.04)]"
        }`}
      >
        <div className={`text-[0.72rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
          {attendantRole}
        </div>
        <div className={`mt-1 text-[1rem] font-semibold leading-tight ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
          {attendantName}
        </div>
        <div className={`mt-1 text-xs ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
          {session?.station?.name || "Station scope"}
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className={`mt-4 rounded-[12px] border px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition ${
            isNightTheme
              ? "border-[#294057] bg-[#111d2a] text-[#c2cfdb] hover:bg-[#162434]"
              : "border-[#d7dee7] bg-white text-[#475569] hover:bg-[#f8fafc]"
          }`}
        >
          Sign Out
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-5">
        <div className="space-y-4">
        <p className={`mx-auto max-w-[220px] text-center text-[1rem] leading-snug ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>
          {qrHint}
        </p>
        <div className="flex justify-center">
          {pilotPumpQrImage ? (
            <div
              className={`rounded-[28px] border p-4 ${
                isNightTheme
                  ? "border-[#213243] bg-[#0f1b28] shadow-[0_10px_30px_rgba(0,0,0,0.2)]"
                  : "border-[#d7dee7] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
              }`}
            >
              <img
                src={pilotPumpQrImage}
                alt={pilotPump ? `QR code for Pump ${pilotPump.id}` : "Hybrid pump QR code"}
                className="h-[210px] w-[210px] rounded-[18px] bg-white p-3"
              />
            </div>
          ) : (
            <QrMatrix />
          )}
        </div>
        {pilotPump ? (
          <div className={`mx-auto max-w-[220px] text-center text-[0.85rem] leading-relaxed ${isNightTheme ? "text-[#9ab0c5]" : "text-[#475569]"}`}>
            Hybrid pilot pump QR ready for Pump {pilotPump.id}.
          </div>
        ) : null}
        {pilotPumpQrPayload ? (
          <div className={`mx-auto max-w-[220px] break-all text-center text-[0.7rem] leading-relaxed ${isNightTheme ? "text-[#6f879d]" : "text-[#64748b]"}`}>
            {pilotPumpQrPayload}
          </div>
        ) : null}
        <div className={`text-center text-[0.95rem] font-medium ${isNightTheme ? "text-[#9ab0c5]" : "text-[#334155]"}`}>
          Available on PlayStore &amp; Apple Store
        </div>
        </div>

        <div className="mt-6 space-y-4">
          <div
            className={`rounded-[18px] border px-5 py-4 ${
              isNightTheme
                ? "border-[#213243] bg-[#0f1b28] shadow-[0_8px_22px_rgba(0,0,0,0.2)]"
                : "border-[#d7dee7] bg-white shadow-[0_8px_22px_rgba(15,23,42,0.04)]"
            }`}
          >
            <div className={`text-[0.75rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>Petrol</div>
            <span className={`mt-2 block text-[1.2rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
              MWK {Math.round(petrolPricePerLitre).toLocaleString()} / L
            </span>
          </div>
          <div
            className={`rounded-[18px] border px-5 py-4 ${
              isNightTheme
                ? "border-[#213243] bg-[#0f1b28] shadow-[0_8px_22px_rgba(0,0,0,0.2)]"
                : "border-[#d7dee7] bg-white shadow-[0_8px_22px_rgba(15,23,42,0.04)]"
            }`}
          >
            <div className={`text-[0.75rem] font-semibold uppercase tracking-[0.14em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}`}>Diesel</div>
            <span className={`mt-2 block text-[1.2rem] font-semibold ${isNightTheme ? "text-[#ecf3fb]" : "text-[#0f172a]"}`}>
              MWK {Math.round(dieselPricePerLitre).toLocaleString()} / L
            </span>
          </div>
          <div className={`flex items-center justify-center gap-3 text-sm font-medium ${isNightTheme ? "text-[#9ab0c5]" : "text-[#475569]"}`}>
            {isOnline ? (
              <Wifi className="h-4 w-4 text-[#16a34a]" />
            ) : (
              <WifiOff className={`h-4 w-4 ${isNightTheme ? "text-[#d2ad8f]" : "text-[#8b5e3c]"}`} />
            )}
            <Smartphone className="h-4 w-4 text-[#16a34a]" />
            <span>{isOnline ? "Kiosk online" : "Kiosk offline"}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
