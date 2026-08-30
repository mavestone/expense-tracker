"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { formatAUD, formatCurrency } from "@/lib/money";
import { formatDateShort } from "@/lib/fy";

type Row = {
  id: string;
  date: string;
  name: string;
  description: string;
  audCents: number;
  originalAmountCents: number;
  originalCurrency: string;
};
type IncomeRow = Row & { invoiceRef: string | null; paid: boolean };
type ExpenseRow = Row & { category: string; deductibleAudCents: number };

type Breakdown = {
  month: string;
  income: IncomeRow[];
  expenses: ExpenseRow[];
  totals: { incomeCents: number; expenseCents: number; netCents: number };
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthTitle(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1] ?? key} ${y}`;
}

/**
 * A foreign charge is only recognisable as the one on the card in its own
 * currency, so the original rides along under the AUD.
 *
 * `tone` is money direction, not status: out is red, money actually received
 * is green, and income still owed stays neutral because it is not in the bank
 * yet. Scoped to this panel — red means "needs attention" everywhere else in
 * the app, and that meaning should not be diluted.
 */
function Amounts({ r, aud, tone }: { r: Row; aud: number; tone: "expense" | "paid" | "unpaid" }) {
  return (
    <span className={`mb-amt ${tone}`}>
      <b>{formatAUD(aud)}</b>
      {r.originalCurrency !== "AUD" && (
        <span className="muted small">{formatCurrency(r.originalAmountCents, r.originalCurrency)}</span>
      )}
    </span>
  );
}

/**
 * What one bar on the trend chart is made of.
 *
 * The expense figure shown is the DEDUCTIBLE portion, not the gross — that is
 * what the chart plots, and a list that does not add up to the bar it came
 * from is worse than no list.
 */
export default function MonthBreakdown({ month, onClose }: { month: string; onClose: () => void }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiGet<Breakdown>(`/api/reports/month?month=${month}`).then(setData).catch((e) => setError(e.message));
  }, [month]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dlg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg mb-dlg" role="dialog" aria-modal="true" aria-label={monthTitle(month)}>
        <div className="mb-head">
          <h2 className="dlg-title">{monthTitle(month)}</h2>
          <button type="button" className="btn ghost small" onClick={onClose}>Close</button>
        </div>

        {error && <div className="alert danger">{error}</div>}

        {!data ? (
          <div className="empty"><span className="spin" /> Loading…</div>
        ) : (
          // One scroll region below the header, so a month with forty records
          // scrolls its content rather than growing the dialog off-screen.
          <div className="mb-scroll">
            <div className="mb-tot">
              <div><span className="k">Income</span><span className="v income">{formatAUD(data.totals.incomeCents)}</span></div>
              <div><span className="k">Deductible spend</span><span className="v expense">{formatAUD(data.totals.expenseCents)}</span></div>
              <div>
                <span className="k">Net</span>
                <span className="v" style={{ color: data.totals.netCents >= 0 ? "var(--ok-ink)" : "var(--danger-ink)" }}>
                  {formatAUD(data.totals.netCents)}
                </span>
              </div>
            </div>

            <h3 className="mb-sec">Income <span className="muted small">{data.income.length}</span></h3>
            {data.income.length === 0 ? (
              <p className="muted small mb2">Nothing invoiced in this month.</p>
            ) : (
              <ul className="mb-list">
                {data.income.map((r) => (
                  <li key={r.id}>
                    <span className="mb-date">{formatDateShort(r.date)}</span>
                    <Link href={`/income/${r.id}`} className="mb-main">
                      <b>{r.name}</b>
                      <span className="muted small">{r.description}</span>
                    </Link>
                    <span className="mb-tag">
                      {r.invoiceRef && <span className="pill chip">{r.invoiceRef}</span>}
                      {!r.paid && <span className="pill overdue">unpaid</span>}
                    </span>
                    <Amounts r={r} aud={r.audCents} tone={r.paid ? "paid" : "unpaid"} />
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mb-sec">Expenses <span className="muted small">{data.expenses.length}</span></h3>
            {data.expenses.length === 0 ? (
              <p className="muted small">Nothing spent in this month.</p>
            ) : (
              <ul className="mb-list">
                {data.expenses.map((r) => (
                  <li key={r.id}>
                    <span className="mb-date">{formatDateShort(r.date)}</span>
                    <Link href={`/expenses/${r.id}`} className="mb-main">
                      <b>{r.name}</b>
                      <span className="muted small">{r.description}</span>
                    </Link>
                    <span className="mb-tag"><span className="pill chip">{r.category}</span></span>
                    <Amounts r={r} aud={r.deductibleAudCents} tone="expense" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
