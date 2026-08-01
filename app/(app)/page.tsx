"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { formatAUD } from "@/lib/money";
import ExpenseList from "@/components/ExpenseList";
import type { ExpenseDto, MetaDto } from "@/lib/types";

type Dashboard = {
  fy: string;
  totals: { count: number; audCents: number; deductibleCents: number; claimableGstCents: number; capitalCount: number; capitalCents: number };
  alerts: { pendingDrafts: number; pendingFx: number; missingReceiptsImportant: number; missingReceiptsTotal: number; staleSubscriptions: number; gstInvoiceFlags: number };
  recent: ExpenseDto[];
};

export default function HomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [fy, setFy] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<MetaDto>("/api/meta").then(setMeta).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setData(null);
    apiGet<Dashboard>(`/api/dashboard${fy ? `?fy=${fy}` : ""}`).then(setData).catch((e) => setError(e.message));
  }, [fy]);

  if (error) return <div className="alert danger">{error}</div>;
  if (!data) return <div className="empty"><span className="spin" /> Loading…</div>;

  const a = data.alerts;
  const alerts: { text: string; href: string; kind: "warn" | "info" | "danger" }[] = [];
  if (a.pendingDrafts > 0) alerts.push({ text: `${a.pendingDrafts} subscription renewal${a.pendingDrafts > 1 ? "s" : ""} waiting for confirmation`, href: "/expenses?status=draft", kind: "info" });
  if (a.gstInvoiceFlags > 0) alerts.push({ text: `${a.gstInvoiceFlags} GST claim${a.gstInvoiceFlags > 1 ? "s" : ""} missing a tax invoice (credit can't be claimed)`, href: "/reports?tab=missing", kind: "danger" });
  if (a.pendingFx > 0) alerts.push({ text: `${a.pendingFx} record${a.pendingFx > 1 ? "s" : ""} with FX rate pending`, href: "/expenses?pendingFx=1", kind: "warn" });
  if (a.missingReceiptsImportant > 0) alerts.push({ text: `${a.missingReceiptsImportant} record${a.missingReceiptsImportant > 1 ? "s" : ""} over the receipt threshold with no receipt`, href: "/reports?tab=missing", kind: "warn" });
  if (a.staleSubscriptions > 0) alerts.push({ text: `${a.staleSubscriptions} subscription${a.staleSubscriptions > 1 ? "s" : ""} with no confirmed payment in 60+ days — still using ${a.staleSubscriptions > 1 ? "them" : "it"}?`, href: "/subscriptions", kind: "warn" });

  return (
    <div>
      <div className="section-head">
        <h1>Overview</h1>
        <select value={fy || data.fy} onChange={(e) => setFy(e.target.value)} style={{ width: "auto", minHeight: 36 }}>
          {(meta?.financialYears ?? [data.fy]).map((f) => (
            <option key={f} value={f}>FY {f}</option>
          ))}
        </select>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Spend (FY {data.fy})</div>
          <div className="value">{formatAUD(data.totals.audCents)}</div>
          <div className="sub">{data.totals.count} expenses</div>
        </div>
        <div className="stat">
          <div className="label">Deductible</div>
          <div className="value">{formatAUD(data.totals.deductibleCents)}</div>
          <div className="sub">business-use portion</div>
        </div>
        <div className="stat">
          <div className="label">GST credits</div>
          <div className="value">{formatAUD(data.totals.claimableGstCents)}</div>
          <div className="sub">claimable (1B)</div>
        </div>
        <div className="stat">
          <div className="label">Capital assets</div>
          <div className="value">{formatAUD(data.totals.capitalCents)}</div>
          <div className="sub">{data.totals.capitalCount} asset{data.totals.capitalCount === 1 ? "" : "s"} this FY</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="mt2">
          {alerts.map((al, i) => (
            <Link key={i} href={al.href} style={{ textDecoration: "none", color: "inherit" }}>
              <div className={`alert ${al.kind}`} style={{ cursor: "pointer" }}>{al.text} →</div>
            </Link>
          ))}
        </div>
      )}

      <div className="card mt2">
        <div className="section-head" style={{ margin: 0 }}>
          <h2 style={{ margin: 0 }}>Recent</h2>
          <span className="btnrow">
            <Link href="/expenses/new" className="btn small">+ Add expense</Link>
            <Link href="/expenses" className="btn ghost small">All expenses</Link>
          </span>
        </div>
        <ExpenseList expenses={data.recent} categories={meta?.categories} />
      </div>
    </div>
  );
}
