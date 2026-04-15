import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Label } from "./ui/label";
import { toast } from "sonner";

const ISSUE_REASONS = [
  "No fuel dispensed",
  "Wrong litres dispensed",
  "Pump error/malfunction",
  "Customer payment issue",
  "Equipment failure",
  "Safety concern",
  "Other",
];

export function ReportIssueButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState("");

  const handleSubmit = () => {
    if (!selectedReason) {
      toast.error("Please select an issue reason");
      return;
    }

    toast.success(`Issue reported: ${selectedReason}`);
    setSelectedReason("");
    setIsOpen(false);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button className="fixed bottom-4 right-4 z-50 h-12 w-[calc(100%-2rem)] justify-center bg-red-600 px-4 text-sm font-bold uppercase tracking-wider text-white shadow-lg hover:bg-red-700 sm:w-auto sm:px-6 md:bottom-6 md:right-6 md:h-14">
            <AlertTriangle className="w-5 h-5 mr-2" />
            Report Issue
          </Button>
        </DialogTrigger>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md bg-[#0D2847] border-2 border-[#1a3a5c] text-white sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-xl uppercase tracking-wider">Report Issue</DialogTitle>
            <DialogDescription className="text-slate-400">
              Select the type of issue you're experiencing
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div>
              <Label className="text-sm uppercase tracking-wide text-slate-300 mb-3 block">
                Issue Reason
              </Label>
              <div className="space-y-2">
                {ISSUE_REASONS.map((reason) => (
                  <button
                    key={reason}
                    onClick={() => setSelectedReason(reason)}
                    className={`w-full text-left px-4 py-3 border transition-colors ${
                      selectedReason === reason
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-[#0f2d4a] border-[#1a3a5c] text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    <span className="font-medium">{reason}</span>
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleSubmit}
              className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-wider"
            >
              Submit Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
