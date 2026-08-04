"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { formatAUD, formatCurrency } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";

type Progress = { total: number; unreviewed: number; logged: number; ignored: number; donePct: number };

type StatementFile = {
  id: string; fyLabel: string; filename: string; periodStart: string | null; periodEnd: string | null;
  sizeBytes: number; txnCount: number; hasFile: boolean;
};

type Account = {
  id: string; label: string; institution: string; accountRef: string | null; kind: string;
  progress: Progress; statements: StatementFile[];
};

type Overview = { accounts: Account[]; financialYears: string[]; progress: Progress };

type Txn = {
  id: string; accountId: string; date: string; description: string; counterparty: string | null;
  direction: "in" | "out"; amountCents: number; currency: string; audAmountCents: number | null;
  status: "unreviewed" | "logged" | "ignored";
  matchedExpenseId: string | null; matchedIncomeId: string | null; matchSource: string | null;
  ignoreReason: string | null;
};

type TxnPage = { transactions: Txn[]; totals: { count: number; outCents: number; inCents: number }; hasMore: boolean; progress: Progress };

const STATUS_TABS = [
  { id: "unreviewed", label: "To review" },
  { id: "logged", label: "Logged" },
  { id: "ignored", label: "Set aside" },
  { id: "", label: "All" },
] as const;

const QUICK_REASONS = [
  "Personal",
  "Own transfer between my accounts",
  "Card repayment — not an expense",
  "Refunded / reversed",
  "Family or gift",
  "Already counted elsewhere",
];

function Bar({ p }: { p: Progress }) {
  const logged = p.total ? (p.logged / p.total) * 100 : 0;
  const ignored = p.total ? (p.ignored / p.total) * 100 : 0;
  return (
    <div className="pbar" title={`${p.logged} logged · ${p.ignored} set aside · ${p.unreviewed} to review`}>
      <span className="seg logged" style={{ width: `${logged}%` }} />
      <span className="seg ignored" style={{ width: `${ignored}%` }} />
    </div>
  );
}

export default function StatementsPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [fy, setFy] = useState("");
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState<string>("unreviewed");
  const [direction, setDirection] = useState("");
  const [q, setQ] = useState("");
  const [minDollars, setMinDollars] = useState("");
  const [page, setPage] = useState<TxnPage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Overview>(`/api/statements${fy ? `?fy=${fy}` : ""}`)
      .then((o) => {
        setOv(o);
        if (!fy && o.financialYears.length) setFy(o.financialYears[0]);
      })
      .catch((e) => setError(e.message));
  }, [fy]);

  const loadTxns = useCallback(() => {
    const p = new URLSearchParams();
    if (fy) p.set("fy", fy);
    if (accountId) p.set("accountId", accountId);
    if (status) p.set("status", status);
    if (direction) p.set("direction", direction);
    if (q.trim()) p.set("q", q.trim());
    if (minDollars) p.set("min", String(Math.round(Number(minDollars) * 100)));
    p.set("limit", "300");
    setPage(null);
    apiGet<TxnPage>(`/api/statements/transactions?${p}`).then(setPage).catch((e) => setError(e.message));
  }, [fy, accountId, status, direction, q, minDollars]);

  useEffect(() => {
    const t = setTimeout(loadTxns, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadTxns, q]);

  async function removeStatement(id: string, filename: string) {
    if (!confirm(`Remove "${filename}" and its parsed lines? The tracker records it matched are untouched.`)) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/statements/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not remove");
      apiGet<Overview>(`/api/statements${fy ? `?fy=${fy}` : ""}`).then(setOv).catch(() => {});
      loadTxns();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function review(id: string, next: Txn["status"], ignoreReason?: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/statements/transactions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, ignoreReason }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update");
      setReasonFor(null);
      loadTxns();
      apiGet<Overview>(`/api/statements${fy ? `?fy=${fy}` : ""}`).then(setOv).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const accounts = ov?.accounts ?? [];
  const current = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);
  const shownProgress = page?.progress ?? current?.progress ?? ov?.progress;

  if (error) return <div className="alert danger">{error}</div>;

  return (
    <div>
      <div className="section-head">
        <h1>Bank statements</h1>
        {ov && ov.financialYears.length > 0 && (
          <span className="fyswitch" style={{ margin: 0 }}>
            {ov.financialYears.map((f) => (
              <button key={f} type="button" className={f === fy ? "active" : ""} onClick={() => setFy(f)}>
                FY {f}
              </button>
            ))}
          </span>
        )}
      </div>

      {!ov ? (
        <div className="empty"><span className="spin" /> Loading…</div>
      ) : ov.accounts.length === 0 ? (
        <div className="card">
          <h2>No statements yet</h2>
          <p className="muted">
            Statements are ingested through the agent API, which stores the original file alongside the
            parsed lines. Ask Claude to load a financial year and it will appear here.
          </p>
          <p className="muted small">The old CSV importer is still available at <Link href="/import">/import</Link>.</p>
        </div>
      ) : (
        <>
          {shownProgress && shownProgress.total > 0 && (
            <div className="card mb2">
              <div className="revhead">
                <div>
                  <div className="revpct">{shownProgress.donePct}%</div>
                  <div className="muted small">
                    {shownProgress.logged + shownProgress.ignored} of {shownProgress.total} lines dealt with
                    {current ? ` · ${current.label}` : " · all accounts"}
                  </div>
                </div>
                <div className="revlegend">
                  <span><i className="dot logged" /> {shownProgress.logged} logged</span>
                  <span><i className="dot ignored" /> {shownProgress.ignored} set aside</span>
                  <span><i className="dot todo" /> {shownProgress.unreviewed} to review</span>
                </div>
              </div>
              <Bar p={shownProgress} />
            </div>
          )}

          <div className="acctgrid mb2">
            <button
              type="button"
              className={`acct${accountId === "" ? " active" : ""}`}
              onClick={() => setAccountId("")}
            >
              <div className="acctname">All accounts</div>
              <div className="muted small">{ov.progress.total} lines · FY {fy}</div>
              <Bar p={ov.progress} />
            </button>
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`acct${accountId === a.id ? " active" : ""}`}
                onClick={() => setAccountId(a.id)}
              >
                <div className="acctname">
                  {a.label} <span className={`badge ${a.kind === "card" ? "warn" : ""}`}>{a.kind}</span>
                </div>
                <div className="muted small">
                  {a.accountRef ?? a.institution} · {a.progress.total} lines
                </div>
                <Bar p={a.progress} />
                {a.statements.length > 0 && (
                  <div className="files">
                    {a.statements.map((s) => (
                      <a
                        key={s.id}
                        href={`/api/statements/${s.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={`${s.filename} · ${s.txnCount} lines${s.periodStart ? ` · ${formatDateAU(s.periodStart)} – ${formatDateAU(s.periodEnd!)}` : ""}`}
                      >
                        ⤓ {s.periodStart ? formatDateAU(s.periodStart).slice(0, 6) : "PDF"}
                      </a>
                    ))}
                    {accountId === a.id && a.statements.map((s) => (
                      <button
                        key={`rm-${s.id}`}
                        type="button"
                        className="rmfile"
                        disabled={busy === s.id}
                        title={`Remove ${s.filename}`}
                        onClick={(e) => { e.stopPropagation(); removeStatement(s.id, s.filename); }}
                      >
                        ✕ {s.periodStart ? formatDateAU(s.periodStart).slice(0, 6) : s.filename.slice(0, 8)}
                      </button>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="filters">
              <div className="tabs">
                {STATUS_TABS.map((t) => (
                  <button key={t.id} type="button" className={status === t.id ? "active" : ""} onClick={() => setStatus(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <input placeholder="Search merchant or description…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="">In &amp; out</option>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </select>
              <input
                type="number"
                inputMode="decimal"
                placeholder="Min $"
                value={minDollars}
                onChange={(e) => setMinDollars(e.target.value)}
                style={{ maxWidth: 110 }}
              />
            </div>

            {!page ? (
              <div className="empty"><span className="spin" /> Loading…</div>
            ) : page.transactions.length === 0 ? (
              <div className="empty">
                {status === "unreviewed" ? "Nothing left to review here. " : "No lines match these filters."}
              </div>
            ) : (
              <>
                <div className="muted small mb1">
                  {page.totals.count} line{page.totals.count === 1 ? "" : "s"} · out {formatAUD(page.totals.outCents)} · in {formatAUD(page.totals.inCents)}
                  {page.hasMore && " · showing the first 300"}
                </div>
                <div className="tablewrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Date</th><th>Description</th><th className="r">Amount</th><th>Status</th><th className="r">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.transactions.map((t) => (
                        <tr key={t.id} className={t.status !== "unreviewed" ? "done" : ""}>
                          <td className="nowrap">{formatDateAU(t.date)}</td>
                          <td>
                            <div className="txndesc">{t.counterparty || t.description}</div>
                            {t.counterparty && <div className="muted small">{t.description}</div>}
                            {t.ignoreReason && <div className="muted small">Set aside — {t.ignoreReason}</div>}
                          </td>
                          <td className="r nowrap">
                            <span className={t.direction === "in" ? "amt in" : "amt"}>
                              {t.direction === "in" ? "+" : ""}
                              {t.currency === "AUD"
                                ? formatAUD(t.amountCents)
                                : formatCurrency(t.amountCents, t.currency)}
                            </span>
                            {t.currency !== "AUD" && t.audAmountCents != null && (
                              <div className="muted small">≈{formatAUD(t.audAmountCents)}</div>
                            )}
                          </td>
                          <td>
                            {t.status === "logged" && (
                              <span className="badge ok">
                                logged{t.matchSource === "auto" ? " (auto)" : ""}
                              </span>
                            )}
                            {t.status === "ignored" && <span className="badge">set aside</span>}
                            {t.status === "unreviewed" && <span className="badge warn">to review</span>}
                            {(t.matchedExpenseId || t.matchedIncomeId) && (
                              <div>
                                <Link
                                  className="small"
                                  href={t.matchedExpenseId ? `/expenses/${t.matchedExpenseId}` : `/income/${t.matchedIncomeId}`}
                                >
                                  view record →
                                </Link>
                              </div>
                            )}
                          </td>
                          <td className="r nowrap">
                            {t.status === "unreviewed" ? (
                              reasonFor === t.id ? (
                                <div className="reasons">
                                  {QUICK_REASONS.map((r) => (
                                    <button key={r} type="button" className="btn ghost small" disabled={busy === t.id} onClick={() => review(t.id, "ignored", r)}>
                                      {r}
                                    </button>
                                  ))}
                                  <button type="button" className="btn ghost small" onClick={() => setReasonFor(null)}>cancel</button>
                                </div>
                              ) : (
                                <span className="btnrow">
                                  <button type="button" className="btn ghost small" disabled={busy === t.id} onClick={() => setReasonFor(t.id)}>
                                    Set aside
                                  </button>
                                  <button type="button" className="btn small" disabled={busy === t.id} onClick={() => review(t.id, "logged")}>
                                    Mark logged
                                  </button>
                                </span>
                              )
                            ) : (
                              <button type="button" className="btn ghost small" disabled={busy === t.id} onClick={() => review(t.id, "unreviewed")}>
                                Undo
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
