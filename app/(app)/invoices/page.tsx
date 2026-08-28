"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { formatCurrency } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import { SkeletonRows, Loading } from "@/components/Skeleton";
import { useFy } from "@/components/FyContext";

type Invoice = {
  id: string;
  number: string;
  clientName: string;
  status: "draft" | "sent" | "paid" | "void";
  issueDate: string;
  dueDate: string;
  currency: string;
  totalCents: number;
  incomeId: string | null;
};

type Resp = {
  invoices: Invoice[];
  byCurrency: { currency: string; count: number; totalCents: number; outstandingCents: number }[];
};

const FILTERS: { key: string; label: string; status?: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts", status: "draft" },
  { key: "sent", label: "Awaiting payment", status: "sent" },
  { key: "paid", label: "Paid", status: "paid" },
];

export default function InvoicesPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [filter, setFilter] = useState("all");
  const { fy, ready: fyReady } = useFy();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fyReady) return;
    setData(null);
    const p = new URLSearchParams();
    const f = FILTERS.find((x) => x.key === filter);
    if (f?.status) p.set("status", f.status);
    if (fy) p.set("fy", fy);
    apiGet<Resp>(`/api/invoices?${p}`).then(setData).catch((e) => setError(e.message));
  }, [filter, fy, fyReady]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="section-head">
        <h1>Invoices</h1>
        <span className="btnrow">
          <Link href="/invoices/new" className="btn small">+ New invoice</Link>
        </span>
      </div>

      {error && <div className="alert danger">{error}</div>}

      <div className="fyswitch" role="group" aria-label="Status">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={f.key === filter ? "active" : ""} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>


      {data && data.byCurrency.length > 0 && (
        <div className="stats mt2">
          {data.byCurrency.map((c) => (
            <div className="stat" key={c.currency}>
              <div className="label">{c.currency} invoiced</div>
              <div className="value">{formatCurrency(c.totalCents, c.currency)}</div>
              <div className="sub">
                {c.count} invoice{c.count === 1 ? "" : "s"}
                {c.outstandingCents > 0 && ` · ${formatCurrency(c.outstandingCents, c.currency)} outstanding`}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card mt2">
        {!data ? (
          <Loading label="Loading invoices"><SkeletonRows rows={4} /></Loading>
        ) : data.invoices.length === 0 ? (
          <div className="empty">
            Nothing here yet. <Link href="/invoices/new">Raise an invoice</Link> — marking it sent posts it straight
            into the income ledger.
          </div>
        ) : (
          <table className="lines-table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Client</th>
                <th>Issued</th>
                <th>Due</th>
                <th className="r">Amount</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i) => {
                const overdue = i.status === "sent" && i.dueDate < today;
                return (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/invoices/${i.id}`}><b>{i.number}</b></Link>
                      {i.incomeId && <div className="small muted">in ledger</div>}
                    </td>
                    <td>{i.clientName}</td>
                    <td className="small nowrap">{formatDateAU(i.issueDate)}</td>
                    <td className="small nowrap">{formatDateAU(i.dueDate)}</td>
                    <td className="r nowrap">{formatCurrency(i.totalCents, i.currency)}</td>
                    <td>
                      <span className={`pill ${overdue ? "overdue" : i.status}`}>{overdue ? "overdue" : i.status}</span>
                    </td>
                    <td className="r nowrap">
                      <a className="btn ghost small" href={`/api/invoices/${i.id}/pdf`} title="Download PDF">PDF</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
