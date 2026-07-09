import React, { useRef } from "react";

/**
 * FeeReceipt — SmartLink Schools
 * -------------------------------------------------
 * Bursar-issued fee payment receipt.
 * Design system: navy/teal, DM Mono (data), Inter (UI text).
 * "Bloomberg Terminal meets university registrar."
 *
 * Structural device: the receipt is one document with a perforated
 * tear-line, matching how bursars actually work — parent keeps the
 * original (top), the office retains a duplicate stub (bottom) with
 * the same figures for reconciliation. Not decorative; both halves
 * carry the same legal weight.
 *
 * Drop-in usage:
 *   <FeeReceipt
 *     school={{ name, address, phone, motto }}
 *     receipt={{ number, date, term, academicYear }}
 *     student={{ name, studentId, grade, class }}
 *     items={[{ label, amount }]}
 *     payment={{ method, reference, amountPaid, balanceBrought, balanceCarried }}
 *     bursar={{ name }}
 *   />
 */

const fmtMWK = (n: any) =>
  "MK " +
  Number(n || 0).toLocaleString("en-MW", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const numberToWords = (num: any) => {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const chunk = (n: number) => {
    let s = "";
    if (n >= 100) {
      s += ones[Math.floor(n / 100)] + " Hundred ";
      n %= 100;
    }
    if (n >= 20) {
      s += tens[Math.floor(n / 10)] + " ";
      n %= 10;
      s += ones[n] ? ones[n] + " " : "";
    } else if (n >= 10) {
      s += teens[n - 10] + " ";
    } else if (n > 0) {
      s += ones[n] + " ";
    }
    return s;
  };

  let n = Math.floor(Number(num || 0));
  if (n === 0) return "Zero Kwacha Only";
  const millions = Math.floor(n / 1000000);
  const thousands = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;

  let out = "";
  if (millions) out += chunk(millions) + "Million ";
  if (thousands) out += chunk(thousands) + "Thousand ";
  if (rest) out += chunk(rest);

  return out.trim() + " Kwacha Only";
};

function ReceiptHalf({ copyLabel, school, receipt, student, items, payment, bursar, total }: any) {
  const isPartial = Number(payment.balanceCarried || 0) > 0;

  return (
    <div className="sl-half">
      <div className="sl-copylabel">{copyLabel}</div>

      {/* Header */}
      <div className="sl-header">
        <div className="sl-school">
          <div className="sl-schoolname">{school.name}</div>
          <div className="sl-schoolmeta">{school.address}</div>
          <div className="sl-schoolmeta">{school.phone}</div>
        </div>
        <div className="sl-receiptid">
          <div className="sl-label">RECEIPT NO.</div>
          <div className="sl-receiptno">{receipt.number}</div>
          <div className="sl-label" style={{ marginTop: 6 }}>DATE</div>
          <div className="sl-mono">{receipt.date}</div>
        </div>
      </div>

      <div className="sl-rule" />

      {/* Student / term block */}
      <div className="sl-grid3">
        <div>
          <div className="sl-label">STUDENT</div>
          <div className="sl-value">{student.name}</div>
        </div>
        <div>
          <div className="sl-label">STUDENT ID</div>
          <div className="sl-value sl-mono">{student.studentId}</div>
        </div>
        <div>
          <div className="sl-label">CLASS</div>
          <div className="sl-value">{student.grade}{student.class ? ` – ${student.class}` : ""}</div>
        </div>
        <div>
          <div className="sl-label">TERM</div>
          <div className="sl-value">{receipt.term}</div>
        </div>
        <div>
          <div className="sl-label">ACADEMIC YEAR</div>
          <div className="sl-value">{receipt.academicYear}</div>
        </div>
        <div>
          <div className="sl-label">PAYMENT METHOD</div>
          <div className="sl-value">{payment.method}</div>
        </div>
      </div>

      <div className="sl-rule" />

      {/* Ledger */}
      <table className="sl-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>DESCRIPTION</th>
            <th style={{ textAlign: "right" }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it: any, i: number) => (
            <tr key={i}>
              <td>{it.label}</td>
              <td className="sl-mono" style={{ textAlign: "right" }}>{fmtMWK(it.amount)}</td>
            </tr>
          ))}
          {payment.balanceBrought ? (
            <tr>
              <td className="sl-muted">Balance brought forward</td>
              <td className="sl-mono sl-muted" style={{ textAlign: "right" }}>
                {fmtMWK(payment.balanceBrought)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="sl-rule" />

      {/* Totals */}
      <div className="sl-totals">
        <div className="sl-totalrow sl-totalrow-main">
          <span>AMOUNT PAID</span>
          <span className="sl-mono">{fmtMWK(payment.amountPaid)}</span>
        </div>
        <div className="sl-totalrow">
          <span className="sl-muted">Balance carried forward</span>
          <span className="sl-mono sl-muted">{fmtMWK(payment.balanceCarried)}</span>
        </div>
        <div className="sl-inwords">
          <span className="sl-label">IN WORDS</span> {numberToWords(payment.amountPaid)}
        </div>
      </div>

      {/* Footer */}
      <div className="sl-footer">
        <div className="sl-sign">
          <div className="sl-signline" />
          <div className="sl-label">BURSAR — {bursar.name}</div>
        </div>
        <div className={`sl-stamp${isPartial ? " partial" : ""}`}>{isPartial ? "PARTIAL" : "PAID"}</div>
      </div>

      <div className="sl-ref">
        Ref: {payment.reference} &nbsp;·&nbsp; Issued via SmartLink Schools
      </div>
    </div>
  );
}

export default function FeeReceipt({
  school,
  receipt,
  student,
  items,
  payment,
  bursar,
  onDownloadPdf,
  downloadPending = false,
}: any) {
  const printRef = useRef<HTMLDivElement | null>(null);
  const total = items.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);

  const handlePrint = () => window.print();

  return (
    <div className="sl-wrap">
      <style>{`
        .sl-wrap {
          --navy: #0B1E33;
          --navy-soft: #142C46;
          --teal: #0F6E6A;
          --teal-soft: #E4F1F0;
          --paper: #FAF8F3;
          --ink: #14181F;
          --muted: #6B7280;
          --line: #D8D2C4;
          font-family: 'Inter', sans-serif;
          color: var(--ink);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 24px 12px;
        }

        .sl-actions {
          display: flex;
          gap: 10px;
        }
        .sl-btn {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.02em;
          padding: 9px 16px;
          border-radius: 4px;
          border: 1px solid var(--navy);
          background: var(--navy);
          color: #fff;
          cursor: pointer;
        }
        .sl-btn.secondary {
          background: transparent;
          color: var(--navy);
        }
        .sl-btn:disabled {
          cursor: progress;
          opacity: 0.62;
        }

        .sl-doc {
          width: 100%;
          max-width: 460px;
          background: var(--paper);
          border: 1px solid var(--line);
          box-shadow: 0 1px 3px rgba(11,30,51,0.08), 0 8px 24px rgba(11,30,51,0.06);
          position: relative;
        }

        .sl-half {
          padding: 22px 22px 18px;
          position: relative;
        }

        .sl-copylabel {
          position: absolute;
          top: 10px;
          right: 22px;
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.14em;
          color: var(--muted);
          text-transform: uppercase;
        }

        .sl-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-right: 70px;
        }
        .sl-schoolname {
          font-weight: 700;
          font-size: 15px;
          color: var(--navy);
          line-height: 1.25;
        }
        .sl-schoolmeta {
          font-size: 11px;
          color: var(--muted);
          margin-top: 2px;
        }
        .sl-receiptid {
          text-align: right;
        }
        .sl-receiptno {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          color: var(--teal);
          font-weight: 500;
        }

        .sl-rule {
          border: none;
          border-top: 1px dashed var(--line);
          margin: 14px 0;
        }

        .sl-grid3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px 10px;
        }
        .sl-label {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          color: var(--muted);
          text-transform: uppercase;
          margin-bottom: 3px;
        }
        .sl-value {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--ink);
        }
        .sl-mono {
          font-family: 'DM Mono', monospace;
        }
        .sl-muted {
          color: var(--muted);
          font-weight: 400;
        }

        .sl-table {
          width: 100%;
          border-collapse: collapse;
        }
        .sl-table th {
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          color: var(--muted);
          text-align: left;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--line);
        }
        .sl-table td {
          font-size: 12.5px;
          padding: 6px 0;
          border-bottom: 1px solid var(--line);
        }

        .sl-totals {
          margin-top: 4px;
        }
        .sl-totalrow {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          padding: 3px 0;
        }
        .sl-totalrow-main {
          background: var(--teal-soft);
          margin: 0 -22px;
          padding: 10px 22px;
          font-weight: 700;
          font-size: 14px;
          color: var(--navy);
        }
        .sl-totalrow-main .sl-mono {
          font-size: 15px;
          color: var(--teal);
        }
        .sl-inwords {
          font-size: 10.5px;
          color: var(--muted);
          margin-top: 8px;
          font-style: italic;
        }

        .sl-footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 22px;
        }
        .sl-signline {
          width: 140px;
          border-top: 1px solid var(--ink);
          margin-bottom: 4px;
        }
        .sl-stamp {
          font-family: 'DM Mono', monospace;
          font-weight: 500;
          font-size: 13px;
          letter-spacing: 0.18em;
          color: var(--teal);
          border: 2px solid var(--teal);
          border-radius: 3px;
          padding: 4px 12px;
          transform: rotate(-6deg);
        }
        .sl-stamp.partial {
          color: #B45309;
          border-color: #B45309;
        }

        .sl-ref {
          margin-top: 14px;
          font-family: 'DM Mono', monospace;
          font-size: 9px;
          color: var(--muted);
          text-align: center;
        }

        /* Perforated tear line between the two halves */
        .sl-tear {
          position: relative;
          height: 0;
          border-top: 1.5px dashed #B7AF9C;
        }
        .sl-tear::before, .sl-tear::after {
          content: "";
          position: absolute;
          top: -7px;
          width: 14px;
          height: 14px;
          background: #fff;
          border-radius: 50%;
        }
        .sl-tear::before { left: -7px; }
        .sl-tear::after { right: -7px; }
        .sl-scissors {
          position: absolute;
          left: 50%;
          top: -8px;
          transform: translateX(-50%);
          background: var(--paper);
          font-size: 10px;
          color: #B7AF9C;
          padding: 0 6px;
          font-family: 'DM Mono', monospace;
        }

        @page {
          size: 130mm 285mm;
          margin: 0;
        }
        @media print {
          html, body { margin: 0; padding: 0; }
          .sl-actions { display: none; }
          .sl-wrap { padding: 0; }
          .sl-doc {
            width: 130mm;
            max-width: 130mm;
            margin: 0 auto;
            box-shadow: none;
            border: none;
          }
          .sl-half {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .sl-tear {
            break-inside: avoid;
          }
        }
      `}</style>

      <div className="sl-actions">
        {onDownloadPdf ? (
          <button className="sl-btn secondary" onClick={onDownloadPdf} disabled={downloadPending}>
            {downloadPending ? "Preparing PDF..." : "Download PDF"}
          </button>
        ) : null}
        <button className="sl-btn" onClick={handlePrint}>Print receipt</button>
      </div>

      <div className="sl-doc" ref={printRef}>
        <ReceiptHalf
          copyLabel="Parent copy"
          school={school}
          receipt={receipt}
          student={student}
          items={items}
          payment={payment}
          bursar={bursar}
          total={total}
        />

        <div className="sl-tear">
          <span className="sl-scissors">✂ — OFFICE COPY BELOW — ✂</span>
        </div>

        <ReceiptHalf
          copyLabel="Office copy"
          school={school}
          receipt={receipt}
          student={student}
          items={items}
          payment={payment}
          bursar={bursar}
          total={total}
        />
      </div>
    </div>
  );
}
