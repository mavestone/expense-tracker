"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiSend, apiUpload } from "@/lib/client";
import { formatAUD, formatCurrency } from "@/lib/money";
import { formatDateAU, fyQuarter } from "@/lib/fy";
import { formatAbn } from "@/lib/abn";
import ReceiptUploader, { type StagedReceipt } from "@/components/ReceiptUploader";
import type { AuditDto } from "@/lib/types";
import { useToast } from "@/components/Toast";
import { useDialog } from "@/components/Dialog";

type IncomeDto = {
  id: string;
  dateEarned: string;
  datePaid: string | null;
  clientName: string;
  clientAbn: string | null;
  invoiceRef: string | null;
  description: string;
  incomeType: string;
  originalAmountCents: number;
  originalCurrency: string;
  fxRate: string | null;
  fxRateSource: string | null;
  fxRateDate: string | null;
  fxStatus: string;
  audAmountCents: number;
  gstTreatment: string;
  gstAmountCents: number;
  paymentAccount: string | null;
  notes: string | null;
  financialYear: string;
  status: string;
  voidReason: string | null;
  voidedAt: string | null;
  source: string;
  createdAt: string;
};

type DocDto = {
  id: string;
  version: number;
  originalFilename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: string;
  isCurrent: boolean;
};

type Detail = { income: IncomeDto; audit: AuditDto[]; documents: DocDto[] };

const GST_LABELS: Record<string, string> = {
  gst: "GST included in the price (collected)",
  gst_free: "GST-free sale",
  no_gst: "No GST",
};

const TYPE_LABELS: Record<string, string> = {
  client_work: "Client work",
  licensing: "Licensing / royalties",
  grant: "Grant / rebate",
  interest: "Interest",
  other: "Other income",
};

export default function IncomeDetailPage() {
  const { ask, dialog } = useDialog();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedReceipt | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Detail>(`/api/income/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="alert danger">{error}</div>;
  if (!data) return <div className="empty"><span className="spin" /> Loading…</div>;

  const r = data.income;
  const current = data.documents.find((d) => d.isCurrent);
  const isVoid = r.status === "void";

  async function upload() {
    if (!staged) return;
    setBusy("Uploading…");
    try {
      await apiUpload(`/api/income/${id}/documents`, staged.file, staged.filename);
      setStaged(null);
      await load();
      toast(current ? "Invoice replaced (old version kept)" : "Invoice attached");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function markPaid() {
    ask({
      title: "Mark as paid",
      prompt: { label: "Date the money arrived", type: "date", defaultValue: new Date().toISOString().slice(0, 10), required: true },
      confirmLabel: "Mark paid",
      onConfirm: async (d) => {
    try {
      await apiSend(`/api/income/${id}`, "PATCH", { datePaid: d });
      await load();
      toast("Marked as paid");
    } catch (e) {
      setError((e as Error).message);
    }
      },
    });
  }

  function doVoid() {
    ask({
      title: "Void this income record?",
      body: "Nothing is deleted — it stays in the audit view with your reason, and drops out of every total.",
      prompt: { label: "Reason", placeholder: "Raised in error against the wrong client", required: true, multiline: true },
      confirmLabel: "Void record",
      danger: true,
      onConfirm: async (reason) => {
        try {
          await apiSend(`/api/income/${id}/void`, "POST", { reason });
          await load();
          toast("Record voided");
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="section-head">
        <div>
          <h1 style={{ marginBottom: 2 }}>{r.clientName}</h1>
          <div className="muted">{r.description}</div>
        </div>
        <div className="r">
          <div style={{ fontSize: 24, fontWeight: 750 }} className="money">{formatAUD(r.audAmountCents)}</div>
          {r.originalCurrency !== "AUD" && (
            <div className="muted small">{formatCurrency(r.originalAmountCents, r.originalCurrency)}</div>
          )}
        </div>
      </div>

      <div className="btnrow mb2">
        {!isVoid && !r.datePaid && <button className="btn" onClick={markPaid}>✓ Mark paid</button>}
        {!isVoid && <button className="btn danger" onClick={doVoid}>Void…</button>}
        <Link href="/income" className="btn ghost">Back to income</Link>
      </div>

      {isVoid && (
        <div className="alert danger">
          <b>Voided</b> {r.voidedAt ? formatDateAU(r.voidedAt.slice(0, 10)) : ""} — {r.voidReason}. Kept for audit; excluded from all reports.
        </div>
      )}
      {!isVoid && !r.datePaid && (
        <div className="alert warn">Awaiting payment — this invoice is counted as income but hasn&apos;t been paid yet.</div>
      )}

      <div className="card">
        <h2>Details</h2>
        <dl className="kv">
          <dt>Date earned / invoiced</dt>
          <dd>{formatDateAU(r.dateEarned)} <span className="muted">· FY {r.financialYear} · {fyQuarter(r.dateEarned)}</span></dd>
          <dt>Paid</dt>
          <dd>{r.datePaid ? <>{formatDateAU(r.datePaid)} <span className="badge ok">paid</span></> : <span className="badge warn">outstanding</span>}</dd>
          {r.invoiceRef && <><dt>Invoice reference</dt><dd>{r.invoiceRef}</dd></>}
          <dt>Type</dt><dd>{TYPE_LABELS[r.incomeType] ?? r.incomeType}</dd>
          {r.clientAbn && <><dt>Client ABN</dt><dd>{formatAbn(r.clientAbn)}</dd></>}
          <dt>Amount</dt>
          <dd>
            {formatCurrency(r.originalAmountCents, r.originalCurrency)}
            {r.originalCurrency !== "AUD" && <> → <b>{formatAUD(r.audAmountCents)}</b></>}
          </dd>
          {r.originalCurrency !== "AUD" && (
            <>
              <dt>FX rate</dt>
              <dd>
                {r.fxStatus === "pending" ? <span className="badge warn">pending</span> : (
                  <>
                    1 {r.originalCurrency} = {r.fxRate} AUD
                    <div className="muted small">{r.fxRateSource} · rate date {r.fxRateDate ? formatDateAU(r.fxRateDate) : "—"}</div>
                  </>
                )}
              </dd>
            </>
          )}
          <dt>GST on sale</dt>
          <dd>
            {GST_LABELS[r.gstTreatment] ?? r.gstTreatment}
            {r.gstAmountCents > 0 && <div className="muted small">GST collected: <b>{formatAUD(r.gstAmountCents)}</b> (BAS 1A)</div>}
          </dd>
          {r.paymentAccount && <><dt>Paid into</dt><dd>{r.paymentAccount}</dd></>}
          {r.notes && <><dt>Notes</dt><dd>{r.notes}</dd></>}
          <dt>Source</dt><dd>{r.source === "agent" ? "Hyperagent (logged from an invoice)" : r.source === "import" ? "Imported" : "Manual entry"}</dd>
          <dt>Record ID</dt><dd><code className="small">{r.id}</code></dd>
        </dl>
      </div>

      <div className="card">
        <h2>Invoice {data.documents.length > 0 && <span className="badge ok">v{current?.version ?? data.documents[0].version}</span>}</h2>
        {current && (
          <div className="mb2">
            {current.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="receipt-thumb" src={`/api/income-documents/${current.id}/download`} alt={`Invoice: ${current.originalFilename}`} />
            ) : current.mime === "application/pdf" ? (
              <iframe
                className="receipt-pdf"
                src={`/api/income-documents/${current.id}/download#toolbar=0&navpanes=0`}
                title={`Invoice: ${current.originalFilename}`}
              />
            ) : (
              <div className="alert info" style={{ margin: 0 }}>📄 {current.originalFilename} ({(current.sizeBytes / 1024).toFixed(0)} KB)</div>
            )}
            <div className="btnrow mt1">
              <a className="btn ghost small" href={`/api/income-documents/${current.id}/download`} target="_blank" rel="noopener noreferrer">Open</a>
              <a className="btn ghost small" href={`/api/income-documents/${current.id}/download?dl=1`}>Download</a>
            </div>
            <div className="muted small mt1">
              Uploaded {formatDateAU(current.uploadedAt.slice(0, 10))} · SHA-256 <code>{current.sha256.slice(0, 16)}…</code>
            </div>
          </div>
        )}
        {!isVoid && (
          <>
            <ReceiptUploader staged={staged} onStage={setStaged} />
            {staged && (
              <div className="btnrow mt1">
                <button className="btn" onClick={upload} disabled={!!busy}>
                  {busy ?? (current ? "Replace invoice (keeps old version)" : "Attach invoice")}
                </button>
              </div>
            )}
          </>
        )}
        {data.documents.filter((d) => !d.isCurrent).length > 0 && (
          <details className="mt2">
            <summary className="small muted" style={{ cursor: "pointer" }}>
              Previous versions ({data.documents.filter((d) => !d.isCurrent).length}) — immutable, kept forever
            </summary>
            <div className="auditlist mt1">
              {data.documents.filter((d) => !d.isCurrent).map((d) => (
                <div className="entry" key={d.id}>
                  v{d.version} · {d.originalFilename} · {formatDateAU(d.uploadedAt.slice(0, 10))} ·{" "}
                  <a href={`/api/income-documents/${d.id}/download`} target="_blank" rel="noopener noreferrer">open</a>
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
            {showHistory ? "Hide" : `Show (${data.audit.length})`}
          </button>
        </div>
        {showHistory && (
          <div className="auditlist mt1">
            {data.audit.map((a) => (
              <div className="entry" key={a.id}>
                <div className="when">{new Date(a.at).toLocaleString("en-AU")} · {a.action}{a.note ? ` — ${a.note}` : ""}</div>
                {a.field && (
                  <div className="change">
                    {a.field}: {a.oldValue != null && <span className="old">{a.oldValue}</span>}{" "}
                    {a.newValue != null && <span className="new">{a.newValue}</span>}
                  </div>
                )}
                {!a.field && a.newValue && <div className="change">{a.newValue}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}
