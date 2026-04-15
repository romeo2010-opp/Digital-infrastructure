import { useFuelStore } from "../store/fuelStore";
import { Droplets } from "lucide-react";

export function PumpStatusPanel() {
  const { pumps } = useFuelStore();

  const getStatusColor = (status: string) => {
    switch (status) {
      case "idle":
        return "bg-green-600";
      case "dispensing":
        return "bg-blue-600";
      case "offline":
        return "bg-red-600";
      default:
        return "bg-slate-600";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "idle":
        return "IDLE";
      case "dispensing":
        return "DISPENSING";
      case "offline":
        return "OFFLINE";
      default:
        return "UNKNOWN";
    }
  };

  return (
    <div className="bg-[#0D2847] border border-[#1a3a5c] flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="border-b border-[#1a3a5c] px-4 py-3">
        <h2 className="text-base text-white font-semibold uppercase tracking-wider md:text-lg">
          Pump Status
        </h2>
        <div className="text-slate-400 text-sm mt-0.5">
          {pumps.filter((p) => p.status === "idle").length} available
        </div>
      </div>

      {/* Pump Grid */}
      <div className="flex-1 min-h-0 overflow-auto p-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {pumps.map((pump) => (
            <div
              key={pump.id}
              className="bg-[#0f2d4a] border border-[#1a3a5c] p-4 hover:border-slate-600 transition-colors"
            >
              {/* Pump ID */}
              <div className="mb-2 text-lg text-white font-bold md:text-xl">
                PUMP {pump.id}
              </div>

              {/* Fuel Types */}
              <div className="flex gap-1.5 mb-3">
                {pump.fuelTypes.map((fuel) => (
                  <span
                    key={fuel}
                    className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 uppercase font-medium tracking-wide"
                  >
                    {fuel}
                  </span>
                ))}
              </div>

              {/* Status Badge */}
              <div className={`${getStatusColor(pump.status)} px-3 py-1.5 mb-3`}>
                <div className="text-white text-xs font-bold uppercase tracking-wider text-center">
                  {getStatusText(pump.status)}
                </div>
              </div>

              {/* Live Counter (if dispensing) */}
              {pump.status === "dispensing" && pump.currentLitres !== undefined && (
                <div className="bg-blue-900/30 border border-blue-600 p-3 mt-2">
                  <div className="flex items-center justify-center gap-2">
                    <Droplets className="w-4 h-4 text-blue-400" />
                    <span className="text-blue-400 text-lg font-bold font-mono">
                      {pump.currentLitres.toFixed(2)}L
                    </span>
                  </div>
                  {pump.currentCustomer && (
                    <div className="text-blue-400 text-xs text-center mt-1 truncate">
                      {pump.currentCustomer}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
