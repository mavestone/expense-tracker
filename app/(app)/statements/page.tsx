"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { formatAUD, formatCurrency } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import { useDialog } from "@/components/Dialog";
import { useFy } from "@/components/FyContext";
import { useToast } from "@/components/Toast";

type Progress = { total: number; unreviewed: number; logged: number; personal: number; ignored: number; donePct: number };

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
  status: "unreviewed" | "logged" | "personal" | "ignored";
  matchedExpenseId: string | null; matchedIncomeId: string | null; matchSource: string | null;
  ignoreReason: string | null;
};

type TxnPage = { transactions: Txn[]; totals: { count: number; outCents: number; inCents: number; unconverted: number }; hasMore: boolean; progress: Progress };

const STATUS_TABS = [
  { id: "unreviewed", label: "Needs a decision" },
  { id: "logged", label: "Business" },
  { id: "personal", label: "Personal" },
  { id: "ignored", label: "Internal transfers & fees" },
  { id: "", label: "All" },
] as const;

const NOT_SPENDING_REASONS = [
  "Own transfer between my accounts",
  "Card repayment",
  "Reimbursement",
  "Refunded / reversed",
  "Family or gift",
  "Already counted elsewhere",
];

function Bar({ p }: { p: Progress }) {
  const pct = (n: number) => (p.total ? (n / p.total) * 100 : 0);
  return (
    <div className="pbar" title={`${p.logged} business · ${p.personal} personal · ${p.ignored} transfers · ${p.unreviewed} to decide`}>
      <span className="seg logged" style={{ width: `${pct(p.logged)}%` }} />
      <span className="seg personal" style={{ width: `${pct(p.personal)}%` }} />
      <span className="seg ignored" style={{ width: `${pct(p.ignored)}%` }} />
    </div>
  );
}

export default function StatementsPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  // Triage is per year; "all years" falls back to the current FY.
  const { resolved: fy } = useFy();
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState<string>("unreviewed");
  const [direction, setDirection] = useState("");
  const [q, setQ] = useState("");
  const [minDollars, setMinDollars] = useState("");
  const [page, setPage] = useState<TxnPage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { ask, dialog } = useDialog();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState(false);

  useEffect(() => {
    if (!fy) return;
    apiGet<Overview>(`/api/statements?fy=${fy}`).then(setOv).catch((e) => setError(e.message));
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
    setSelected(new Set());
    apiGet<TxnPage>(`/api/statements/transactions?${p}`).then(setPage).catch((e) => setError(e.message));
  }, [fy, accountId, status, direction, q, minDollars]);

  useEffect(() => {
    const t = setTimeout(loadTxns, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadTxns, q]);

  function removeStatement(id: string, filename: string) {
    ask({
      title: "Remove this statement?",
      body: (
        <>
          <b>{filename}</b> and its parsed lines will be removed. Expense and income records it matched are
          untouched — only the statement and its reconciliation are.
        </>
      ),
      confirmLabel: "Remove statement",
      danger: true,
      onConfirm: () => doRemoveStatement(id),
    });
  }

  async function doRemoveStatement(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/statements/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not remove");
      apiGet<Overview>(`/api/statements${fy ? `?fy=${fy}` : ""}`).then(setOv).catch(() => {});
      toast("Statement removed");
      loadTxns();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function applyBulk(next: Txn["status"], ignoreReason?: string) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy("bulk");
    try {
      const res = await fetch("/api/statements/transactions/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, status: next, ignoreReason }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update");
      setBulkReason(false);
      loadTxns();
      apiGet<Overview>(`/api/statements${fy ? `?fy=${fy}` : ""}`).then(setOv).catch(() => {});
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
        <span className="muted small">FY {fy}</span>
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
                  <span><i className="dot logged" /> {shownProgress.logged} business</span>
                  <span><i className="dot personal" /> {shownProgress.personal} personal</span>
                  <span><i className="dot ignored" /> {shownProgress.ignored} transfers</span>
                  <span><i className="dot todo" /> {shownProgress.unreviewed} to decide</span>
                </div>
              </div>
              <Bar p={shownProgress} />
            </div>
          )}

          <div className="acctpills mb2">
            <button type="button" className={`apill all${accountId === "" ? " active" : ""}`} onClick={() => setAccountId("")}>
              <span className="alabel">All accounts</span>
              <span className="acount">{ov.progress.total}</span>
            </button>
            {accounts.map((a, i) => (
              <button
                key={a.id}
                type="button"
                className={`apill c${i % 4}${accountId === a.id ? " active" : ""}`}
                onClick={() => setAccountId(a.id)}
              >
                <span className="alabel">{a.label}</span>
                <span className="acount">{a.progress.total}</span>
                <span className="apct">{a.progress.donePct}%</span>
              </button>
            ))}
          </div>

          {current && current.statements.length > 0 && (
            <div className="stfiles mb2">
              <span className="muted small">Original statements —</span>
              {current.statements.map((st) => (
                <span key={st.id} className="stfile">
                  <a href={`/api/statements/${st.id}/file`} target="_blank" rel="noreferrer" title={`${st.filename} · ${st.txnCount} lines`}>
                    ⤓ {st.periodStart ? `${formatDateAU(st.periodStart)} – ${formatDateAU(st.periodEnd!)}` : st.filename}
                  </a>
                  <button type="button" className="rmfile" disabled={busy === st.id} title="Remove this statement" onClick={() => removeStatement(st.id, st.filename)}>✕</button>
                </span>
              ))}
            </div>
          )}

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
                  {page.totals.unconverted > 0 && ` · ${page.totals.unconverted} foreign line${page.totals.unconverted === 1 ? "" : "s"} not converted, excluded from these totals`}
                  {page.hasMore && " · showing the first 300"}
                </div>
                {selected.size > 0 && (
                  <div className="bulkbar">
                    <span className="bcount">{selected.size} selected</span>
                    {bulkReason ? (
                      <>
                        {NOT_SPENDING_REASONS.map((r) => (
                          <button key={r} type="button" className="btn ghost small" disabled={busy === "bulk"} onClick={() => applyBulk("ignored", r)}>{r}</button>
                        ))}
                        <button type="button" className="btn ghost small" onClick={() => setBulkReason(false)}>cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn ghost small" disabled={busy === "bulk"} onClick={() => applyBulk("personal")}>Personal</button>
                        <button type="button" className="btn ghost small" disabled={busy === "bulk"} onClick={() => setBulkReason(true)}>Transfer</button>
                        <button type="button" className="btn small" disabled={busy === "bulk"} onClick={() => applyBulk("logged")}>Business</button>
                        <button type="button" className="btn ghost small" disabled={busy === "bulk"} onClick={() => applyBulk("unreviewed")}>Undo</button>
                        <button type="button" className="btn ghost small" onClick={() => setSelected(new Set())}>Clear</button>
                      </>
                    )}
                  </div>
                )}
                <div className="tablewrap">
                  <table className="data csv">
                    <thead>
                      <tr>
                        <th className="ck">
                          <input
                            type="checkbox"
                            aria-label="Select all shown"
                            checked={page.transactions.length > 0 && selected.size === page.transactions.length}
                            ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < page.transactions.length; }}
                            onChange={(e) =>
                              setSelected(e.target.checked ? new Set(page.transactions.map((x) => x.id)) : new Set())
                            }
                          />
                        </th>
                        <th>Date</th><th>Account</th><th>Description</th>
                        <th className="r">Amount</th><th className="r">AUD</th>
                        <th>Category</th><th className="r">Decide</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.transactions.map((t) => {
                        const acct = accounts.find((a) => a.id === t.accountId);
                        return (
                          <tr key={t.id} className={`${t.status !== "unreviewed" ? "done" : ""}${selected.has(t.id) ? " sel" : ""}`}>
                            <td className="ck">
                              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.description}`} />
                            </td>
                            <td className="nowrap mono">{t.date}</td>
                            <td className="nowrap muted small">{acct?.label ?? "—"}</td>
                            <td className="desc">
                              <span title={t.description}>{t.counterparty || t.description}</span>
                              {t.ignoreReason && <span className="muted small"> · {t.ignoreReason}</span>}
                            </td>
                            <td className="r nowrap mono">
                              <span className={t.direction === "in" ? "amt in" : "amt"}>
                                {t.direction === "in" ? "+" : "−"}
                                {t.currency === "AUD" ? formatAUD(t.amountCents) : formatCurrency(t.amountCents, t.currency)}
                              </span>
                            </td>
                            <td className="r nowrap mono muted">
                              {t.audAmountCents != null ? formatAUD(t.audAmountCents) : "—"}
                            </td>
                            <td className="nowrap">
                              {t.status === "logged" && <span className="badge ok">business</span>}
                              {t.status === "personal" && <span className="badge">personal</span>}
                              {t.status === "ignored" && <span className="badge">transfer</span>}
                              {t.status === "unreviewed" && <span className="badge warn">decide</span>}
                              {(t.matchedExpenseId || t.matchedIncomeId) && (
                                <Link className="small" style={{ marginLeft: 6 }} href={t.matchedExpenseId ? `/expenses/${t.matchedExpenseId}` : `/income/${t.matchedIncomeId}`}>
                                  record →
                                </Link>
                              )}
                            </td>
                            <td className="r nowrap">
                              {reasonFor === t.id ? (
                                <span className="reasons">
                                  {NOT_SPENDING_REASONS.map((r) => (
                                    <button key={r} type="button" className="btn ghost small" disabled={busy === t.id} onClick={() => review(t.id, "ignored", r)}>{r}</button>
                                  ))}
                                  <button type="button" className="btn ghost small" onClick={() => setReasonFor(null)}>cancel</button>
                                </span>
                              ) : t.status === "unreviewed" ? (
                                <span className="btnrow">
                                  <button type="button" className="btn ghost small" disabled={busy === t.id} onClick={() => review(t.id, "personal")}>Personal</button>
                                  <button type="button" className="btn ghost small" disabled={busy === t.id} onClick={() => setReasonFor(t.id)}>Transfer</button>
                                  <button type="button" className="btn small" disabled={busy === t.id} onClick={() => review(t.id, "logged")}>Business</button>
                                </span>
                              ) : (
                                <button type="button" className="btn ghost small" disabled={busy === t.id} onClick={() => review(t.id, "unreviewed")}>Undo</button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
