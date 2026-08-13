"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { formatAUD } from "@/lib/money";
import { taxPosition, bracketLabel, rateLabel, scaleForFy } from "@/lib/tax";
import ExpenseList from "@/components/ExpenseList";
import TrendChart, { type TrendMonth } from "@/components/TrendChart";
import type { ExpenseDto, MetaDto } from "@/lib/types";

type Dashboard = {
  fy: string;
  totals: { count: number; audCents: number; deductibleCents: number; claimableGstCents: number; blockedGstCents: number; capitalCount: number; capitalCents: number };
  income: { count: number; audCents: number; gstCents: number; netCents: number; outstandingCount: number; outstandingCents: number };
  alerts: { pendingDrafts: number; pendingFx: number; missingReceiptsImportant: number; missingReceiptsTotal: number; staleSubscriptions: number; gstInvoiceFlags: number; unpaidInvoices: number };
  recent: ExpenseDto[];
};

type Trend = { fy: string; months: TrendMonth[]; totals: { incomeCents: number; expenseCents: number } };

/**
 * Time-of-day greeting, computed in the browser so it reflects where the owner
 * actually is — this business runs from a different timezone most months, and a
 * server-rendered "good morning" at 11pm reads as broken.
 */
function greeting(h: number): string {
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [hello, setHello] = useState<string | null>(null);
  const [fy, setFy] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Set after mount: rendering it on the server would hydrate a stale hour.
  useEffect(() => {
    setHello(greeting(new Date().getHours()));
  }, []);
  useEffect(() => {
    apiGet<{ settings: { owner_name?: string } }>("/api/settings")
      .then((s) => setOwnerName(s.settings?.owner_name ?? ""))
      .catch(() => setOwnerName(""));
  }, []);

  useEffect(() => {
    apiGet<MetaDto>("/api/meta").then(setMeta).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setData(null);
    setTrend(null);
    apiGet<Dashboard>(`/api/dashboard${fy ? `?fy=${fy}` : ""}`).then(setData).catch((e) => setError(e.message));
    apiGet<Trend>(`/api/reports/trend${fy ? `?fy=${fy}` : ""}`).then(setTrend).catch(() => setTrend(null));
  }, [fy]);

  if (error) return <div className="alert danger">{error}</div>;
  if (!data) return <div className="empty"><span className="spin" /> Loading…</div>;

  const activeFy = fy || data.fy;
  const years = meta?.financialYears ?? [data.fy];

  const a = data.alerts;
  const alerts: { text: string; href: string; kind: "warn" | "info" | "danger" }[] = [];
  if (a.unpaidInvoices > 0) alerts.push({ text: `${a.unpaidInvoices} invoice${a.unpaidInvoices > 1 ? "s" : ""} awaiting payment${data.income?.outstandingCents ? ` — ${formatAUD(data.income.outstandingCents)}` : ""}`, href: "/income?outstanding=1", kind: "info" });
  if (a.pendingDrafts > 0) alerts.push({ text: `${a.pendingDrafts} subscription renewal${a.pendingDrafts > 1 ? "s" : ""} waiting for confirmation`, href: "/expenses?status=draft", kind: "info" });
  if (a.gstInvoiceFlags > 0) alerts.push({ text: `${a.gstInvoiceFlags} GST claim${a.gstInvoiceFlags > 1 ? "s" : ""} missing a tax invoice (credit can't be claimed)`, href: "/reports?tab=missing", kind: "danger" });
  if (a.pendingFx > 0) alerts.push({ text: `${a.pendingFx} record${a.pendingFx > 1 ? "s" : ""} with FX rate pending`, href: "/expenses?pendingFx=1", kind: "warn" });
  if (a.missingReceiptsImportant > 0) alerts.push({ text: `${a.missingReceiptsImportant} record${a.missingReceiptsImportant > 1 ? "s" : ""} over the receipt threshold with no receipt`, href: "/reports?tab=missing", kind: "warn" });
  // Subscriptions has no nav tab any more, but this alert still deep-links to it —
  // a warning about money going out on unused services is worth keeping.
  if (a.staleSubscriptions > 0) alerts.push({ text: `${a.staleSubscriptions} subscription${a.staleSubscriptions > 1 ? "s" : ""} with no confirmed payment in 60+ days — still using ${a.staleSubscriptions > 1 ? "them" : "it"}?`, href: "/subscriptions", kind: "warn" });

  const net = data.income?.netCents ?? 0;
  const pos = taxPosition(net, activeFy);
  const scale = scaleForFy(activeFy);
  const inLoss = net <= 0;
  const bracketSpan = pos.bracket.toCents == null ? null : pos.bracket.toCents - (pos.bracket.fromCents - 1);
  const throughBracket =
    bracketSpan && bracketSpan > 0
      ? Math.min(100, Math.max(0, ((net - (pos.bracket.fromCents - 1)) / bracketSpan) * 100))
      : 100;

  return (
    <div>
      <div className="section-head">
        <div>
          <h1 className="greet">
            {hello ?? "Overview"}
            {/* Only the first name — the full name is what prints on invoices. */}
            {hello && ownerName ? `, ${ownerName.trim().split(/\s+/)[0]}` : ""}
          </h1>
          <p className="greet-sub muted small">
            Here is where FY {activeFy} stands.
          </p>
        </div>
      </div>

      <div className="fyswitch" role="group" aria-label="Financial year">
        {years.map((f) => (
          <button
            key={f}
            type="button"
            className={f === activeFy ? "active" : ""}
            aria-pressed={f === activeFy}
            onClick={() => setFy(f)}
          >
            FY {f}
          </button>
        ))}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Income</div>
          <div className="value">{formatAUD(data.income?.audCents ?? 0)}</div>
          <div className="sub">
            {data.income?.count ?? 0} invoice{(data.income?.count ?? 0) === 1 ? "" : "s"}
            {(data.income?.outstandingCents ?? 0) > 0 && ` · ${formatAUD(data.income.outstandingCents)} unpaid`}
          </div>
        </div>
        <div className="stat">
          <div className="label">Deductible spend</div>
          <div className="value">{formatAUD(data.totals.deductibleCents)}</div>
          <div className="sub">{data.totals.count} expenses · {formatAUD(data.totals.audCents)} total</div>
        </div>
        <div className="stat">
          <div className="label">Taxable profit</div>
          <div className="value" style={{ color: net >= 0 ? "var(--ok)" : "var(--danger)" }}>
            {formatAUD(net)}
          </div>
          <div className="sub">income − expenses, ex-GST</div>
        </div>
        <div className="stat">
          <div className="label">GST credits</div>
          <div className="value">{formatAUD(data.totals.claimableGstCents)}</div>
          <div className="sub">
            claimable (1B){data.totals.capitalCount > 0 ? ` · ${data.totals.capitalCount} capital asset${data.totals.capitalCount === 1 ? "" : "s"}` : ""}
            {(data.totals.blockedGstCents ?? 0) > 0 && (
              <div style={{ color: "var(--warn)" }}>
                {formatAUD(data.totals.blockedGstCents)} held back — no tax invoice
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card mt2">
        <div className="section-head" style={{ margin: 0 }}>
          <h2 style={{ margin: 0 }}>Income vs spend — FY {activeFy}</h2>
          {trend && (
            <span className="small muted">
              {formatAUD(trend.totals.incomeCents)} in · {formatAUD(trend.totals.expenseCents)} out
            </span>
          )}
        </div>
        {trend ? <TrendChart months={trend.months} /> : <div className="empty"><span className="spin" /> Loading…</div>}
      </div>

      <div className="card mt2 taxcard">
        <div className="section-head" style={{ margin: 0 }}>
          <h2 style={{ margin: 0 }}>Tax position — FY {activeFy}</h2>
          <span className="taxbadge">indicative</span>
        </div>

        {inLoss ? (
          <p className="taxnote" style={{ marginTop: 10 }}>
            Deductible spend exceeds income for this year, so there is no taxable profit to
            estimate tax on. A business loss may be offset or carried forward depending on your
            circumstances — one for your accountant.
          </p>
        ) : (
          <>
            <div className="taxsummary">
              <div>
                <div className="tlabel">Taxable profit</div>
                <div className="tvalue">{formatAUD(net)}</div>
              </div>
              <div>
                <div className="tlabel">Marginal rate</div>
                <div className="tvalue accent">{rateLabel(pos.marginalRateBp)}</div>
                <div className="tsub">on your next dollar</div>
              </div>
              <div>
                <div className="tlabel">Estimated tax</div>
                <div className="tvalue">{formatAUD(pos.totalTaxCents)}</div>
                <div className="tsub">
                  {formatAUD(pos.incomeTaxCents)} income tax + {formatAUD(pos.medicareLevyCents)} Medicare
                </div>
              </div>
              <div>
                <div className="tlabel">Effective rate</div>
                <div className="tvalue">{(pos.effectiveRateBp / 100).toFixed(1)}%</div>
                <div className="tsub">tax ÷ taxable profit</div>
              </div>
            </div>

            <div className="ladder">
              {scale.brackets.map((b, i) => {
                const current = i === pos.bracketIndex;
                const passed = i < pos.bracketIndex;
                return (
                  <div key={i} className={`rung${current ? " current" : ""}${passed ? " passed" : ""}`}>
                    <span className="rate">{rateLabel(b.rateBp)}</span>
                    <span className="range">{bracketLabel(b)}</span>
                    {current && (
                      <span className="here">
                        <span className="bar"><span style={{ width: `${throughBracket}%` }} /></span>
                        you are here
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {pos.toNextBracketCents != null && pos.nextBracket && (
              <p className="taxnote">
                <b>{formatAUD(pos.toNextBracketCents)}</b> more taxable profit before the{" "}
                <b>{rateLabel(pos.nextBracket.rateBp)}</b> bracket starts.
              </p>
            )}
          </>
        )}

        <p className="taxnote muted">
          Estimated from this tracker alone — business income less deductible spend, both ex-GST.
          It excludes salary and any other income, prior-year losses, offsets, PAYG instalments
          already paid, and depreciation not recorded here. Medicare levy is the flat 2%; the
          low-income shade-in is not modelled.
          {!scale.verifiedForFy && (
            <>
              {" "}
              <b>FY {activeFy} rates are not confirmed here</b> — figures use the published{" "}
              FY {scale.basisFy} scale.
            </>
          )}{" "}
          Not tax advice; your accountant works from the full picture.
        </p>
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
