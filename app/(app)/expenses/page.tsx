"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { SkeletonRows, Loading } from "@/components/Skeleton";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/client";
import { formatAUD } from "@/lib/money";
import ExpenseTable, { decorate, type Row } from "@/components/ExpenseTable";
import { Camera } from "lucide-react";
import type { ExpenseDto, MetaDto } from "@/lib/types";

type ListResponse = {
  expenses: ExpenseDto[];
  hasMore: boolean;
  totals: {
    count: number; audTotal: number; deductibleTotal: number;
    gstClaimedTotal: number; gstBlockedTotal: number; blockedCount: number;
  };
};

const FLAG_LABEL: Record<string, string> = {
  capital: "Capital assets",
  missingReceipt: "Needs attention",
  pendingFx: "FX pending",
};

function ExpensesInner() {
  const params = useSearchParams();
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [data, setData] = useState<ListResponse | null>(null);
  const [rows, setRows] = useState<ExpenseDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fy, setFy] = useState(params.get("fy") ?? "");
  const [quarter, setQuarter] = useState(params.get("quarter") ?? "");
  const [categoryId, setCategoryId] = useState(params.get("categoryId") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [flags, setFlags] = useState(
    params.get("pendingFx") === "1" ? "pendingFx" : params.get("missingReceipt") === "1" ? "missingReceipt" : params.get("capital") === "1" ? "capital" : ""
  );

  useEffect(() => {
    apiGet<MetaDto>("/api/meta").then(setMeta).catch((e) => setError(e.message));
  }, []);

  const load = useCallback(
    async (offset = 0) => {
      setBusy(true);
      setError(null);
      try {
        const p = new URLSearchParams();
        if (fy) p.set("fy", fy);
        if (fy && quarter) p.set("quarter", quarter);
        if (categoryId) p.set("categoryId", categoryId);
        if (status) p.set("status", status);
        if (q.trim()) p.set("q", q.trim());
        if (flags === "capital") p.set("capital", "1");
        if (flags === "missingReceipt") p.set("missingReceipt", "1");
        if (flags === "pendingFx") p.set("pendingFx", "1");
        p.set("limit", "100");
        if (offset > 0) p.set("offset", String(offset));
        const res = await apiGet<ListResponse>(`/api/expenses?${p.toString()}`);
        setData(res);
        setRows((prev) => (offset > 0 ? [...prev, ...res.expenses] : res.expenses));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [fy, quarter, categoryId, status, q, flags]
  );

  useEffect(() => {
    const t = setTimeout(() => load(0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const activeFilters = [fy, quarter, categoryId, status, flags, q].filter(Boolean).length;

  const flagCents = meta?.settings?.gst_receipt_flag_cents ?? 8250;
  // The blocked record sorts first on a phone: it is the only line costing
  // money, and date order is no help if you never scroll to it.
  const decorated: Row[] = decorate(rows, flagCents);
  const ordered = [...decorated].sort((a, b) => Number(b.blocked) - Number(a.blocked));
  const categoryName = (id: string) =>
    meta?.categories.find((c) => c.id === id)?.name ?? "Uncategorised";

  const applied: { key: string; label: string; clear: () => void }[] = [];
  if (fy) applied.push({ key: "fy", label: `FY ${fy}`, clear: () => { setFy(""); setQuarter(""); } });
  if (quarter) applied.push({ key: "q", label: quarter, clear: () => setQuarter("") });
  if (categoryId) applied.push({ key: "cat", label: categoryName(categoryId), clear: () => setCategoryId("") });
  if (status) applied.push({ key: "st", label: status, clear: () => setStatus("") });
  if (flags) applied.push({ key: "fl", label: FLAG_LABEL[flags] ?? flags, clear: () => setFlags("") });
  if (q.trim()) applied.push({ key: "q2", label: `"${q.trim()}"`, clear: () => setQ("") });

  function clearAll() { setFy(""); setQuarter(""); setCategoryId(""); setStatus(""); setFlags(""); setQ(""); }

  return (
    <div className="expenses">
      <div className="section-head">
        <div>
          <h1>Expenses</h1>
          {data && (
            <p className="greet-sub muted small">
              {data.totals.count} record{data.totals.count === 1 ? "" : "s"} ·{" "}
              {formatAUD(data.totals.audTotal)}{fy ? ` · FY ${fy}` : ""}
            </p>
          )}
        </div>
        <Link href="/expenses/new" className="btn"><Camera size={16} /> Snap a receipt</Link>
      </div>

      <div className="filters">
        <input className="grow" type="search" placeholder="Search supplier, description, notes"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={fy} onChange={(e) => { setFy(e.target.value); if (!e.target.value) setQuarter(""); }}>
          <option value="">All years</option>
          {(meta?.financialYears ?? []).map((f) => <option key={f} value={f}>FY {f}</option>)}
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {(meta?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Active + drafts</option>
          <option value="active">Active only</option>
          <option value="draft">Drafts</option>
          <option value="void">Voided</option>
        </select>
        {/* A filter, not a banner — it stays useful at 550 records. */}
        {data && data.totals.blockedCount > 0 && (
          <button type="button"
            className={`needschip${flags === "missingReceipt" ? " on" : ""}`}
            onClick={() => setFlags(flags === "missingReceipt" ? "" : "missingReceipt")}>
            Needs attention · {data.totals.blockedCount}
          </button>
        )}
      </div>

      {applied.length > 0 && (
        <div className="chiprow">
          {applied.map((c) => (
            <button key={c.key} type="button" className="fchip" onClick={c.clear}>
              {c.label}<span aria-hidden>×</span>
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          {applied.length > 1 && (
            <button type="button" className="fchip clear" onClick={clearAll}>Clear all</button>
          )}
        </div>
      )}

      {error && <div className="alert danger">{error}</div>}

      {!data ? (
        <div className="card"><Loading label="Loading expenses"><SkeletonRows rows={6} /></Loading></div>
      ) : ordered.length === 0 ? (
        <div className="card empty">
          <b>Nothing matches these filters</b>
          {applied.length > 0 ? (
            <>
              Nothing {applied.map((c) => c.label).join(" · ")}.{" "}
              {data.totals.count === 0 && "There are no records in this view at all."}
              <div className="btnrow" style={{ justifyContent: "center", marginTop: 14 }}>
                <button className="btn" onClick={clearAll}>Clear all filters</button>
                {applied.length > 1 && (
                  <button className="btn ghost" onClick={() => applied[applied.length - 1].clear()}>
                    Just drop {applied[applied.length - 1].label}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>No expenses recorded yet.</>
          )}
        </div>
      ) : (
        <>
          <ExpenseTable rows={ordered} categoryName={categoryName} />
          <div className="listfoot">
            <span className="muted small">
              Showing {ordered.length} of {data.totals.count}
            </span>
            <span className="foots">
              <span><i>Total</i> {formatAUD(data.totals.audTotal)}</span>
              <span><i>Deductible</i> {formatAUD(data.totals.deductibleTotal)}</span>
              <span><i>GST claimed</i> <b className="ok">{formatAUD(data.totals.gstClaimedTotal)}</b></span>
            </span>
          </div>
        </>
      )}

      {data?.hasMore && (
        <div className="btnrow" style={{ justifyContent: "center" }}>
          <button className="btn ghost" onClick={() => load(rows.length)} disabled={busy}>
            {busy ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={<div className="empty"><span className="spin" /></div>}>
      <ExpensesInner />
    </Suspense>
  );
}
