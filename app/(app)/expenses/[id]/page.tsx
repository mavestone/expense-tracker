"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiSend, apiUpload } from "@/lib/client";
import { formatAUD, formatCurrency, centsToDecimalString, bpToPercentString, applyBp } from "@/lib/money";
import { formatDateAU, fyQuarter } from "@/lib/fy";
import { formatAbn } from "@/lib/abn";
import ExpenseForm from "@/components/ExpenseForm";
import ReceiptUploader, { type StagedReceipt } from "@/components/ReceiptUploader";
import type { AuditDto, ExpenseDto, ReceiptDto, CategoryDto, SubscriptionDto } from "@/lib/types";
import { useToast } from "@/components/Toast";

type Detail = {
  expense: ExpenseDto;
  receipts: ReceiptDto[];
  audit: AuditDto[];
  flags: string[];
  category: CategoryDto | null;
  subscription: SubscriptionDto | null;
};

const GST_LABELS: Record<string, string> = {
  gst: "GST included (claimable)",
  gst_free: "GST-free / no GST",
  input_taxed: "Input taxed / not claimable",
};

const FIELD_LABELS: Record<string, string> = {
  dateIncurred: "Date incurred", supplierName: "Supplier", supplierAbn: "Supplier ABN", description: "Description",
  categoryId: "Category", originalAmountCents: "Original amount (cents)", originalCurrency: "Currency",
  fxRate: "FX rate", fxRateSource: "FX rate source", fxRateDate: "FX rate date", fxStatus: "FX status",
  fxOverrideNote: "FX override note", audAmountCents: "AUD amount (cents)", audIsOverridden: "AUD overridden",
  audOverrideNote: "AUD override reason", gstTreatment: "GST treatment", gstAmountCents: "GST (cents)",
  businessUseBp: "Business use (bp)", deductibleAudCents: "Deductible (cents)", isCapital: "Capital asset",
  assetName: "Asset name", effectiveLifeYears: "Effective life", paymentMethod: "Payment method", notes: "Notes",
  financialYear: "Financial year", missingReceiptAck: "Missing receipt acknowledged", status: "Status", receipt: "Receipt",
};

export default function ExpenseDetailPage() {
  const { toast } = useToast();
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [staged, setStaged] = useState<StagedReceipt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Detail>(`/api/expenses/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // The provider handles its own dismissal now.
    if (search.get("created")) toast("Expense saved");
    if (search.get("updated")) toast("Changes saved");
  }, [search, toast]);

  if (error) return <div className="alert danger">{error}</div>;
  if (!data) return <div className="empty"><span className="spin" /> Loading…</div>;

  const { expense: e, receipts, audit, flags } = data;
  const current = receipts.find((r) => r.isCurrent);
  const isVoid = e.status === "void";

  if (editing) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <ExpenseForm mode="edit" initial={{ ...e, receiptCount: current ? 1 : 0 }} />
      </div>
    );
  }

  async function uploadReceipt() {
    if (!staged) return;
    setBusy("Uploading…");
    try {
      await apiUpload(`/api/expenses/${id}/receipts`, staged.file, staged.filename);
      setStaged(null);
      toast(current ? "Receipt replaced (old version kept)" : "Receipt attached");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doVoid() {
    if (!voidReason.trim()) return;
    setBusy("Voiding…");
    try {
      await apiSend(`/api/expenses/${id}/void`, "POST", { reason: voidReason });
      setVoiding(false);
      await load();
      toast("Record voided (kept in the audit view)");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmDraft() {
    setBusy("Confirming…");
    try {
      await apiSend(`/api/expenses/${id}/confirm`, "POST");
      await load();
      toast("Confirmed — now counted in reports");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function resolveFx() {
    setBusy("Fetching rate…");
    try {
      await apiSend(`/api/expenses/${id}/resolve-fx`, "POST");
      await load();
      toast("FX rate applied");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const claimable = e.gstTreatment === "gst" ? applyBp(e.gstAmountCents, e.businessUseBp) : 0;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="section-head">
        <div>
          <h1 style={{ marginBottom: 2 }}>{e.supplierName}</h1>
          <div className="muted">{e.description}</div>
        </div>
        <div className="r">
          <div style={{ fontSize: 24, fontWeight: 750 }} className="money">{formatAUD(e.audAmountCents)}</div>
          {e.originalCurrency !== "AUD" && (
            <div className="muted small">{formatCurrency(e.originalAmountCents, e.originalCurrency)}</div>
          )}
        </div>
      </div>

      <div className="btnrow mb2">
        {e.status === "draft" && <button className="btn" onClick={confirmDraft} disabled={!!busy}>✓ Confirm draft</button>}
        {!isVoid && <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>}
        {e.fxStatus === "pending" && <button className="btn ghost" onClick={resolveFx} disabled={!!busy}>Fetch FX rate</button>}
        {!isVoid && <button className="btn danger" onClick={() => setVoiding(true)}>Void…</button>}
        <Link href="/expenses" className="btn ghost">Back</Link>
      </div>

      {isVoid && (
        <div className="alert danger">
          <b>Voided</b> {e.voidedAt ? formatDateAU(e.voidedAt.slice(0, 10)) : ""} — {e.voidReason}. Kept for audit; excluded from all reports.
        </div>
      )}
      {e.status === "draft" && (
        <div className="alert info">Draft generated from a subscription renewal — confirm it (or edit first) to include it in reports, or void it if the payment never happened.</div>
      )}
      {flags.includes("gst_invoice_required") && (
        <div className="alert danger">GST-claimable over the tax-invoice threshold with <b>no receipt attached</b> — the credit is excluded from the BAS summary until a valid tax invoice is attached.</div>
      )}
      {flags.includes("receipt_required") && !flags.includes("gst_invoice_required") && (
        <div className="alert warn">Over the receipt threshold with no receipt attached.</div>
      )}
      {e.fxStatus === "pending" && (
        <div className="alert warn">FX rate pending — AUD amount is $0.00 until a rate is applied. Use “Fetch FX rate” or edit the record to enter one manually.</div>
      )}

      {voiding && (
        <div className="card flagged">
          <h2>Void this record?</h2>
          <p className="small muted mt0">Nothing is ever deleted — the record stays readable in the audit view with your reason, and is excluded from reports and exports.</p>
          <div className="field">
            <label>Reason (required)</label>
            <input type="text" value={voidReason} onChange={(ev) => setVoidReason(ev.target.value)} placeholder="e.g. duplicate entry" autoFocus />
          </div>
          <div className="btnrow">
            <button className="btn danger" onClick={doVoid} disabled={!voidReason.trim() || !!busy}>Void record</button>
            <button className="btn ghost" onClick={() => setVoiding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Details</h2>
        <dl className="kv">
          <dt>Date incurred</dt><dd>{formatDateAU(e.dateIncurred)} <span className="muted">· FY {e.financialYear} · {fyQuarter(e.dateIncurred)}</span></dd>
          <dt>Category</dt><dd>{data.category?.name ?? "—"}</dd>
          {e.supplierAbn && <><dt>Supplier ABN</dt><dd>{formatAbn(e.supplierAbn)}</dd></>}
          <dt>Amount</dt>
          <dd>
            {formatCurrency(e.originalAmountCents, e.originalCurrency)}
            {e.originalCurrency !== "AUD" && <> → <b>{formatAUD(e.audAmountCents)}</b></>}
          </dd>
          {e.originalCurrency !== "AUD" && (
            <>
              <dt>FX rate</dt>
              <dd>
                {e.fxStatus === "pending" ? (
                  <span className="badge warn">pending</span>
                ) : (
                  <>
                    1 {e.originalCurrency} = {e.fxRate} AUD
                    <div className="muted small">
                      {e.fxRateSource} · rate date {e.fxRateDate ? formatDateAU(e.fxRateDate) : "—"}
                      {e.fxOverrideNote ? ` · note: ${e.fxOverrideNote}` : ""}
                    </div>
                  </>
                )}
              </dd>
            </>
          )}
          {e.audIsOverridden && (
            <><dt>AUD override</dt><dd>Yes — {e.audOverrideNote}</dd></>
          )}
          <dt>GST</dt>
          <dd>
            {GST_LABELS[e.gstTreatment]}
            {e.gstTreatment === "gst" && (
              <div className="muted small">
                GST {formatAUD(e.gstAmountCents)}{e.businessUseBp !== 10000 ? ` · claimable ${formatAUD(claimable)} at ${bpToPercentString(e.businessUseBp)}%` : ""}
              </div>
            )}
          </dd>
          <dt>Business use</dt><dd>{bpToPercentString(e.businessUseBp)}% · deductible <b>{formatAUD(e.deductibleAudCents)}</b></dd>
          {e.isCapital && (
            <>
              <dt>Capital asset</dt>
              <dd>
                {e.assetName ?? e.description}
                <div className="muted small">effective life: {e.effectiveLifeYears ? `${e.effectiveLifeYears} years` : "not set"} · on the depreciation schedule</div>
              </dd>
            </>
          )}
          {e.paymentMethod && <><dt>Payment</dt><dd>{e.paymentMethod}</dd></>}
          {e.notes && <><dt>Notes</dt><dd>{e.notes}</dd></>}
          <dt>Source</dt>
          <dd>
            {e.source === "manual" ? "Manual entry" : e.source === "subscription" ? "Subscription renewal" : e.source === "agent" ? "Hyperagent (analysed invoice)" : "CSV import"}
            {data.subscription && <> · <Link href="/subscriptions">{data.subscription.vendor}</Link></>}
          </dd>
          <dt>Record ID</dt><dd><code className="small">{e.id}</code></dd>
        </dl>
      </div>

      <div className="card">
        <h2>Receipt {receipts.length > 0 && <span className="badge ok">v{current?.version ?? receipts[0].version}</span>}</h2>
        {current && (
          <div className="mb2">
            {current.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="receipt-thumb" src={`/api/receipts/${current.id}/download`} alt={`Receipt: ${current.originalFilename}`} />
            ) : current.mime === "application/pdf" ? (
              <iframe
                className="receipt-pdf"
                src={`/api/receipts/${current.id}/download#toolbar=0&navpanes=0`}
                title={`Receipt: ${current.originalFilename}`}
              />
            ) : (
              <div className="alert info" style={{ margin: 0 }}>📄 {current.originalFilename} ({(current.sizeBytes / 1024).toFixed(0)} KB)</div>
            )}
            <div className="btnrow mt1">
              <a className="btn ghost small" href={`/api/receipts/${current.id}/download`} target="_blank" rel="noopener noreferrer">Open</a>
              <a className="btn ghost small" href={`/api/receipts/${current.id}/download?dl=1`}>Download</a>
            </div>
            <div className="muted small mt1">Uploaded {formatDateAU(current.uploadedAt.slice(0, 10))} · SHA-256 <code>{current.sha256.slice(0, 16)}…</code></div>
          </div>
        )}
        {!isVoid && (
          <>
            <ReceiptUploader staged={staged} onStage={setStaged} />
            {staged && (
              <div className="btnrow mt1">
                <button className="btn" onClick={uploadReceipt} disabled={!!busy}>
                  {busy ?? (current ? "Replace receipt (keeps old version)" : "Attach receipt")}
                </button>
              </div>
            )}
          </>
        )}
        {receipts.filter((r) => !r.isCurrent).length > 0 && (
          <details className="mt2">
            <summary className="small muted" style={{ cursor: "pointer" }}>Previous versions ({receipts.filter((r) => !r.isCurrent).length}) — immutable, kept forever</summary>
            <div className="auditlist mt1">
              {receipts.filter((r) => !r.isCurrent).map((r) => (
                <div className="entry" key={r.id}>
                  v{r.version} · {r.originalFilename} · {formatDateAU(r.uploadedAt.slice(0, 10))} ·{" "}
                  <a href={`/api/receipts/${r.id}/download`} target="_blank" rel="noopener noreferrer">open</a>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="card">
        <div className="section-head" style={{ margin: 0 }}>
          <h2 style={{ margin: 0 }}>History</h2>
          <button className="btn ghost small" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Hide" : `Show (${audit.length})`}
          </button>
        </div>
        {showHistory && (
          <div className="auditlist mt1">
            {audit.map((a) => (
              <div className="entry" key={a.id}>
                <div className="when">{new Date(a.at).toLocaleString("en-AU")} · {a.action}{a.note ? ` — ${a.note}` : ""}</div>
                {a.field && (
                  <div className="change">
                    {FIELD_LABELS[a.field] ?? a.field}: {a.oldValue != null && <span className="old">{a.oldValue}</span>}{" "}
                    {a.newValue != null && <span className="new">{a.newValue}</span>}
                  </div>
                )}
                {!a.field && a.newValue && <div className="change">{a.newValue}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
