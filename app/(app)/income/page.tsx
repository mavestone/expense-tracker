"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, apiUpload, ApiError } from "@/lib/client";
import ReceiptUploader, { type StagedReceipt } from "@/components/ReceiptUploader";
import { formatAUD, formatCurrency, parseMoneyToCents, centsToDecimalString } from "@/lib/money";
import { formatDateAU, financialYear } from "@/lib/fy";
import { COMMON_CURRENCIES, type MetaDto } from "@/lib/types";
import { useDialog } from "@/components/Dialog";
import { useToast } from "@/components/Toast";

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
  source: string;
};

type ListResp = {
  income: IncomeDto[];
  totals: { count: number; audTotal: number; gstTotal: number };
  outstanding: { count: number; audTotal: number };
};

const TYPES = [
  { value: "client_work", label: "Client work" },
  { value: "licensing", label: "Licensing / royalties" },
  { value: "grant", label: "Grant / rebate" },
  { value: "interest", label: "Interest" },
  { value: "other", label: "Other income" },
];

const GSTS = [
  { value: "gst", label: "GST included (you collected 1/11)" },
  { value: "gst_free", label: "GST-free sale (e.g. export of services)" },
  { value: "no_gst", label: "No GST (not registered / out of scope)" },
];

const EMPTY = {
  dateEarned: "",
  datePaid: "",
  clientName: "",
  clientAbn: "",
  invoiceRef: "",
  description: "",
  incomeType: "client_work",
  amount: "",
  currency: "AUD",
  gstTreatment: "no_gst",
  paymentAccount: "",
  notes: "",
};

export default function IncomePage() {
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [data, setData] = useState<ListResp | null>(null);
  const [fy, setFy] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog } = useDialog();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<StagedReceipt | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (fy) p.set("fy", fy);
    if (outstandingOnly) p.set("outstanding", "1");
    if (q.trim()) p.set("q", q.trim());
    try {
      setData(await apiGet<ListResp>(`/api/income?${p}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [fy, outstandingOnly, q]);

  useEffect(() => {
    apiGet<MetaDto>("/api/meta").then(setMeta).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  function openNew() {
    setForm({ ...EMPTY, dateEarned: meta?.today ?? "", gstTreatment: meta?.settings.gst_registered ? "gst" : "no_gst" });
    setEditingId(null);
    setStaged(null);
    setFormOpen(true);
    setError(null);
  }

  function openEdit(r: IncomeDto) {
    setForm({
      dateEarned: r.dateEarned,
      datePaid: r.datePaid ?? "",
      clientName: r.clientName,
      clientAbn: r.clientAbn ?? "",
      invoiceRef: r.invoiceRef ?? "",
      description: r.description,
      incomeType: r.incomeType,
      amount: centsToDecimalString(r.originalAmountCents),
      currency: r.originalCurrency,
      gstTreatment: r.gstTreatment,
      paymentAccount: r.paymentAccount ?? "",
      notes: r.notes ?? "",
    });
    setEditingId(r.id);
    setStaged(null);
    setFormOpen(true);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = parseMoneyToCents(form.amount);
    if (amountCents == null) return setError("Enter a valid amount, e.g. 1500.00");
    setBusy(true);
    setError(null);
    const input = {
      dateEarned: form.dateEarned,
      datePaid: form.datePaid || null,
      clientName: form.clientName,
      clientAbn: form.clientAbn || null,
      invoiceRef: form.invoiceRef || null,
      description: form.description,
      incomeType: form.incomeType,
      originalAmountCents: amountCents,
      originalCurrency: form.currency.toUpperCase(),
      gstTreatment: form.gstTreatment,
      paymentAccount: form.paymentAccount || null,
      notes: form.notes || null,
    };
    try {
      let recId = editingId;
      if (editingId) {
        await apiSend(`/api/income/${editingId}`, "PATCH", { input });
      } else {
        const res = await apiSend<{ income: { id: string } }>("/api/income", "POST", { input });
        recId = res.income.id;
      }
      if (staged && recId) {
        await apiUpload(`/api/income/${recId}/documents`, staged.file, staged.filename);
      }
      setFormOpen(false);
      setStaged(null);
      await load();
      toast(editingId ? "Income updated" : "Income recorded");
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.join(" ") ?? err.message) : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function markPaid(r: IncomeDto) {
    ask({
      title: "Mark as paid",
      body: <><b>{r.clientName}</b> — {r.description}</>,
      prompt: { label: "Date the money arrived", type: "date", defaultValue: meta?.today ?? "", required: true },
      confirmLabel: "Mark paid",
      onConfirm: async (d) => {
        try {
          await apiSend(`/api/income/${r.id}`, "PATCH", { datePaid: d });
          await load();
          toast("Marked as paid");
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }

  function doVoid(r: IncomeDto) {
    ask({
      title: "Void this income record?",
      body: (
        <>
          <b>{r.clientName}</b> — {r.description}. Nothing is deleted; it stays in the audit view with your reason,
          and drops out of every total.
        </>
      ),
      prompt: { label: "Reason", placeholder: "Raised in error against the wrong client", required: true, multiline: true },
      confirmLabel: "Void record",
      danger: true,
      onConfirm: async (reason) => {
        try {
          await apiSend(`/api/income/${r.id}/void`, "POST", { reason });
          await load();
          toast("Record voided");
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  }

  if (!meta || !data) return <div className="empty"><span className="spin" /> Loading…</div>;

  const gstReg = meta.settings.gst_registered;

  return (
    <div>
      <div className="section-head">
        <h1>Income</h1>
        <button className="btn small" onClick={openNew}>+ Record income</button>
      </div>

      <div className="stats mb2">
        <div className="stat">
          <div className="label">Income {fy ? `FY ${fy}` : "(all years)"}</div>
          <div className="value">{formatAUD(data.totals.audTotal)}</div>
          <div className="sub">{data.totals.count} record{data.totals.count === 1 ? "" : "s"}</div>
        </div>
        <div className="stat">
          <div className="label">Awaiting payment</div>
          <div className="value">{formatAUD(data.outstanding.audTotal)}</div>
          <div className="sub">{data.outstanding.count} unpaid invoice{data.outstanding.count === 1 ? "" : "s"}</div>
        </div>
        {gstReg && (
          <div className="stat">
            <div className="label">GST collected (1A)</div>
            <div className="value">{formatAUD(data.totals.gstTotal)}</div>
            <div className="sub">owed to the ATO on sales</div>
          </div>
        )}
      </div>

      {!gstReg && (
        <div className="alert info">
          Recorded as <b>not GST-registered</b>, so no GST is applied to sales. If you are registered, turn it on in Settings — it also affects whether you can claim GST credits on purchases.
        </div>
      )}

      <div className="filterbar">
        <select value={fy} onChange={(e) => setFy(e.target.value)}>
          <option value="">All FYs</option>
          {meta.financialYears.map((f) => <option key={f} value={f}>FY {f}</option>)}
        </select>
        <label className="checkline" style={{ margin: 0, alignItems: "center" }}>
          <input type="checkbox" checked={outstandingOnly} onChange={(e) => setOutstandingOnly(e.target.checked)} />
          <span className="small">Unpaid only</span>
        </label>
        <input type="search" placeholder="Search client, description, invoice ref" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <div className="alert danger">{error}</div>}

      {formOpen && (
        <form className="card mb2" onSubmit={save}>
          <h2>{editingId ? "Edit income" : "Record income"}</h2>
          <div className="grid2">
            <div className="field">
              <label>Date earned / invoiced</label>
              <input type="date" value={form.dateEarned} onChange={(e) => setForm({ ...form, dateEarned: e.target.value })} required />
              {form.dateEarned && <span className="hint">FY {financialYear(form.dateEarned)}</span>}
            </div>
            <div className="field">
              <label>Date paid <span className="muted">(leave blank if unpaid)</span></label>
              <input type="date" value={form.datePaid} onChange={(e) => setForm({ ...form, datePaid: e.target.value })} />
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label>Client / payer</label>
              <input type="text" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required />
            </div>
            <div className="field">
              <label>Invoice reference <span className="muted">(optional)</span></label>
              <input type="text" value={form.invoiceRef} onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })} placeholder="e.g. INV-014" />
            </div>
          </div>
          <div className="field">
            <label>Description</label>
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="What the work was" />
          </div>
          <div className="grid3">
            <div className="field">
              <label>Amount</label>
              <input type="text" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required placeholder="0.00" />
            </div>
            <div className="field">
              <label>Currency</label>
              <input type="text" list="ccy-inc" maxLength={3} style={{ textTransform: "uppercase" }} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} required />
              <datalist id="ccy-inc">{COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="field">
              <label>Type</label>
              <select value={form.incomeType} onChange={(e) => setForm({ ...form, incomeType: e.target.value })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label>GST on this sale</label>
              <select value={form.gstTreatment} onChange={(e) => setForm({ ...form, gstTreatment: e.target.value })} disabled={!gstReg}>
                {GSTS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
              {!gstReg && <span className="hint">Locked to “No GST” until GST registration is enabled in Settings.</span>}
            </div>
            <div className="field">
              <label>Paid into <span className="muted">(account)</span></label>
              <input type="text" value={form.paymentAccount} onChange={(e) => setForm({ ...form, paymentAccount: e.target.value })} placeholder="e.g. Wise AUD" />
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label>Client ABN <span className="muted">(optional)</span></label>
              <input type="text" inputMode="numeric" value={form.clientAbn} onChange={(e) => setForm({ ...form, clientAbn: e.target.value })} />
            </div>
            <div className="field">
              <label>Notes</label>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          {form.currency.toUpperCase() !== "AUD" && (
            <div className="alert info" style={{ marginTop: 0 }}>
              Foreign currency — the AUD value will use the published rate for {form.dateEarned ? formatDateAU(form.dateEarned) : "the income date"} and be frozen on the record.
            </div>
          )}
          <div className="field">
            <label>Invoice document <span className="muted">(optional — PDF or image)</span></label>
            <ReceiptUploader staged={staged} onStage={setStaged} />
            {editingId && <span className="hint">Attaching here adds a new version; existing versions are kept.</span>}
          </div>
          <div className="btnrow">
            <button className="btn" disabled={busy}>{busy ? "Saving…" : editingId ? "Save changes" : "Record income"}</button>
            <button type="button" className="btn ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        {data.income.length === 0 && <div className="empty">No income recorded yet.</div>}
        <div className="explist">
          {data.income.map((r) => (
            <div key={r.id} className="exprow" style={{ cursor: "default" }}>
              <Link href={`/income/${r.id}`} className="l1" style={{ color: "inherit" }}>
                <span className="supplier">{r.clientName}</span>
                <span className="desc">{r.description}</span>
              </Link>
              <Link href={`/income/${r.id}`} className="amount" style={{ color: "inherit", textDecoration: "none" }}>
                {formatAUD(r.audAmountCents)}
                {r.originalCurrency !== "AUD" && (
                  <div className="muted small" style={{ fontWeight: 400 }}>{formatCurrency(r.originalAmountCents, r.originalCurrency)}</div>
                )}
              </Link>
              <div className="meta">
                <span>{formatDateAU(r.dateEarned)}</span>
                {r.invoiceRef && <span>· {r.invoiceRef}</span>}
                {r.datePaid ? (
                  <span className="badge ok">paid {formatDateAU(r.datePaid)}</span>
                ) : (
                  <span className="badge warn">unpaid</span>
                )}
                {r.gstTreatment === "gst" && r.gstAmountCents > 0 && <span className="badge info">GST {formatAUD(r.gstAmountCents)}</span>}
                {r.fxStatus === "pending" && <span className="badge warn">FX pending</span>}
                {r.source === "agent" && <span className="badge neutral">via agent</span>}
                <span style={{ flex: 1 }} />
                <Link href={`/income/${r.id}`} className="btn ghost small">View invoice</Link>
                {!r.datePaid && <button className="btn ghost small" onClick={() => markPaid(r)}>Mark paid</button>}
                <button className="btn ghost small" onClick={() => openEdit(r)}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {dialog}
    </div>
  );
}
