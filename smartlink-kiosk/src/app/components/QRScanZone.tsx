import { QrCode } from "lucide-react";

export function QRScanZone() {
  return (
    <div className="bg-[#0D2847] border-t border-[#1a3a5c] px-4 py-3 md:px-6">
      <div className="flex flex-col items-center justify-center gap-3 text-center text-slate-400 sm:flex-row sm:text-left">
        <QrCode className="h-7 w-7 md:h-8 md:w-8" />
        <div className="min-w-0">
          <div className="text-white text-sm font-semibold uppercase tracking-wider">
            Scan Customer QR Code
          </div>
          <div className="mt-0.5 break-words text-xs">Point camera at customer's SmartLink QR code to add to queue</div>
        </div>
        <div className="flex h-16 w-16 shrink-0 items-center justify-center border-2 border-dashed border-slate-600 md:h-20 md:w-20">
          <QrCode className="h-10 w-10 text-slate-600 md:h-12 md:w-12" />
        </div>
      </div>
    </div>
  );
}
