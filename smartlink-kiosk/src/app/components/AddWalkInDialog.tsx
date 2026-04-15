import { useState } from "react";
import { UserPlus } from "lucide-react";
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
import { useFuelStore } from "../store/fuelStore";
import { useKioskTheme } from "./KioskThemeContext";
import { toast } from "sonner";
import { kioskApi } from "../api/kioskApi";
import { useKioskOperations } from "../hooks/useKioskOperations";

interface AddWalkInDialogProps {
  triggerLabel?: string;
  triggerClassName?: string;
}

export function AddWalkInDialog({
  triggerLabel = "Add Walk-in",
  triggerClassName = "h-10 w-full bg-[#16324f] text-white font-semibold uppercase tracking-wider text-xs hover:bg-[#10273e] sm:w-auto",
}: AddWalkInDialogProps) {
  const { isNightTheme } = useKioskTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [fuelType, setFuelType] = useState<"petrol" | "diesel">("petrol");
  const [litres, setLitres] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { addToQueue, isApiMode } = useFuelStore();
  const { refreshData } = useKioskOperations();

  const handleSubmit = async () => {
    if (!customerName.trim()) {
      toast.error("Please enter customer name or ID");
      return;
    }

    if (!isApiMode && (!litres || parseFloat(litres) <= 0)) {
      toast.error("Please enter valid litres");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isApiMode) {
        await kioskApi.joinQueue({
          fuelType: fuelType.toUpperCase() as "PETROL" | "DIESEL",
          maskedPlate: customerName.trim(),
        });
        await refreshData({ silent: true });
        toast.success(`Walk-in customer ${customerName} added to live queue`);
      } else {
        addToQueue({
          userType: "walkin",
          walkinId: customerName.trim(),
          fuelType,
          requestedLitres: parseFloat(litres),
          waitTime: "0m",
          status: "READY",
        });
        toast.success(`Walk-in customer ${customerName} added to queue`);
      }

      setCustomerName("");
      setLitres("");
      setFuelType("petrol");
      setIsOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add walk-in customer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className={triggerClassName}>
          <UserPlus className="w-4 h-4 mr-2" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={`w-[calc(100vw-2rem)] max-w-md border text-[#0f172a] shadow-[0_20px_48px_rgba(15,23,42,0.14)] sm:w-full ${
          isNightTheme
            ? "border-[#213243] bg-[#0d1722] text-[#ecf3fb]"
            : "border-[#d7dee7] bg-[#f8fafc] text-[#0f172a]"
        }`}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-tight">Add Walk-in Customer</DialogTitle>
          <DialogDescription className={isNightTheme ? "text-[#8ea1b5]" : "text-[#64748b]"}>
            {isApiMode
              ? "Add a walk-in customer to the live station queue. Requested litres can be confirmed during authorization."
              : "Manually add a walk-in customer to the queue"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div>
            <Label className={`mb-2 block text-sm font-semibold uppercase tracking-[0.08em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#475569]"}`}>
              Customer Name/ID *
            </Label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter name or ID"
              className={`h-12 ${
                isNightTheme
                  ? "border-[#294057] bg-[#111d2a] text-[#ecf3fb] placeholder:text-[#60778d]"
                  : "border-[#d7dee7] bg-white text-[#0f172a] placeholder:text-[#94a3b8]"
              }`}
            />
          </div>

          <div>
            <Label className={`mb-2 block text-sm font-semibold uppercase tracking-[0.08em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#475569]"}`}>
              Fuel Type *
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <button
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

          {!isApiMode ? (
            <div>
              <Label className={`mb-2 block text-sm font-semibold uppercase tracking-[0.08em] ${isNightTheme ? "text-[#8ea1b5]" : "text-[#475569]"}`}>
                Requested Litres *
              </Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={litres}
                onChange={(e) => setLitres(e.target.value)}
                placeholder="Enter litres"
                className={`h-12 ${
                  isNightTheme
                    ? "border-[#294057] bg-[#111d2a] text-[#ecf3fb] placeholder:text-[#60778d]"
                    : "border-[#d7dee7] bg-white text-[#0f172a] placeholder:text-[#94a3b8]"
                }`}
              />
            </div>
          ) : (
            <div
              className={`rounded-[14px] border px-4 py-3 text-sm ${
                isNightTheme
                  ? "border-[#294057] bg-[#111d2a] text-[#9ab0c5]"
                  : "border-[#d7dee7] bg-white text-[#64748b]"
              }`}
            >
              This creates the walk-in queue entry now. Litres and amount can be confirmed after selecting the customer.
            </div>
          )}

          <Button
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className={`h-13 w-full text-white font-semibold uppercase tracking-[0.08em] ${
              isNightTheme ? "bg-[#35516d] hover:bg-[#3f6486]" : "bg-[#16324f] hover:bg-[#10273e]"
            } ${isSubmitting ? "cursor-not-allowed opacity-70" : ""}`}
          >
            {isSubmitting ? "Adding..." : "Add to Queue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
