"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, ApiError } from "@/lib/client";
import { formatCurrency } from "@/lib/money";

type Client = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  addressLines: string | null;
  country: string | null;
  abn: string | null;
  taxLabel: string | null;
  taxId: string | null;
  invoicePrefix: string;
  defaultCurrency: string;
  defaultGstTreatment: "gst" | "gst_free";
  paymentTermsDays: number;
  notes: string | null;
  archived: boolean;
  invoiceCount: number;
  outstanding: { currency: string; cents: number }[];
};

const EMPTY = {
  name: "",
  contactName: "",
  email: "",
  addressLines: "",
  country: "",
  abn: "",
  taxLabel: "",
  taxId: "",
  invoicePrefix: "",
  defaultCurrency: "AUD",
  defaultGstTreatment: "gst_free" as "gst" | "gst_free",
  paymentTermsDays: 14,
  notes: "",
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function load() {
    apiGet<{ clients: Client[] }>(`/api/clients${showArchived ? "?archived=1" : ""}`)
      .then((r) => setClients(r.clients))
      .catch((e) => setErrors([e.message]));
  }
  useEffect(load, [showArchived]);

  function openNew() {
    setForm({ ...EMPTY });
    setErrors([]);
    setEditing("new");
  }
  function openEdit(c: Client) {
    setForm({
      name: c.name,
      contactName: c.contactName ?? "",
      email: c.email ?? "",
      addressLines: c.addressLines ?? "",
      country: c.country ?? "",
      abn: c.abn ?? "",
      taxLabel: c.taxLabel ?? "",
      taxId: c.taxId ?? "",
      invoicePrefix: c.invoicePrefix,
      defaultCurrency: c.defaultCurrency,
      defaultGstTreatment: c.defaultGstTreatment,
      paymentTermsDays: c.paymentTermsDays,
      notes: c.notes ?? "",
    });
    setErrors([]);
    setEditing(c.id);
  }

  async function save() {
    setSaving(true);
    setErrors([]);
    try {
      if (editing === "new") await apiSend("/api/clients", "POST", form);
      else await apiSend(`/api/clients/${editing}`, "PUT", form);
      setEditing(null);
      load();
    } catch (e) {
      setErrors(e instanceof ApiError && e.errors?.length ? e.errors : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(c: Client) {
    await apiSend(`/api/clients/${c.id}`, "PUT", { archived: !c.archived });
    load();
  }

  return (
    <div>
      <div className="section-head">
        <h1>Clients</h1>
        <span className="btnrow">
          <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <button className="btn small" onClick={openNew}>+ New client</button>
        </span>
      </div>

      {editing && (
        <div className="card mb2">
          <h2>{editing === "new" ? "New client" : "Edit client"}</h2>
          {errors.length > 0 && <div className="alert danger">{errors.join(" ")}</div>}

          <div className="grid2">
            <label>
              Business name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Kirin Consulting LLC" />
            </label>
            <label>
              Contact person
              <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              Country
              <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="United States" />
            </label>
          </div>

          <label className="mt1">
            Address
            <textarea rows={3} value={form.addressLines} onChange={(e) => setForm({ ...form, addressLines: e.target.value })} placeholder={"One line per line\nas it should print"} />
          </label>

          <div className="grid2 mt1">
            <label>
              Invoice prefix
              <input
                value={form.invoicePrefix}
                onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })}
                placeholder="KC"
              />
              <span className="hint">Invoice numbers run {form.invoicePrefix || "KC"}_01, {form.invoicePrefix || "KC"}_02 …</span>
            </label>
            <label>
              Payment terms
              <input
                type="number"
                min={0}
                max={180}
                value={form.paymentTermsDays}
                onChange={(e) => setForm({ ...form, paymentTermsDays: parseInt(e.target.value || "0", 10) })}
              />
              <span className="hint">Days from the issue date to the due date.</span>
            </label>
            <label>
              Default currency
              <select value={form.defaultCurrency} onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value })}>
                <option value="AUD">AUD — Australian dollar</option>
                <option value="USD">USD — US dollar</option>
                <option value="GBP">GBP — pound sterling</option>
              </select>
            </label>
            <label>
              Default GST treatment
              <select
                value={form.defaultGstTreatment}
                onChange={(e) => setForm({ ...form, defaultGstTreatment: e.target.value as "gst" | "gst_free" })}
              >
                <option value="gst_free">GST-free — export of services</option>
                <option value="gst">GST — add 10% (Australian client)</option>
              </select>
            </label>
          </div>

          <div className="grid3 mt1">
            <label>
              ABN <span className="muted small">(Australian clients)</span>
              <input value={form.abn} onChange={(e) => setForm({ ...form, abn: e.target.value })} />
            </label>
            <label>
              Other tax number — label
              <input value={form.taxLabel} onChange={(e) => setForm({ ...form, taxLabel: e.target.value })} placeholder="VAT no. / EIN" />
            </label>
            <label>
              Other tax number
              <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
            </label>
          </div>

          <label className="mt1">
            Notes
            <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>

          <div className="btnrow mt2">
            <button className="btn" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save client"}
            </button>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      {!clients ? (
        <div className="empty"><span className="spin" /> Loading…</div>
      ) : clients.length === 0 ? (
        <div className="empty">
          No clients yet. Add one and its details carry onto every invoice you raise for it.
        </div>
      ) : (
        <div className="card">
          <table className="lines-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Prefix</th>
                <th>Terms</th>
                <th>GST</th>
                <th className="r">Invoices</th>
                <th className="r">Outstanding</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} style={c.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <b>{c.name}</b>
                    {c.archived && <span className="pill void" style={{ marginLeft: 8 }}>archived</span>}
                    <div className="small muted">
                      {[c.contactName, c.country].filter(Boolean).join(" · ") || c.email || "—"}
                    </div>
                  </td>
                  <td className="small">{c.invoicePrefix}</td>
                  <td className="small">{c.paymentTermsDays}d</td>
                  <td className="small">{c.defaultGstTreatment === "gst" ? "10%" : "free"}</td>
                  <td className="r small">{c.invoiceCount}</td>
                  <td className="r small">
                    {c.outstanding.length === 0
                      ? "—"
                      : c.outstanding.map((o) => <div key={o.currency}>{formatCurrency(o.cents, o.currency)}</div>)}
                  </td>
                  <td className="r nowrap">
                    <Link href={`/invoices/new?clientId=${c.id}`} className="btn ghost small">Invoice</Link>{" "}
                    <button className="btn ghost small" onClick={() => openEdit(c)}>Edit</button>{" "}
                    <button className="btn ghost small" onClick={() => toggleArchive(c)}>
                      {c.archived ? "Restore" : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
