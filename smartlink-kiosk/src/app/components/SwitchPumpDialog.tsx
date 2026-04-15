import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { useFuelStore, type FuelType } from "../store/fuelStore";
import { toast } from "sonner";
import { useKioskOperations } from "../hooks/useKioskOperations";
import { useKioskTheme } from "./KioskThemeContext";

interface SwitchPumpDialogProps {
  currentPump?: number | null;
  fuelType: FuelType;
}

export function SwitchPumpDialog({ currentPump, fuelType }: SwitchPumpDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { pumps, switchPump } = useFuelStore();
  const { refreshData } = useKioskOperations();
  const { isNightTheme } = useKioskTheme();

  const supportsFuelType = (pump: (typeof pumps)[number]) =>
    pump.fuelTypes.includes(fuelType)
    || pump.nozzles.some((nozzle) => nozzle.fuelType === fuelType);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const loadLatestPumps = async () => {
      setIsRefreshing(true);
      try {
        await refreshData({ silent: true });
      } catch (_error) {
        // Silent refresh keeps the picker responsive even if the latest fetch fails.
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    };

    void loadLatestPumps();

    return () => {
      cancelled = true;
    };
  }, [isOpen, refreshData]);

  const compatiblePumps = useMemo(
    () =>
      pumps
        .filter((pump) => pump.id !== currentPump && supportsFuelType(pump))
        .sort((left, right) => left.id - right.id),
    [currentPump, fuelType, pumps]
  );

  const handleSwitchPump = (pumpId: number) => {
    switchPump(pumpId);
    toast.success(`Switched to Pump ${pumpId}`);
    setIsOpen(false);
  };

  const statusLabel = (status: string) => {
    if (status === "dispensing") return "DISPENSING";
    if (status === "offline") return "OFFLINE";
    return "AVAILABLE";
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          className={`h-12 w-full rounded-[14px] border px-5 py-4 text-[1.05rem] font-semibold transition ${
            isNightTheme
              ? "border-[#294057] bg-[#111d2a] text-[#c2cfdb] shadow-[0_8px_18px_rgba(0,0,0,0.16)] hover:bg-[#162434]"
              : "border-[#d7dee7] bg-white text-[#475569] shadow-[0_8px_18px_rgba(15,23,42,0.04)] hover:bg-[#f8fafc]"
          }`}
        >
          <ArrowLeftRight className="w-5 h-5 mr-2" />
          {currentPump ? "SWITCH PUMP" : "ASSIGN PUMP"}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md bg-[#0D2847] border-2 border-[#1a3a5c] text-white sm:w-full">
        <DialogHeader>
          <DialogTitle className="text-xl uppercase tracking-wider">Switch Pump</DialogTitle>
          <DialogDescription className="text-slate-400">
            {currentPump
              ? `Select another available pump compatible with ${fuelType}`
              : `Select an available pump compatible with ${fuelType}`}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {currentPump ? (
            <div className="bg-[#0f2d4a] border border-blue-600 p-3 mb-4">
              <div className="text-blue-400 text-sm font-semibold">
                Current Pump: PUMP {currentPump}
              </div>
            </div>
          ) : null}

          {isRefreshing ? (
            <div className="text-center py-8 text-slate-400">
              Loading latest pumps from station data...
            </div>
          ) : compatiblePumps.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              No compatible pumps found for {fuelType}
            </div>
          ) : (
            <div className="space-y-2">
              {compatiblePumps.map((pump) => {
                const canSelect = pump.status === "idle";
                return (
                <button
                  key={pump.id}
                  onClick={() => canSelect ? handleSwitchPump(pump.id) : undefined}
                  disabled={!canSelect}
                  className={`w-full border p-4 text-left transition-colors ${
                    canSelect
                      ? "bg-[#0f2d4a] border-[#1a3a5c] hover:border-slate-500 hover:bg-[#1a3a5c]"
                      : "bg-[#0a2138] border-[#15314e] opacity-75 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-white font-bold text-lg mb-1">
                        PUMP {pump.id}
                      </div>
                      <div className="flex gap-1.5">
                        {pump.fuelTypes.map((fuel) => (
                          <span
                            key={fuel}
                            className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 uppercase font-medium"
                          >
                            {fuel}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className={`text-white text-xs px-3 py-1 font-bold uppercase ${
                      pump.status === "idle"
                        ? "bg-green-600"
                        : pump.status === "dispensing"
                          ? "bg-amber-600"
                          : "bg-slate-600"
                    }`}>
                      {statusLabel(pump.status)}
                    </div>
                  </div>
                  {!canSelect ? (
                    <div className="mt-2 text-xs text-slate-400">
                      This pump is visible from live station data but cannot be assigned right now.
                    </div>
                  ) : null}
                </button>
              )})}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
