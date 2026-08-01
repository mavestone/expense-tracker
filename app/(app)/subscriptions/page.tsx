"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, ApiError } from "@/lib/client";
import { formatAUD, formatCurrency, parseMoneyToCents, centsToDecimalString, percentToBp, bpToPercentString } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import { GST_TREATMENTS } from "@/lib/gst";
import { COMMON_CURRENCIES, type MetaDto, type SubscriptionDto } from "@/lib/types";

type Overview = { subscriptions: SubscriptionDto[]; totalAnnualAudCents: number; fxIncomplete: boolean; draftsGenerated: number };

const EMPTY_FORM = {
  vendor: "",
  description: "",
  amount: "",
  currency: "USD",
  frequency: "monthly" as "monthly" | "annual",
  nextRenewalDate: "",
  buPct: "100",
  categoryId: "",
  gstTreatment: "gst_free",
  paymentMethod: "",
  supplierAbn: "",
  notes: "",
};

export default function SubscriptionsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([apiGet<MetaDto>("/api/meta"), apiGet<Overview>("/api/subscriptions")]);
      setMeta(m);
      setData(o);
      if (o.draftsGenerated > 0) setToast(`${o.draftsGenerated} renewal draft${o.draftsGenerated > 1 ? "s" : ""} generated — confirm under Expenses`);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, nextRenewalDate: meta?.today ?? "", categoryId: meta?.categories.find((c) => c.name.startsWith("Software"))?.id ?? meta?.categories[0]?.id ?? "" });
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(s: SubscriptionDto) {
    setForm({
      vendor: s.vendor,
      description: s.description ?? "",
      amount: centsToDecimalString(s.amountCents),
      currency: s.currency,
      frequency: s.frequency,
      nextRenewalDate: s.nextRenewalDate,
      buPct: bpToPercentString(s.businessUseBp),
      categoryId: s.categoryId,
      gstTreatment: s.gstTreatment,
      paymentMethod: s.paymentMethod ?? "",
      supplierAbn: s.supplierAbn ?? "",
      notes: s.notes ?? "",
    });
    setEditingId(s.id);
    setFormOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = parseMoneyToCents(form.amount);
    const bp = percentToBp(form.buPct);
    if (amountCents == null || bp == null) return setError("Check the amount and business use %.");
    setBusy(true);
    setError(null);
    const input = {
      vendor: form.vendor,
      description: form.description || null,
      amountCents,
      currency: form.currency.toUpperCase(),
      frequency: form.frequency,
      nextRenewalDate: form.nextRenewalDate,
      businessUseBp: bp,
      categoryId: form.categoryId,
      gstTreatment: form.gstTreatment,
      paymentMethod: form.paymentMethod || null,
      supplierAbn: form.supplierAbn || null,
      notes: form.notes || null,
    };
    try {
      if (editingId) await apiSend(`/api/subscriptions/${editingId}`, "PATCH", { input });
      else await apiSend("/api/subscriptions", "POST", { input });
      setFormOpen(false);
      await load();
      setToast(editingId ? "Subscription updated" : "Subscription added — drafts will appear on each renewal date");
    } catch (err) {
      setError(err instanceof ApiError ? (err.errors?.join(" ") ?? err.message) : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(s: SubscriptionDto) {
    const msg = s.active
      ? `Mark "${s.vendor}" as cancelled? No more renewal drafts will be generated. Existing records are kept.`
      : `Reactivate "${s.vendor}"?`;
    if (!confirm(msg)) return;
    await apiSend(`/api/subscriptions/${s.id}`, "PATCH", { active: !s.active });
    await load();
  }

  if (error && !data) return <div className="alert danger">{error}</div>;
  if (!data || !meta) return <div className="empty"><span className="spin" /> Loading…</div>;

  const active = data.subscriptions.filter((s) => s.active);
  const inactive = data.subscriptions.filter((s) => !s.active);

  return (
    <div>
      <div className="section-head">
        <h1>Subscriptions</h1>
        <button className="btn small" onClick={openCreate}>+ Add subscription</button>
      </div>

      <div className="stats mb2">
        <div className="stat">
          <div className="label">Est. annual spend</div>
          <div className="value">{formatAUD(data.totalAnnualAudCents)}</div>
          <div className="sub">active subscriptions, at current rates{data.fxIncomplete ? " (some rates unavailable)" : ""}</div>
        </div>
        <div className="stat">
          <div className="label">Active</div>
          <div className="value">{active.length}</div>
          <div className="sub">{inactive.length} cancelled</div>
        </div>
        <div className="stat">
          <div className="label">Needs attention</div>
          <div className="value">{active.filter((s) => s.stale).length}</div>
          <div className="sub">no confirmed payment in 60+ days</div>
        </div>
      </div>

      {error && <div className="alert danger">{error}</div>}

      {formOpen && (
        <form className="card mb2" onSubmit={save}>
          <h2>{editingId ? "Edit subscription" : "New subscription"}</h2>
          <div className="grid2">
            <div className="field">
              <label>Vendor</label>
              <input type="text" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} required />
            </div>
            <div className="field">
              <label>Description <span className="muted">(used on generated records)</span></label>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Creative Cloud All Apps" />
            </div>
          </div>
          <div className="grid3">
            <div className="field">
              <label>Amount</label>
              <input type="text" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </div>
            <div className="field">
              <label>Currency</label>
              <input type="text" list="ccy-list-sub" value={form.currency} maxLength={3} style={{ textTransform: "uppercase" }} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} required />
              <datalist id="ccy-list-sub">
                {COMMON_CURRENCIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="field">
              <label>Billing</label>
              <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as "monthly" | "annual" })}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
          </div>
          <div className="grid3">
            <div className="field">
              <label>Next renewal date</label>
              <input type="date" value={form.nextRenewalDate} onChange={(e) => setForm({ ...form, nextRenewalDate: e.target.value })} required />
            </div>
            <div className="field">
              <label>Business use %</label>
              <input type="text" inputMode="decimal" value={form.buPct} onChange={(e) => setForm({ ...form, buPct: e.target.value })} required />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required>
                {meta.categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid3">
            <div className="field">
              <label>GST treatment</label>
              <select value={form.gstTreatment} onChange={(e) => setForm({ ...form, gstTreatment: e.target.value })}>
                {GST_TREATMENTS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Payment method</label>
              <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                <option value="">—</option>
                {meta.paymentMethods.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Supplier ABN <span className="muted">(if Australian)</span></label>
              <input type="text" inputMode="numeric" value={form.supplierAbn} onChange={(e) => setForm({ ...form, supplierAbn: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label>Notes</label>
            <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="btnrow">
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save subscription"}</button>
            <button type="button" className="btn ghost" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="card">
        <h2>Active</h2>
        {active.length === 0 && <div className="empty">No subscriptions yet. Add your recurring software so renewals generate draft expenses automatically.</div>}
        <div className="explist">
          {active.map((s) => (
            <div key={s.id} className="exprow" style={{ cursor: "default" }}>
              <div className="l1">
                <span className="supplier">{s.vendor}</span>
                <span className="desc">{s.description || `${s.frequency} · next ${formatDateAU(s.nextRenewalDate)}`}</span>
              </div>
              <div className="amount">
                {formatCurrency(s.amountCents, s.currency)}<span className="muted small" style={{ fontWeight: 400 }}> /{s.frequency === "monthly" ? "mo" : "yr"}</span>
                {s.estAnnualAudCents != null && (
                  <div className="muted small" style={{ fontWeight: 400 }}>≈ {formatAUD(s.estAnnualAudCents)}/yr</div>
                )}
              </div>
              <div className="meta">
                <span>Next: {formatDateAU(s.nextRenewalDate)}</span>
                <span>· Last confirmed: {s.lastConfirmedDate ? formatDateAU(s.lastConfirmedDate) : "never"}</span>
                {s.pendingDraftCount > 0 && (
                  <Link href="/expenses?status=draft" className="badge info">{s.pendingDraftCount} draft{s.pendingDraftCount > 1 ? "s" : ""} to confirm</Link>
                )}
                {s.stale && <span className="badge danger">no confirmed payment in 60+ days — cancel?</span>}
                <span style={{ flex: 1 }} />
                <button className="btn ghost small" onClick={() => openEdit(s)}>Edit</button>
                <button className="btn ghost small" onClick={() => toggleActive(s)}>Cancelled it?</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {inactive.length > 0 && (
        <div className="card">
          <h2>Cancelled</h2>
          <div className="explist">
            {inactive.map((s) => (
              <div key={s.id} className="exprow" style={{ cursor: "default", opacity: 0.65 }}>
                <div className="l1">
                  <span className="supplier">{s.vendor}</span>
                  <span className="desc">cancelled {s.canceledAt ? formatDateAU(s.canceledAt.slice(0, 10)) : ""}</span>
                </div>
                <div className="amount">{formatCurrency(s.amountCents, s.currency)}</div>
                <div className="meta">
                  <span style={{ flex: 1 }} />
                  <button className="btn ghost small" onClick={() => toggleActive(s)}>Reactivate</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
