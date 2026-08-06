"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/client";
import { formatAUD, bpToPercentString } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import type { MetaDto } from "@/lib/types";

type Tab = "profit" | "category" | "gst" | "depreciation" | "missing";

type ProfitReport = {
  fy: string;
  income: {
    byType: { type: string; count: number; audCents: number; gstCents: number }[];
    byClient: { client: string; count: number; audCents: number }[];
    totals: { count: number; audCents: number; gstCents: number; outstandingCents: number; outstandingCount: number };
  };
  expenses: { count: number; audCents: number; deductibleCents: number; claimableGstCents: number };
  profit: { incomeAudCents: number; incomeExGstCents: number; deductibleExpenseCents: number; claimableGstCents: number; netCents: number };
};

const INCOME_TYPE_LABELS: Record<string, string> = {
  client_work: "Client work",
  licensing: "Licensing / royalties",
  grant: "Grant / rebate",
  interest: "Interest",
  other: "Other income",
};

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
    g1Cents: number;
    oneACents: number;
    netGstCents: number;
    byTreatment: Record<string, { count: number; audCents: number; businessAudCents: number }>;
    flaggedNoInvoice: { id: string; date: string; supplier: string; audCents: number; claimableGstCents: number }[];
  }[];
  totals: { g10Cents: number; g11Cents: number; oneBCents: number; excludedGstCents: number; flaggedCount: number; g1Cents: number; oneACents: number; netGstCents: number };
  thresholdCents: number;
  basis: "accruals" | "cash";
  excludedInterestCents: number;
  deferred: { invoiceRef: string | null; client: string; audCents: number; dateEarned: string; datePaid: string | null }[];
};

type DepreciationReport = {
  assets: {
    id: string; assetName: string; purchaseDate: string; supplier: string; costAudCents: number;
    originalAmountCents: number; originalCurrency: string; businessUseBp: number;
    businessPortionCents: number;
    effectiveLifeYears: string | null; financialYear: string; hasReceipt: boolean;
    thresholdCents: number | null;
    method: "immediate" | "pool" | "unknown";
    deductionCents: number;
    treatmentNote: string;
    disposal: {
      date: string; reason: string | null; terminationValueCents: number;
      adjustableValueCents: number | null; note: string | null;
      deductionCents: number; assessableCents: number;
    } | null;
  }[];
  totals: {
    count: number; costCents: number; deductionCents: number;
    balancingDeductionCents: number; balancingAssessableCents: number;
    unknownTreatment: number;
  };
};

type MissingReport = {
  records: { id: string; date: string; supplier: string; description: string; audCents: number; status: string; severity: "gst_invoice_required" | "receipt_required" | "info" }[];
};

function ReportsInner() {
  const params = useSearchParams();
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [fy, setFy] = useState("");
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "profit");
  const [profit, setProfit] = useState<ProfitReport | null>(null);
  const [cat, setCat] = useState<CategoryReport | null>(null);
  const [gst, setGst] = useState<GstReport | null>(null);
  // Which basis the GST report is read on. Defaults to accruals because that is
  // how the ledger stores a sale; the toggle is what makes a cash-registered
  // BAS reconcile without re-deriving the numbers by hand.
  const [basis, setBasis] = useState<"accruals" | "cash">("accruals");
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
    setCat(null); setGst(null); setDep(null); setMissing(null); setProfit(null);
    Promise.all([
      apiGet<CategoryReport>(`/api/reports/category?fy=${fy}`),
      apiGet<GstReport>(`/api/reports/gst?fy=${fy}&basis=${basis}`),
      apiGet<DepreciationReport>(`/api/reports/depreciation?fy=${fy}`),
      apiGet<MissingReport>(`/api/reports/missing-receipts?fy=${fy}`),
      apiGet<ProfitReport>(`/api/reports/income?fy=${fy}`),
    ]).then(([c, g, d, m, p]) => { setCat(c); setGst(g); setDep(d); setMissing(m); setProfit(p); })
      .catch((e) => setError(e.message));
  }, [fy, basis]);

  if (error) return <div className="alert danger">{error}</div>;
  if (!meta || !fy) return <div className="empty"><span className="spin" /> Loading…</div>;

  const TABS: { id: Tab; label: string }[] = [
    { id: "profit", label: "Income & profit" },
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
          <a className="btn ghost small" href={`/api/export/csv?fy=${fy}`}>⬇ Expenses CSV — FY {fy}</a>
          <a className="btn ghost small" href={`/api/export/income-csv?fy=${fy}`}>⬇ Income CSV — FY {fy}</a>
          <a className="btn ghost small" href={`/api/export/csv?fy=all`}>⬇ Expenses — all years</a>
          <a className="btn ghost small" href={`/api/export/backup?fy=all`}>⬇ Full backup (zip: JSON + all receipts)</a>
        </div>
        <p className="small muted mt1" style={{ marginBottom: 0 }}>
          CSVs: one row per record, all fields, AUD amounts as plain decimals, dates DD/MM/YYYY. Backup: everything including income, restorable and readable without this app — keep an offline copy somewhere safe.
        </p>
      </div>

      {tab === "profit" && (
        <div>
          {!profit ? <div className="card"><div className="empty"><span className="spin" /></div></div> : (
            <>
              <div className="stats mb2">
                <div className="stat">
                  <div className="label">Income</div>
                  <div className="value">{formatAUD(profit.profit.incomeAudCents)}</div>
                  <div className="sub">{profit.income.totals.count} record{profit.income.totals.count === 1 ? "" : "s"}</div>
                </div>
                <div className="stat">
                  <div className="label">Deductible expenses</div>
                  <div className="value">{formatAUD(profit.profit.deductibleExpenseCents)}</div>
                  <div className="sub">{profit.expenses.count} expense{profit.expenses.count === 1 ? "" : "s"}</div>
                </div>
                <div className="stat">
                  <div className="label">Net (indicative)</div>
                  <div className="value" style={{ color: profit.profit.netCents >= 0 ? "var(--ok)" : "var(--danger)" }}>
                    {formatAUD(profit.profit.netCents)}
                  </div>
                  <div className="sub">income − expenses, both ex-GST</div>
                </div>
                <div className="stat">
                  <div className="label">Awaiting payment</div>
                  <div className="value">{formatAUD(profit.income.totals.outstandingCents)}</div>
                  <div className="sub">{profit.income.totals.outstandingCount} unpaid</div>
                </div>
              </div>

              <div className="card">
                <h2>How the net figure is built — FY {fy}</h2>
                <div className="tablewrap">
                  <table className="data">
                    <tbody>
                      <tr><td>Income received / invoiced</td><td className="r">{formatAUD(profit.profit.incomeAudCents)}</td></tr>
                      <tr><td>less GST collected on sales (owed to the ATO)</td><td className="r">−{formatAUD(profit.income.totals.gstCents)}</td></tr>
                      <tr><td><b>Income excluding GST</b></td><td className="r"><b>{formatAUD(profit.profit.incomeExGstCents)}</b></td></tr>
                      <tr><td>less deductible expenses (business-use portion)</td><td className="r">−{formatAUD(profit.profit.deductibleExpenseCents)}</td></tr>
                      <tr><td>add back GST credits claimable on those purchases</td><td className="r">+{formatAUD(profit.profit.claimableGstCents)}</td></tr>
                    </tbody>
                    <tfoot>
                      <tr><td>Indicative net</td><td className="r">{formatAUD(profit.profit.netCents)}</td></tr>
                    </tfoot>
                  </table>
                </div>
                <p className="small muted">
                  Indicative only — a working figure, not a tax return. It excludes depreciation on capital assets, anything paid outside this tracker, and any adjustments your accountant makes.
                </p>
              </div>

              <div className="card">
                <h2>Income by client</h2>
                <div className="tablewrap">
                  <table className="data">
                    <thead><tr><th>Client</th><th className="r">Records</th><th className="r">Total AUD</th></tr></thead>
                    <tbody>
                      {profit.income.byClient.map((c) => (
                        <tr key={c.client}><td>{c.client}</td><td className="r">{c.count}</td><td className="r">{formatAUD(c.audCents)}</td></tr>
                      ))}
                      {profit.income.byClient.length === 0 && <tr><td colSpan={3} className="empty">No income recorded for FY {fy}.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {profit.income.byType.length > 0 && (
                <div className="card">
                  <h2>Income by type</h2>
                  <div className="tablewrap">
                    <table className="data">
                      <thead><tr><th>Type</th><th className="r">Records</th><th className="r">Total AUD</th></tr></thead>
                      <tbody>
                        {profit.income.byType.map((t) => (
                          <tr key={t.type}><td>{INCOME_TYPE_LABELS[t.type] ?? t.type}</td><td className="r">{t.count}</td><td className="r">{formatAUD(t.audCents)}</td></tr>
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
                <div className="section-head" style={{ margin: "0 0 12px" }}>
                  <h2 style={{ margin: 0 }}>Quarterly GST / BAS summary — FY {fy}</h2>
                  <div className="fyswitch" role="group" aria-label="Accounting basis">
                    <button type="button" className={basis === "accruals" ? "active" : ""} onClick={() => setBasis("accruals")}>
                      Accruals
                    </button>
                    <button type="button" className={basis === "cash" ? "active" : ""} onClick={() => setBasis("cash")}>
                      Cash
                    </button>
                  </div>
                </div>
                <p className="small muted" style={{ marginTop: -4, marginBottom: 12 }}>
                  {basis === "cash"
                    ? "Cash basis — a sale counts in the quarter the money arrived. Report on this basis only if that is how you are registered for GST."
                    : "Accruals basis — a sale counts in the quarter it was invoiced, whether or not it has been paid."}
                </p>
                <div className="tablewrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Quarter</th>
                        <th className="r">G1 · total sales</th>
                        <th className="r">1A · GST on sales</th>
                        <th className="r">G10 · capital</th>
                        <th className="r">G11 · non-capital</th>
                        <th className="r">1B · GST credits</th>
                        <th className="r">Net GST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gst.quarters.map((q) => (
                        <tr key={q.quarter}>
                          <td>{q.quarter} <span className="muted">{q.label}</span></td>
                          <td className="r">{formatAUD(q.g1Cents)}</td>
                          <td className="r">{formatAUD(q.oneACents)}</td>
                          <td className="r">{formatAUD(q.g10Cents)}</td>
                          <td className="r">{formatAUD(q.g11Cents)}</td>
                          <td className="r">
                            {formatAUD(q.oneBCents)}
                            {q.excludedGstCents > 0 && <div className="small" style={{ color: "var(--danger)" }}>+{formatAUD(q.excludedGstCents)} excluded (no tax invoice)</div>}
                          </td>
                          <td className="r" style={{ color: q.netGstCents > 0 ? "var(--danger)" : "var(--ok)" }}>
                            {formatAUD(q.netGstCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>FY total</td>
                        <td className="r">{formatAUD(gst.totals.g1Cents)}</td>
                        <td className="r">{formatAUD(gst.totals.oneACents)}</td>
                        <td className="r">{formatAUD(gst.totals.g10Cents)}</td>
                        <td className="r">{formatAUD(gst.totals.g11Cents)}</td>
                        <td className="r">{formatAUD(gst.totals.oneBCents)}</td>
                        <td className="r">{formatAUD(gst.totals.netGstCents)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="small muted" style={{ marginBottom: 4 }}>
                  <b>Net GST</b> = 1A (collected on sales) − 1B (credits on purchases). Positive means payable to the ATO; negative means refundable.
                </p>
                {(gst.excludedInterestCents > 0 || gst.deferred.length > 0) && (
                  <div className="alert info" style={{ marginTop: 10 }}>
                    <b>Reconciling items.</b>
                    {gst.excludedInterestCents > 0 && (
                      <div className="small" style={{ marginTop: 4 }}>
                        {formatAUD(gst.excludedInterestCents)} of bank interest is excluded from G1 — interest is an
                        input-taxed financial supply, not a sale.
                      </div>
                    )}
                    {gst.deferred.length > 0 && (
                      <div className="small" style={{ marginTop: 4 }}>
                        {gst.deferred.length} invoice{gst.deferred.length === 1 ? "" : "s"} dated in FY {fy} but not paid
                        by 30 June{" "}
                        {gst.deferred.map((d) => `${d.invoiceRef ?? d.client} ${formatAUD(d.audCents)}`).join(", ")} —
                        excluded here on the cash basis and picked up in the following year&apos;s G1. This is the
                        difference between the two bases.
                      </div>
                    )}
                  </div>
                )}
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
                <div className="card flagged">
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
          <p className="small muted mt0">
            Simplified depreciation for a small business entity. An asset costing under the instant
            asset write-off threshold for its year is deductible in full at the business-use share;
            anything at or above it goes to the small business pool at 15% in the first year and 30%
            after. Effective life is your manual entry. Figures are working estimates — your
            accountant confirms the treatment.
          </p>
          {!dep ? <div className="empty"><span className="spin" /></div> : (
            <>
              {dep.totals.unknownTreatment > 0 && (
                <div className="alert warn">
                  {dep.totals.unknownTreatment} asset{dep.totals.unknownTreatment > 1 ? "s" : ""} can&apos;t be
                  worked out — no instant asset write-off threshold is set for that financial year.{" "}
                  <Link href="/settings">Set it in Settings</Link> and these will calculate.
                </div>
              )}
              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr><th>Asset</th><th>Purchased</th><th className="r">Cost (AUD)</th><th className="r">Business use</th><th>Treatment</th><th className="r">Deduction</th><th>Disposal</th><th>Receipt</th></tr>
                  </thead>
                  <tbody>
                    {dep.assets.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/expenses/${a.id}`}>{a.assetName}</Link>
                          <div className="muted small">{a.supplier}</div>
                        </td>
                        <td className="nowrap">{formatDateAU(a.purchaseDate)}</td>
                        <td className="r">
                          {formatAUD(a.costAudCents)}
                          {a.originalCurrency !== "AUD" && <div className="muted small">{a.originalCurrency} {(a.originalAmountCents / 100).toFixed(2)}</div>}
                        </td>
                        <td className="r">
                          {bpToPercentString(a.businessUseBp)}%
                          <div className="muted small">{formatAUD(a.businessPortionCents)}</div>
                        </td>
                        <td>
                          {a.method === "immediate" && <span className="badge ok">written off</span>}
                          {a.method === "pool" && <span className="badge info">pool 15%/30%</span>}
                          {a.method === "unknown" && <span className="badge warn">threshold not set</span>}
                          <div className="muted small">
                            {a.effectiveLifeYears ? `${a.effectiveLifeYears} yr life` : "life not set"}
                          </div>
                        </td>
                        <td className="r">{a.deductionCents > 0 ? formatAUD(a.deductionCents) : "—"}</td>
                        <td>
                          {a.disposal ? (
                            <>
                              <span className="badge">{a.disposal.reason ?? "disposed"}</span>
                              <div className="muted small">{formatDateAU(a.disposal.date)}</div>
                              {a.disposal.deductionCents > 0 && (
                                <div className="small">+{formatAUD(a.disposal.deductionCents)} deduction</div>
                              )}
                              {a.disposal.assessableCents > 0 && (
                                <div className="small">{formatAUD(a.disposal.assessableCents)} assessable</div>
                              )}
                              {a.disposal.deductionCents === 0 && a.disposal.assessableCents === 0 && (
                                <div className="muted small">no adjustment</div>
                              )}
                            </>
                          ) : <span className="muted small">held</span>}
                        </td>
                        <td>{a.hasReceipt ? <span className="badge ok">yes</span> : <span className="badge danger">missing</span>}</td>
                      </tr>
                    ))}
                    {dep.assets.length === 0 && <tr><td colSpan={8} className="empty">No capital assets recorded in FY {fy}.</td></tr>}
                  </tbody>
                  {dep.assets.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="r strong">Totals</td>
                        <td className="muted small">{dep.totals.count} asset{dep.totals.count === 1 ? "" : "s"}</td>
                        <td className="r strong">{formatAUD(dep.totals.deductionCents)}</td>
                        <td className="small">
                          {dep.totals.balancingDeductionCents > 0 && <div>+{formatAUD(dep.totals.balancingDeductionCents)} deduction</div>}
                          {dep.totals.balancingAssessableCents > 0 && <div>{formatAUD(dep.totals.balancingAssessableCents)} assessable</div>}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
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
