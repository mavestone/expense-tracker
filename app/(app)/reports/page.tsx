"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/client";
import { formatAUD, bpToPercentString } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import type { MetaDto } from "@/lib/types";

type Tab = "category" | "gst" | "depreciation" | "missing";

type CategoryReport = {
  fy: string;
  categories: { categoryId: string; category: string; count: number; audCents: number; deductibleCents: number; claimableGstCents: number }[];
  totals: { count: number; audCents: number; deductibleCents: number; claimableGstCents: number };
};

type GstReport = {
  fy: string;
  quarters: {
    quarter: string;
    label: string;
    g10Cents: number;
    g11Cents: number;
    oneBCents: number;
    excludedGstCents: number;
    byTreatment: Record<string, { count: number; audCents: number; businessAudCents: number }>;
    flaggedNoInvoice: { id: string; date: string; supplier: string; audCents: number; claimableGstCents: number }[];
  }[];
  totals: { g10Cents: number; g11Cents: number; oneBCents: number; excludedGstCents: number; flaggedCount: number };
  thresholdCents: number;
};

type DepreciationReport = {
  assets: {
    id: string; assetName: string; purchaseDate: string; supplier: string; costAudCents: number;
    originalAmountCents: number; originalCurrency: string; businessUseBp: number;
    effectiveLifeYears: string | null; financialYear: string; hasReceipt: boolean;
  }[];
};

type MissingReport = {
  records: { id: string; date: string; supplier: string; description: string; audCents: number; status: string; severity: "gst_invoice_required" | "receipt_required" | "info" }[];
};

function ReportsInner() {
  const params = useSearchParams();
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [fy, setFy] = useState("");
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "category");
  const [cat, setCat] = useState<CategoryReport | null>(null);
  const [gst, setGst] = useState<GstReport | null>(null);
  const [dep, setDep] = useState<DepreciationReport | null>(null);
  const [missing, setMissing] = useState<MissingReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<MetaDto>("/api/meta").then((m) => {
      setMeta(m);
      setFy((f) => f || m.currentFy);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!fy) return;
    setError(null);
    setCat(null); setGst(null); setDep(null); setMissing(null);
    Promise.all([
      apiGet<CategoryReport>(`/api/reports/category?fy=${fy}`),
      apiGet<GstReport>(`/api/reports/gst?fy=${fy}`),
      apiGet<DepreciationReport>(`/api/reports/depreciation?fy=${fy}`),
      apiGet<MissingReport>(`/api/reports/missing-receipts?fy=${fy}`),
    ]).then(([c, g, d, m]) => { setCat(c); setGst(g); setDep(d); setMissing(m); })
      .catch((e) => setError(e.message));
  }, [fy]);

  if (error) return <div className="alert danger">{error}</div>;
  if (!meta || !fy) return <div className="empty"><span className="spin" /> Loading…</div>;

  const TABS: { id: Tab; label: string }[] = [
    { id: "category", label: "By category" },
    { id: "gst", label: "GST / BAS" },
    { id: "depreciation", label: "Depreciation" },
    { id: "missing", label: "Missing receipts" },
  ];

  return (
    <div>
      <div className="section-head">
        <h1>Reports</h1>
        <div className="btnrow">
          <select value={fy} onChange={(e) => setFy(e.target.value)} style={{ width: "auto", minHeight: 36 }}>
            {meta.financialYears.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </select>
        </div>
      </div>

      <div className="steps">
        {TABS.map((t) => (
          <button key={t.id} className={`step ${tab === t.id ? "active" : ""}`} style={{ border: "none", cursor: "pointer", font: "inherit" }} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="card mb2">
        <h2>Exports</h2>
        <div className="btnrow">
          <a className="btn ghost small" href={`/api/export/csv?fy=${fy}`}>⬇ CSV — FY {fy} (for Xero / MYOB / accountant)</a>
          <a className="btn ghost small" href={`/api/export/csv?fy=all`}>⬇ CSV — all years</a>
          <a className="btn ghost small" href={`/api/export/backup?fy=all`}>⬇ Full backup (zip: JSON + all receipts)</a>
        </div>
        <p className="small muted mt1" style={{ marginBottom: 0 }}>
          CSV: one row per expense, all fields, AUD amounts as plain decimals, dates DD/MM/YYYY. Backup: everything, restorable and readable without this app — keep an offline copy somewhere safe.
        </p>
      </div>

      {tab === "category" && (
        <div className="card">
          <h2>Expense summary by category — FY {fy}</h2>
          {!cat ? <div className="empty"><span className="spin" /></div> : (
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr><th>Category</th><th className="r">Records</th><th className="r">Total AUD</th><th className="r">Deductible AUD</th><th className="r">Claimable GST</th></tr>
                </thead>
                <tbody>
                  {cat.categories.map((c) => (
                    <tr key={c.categoryId}>
                      <td>{c.category}</td>
                      <td className="r">{c.count}</td>
                      <td className="r">{formatAUD(c.audCents)}</td>
                      <td className="r">{formatAUD(c.deductibleCents)}</td>
                      <td className="r">{formatAUD(c.claimableGstCents)}</td>
                    </tr>
                  ))}
                  {cat.categories.length === 0 && <tr><td colSpan={5} className="empty">No confirmed expenses in FY {fy}.</td></tr>}
                </tbody>
                {cat.categories.length > 0 && (
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="r">{cat.totals.count}</td>
                      <td className="r">{formatAUD(cat.totals.audCents)}</td>
                      <td className="r">{formatAUD(cat.totals.deductibleCents)}</td>
                      <td className="r">{formatAUD(cat.totals.claimableGstCents)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "gst" && (
        <div>
          {!gst ? <div className="card"><div className="empty"><span className="spin" /></div></div> : (
            <>
              <div className="card">
                <h2>Quarterly GST / BAS summary — FY {fy}</h2>
                <div className="tablewrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Quarter</th>
                        <th className="r">G10 · capital purchases</th>
                        <th className="r">G11 · non-capital purchases</th>
                        <th className="r">1B · GST credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gst.quarters.map((q) => (
                        <tr key={q.quarter}>
                          <td>{q.quarter} <span className="muted">{q.label}</span></td>
                          <td className="r">{formatAUD(q.g10Cents)}</td>
                          <td className="r">{formatAUD(q.g11Cents)}</td>
                          <td className="r">
                            {formatAUD(q.oneBCents)}
                            {q.excludedGstCents > 0 && <div className="small" style={{ color: "var(--danger)" }}>+{formatAUD(q.excludedGstCents)} excluded (no tax invoice)</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>FY total</td>
                        <td className="r">{formatAUD(gst.totals.g10Cents)}</td>
                        <td className="r">{formatAUD(gst.totals.g11Cents)}</td>
                        <td className="r">{formatAUD(gst.totals.oneBCents)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="small muted">
                  Methodology: amounts are GST-inclusive AUD, business-use portion only. G10 = capital, G11 = non-capital (all GST treatments, per the ATO calculation worksheet — see the breakdown below for your accountant to adjust, e.g. G14 for no-GST purchases). 1B = business-use portion of GST on records marked “GST included”, excluding records over {formatAUD(gst.thresholdCents)} with no tax invoice attached.
                </p>
              </div>

              <div className="card">
                <h2>Breakdown by GST treatment</h2>
                <div className="tablewrap">
                  <table className="data">
                    <thead>
                      <tr><th>Quarter</th><th className="r">GST included</th><th className="r">GST-free / no GST</th><th className="r">Input taxed</th></tr>
                    </thead>
                    <tbody>
                      {gst.quarters.map((q) => (
                        <tr key={q.quarter}>
                          <td>{q.quarter}</td>
                          <td className="r">{formatAUD(q.byTreatment.gst?.businessAudCents ?? 0)} <span className="muted small">({q.byTreatment.gst?.count ?? 0})</span></td>
                          <td className="r">{formatAUD(q.byTreatment.gst_free?.businessAudCents ?? 0)} <span className="muted small">({q.byTreatment.gst_free?.count ?? 0})</span></td>
                          <td className="r">{formatAUD(q.byTreatment.input_taxed?.businessAudCents ?? 0)} <span className="muted small">({q.byTreatment.input_taxed?.count ?? 0})</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {gst.totals.flaggedCount > 0 && (
                <div className="card" style={{ borderColor: "#eecac6" }}>
                  <h2 style={{ color: "var(--danger)" }}>⚠ GST credits blocked — no tax invoice</h2>
                  <p className="small muted mt0">These GST-claimable purchases are over {formatAUD(gst.thresholdCents)} with no receipt attached. Attach a valid tax invoice to include the credit in 1B.</p>
                  <div className="tablewrap">
                    <table className="data">
                      <thead><tr><th>Date</th><th>Supplier</th><th className="r">Amount</th><th className="r">GST at risk</th><th /></tr></thead>
                      <tbody>
                        {gst.quarters.flatMap((q) => q.flaggedNoInvoice).map((f) => (
                          <tr key={f.id}>
                            <td>{formatDateAU(f.date)}</td>
                            <td>{f.supplier}</td>
                            <td className="r">{formatAUD(f.audCents)}</td>
                            <td className="r">{formatAUD(f.claimableGstCents)}</td>
                            <td><Link href={`/expenses/${f.id}`}>attach →</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "depreciation" && (
        <div className="card">
          <h2>Depreciation schedule — capital assets, FY {fy}</h2>
          <p className="small muted mt0">Inputs for your accountant — this app deliberately does not calculate depreciation deductions. Effective life is your manual entry; your accountant will confirm it.</p>
          {!dep ? <div className="empty"><span className="spin" /></div> : (
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr><th>Asset</th><th>Purchased</th><th>Supplier</th><th className="r">Cost (AUD)</th><th className="r">Business use</th><th className="r">Effective life</th><th>Receipt</th></tr>
                </thead>
                <tbody>
                  {dep.assets.map((a) => (
                    <tr key={a.id}>
                      <td><Link href={`/expenses/${a.id}`}>{a.assetName}</Link></td>
                      <td className="nowrap">{formatDateAU(a.purchaseDate)}</td>
                      <td>{a.supplier}</td>
                      <td className="r">
                        {formatAUD(a.costAudCents)}
                        {a.originalCurrency !== "AUD" && <div className="muted small">{a.originalCurrency} {(a.originalAmountCents / 100).toFixed(2)}</div>}
                      </td>
                      <td className="r">{bpToPercentString(a.businessUseBp)}%</td>
                      <td className="r">{a.effectiveLifeYears ? `${a.effectiveLifeYears} yrs` : <span className="badge warn">not set</span>}</td>
                      <td>{a.hasReceipt ? <span className="badge ok">yes</span> : <span className="badge danger">missing</span>}</td>
                    </tr>
                  ))}
                  {dep.assets.length === 0 && <tr><td colSpan={7} className="empty">No capital assets recorded in FY {fy}.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "missing" && (
        <div className="card">
          <h2>Missing receipts — FY {fy}</h2>
          {!missing ? <div className="empty"><span className="spin" /></div> : (
            <div className="tablewrap">
              <table className="data">
                <thead><tr><th>Date</th><th>Supplier</th><th>Description</th><th className="r">AUD</th><th>Why it matters</th></tr></thead>
                <tbody>
                  {missing.records.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap"><Link href={`/expenses/${m.id}`}>{formatDateAU(m.date)}</Link></td>
                      <td>{m.supplier}</td>
                      <td>{m.description}{m.status === "draft" ? " (draft)" : ""}</td>
                      <td className="r">{formatAUD(m.audCents)}</td>
                      <td>
                        {m.severity === "gst_invoice_required" && <span className="badge danger">GST credit blocked</span>}
                        {m.severity === "receipt_required" && <span className="badge warn">over receipt threshold</span>}
                        {m.severity === "info" && <span className="badge neutral">good practice</span>}
                      </td>
                    </tr>
                  ))}
                  {missing.records.length === 0 && <tr><td colSpan={5} className="empty">🎉 Every record in FY {fy} has a receipt.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="empty"><span className="spin" /></div>}>
      <ReportsInner />
    </Suspense>
  );
}
