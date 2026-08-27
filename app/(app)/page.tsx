"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/client";
import { formatAUD } from "@/lib/money";
import TrendChart, { type TrendMonth } from "@/components/TrendChart";
import ActionStack, { type ActionData } from "@/components/ActionStack";
import { SkeletonStats, SkeletonBlock, Loading } from "@/components/Skeleton";
import type { ExpenseDto, MetaDto } from "@/lib/types";

type Dashboard = {
  fy: string;
  actions: ActionData;
  totals: { count: number; audCents: number; deductibleCents: number; claimableGstCents: number; blockedGstCents: number };
  income: { count: number; audCents: number; gstCents: number; netCents: number; outstandingCents: number };
  recent: ExpenseDto[];
};
type Trend = { fy: string; months: TrendMonth[]; totals: { incomeCents: number; expenseCents: number } };
type Closure = {
  finalised: boolean;
  closure: { lodgedDate: string | null; taxableIncomeCents: number | null; taxPayableCents: number | null } | null;
};

/**
 * Time-of-day greeting, computed in the browser so it reflects where the owner
 * actually is — this business runs from a different timezone most months.
 */
function greeting(h: number): string {
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [closure, setClosure] = useState<Closure | null>(null);
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [hello, setHello] = useState<string | null>(null);
  const [fy, setFy] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setHello(greeting(new Date().getHours())), []);
  useEffect(() => {
    apiGet<MetaDto>("/api/meta").then(setMeta).catch((e) => setError(e.message));
    apiGet<{ settings: { owner_name?: string } }>("/api/settings")
      .then((s) => setOwnerName(s.settings?.owner_name ?? ""))
      .catch(() => setOwnerName(""));
  }, []);

  useEffect(() => {
    setData(null);
    setTrend(null);
    setClosure(null);
    const q = fy ? `?fy=${fy}` : "";
    apiGet<Dashboard>(`/api/dashboard${q}`).then(setData).catch((e) => setError(e.message));
    apiGet<Trend>(`/api/reports/trend${q}`).then(setTrend).catch(() => setTrend(null));
  }, [fy]);

  useEffect(() => {
    const active = fy || data?.fy;
    if (!active) return;
    apiGet<Closure>(`/api/fy/${active}`).then(setClosure).catch(() => setClosure(null));
  }, [fy, data?.fy]);

  if (error) return <div className="alert danger">{error}</div>;

  const activeFy = fy || data?.fy || "";
  const years = meta?.financialYears ?? (data ? [data.fy] : []);

  if (!data)
    return (
      <Loading label="Loading your overview">
        <div className="section-head"><div><h1 className="greet">{hello ?? "Overview"}</h1></div></div>
        <SkeletonStats count={3} />
        <div className="card mt2"><SkeletonBlock height={200} /></div>
        <div className="card mt2"><SkeletonBlock height={260} /></div>
      </Loading>
    );

  const a = data.actions;
  const outstanding = [a.unpaid ? 1 : 0, a.triage && a.triage.undecided > 0 ? 1 : 0, a.blockedGst ? 1 : 0]
    .reduce((s, n) => s + n, 0);

  return (
    <div className="overview">
      <div className="section-head">
        <div>
          <h1 className="greet">
            {a.allClear
              ? `${hello ?? "Hello"}${hello && ownerName ? `, ${ownerName}` : ""}`
              : outstanding === 1
                ? "One thing needs you"
                : `${outstanding === 2 ? "Two" : "Three"} things need you`}
          </h1>
          <p className="greet-sub muted small">
            FY {activeFy}
            {closure?.finalised ? " · lodged" : " · open"} · {a.today ? formatDate(a.today) : ""}
          </p>
        </div>
        {closure?.finalised && (
          <span className="taxbadge ok">
            FY {activeFy} lodged
            {closure.closure?.taxPayableCents === 0 ? " · nil tax payable" : ""}
          </span>
        )}
      </div>

      {years.length > 1 && (
        <div className="fyswitch" role="group" aria-label="Financial year">
          {years.map((f) => (
            <button key={f} type="button" className={f === activeFy ? "active" : ""} onClick={() => setFy(f)}>
              FY {f}
            </button>
          ))}
        </div>
      )}

      <ActionStack data={a} />

      <div className="fypair">
        <article className="card fycard">
          <div className="fy-head">
            <div>
              <div className="act-label">FY {activeFy}{closure?.finalised ? " · finalised" : " · open"}</div>
              <div className="fy-figure">{formatAUD(data.income.audCents)}</div>
              <div className="muted small">
                Income from {data.income.count} invoice{data.income.count === 1 ? "" : "s"}
              </div>
            </div>
            {closure?.finalised && closure.closure && (
              <div className="fy-tax">
                <div className="act-label">Tax payable</div>
                <div className="fy-figure ok">
                  {closure.closure.taxPayableCents === 0 ? "Nil" : formatAUD(closure.closure.taxPayableCents ?? 0)}
                </div>
                {closure.closure.taxableIncomeCents != null && (
                  <p className="fy-note">
                    Taxable income {formatAUD(closure.closure.taxableIncomeCents)}
                    {closure.closure.taxPayableCents === 0 ? " — under the $18,200 threshold" : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="fystrip">
            <div>
              <span className="k">Expenses</span>
              <span className="v">{formatAUD(data.totals.deductibleCents)}</span>
              <span className="s">{data.totals.count} record{data.totals.count === 1 ? "" : "s"}</span>
            </div>
            <div>
              <span className="k">GST on sales</span>
              <span className="v">{formatAUD(data.income.gstCents)}</span>
              <span className="s">Collected</span>
            </div>
            <div>
              <span className="k">Credits claimed</span>
              <span className="v ok">{formatAUD(data.totals.claimableGstCents)}</span>
              <span className="s">Claimable</span>
            </div>
            <div className={data.totals.blockedGstCents > 0 ? "blocked" : undefined}>
              <span className="k">Blocked</span>
              <span className="v">{formatAUD(data.totals.blockedGstCents)}</span>
              <span className="s">
                {a.blockedGst ? `${a.blockedGst.count} record${a.blockedGst.count === 1 ? "" : "s"}` : "None"}
              </span>
            </div>
          </div>
        </article>

        <article className="card fycard">
          <div className="act-label">Net position</div>
          <div className="fy-figure" style={{ color: data.income.netCents >= 0 ? "var(--ok-ink)" : "var(--danger-ink)" }}>
            {formatAUD(data.income.netCents)}
          </div>
          <div className="muted small">Income less deductible spend, both ex-GST</div>
          <hr className="fy-rule" />
          <div className="fy-row">
            <span className="muted small">Deductible spend</span>
            <b>{formatAUD(data.totals.deductibleCents)}</b>
          </div>
          <div className="fy-row">
            <span className="muted small">GST credits claimable</span>
            <b>{formatAUD(data.totals.claimableGstCents)}</b>
          </div>
          {a.unpaid && (
            <p className="fy-foot muted small">
              The unpaid {a.unpaid.first.number} above lands in the year it is paid, not the year it was issued —
              on a cash basis for GST.
            </p>
          )}
        </article>
      </div>

      <div className="card">
        <div className="section-head" style={{ margin: 0 }}>
          <h2 style={{ margin: 0 }}>Income by month — FY {activeFy}</h2>
          {trend && (
            <span className="small muted">
              {formatAUD(trend.totals.incomeCents)} in · {formatAUD(trend.totals.expenseCents)} out
            </span>
          )}
        </div>
        {trend ? <TrendChart months={trend.months} /> : <SkeletonBlock height={300} />}
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}
