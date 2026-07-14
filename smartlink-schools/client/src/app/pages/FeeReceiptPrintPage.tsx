import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import FeeReceipt from "../components/FeeReceipt";
import { Button } from "../components/ui/button";
import { SmartLinkLoadingState } from "../components/SmartLinkLoadingState";
import { PageBackButton } from "../components/PageBackButton";
import { usePortal } from "../lib/portalContext";

function safeReceiptFilename(value: any) {
  return String(value || "receipt")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "receipt";
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function FeeReceiptPrintPage() {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const { token, api } = usePortal();
  const [payload, setPayload] = useState<any>(null);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token || !paymentId) return;
    let active = true;
    setError("");
    api.getPaymentReceipt(token, paymentId)
      .then((data: any) => {
        if (active) setPayload(data);
      })
      .catch((err: any) => {
        if (active) setError(err?.message || "Unable to load receipt.");
      });
    return () => {
      active = false;
    };
  }, [api, paymentId, token]);

  const downloadPdf = async () => {
    if (!token || !paymentId || downloading) return;
    setDownloading(true);
    setDownloadError("");
    try {
      const blob = await api.downloadPaymentReceiptPdf(token, paymentId);
      const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      downloadBlob(`fee-receipt-${safeReceiptFilename(payload?.receipt?.number)}.pdf`, pdfBlob);
    } catch (err: any) {
      setDownloadError(err?.message || "Unable to download receipt PDF.");
    } finally {
      setDownloading(false);
    }
  };

  if (error) {
    return (
      <div className="grid min-h-full place-items-center bg-[#f8fafc] p-6">
        <section className="w-full max-w-lg rounded-[8px] border border-[#fecaca] bg-white p-5 shadow-sm">
          <div className="text-[14px] font-semibold text-[#b91c1c]">{error}</div>
          <PageBackButton fallback="/fees/receipts" label="Back to receipts" className="mt-4" />
        </section>
      </div>
    );
  }

  if (!payload) {
    return <div className="p-6"><SmartLinkLoadingState label="Loading receipt..." detail="Preparing the school fee receipt." /></div>;
  }

  return (
    <div className="min-h-full bg-[#eef2f7] print:bg-white">
      <div className="mx-auto flex max-w-[620px] items-center justify-between px-4 py-3 print:hidden">
        <PageBackButton fallback="/fees/receipts" label="Back to receipts" />
      </div>
      {downloadError ? (
        <div className="mx-auto mb-3 max-w-[620px] rounded-[6px] border border-[#fecaca] bg-white px-3 py-2 text-[12px] font-semibold text-[#b91c1c] print:hidden">
          {downloadError}
        </div>
      ) : null}
      <FeeReceipt
        school={payload.school}
        receipt={payload.receipt}
        student={payload.student}
        items={payload.items}
        payment={payload.payment}
        bursar={payload.bursar}
        onDownloadPdf={downloadPdf}
        downloadPending={downloading}
      />
    </div>
  );
}
