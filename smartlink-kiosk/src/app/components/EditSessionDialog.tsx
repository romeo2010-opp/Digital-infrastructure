import { useEffect, useState } from "react";
import { Delete, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { useKioskOperations } from "../hooks/useKioskOperations";
import { useFuelStore, type FuelType } from "../store/fuelStore";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useKioskTheme } from "./KioskThemeContext";

function deriveModeFromSession(amount?: number, litres?: number) {
  if (typeof amount === "number" && amount > 0) return "amount";
  if (typeof litres === "number" && litres > 0) return "litres";
  return "amount";
}

function formatKeypadDisplay(mode: "amount" | "litres", value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return mode === "amount" ? "MWK 0" : "0.0 L";
  }

  if (mode === "amount") {
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return "MWK 0";
    return `MWK ${amount.toLocaleString()}`;
  }

  return `${normalized} L`;
}

const AMOUNT_PRESETS = ["5000", "10000", "15000", "20000"];
const LITRE_PRESETS = ["5", "10", "20", "40"];
const NUMPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface EditSessionDialogProps {
  autoOpenKey?: string | null
}

export function EditSessionDialog({ autoOpenKey = null }: EditSessionDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { activeSession, updateActiveSession } = useFuelStore();
  const { updateCurrentSessionDetails } = useKioskOperations();
  const { isNightTheme } = useKioskTheme();
  const [fuelType, setFuelType] = useState<FuelType>("petrol");
  const [vehicleLabel, setVehicleLabel] = useState("");
  const [requestMode, setRequestMode] = useState<"amount" | "litres">("amount");
  const [requestedAmountMwk, setRequestedAmountMwk] = useState("");
  const [requestedLitres, setRequestedLitres] = useState("");

  useEffect(() => {
    if (!isOpen || !activeSession) return;
    setFuelType(activeSession.fuelType);
    setVehicleLabel(activeSession.vehicleLabel || "");
    setRequestMode(deriveModeFromSession(activeSession.requestedAmountMwk, activeSession.requestedLitres));
    setRequestedAmountMwk(
      typeof activeSession.requestedAmountMwk === "number" && activeSession.requestedAmountMwk > 0
        ? String(activeSession.requestedAmountMwk)
        : ""
    );
    setRequestedLitres(
      typeof activeSession.requestedLitres === "number" && activeSession.requestedLitres > 0
        ? String(activeSession.requestedLitres)
        : ""
    );
  }, [activeSession, isOpen]);

  useEffect(() => {
    if (!autoOpenKey) return
    setIsOpen(true)
  }, [autoOpenKey])

  if (!activeSession) return null;

  const activeNumericValue = requestMode === "amount" ? requestedAmountMwk : requestedLitres;
  const setActiveNumericValue = (nextValue: string) => {
    if (requestMode === "amount") {
      setRequestedAmountMwk(nextValue);
      return;
    }
    setRequestedLitres(nextValue);
  };

  const handleNumericKeyPress = (key: string) => {
    const currentValue = activeNumericValue;
    if (key === ".") {
      if (requestMode === "amount") return;
      if (currentValue.includes(".")) return;
      setActiveNumericValue(currentValue ? `${currentValue}.` : "0.");
      return;
    }

    const candidateValue = `${currentValue}${key}`;
    if (requestMode === "amount") {
      const normalized = candidateValue.replace(/^0+(?=\d)/, "");
      setActiveNumericValue(normalized.slice(0, 9));
      return;
    }

    setActiveNumericValue(candidateValue.slice(0, 8));
  };

  const handleNumericBackspace = () => {
    setActiveNumericValue(activeNumericValue.slice(0, -1));
  };

  const handleNumericClear = () => {
    setActiveNumericValue("");
  };

  const handlePresetSelect = (value: string) => {
    setActiveNumericValue(value);
  };

  const handleSubmit = async () => {
    const parsedAmount =
      requestMode === "amount"
        ? Number(requestedAmountMwk || 0)
        : 0;
    const parsedLitres =
      requestMode === "litres"
        ? Number(requestedLitres || 0)
        : 0;

    if (requestMode === "amount" && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      toast.error("Enter a valid MWK amount.");
      return;
    }

    if (requestMode === "litres" && (!Number.isFinite(parsedLitres) || parsedLitres <= 0)) {
      toast.error("Enter valid litres.");
      return;
    }

    const nextPayload = {
      fuelType,
      vehicleLabel: vehicleLabel.trim() || "Vehicle details pending",
      requestedAmountMwk: requestMode === "amount" ? parsedAmount : undefined,
      requestedLitres: requestMode === "litres" ? parsedLitres : undefined,
    };

    setIsSubmitting(true);
    try {
      await updateCurrentSessionDetails({
        fuelType,
        vehicleLabel: nextPayload.vehicleLabel,
        amountMwk: requestMode === "amount" ? parsedAmount : undefined,
        requestedLitres: requestMode === "litres" ? parsedLitres : undefined,
      });
      updateActiveSession(nextPayload);
      toast.success("Queue session updated.");
      setIsOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update this queue session.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-2 text-sm font-medium transition ${
            isNightTheme ? "text-[#8ea1b5] hover:text-[#ecf3fb]" : "text-[#64748b] hover:text-[#0f172a]"
          }`}
        >
          <PencilLine className="h-4 w-4" />
          <span>Edit</span>
        </button>
      </DialogTrigger>
      <DialogContent
        className={`w-[calc(100vw-2rem)] max-w-md border shadow-[0_20px_48px_rgba(15,23,42,0.14)] sm:w-full ${
          isNightTheme
            ? "border-[#213243] bg-[#0d1722] text-[#ecf3fb]"
            : "border-[#d7dee7] bg-[#f8fafc] text-[#0f172a]"
        }`}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-tight">Edit Session</DialogTitle>
          <DialogDescription className={isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}>
            Update the live pump request before authorization.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div>
            <Label className={`mb-2 block text-sm font-semibold uppercase tracking-[0.08em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#475569]"}`}>
              Vehicle / Driver Note
            </Label>
            <Input
              value={vehicleLabel}
              onChange={(event) => setVehicleLabel(event.target.value)}
              placeholder="Vehicle or verification note"
              className={`h-12 ${
                isNightTheme
                  ? "border-[#294057] bg-[#111d2a] text-[#ecf3fb] placeholder:text-[#60778d]"
                  : "border-[#d7dee7] bg-white text-[#0f172a] placeholder:text-[#94a3b8]"
              }`}
            />
          </div>

          <div>
            <Label className={`mb-2 block text-sm font-semibold uppercase tracking-[0.08em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#475569]"}`}>
              Fuel Type
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFuelType("petrol")}
                className={`h-12 border-2 font-semibold uppercase tracking-wider transition-colors ${
                  fuelType === "petrol"
                    ? isNightTheme
                      ? "border-[#4a6b8b] bg-[#35516d] text-white"
                      : "border-[#16324f] bg-[#16324f] text-white"
                    : isNightTheme
                      ? "border-[#294057] bg-[#111d2a] text-[#9ab0c5] hover:border-[#4a6b8b]"
                      : "border-[#d7dee7] bg-white text-[#475569] hover:border-[#9fb0c1]"
                }`}
              >
                Petrol
              </button>
              <button
                type="button"
                onClick={() => setFuelType("diesel")}
                className={`h-12 border-2 font-semibold uppercase tracking-wider transition-colors ${
                  fuelType === "diesel"
                    ? isNightTheme
                      ? "border-[#4a6b8b] bg-[#35516d] text-white"
                      : "border-[#16324f] bg-[#16324f] text-white"
                    : isNightTheme
                      ? "border-[#294057] bg-[#111d2a] text-[#9ab0c5] hover:border-[#4a6b8b]"
                      : "border-[#d7dee7] bg-white text-[#475569] hover:border-[#9fb0c1]"
                }`}
              >
                Diesel
              </button>
            </div>
          </div>

          <div>
            <Label className={`mb-2 block text-sm font-semibold uppercase tracking-[0.08em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#475569]"}`}>
              Request Mode
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRequestMode("amount")}
                className={`h-12 border-2 font-semibold uppercase tracking-wider transition-colors ${
                  requestMode === "amount"
                    ? isNightTheme
                      ? "border-[#4a6b8b] bg-[#35516d] text-white"
                      : "border-[#16324f] bg-[#16324f] text-white"
                    : isNightTheme
                      ? "border-[#294057] bg-[#111d2a] text-[#9ab0c5] hover:border-[#4a6b8b]"
                      : "border-[#d7dee7] bg-white text-[#475569] hover:border-[#9fb0c1]"
                }`}
              >
                Amount
              </button>
              <button
                type="button"
                onClick={() => setRequestMode("litres")}
                className={`h-12 border-2 font-semibold uppercase tracking-wider transition-colors ${
                  requestMode === "litres"
                    ? isNightTheme
                      ? "border-[#4a6b8b] bg-[#35516d] text-white"
                      : "border-[#16324f] bg-[#16324f] text-white"
                    : isNightTheme
                      ? "border-[#294057] bg-[#111d2a] text-[#9ab0c5] hover:border-[#4a6b8b]"
                      : "border-[#d7dee7] bg-white text-[#475569] hover:border-[#9fb0c1]"
                }`}
              >
                Litres
              </button>
            </div>
          </div>

          <div>
            <Label className={`mb-2 block text-sm font-semibold uppercase tracking-[0.08em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#475569]"}`}>
              {requestMode === "amount" ? "Requested Amount (MWK)" : "Requested Litres"}
            </Label>

            <div
              className={`rounded-[18px] border px-4 py-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${
                isNightTheme ? "border-[#294057] bg-[#111d2a]" : "border-[#d7dee7] bg-[#16324f]"
              }`}
            >
              <div className={`text-[0.72rem] font-semibold uppercase tracking-[0.16em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#9fb0c1]"}`}>
                {requestMode === "amount" ? "Amount Entry" : "Litre Entry"}
              </div>
              <div className={`mt-2 text-[1.8rem] font-semibold tracking-[0.04em] ${isNightTheme ? "text-[#ecf3fb]" : "text-white"}`}>
                {formatKeypadDisplay(requestMode, activeNumericValue)}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {(requestMode === "amount" ? AMOUNT_PRESETS : LITRE_PRESETS).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  className={`rounded-[12px] border px-3 py-3 text-sm font-semibold transition ${
                    isNightTheme
                      ? "border-[#294057] bg-[#111d2a] text-[#c8d7e5] hover:bg-[#162434]"
                      : "border-[#d7dee7] bg-white text-[#16324f] hover:bg-[#f1f5f9]"
                  }`}
                >
                  {requestMode === "amount" ? `MWK ${Number(preset).toLocaleString()}` : `${preset}L`}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {NUMPAD_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleNumericKeyPress(key)}
                  className={`rounded-[14px] border px-4 py-4 text-lg font-semibold transition ${
                    isNightTheme
                      ? "border-[#294057] bg-[#111d2a] text-[#ecf3fb] shadow-[0_4px_10px_rgba(0,0,0,0.16)] hover:bg-[#162434]"
                      : "border-[#d7dee7] bg-white text-[#0f172a] shadow-[0_4px_10px_rgba(15,23,42,0.03)] hover:bg-[#f8fafc]"
                  }`}
                >
                  {key}
                </button>
              ))}

              <button
                type="button"
                onClick={handleNumericClear}
                className={`rounded-[14px] border px-4 py-4 text-sm font-semibold uppercase tracking-[0.08em] transition ${
                  isNightTheme
                    ? "border-[#533a2b] bg-[#221913] text-[#d2ad8f] hover:bg-[#2b2019]"
                    : "border-[#e2d6ca] bg-[#faf5f0] text-[#8b5e3c] hover:bg-[#f5ece4]"
                }`}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => handleNumericKeyPress(requestMode === "amount" ? "0" : ".")}
                className={`rounded-[14px] border px-4 py-4 text-lg font-semibold transition ${
                  isNightTheme
                    ? "border-[#294057] bg-[#111d2a] text-[#ecf3fb] shadow-[0_4px_10px_rgba(0,0,0,0.16)] hover:bg-[#162434]"
                    : "border-[#d7dee7] bg-white text-[#0f172a] shadow-[0_4px_10px_rgba(15,23,42,0.03)] hover:bg-[#f8fafc]"
                }`}
              >
                {requestMode === "amount" ? "0" : "."}
              </button>
              <button
                type="button"
                onClick={handleNumericBackspace}
                className={`flex items-center justify-center rounded-[14px] border px-4 py-4 transition ${
                  isNightTheme
                    ? "border-[#294057] bg-[#111d2a] text-[#c8d7e5] shadow-[0_4px_10px_rgba(0,0,0,0.16)] hover:bg-[#162434]"
                    : "border-[#d7dee7] bg-white text-[#16324f] shadow-[0_4px_10px_rgba(15,23,42,0.03)] hover:bg-[#f8fafc]"
                }`}
              >
                <Delete className="h-5 w-5" />
              </button>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`h-13 w-full text-white font-semibold uppercase tracking-[0.08em] ${
              isNightTheme ? "bg-[#35516d] hover:bg-[#3f6486]" : "bg-[#16324f] hover:bg-[#10273e]"
            }`}
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
