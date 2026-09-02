"use client";

import Link from "next/link";
import { AlertTriangle, ListChecks, Receipt, Check, Camera, FileText, CalendarClock } from "lucide-react";
import { formatAUD, formatCurrency } from "@/lib/money";
import { formatDateShort } from "@/lib/fy";

export type UnpaidInvoice = {
  id: string;
  number: string;
  client: string;
  currency: string;
  totalCents: number;
  issueDate: string;
  dueDate: string;
  gstTreatment: string;
  overdueDays: number;
};

export type ActionData = {
  fy: string;
  today: string;
  unpaid: {
    count: number;
    byCurrency: { currency: string; cents: number }[];
    items: UnpaidInvoice[];
    first: UnpaidInvoice;
  } | null;
  triage: { undecided: number; total: number; autoFiled: number; business: number } | null;
  statementDue: {
    count: number;
    accounts: { label: string; months: string[] }[];
    first: { label: string; month: string };
  } | null;
  blockedGst: {
    count: number; totalCents: number; thresholdCents: number;
    first: { id: string; supplier: string; date: string; audCents: number; gstCents: number };
  } | null;
  allClear: boolean;
};

/**
 * The three things that might need you, or the fact that none of them do.
 *
 * "Nothing needs a decision" is the common case, not an error path — most
 * weeks every invoice is paid and every line is filed. It gets a designed
 * state rather than an absence.
 */
export default function ActionStack({ data, nextBas }: { data: ActionData; nextBas?: string }) {
  if (data.allClear) {
    return (
      <div className="card allclear">
        <span className="allclear-mark" aria-hidden><Check size={26} strokeWidth={3} /></span>
        <h2>Nothing needs a decision</h2>
        <p>
          Every invoice is paid, every statement line is filed, and no GST credit is blocked.
          {nextBas ? ` Next BAS is due ${nextBas}.` : ""}
        </p>
        <div className="btnrow">
          <Link href="/expenses/new" className="btn"><Camera size={16} /> Snap a receipt</Link>
          <Link href="/invoices/new" className="btn ghost"><FileText size={16} /> New invoice</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="actionstack">
      {data.unpaid && (
        <article className="card act danger">
          <div className="act-label"><AlertTriangle size={14} />
            {data.unpaid.first.overdueDays > 0
              ? `Overdue ${data.unpaid.first.overdueDays} day${data.unpaid.first.overdueDays === 1 ? "" : "s"}`
              : "Awaiting payment"}
          </div>

          {/* One figure only when one currency: a USD invoice and an AUD one
              have no meaningful total, so the count leads instead. */}
          <div className="act-figure">
            {data.unpaid.byCurrency.length === 1
              ? formatCurrency(data.unpaid.byCurrency[0].cents, data.unpaid.byCurrency[0].currency)
              : data.unpaid.count}
            {data.unpaid.byCurrency.length > 1 && (
              <span className="act-of">invoices unpaid</span>
            )}
          </div>

          <ul className="unpaidstack">
            {data.unpaid.items.map((inv) => (
              <li key={inv.id}>
                <Link href={`/invoices/${inv.id}`}>
                  <span className="us-main">
                    <b>{inv.number}</b>
                    <span className="us-client">{inv.client}</span>
                  </span>
                  <span className="us-right">
                    <b>{formatCurrency(inv.totalCents, inv.currency)}</b>
                    <span className={inv.overdueDays > 0 ? "us-late" : "us-due"}>
                      {inv.overdueDays > 0
                        ? `${inv.overdueDays}d overdue`
                        : `due ${formatDateShort(inv.dueDate)}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="btnrow">
            <Link href="/invoices?status=sent" className="btn" style={{ flex: 1 }}>All unpaid</Link>
          </div>
        </article>
      )}

      {data.triage && data.triage.undecided > 0 && (
        <article className="card act accent">
          <div className="act-label"><ListChecks size={14} /> To confirm</div>
          <div className="act-figure">
            {data.triage.undecided}
            <span className="act-of">of {data.triage.total.toLocaleString()} lines</span>
          </div>
          <div className="pbar" aria-hidden>
            <span style={{ width: `${Math.max(2, (data.triage.undecided / data.triage.total) * 100)}%` }} />
          </div>
          <div className="act-context">
            The classifier already filed {data.triage.autoFiled.toLocaleString()} as personal or internal.
            These {data.triage.undecided} still need you.
          </div>
          <div className="btnrow">
            <Link href="/statements" className="btn" style={{ flex: 1 }}>Start triage</Link>
          </div>
        </article>
      )}

      {data.statementDue && (
        <article className="card act accent">
          <div className="act-label"><CalendarClock size={14} /> Statement due</div>
          <div className="act-figure">
            {data.statementDue.first.month.split(" ")[0]}
            <span className="act-of">{data.statementDue.first.month.split(" ")[1]}</span>
          </div>
          <div className="act-context">
            <div><b>{data.statementDue.first.label}</b> — no statement covering it yet.</div>
            {data.statementDue.count > 1 && (
              <div>
                {data.statementDue.count} month{data.statementDue.count === 1 ? "" : "s"} outstanding:{" "}
                {data.statementDue.accounts
                  .map((a) => `${a.label} — ${a.months.join(", ")}`)
                  .join("; ")}
              </div>
            )}
          </div>
          <div className="btnrow">
            <Link href="/import" className="btn" style={{ flex: 1 }}>Upload statement</Link>
            <Link href="/statements" className="btn ghost">Statements</Link>
          </div>
        </article>
      )}

      {data.blockedGst && (
        <article className="card act warn">
          <div className="act-label"><Receipt size={14} /> GST credit blocked</div>
          <div className="act-figure">{formatAUD(data.blockedGst.totalCents)}</div>
          <div className="act-context">
            <div>
              <b>{data.blockedGst.first.supplier}</b> · {formatAUD(data.blockedGst.first.audCents)} ·{" "}
              {formatDateShort(data.blockedGst.first.date)}
            </div>
            <div>Over {formatAUD(data.blockedGst.thresholdCents)} with no tax invoice</div>
            {data.blockedGst.count > 1 && <div>{data.blockedGst.count} records affected</div>}
          </div>
          <div className="btnrow">
            <Link href={`/expenses/${data.blockedGst.first.id}`} className="btn" style={{ flex: 1 }}>
              <Camera size={16} /> Attach tax invoice
            </Link>
          </div>
        </article>
      )}
    </div>
  );
}
