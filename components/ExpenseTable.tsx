"use client";

import Link from "next/link";
import { Camera } from "lucide-react";
import { formatAUD, formatCurrency, applyBp, bpToPercentString } from "@/lib/money";
import { formatDateShort } from "@/lib/fy";
import type { ExpenseDto } from "@/lib/types";

export type Row = ExpenseDto & { blocked: boolean; claimableGstCents: number };

/**
 * Decorate rows with the one fact the list is really for: whether a GST credit
 * is being forfeited. A blocked credit is the only line on the screen actively
 * costing money, so it tints its whole row and sorts to the top on a phone —
 * never collapsed behind an icon.
 */
export function decorate(rows: ExpenseDto[], flagCents: number): Row[] {
  return rows.map((e) => {
    const claimable = e.gstTreatment === "gst" ? applyBp(e.gstAmountCents, e.businessUseBp) : 0;
    const blocked =
      e.gstTreatment === "gst" && e.audAmountCents > flagCents && (e.receiptCount ?? 0) === 0;
    return { ...e, blocked, claimableGstCents: blocked ? 0 : claimable };
  });
}

function GstCell({ r }: { r: Row }) {
  if (r.gstTreatment !== "gst") return <span className="muted small">GST-free</span>;
  if (r.blocked)
    return (
      <>
        <s className="gst-forfeit">{formatAUD(applyBp(r.gstAmountCents, r.businessUseBp))}</s>
        <span className="sub danger">Blocked</span>
      </>
    );
  return (
    <>
      <span className="ok">{formatAUD(r.claimableGstCents)}</span>
      {r.businessUseBp < 10000 && <span className="sub">of {formatAUD(r.gstAmountCents)}</span>}
    </>
  );
}

function Deductible({ r }: { r: Row }) {
  const split = r.deductibleAudCents !== r.audAmountCents;
  return (
    <>
      <span>{formatAUD(r.deductibleAudCents)}</span>
      <span className={split ? "sub split" : "sub"}>
        {split ? `${bpToPercentString(r.businessUseBp)}% business` : "100%"}
      </span>
    </>
  );
}

export default function ExpenseTable({
  rows,
  categoryName,
}: {
  rows: Row[];
  categoryName: (id: string) => string;
}) {
  return (
    <div className="tablewrap exptable">
      <div className="exphead" role="row">
        <span>Date</span><span>Supplier</span><span>Category</span>
        <span className="r">Amount</span><span className="r">Deductible</span><span className="r">GST</span>
      </div>

      {rows.map((r) => (
        <div key={r.id} className={`exprow2${r.blocked ? " blocked" : ""}`}>
          <Link href={`/expenses/${r.id}`} className="exprow2-main">
            <span className="c-date">{formatDateShort(r.dateIncurred)}</span>
            <span className="c-supplier">
              {/* The name ellipsises; the pill must not be inside the clipped
                  box or it wraps and stretches to the column width. */}
              <span className="supline">
                <b>{r.supplierName}</b>
                {r.isCapital && <span className="pill capital">Capital</span>}
              </span>
              <span className="sub">{r.description}</span>
            </span>
            <span className="c-cat"><span className="pill chip">{categoryName(r.categoryId)}</span></span>
            <span className="c-amt r">
              <span>{formatAUD(r.audAmountCents)}</span>
              {r.originalCurrency !== "AUD" && (
                <span className="sub">{formatCurrency(r.originalAmountCents, r.originalCurrency)}</span>
              )}
            </span>
            <span className="c-ded r"><Deductible r={r} /></span>
            <span className="c-gst r"><GstCell r={r} /></span>
          </Link>

          {r.blocked && (
            <div className="blockedstrip">
              <span>
                No tax invoice — this GST credit cannot be claimed. The deduction of{" "}
                {formatAUD(r.deductibleAudCents)} is unaffected.
              </span>
              <Link href={`/expenses/${r.id}`} className="btn small"><Camera size={14} /> Attach now</Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
