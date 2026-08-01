"use client";

import Link from "next/link";
import { formatAUD, formatCurrency } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import type { ExpenseDto, CategoryDto } from "@/lib/types";

export default function ExpenseList({ expenses, categories }: { expenses: ExpenseDto[]; categories?: CategoryDto[] }) {
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  if (expenses.length === 0) return <div className="empty">No expenses found.</div>;
  return (
    <div className="explist">
      {expenses.map((e) => (
        <Link key={e.id} href={`/expenses/${e.id}`} className="exprow">
          <div className="l1">
            <span className="supplier">{e.supplierName}</span>
            <span className="desc">{e.description}</span>
          </div>
          <div className="amount">
            {formatAUD(e.audAmountCents)}
            {e.originalCurrency !== "AUD" && (
              <div className="muted small" style={{ fontWeight: 400 }}>
                {e.fxStatus === "pending" ? "FX pending · " : ""}
                {formatCurrency(e.originalAmountCents, e.originalCurrency)}
              </div>
            )}
          </div>
          <div className="meta">
            <span>{formatDateAU(e.dateIncurred)}</span>
            {catName.has(e.categoryId) && <span>· {catName.get(e.categoryId)}</span>}
            {e.status === "draft" && <span className="badge info">draft — confirm</span>}
            {e.status === "void" && <span className="badge danger">void</span>}
            {e.isCapital && <span className="badge neutral">capital</span>}
            {e.gstTreatment === "gst" && <span className="badge ok">GST</span>}
            {e.fxStatus === "pending" && <span className="badge warn">FX pending</span>}
            {(e.receiptCount ?? 0) === 0 && e.status !== "void" && <span className="badge warn">no receipt</span>}
            {e.source === "subscription" && <span className="badge neutral">sub</span>}
            {e.source === "import" && <span className="badge neutral">imported</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
