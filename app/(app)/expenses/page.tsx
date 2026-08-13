"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { SkeletonRows, Loading } from "@/components/Skeleton";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/client";
import { formatAUD } from "@/lib/money";
import ExpenseList from "@/components/ExpenseList";
import type { ExpenseDto, MetaDto } from "@/lib/types";

type ListResponse = {
  expenses: ExpenseDto[];
  hasMore: boolean;
  totals: { count: number; audTotal: number; deductibleTotal: number };
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

  return (
    <div>
      <div className="section-head">
        <h1>Expenses</h1>
        <Link href="/expenses/new" className="btn small">+ Add expense</Link>
      </div>

      <div className="filters">
        <select value={fy} onChange={(e) => { setFy(e.target.value); if (!e.target.value) setQuarter(""); }}>
          <option value="">All FYs</option>
          {(meta?.financialYears ?? []).map((f) => (
            <option key={f} value={f}>FY {f}</option>
          ))}
        </select>
        <select value={quarter} onChange={(e) => setQuarter(e.target.value)} disabled={!fy}>
          <option value="">All quarters</option>
          <option value="Q1">Q1 Jul–Sep</option>
          <option value="Q2">Q2 Oct–Dec</option>
          <option value="Q3">Q3 Jan–Mar</option>
          <option value="Q4">Q4 Apr–Jun</option>
        </select>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {(meta?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Active + drafts</option>
          <option value="active">Active only</option>
          <option value="draft">Drafts</option>
          <option value="void">Voided</option>
        </select>
        <select value={flags} onChange={(e) => setFlags(e.target.value)}>
          <option value="">All records</option>
          <option value="capital">Capital assets</option>
          <option value="missingReceipt">Missing receipt</option>
          <option value="pendingFx">FX pending</option>
        </select>
        <input
          className="grow"
          type="search"
          placeholder="Search supplier, description, notes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {activeFilters > 0 && (
          <button
            className="btn ghost small"
            onClick={() => { setFy(""); setQuarter(""); setCategoryId(""); setStatus(""); setFlags(""); setQ(""); }}
          >
            Clear {activeFilters}
          </button>
        )}
      </div>

      {error && <div className="alert danger">{error}</div>}

      {data && (
        <div className="listsum">
          <span><b>{data.totals.count}</b> record{data.totals.count === 1 ? "" : "s"}</span>
          <span>total <b>{formatAUD(data.totals.audTotal)}</b></span>
          <span>deductible <b className="accent">{formatAUD(data.totals.deductibleTotal)}</b></span>
        </div>
      )}

      <div className="card">
        {!data && <Loading label="Loading expenses"><SkeletonRows rows={6} /></Loading>}
        {data && <ExpenseList expenses={rows} categories={meta?.categories} />}
        {data?.hasMore && (
          <div className="btnrow mt2" style={{ justifyContent: "center" }}>
            <button className="btn ghost" onClick={() => load(rows.length)} disabled={busy}>
              {busy ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
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
