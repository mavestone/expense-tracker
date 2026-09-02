"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiSend, ApiError } from "@/lib/client";
import { formatCurrency, currencySymbol, parseMoneyToCents, centsToDecimalString } from "@/lib/money";
import ClientQuickAdd, { type NewClient } from "@/components/ClientQuickAdd";
import { formatDateAU } from "@/lib/fy";

type Client = {
  id: string;
  name: string;
  invoicePrefix: string;
  defaultCurrency: string;
  defaultGstTreatment: "gst" | "gst_free";
  paymentTermsDays: number;
};

type LineDraft = {
  description: string;
  qty: string;
  unit: string;
  expenseId?: string | null;
  lineDate?: string;
  category?: string;
  location?: string;
};

type Expense = {
  id: string;
  dateIncurred: string;
  supplierName: string;
  description: string;
  originalAmountCents: number;
  originalCurrency: string;
  audAmountCents: number;
  categoryId: string;
};

export type InvoiceKind = "services" | "reimbursement";

export type InvoiceFormValue = {
  id?: string;
  clientId: string;
  kind: InvoiceKind;
  number?: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  gstTreatment: "gst" | "gst_free";
  purchaseOrder: string;
  terms: string;
  notes: string;
  lines: LineDraft[];
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const EMPTY_LINE: LineDraft = { description: "", qty: "1", unit: "", expenseId: null, lineDate: "", category: "", location: "" };

/**
 * Builder for a new or draft invoice. Totals are recomputed here purely so the
 * owner can see them while typing — the server recomputes them from the lines
 * on save, and its numbers are the ones that are stored.
 */
export default function InvoiceForm({ initial }: { initial?: InvoiceFormValue }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [clients, setClients] = useState<Client[] | null>(null);
  const [v, setV] = useState<InvoiceFormValue>(
    initial ?? {
      clientId: "",
      kind:
        (typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("kind") === "reimbursement"
          ? "reimbursement"
          : "services") as InvoiceKind,
      issueDate: today,
      dueDate: addDays(today, 14),
      currency: "AUD",
      gstTreatment: "gst_free",
      purchaseOrder: "",
      terms: "",
      notes: "",
      lines: [{ ...EMPTY_LINE }],
    }
  );
  const [nextNumber, setNextNumber] = useState<string>("");
  const [addingClient, setAddingClient] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [picked, setPicked] = useState<Expense[] | null>(null);
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{ clients: Client[] }>("/api/clients")
      .then((r) => {
        setClients(r.clients);
        // Deep-linked from the client list: /invoices/new?clientId=…
        const pre = new URLSearchParams(window.location.search).get("clientId");
        if (pre && !initial && r.clients.some((c) => c.id === pre)) applyClient(pre, r.clients);
      })
      .catch((e) => setErrors([e.message]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A client added mid-invoice is selected immediately, defaults and all. */
  function addClient(c: NewClient) {
    const next = [...(clients ?? []), c as Client].sort((a, b) => a.name.localeCompare(b.name));
    setClients(next);
    setAddingClient(false);
    setV((prev) => ({
      ...prev,
      clientId: c.id,
      currency: c.defaultCurrency,
      gstTreatment: c.defaultGstTreatment,
      dueDate: addDays(prev.issueDate, c.paymentTermsDays),
    }));
  }

  function applyClient(id: string, list?: Client[]) {
    const c = (list ?? clients ?? []).find((x) => x.id === id);
    setV((prev) => ({
      ...prev,
      clientId: id,
      // A client's defaults are the whole point of storing them — apply on pick,
      // but never overwrite an edit in progress on an existing invoice.
      ...(c && !initial
        ? {
            currency: c.defaultCurrency,
            gstTreatment: c.defaultGstTreatment,
            dueDate: addDays(prev.issueDate, c.paymentTermsDays),
          }
        : {}),
    }));
  }

  useEffect(() => {
    if (!v.clientId || initial) return setNextNumber("");
    apiGet<{ number: string }>(`/api/invoices/next-number?clientId=${v.clientId}&issueDate=${v.issueDate}`)
      .then((r) => {
        setNextNumber(r.number);
        // Fill the field, but never overwrite a reference already typed.
        setV((prev) => (prev.number?.trim() ? prev : { ...prev, number: r.number }));
      })
      .catch(() => setNextNumber(""));
  }, [v.clientId, v.issueDate, initial]);

  useEffect(() => {
    if (!pickerOpen || Object.keys(catNames).length) return;
    apiGet<{ categories: { id: string; name: string }[] }>("/api/meta")
      .then((m) => setCatNames(Object.fromEntries(m.categories.map((c) => [c.id, c.name]))))
      .catch(() => setCatNames({}));
  }, [pickerOpen, catNames]);

  useEffect(() => {
    if (!pickerOpen) return;
    const t = setTimeout(() => {
      const p = new URLSearchParams({ limit: "25", status: "active" });
      if (pickerQ.trim()) p.set("q", pickerQ.trim());
      apiGet<{ expenses: Expense[] }>(`/api/expenses?${p}`)
        .then((r) => setPicked(r.expenses))
        .catch(() => setPicked([]));
    }, pickerQ ? 250 : 0);
    return () => clearTimeout(t);
  }, [pickerOpen, pickerQ]);

  /**
   * Pull an expense in as a line. The description and the link come across;
   * the amount deliberately does not. The expense is in the currency it was
   * paid in and the invoice is in the client's, and this app converts in
   * exactly one place — the FX engine, on the record. Typing what the
   * statement says it cost is both accurate and honest about the rate.
   */
  function addExpenseLine(e: Expense) {
    const line: LineDraft = {
      description: [e.supplierName, e.description].filter(Boolean).join(" — "),
      qty: "1",
      unit: "",
      expenseId: e.id,
      lineDate: e.dateIncurred,
      category: catNames[e.categoryId] ?? "",
      location: "",
    };
    setV((prev) => {
      const blank = prev.lines.findIndex((l) => !l.description.trim() && !l.unit.trim());
      const lines = blank >= 0
        ? prev.lines.map((l, i) => (i === blank ? line : l))
        : [...prev.lines, line];
      return { ...prev, lines };
    });
  }

  const totals = useMemo(() => {
    const sub = v.lines.reduce((s, l) => {
      const q = Math.round(parseFloat(l.qty || "0") * 1000);
      const u = parseMoneyToCents(l.unit || "0") ?? 0;
      return s + (Number.isFinite(q) ? Math.round((q * u) / 1000) : 0);
    }, 0);
    const gst = v.gstTreatment === "gst" ? Math.round(sub * 0.1) : 0;
    return { sub, gst, total: sub + gst };
  }, [v.lines, v.gstTreatment]);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setV({ ...v, lines: v.lines.map((l, j) => (i === j ? { ...l, ...patch } : l)) });
  }

  async function save(then: "stay" | "view") {
    setSaving(true);
    setErrors([]);
    try {
      const payload = {
        clientId: v.clientId,
        number: v.number?.trim() || null,
        kind: v.kind,
        issueDate: v.issueDate,
        dueDate: v.dueDate,
        currency: v.currency,
        gstTreatment: v.gstTreatment,
        purchaseOrder: v.purchaseOrder || null,
        terms: v.terms || null,
        notes: v.notes || null,
        lines: v.lines
          .filter((l) => l.description.trim() || l.unit.trim())
          .map((l) => ({
            description: l.description,
            quantityMilli: Math.round(parseFloat(l.qty || "1") * 1000),
            unitAmountCents: parseMoneyToCents(l.unit || "0") ?? 0,
            expenseId: l.expenseId ?? null,
            lineDate: l.lineDate || null,
            category: l.category || null,
            location: l.location || null,
          })),
      };
      const res = initial?.id
        ? await apiSend<{ invoice: { id: string } }>(`/api/invoices/${initial.id}`, "PUT", payload)
        : await apiSend<{ invoice: { id: string } }>("/api/invoices", "POST", payload);
      if (then === "view") router.push(`/invoices/${res.invoice.id}`);
      else router.refresh();
    } catch (e) {
      setErrors(e instanceof ApiError && e.errors?.length ? e.errors : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  if (!clients) return <div className="empty"><span className="spin" /> Loading…</div>;
  if (clients.length === 0 || addingClient)
    return (
      <div>
        {clients.length === 0 && !addingClient && (
          <p className="muted small mb2">
            No clients yet. Add one — its currency, terms and GST treatment become the defaults for every invoice you
            raise for them.
          </p>
        )}
        <div className="card">
          <ClientQuickAdd onCreated={addClient} onCancel={() => setAddingClient(false)} />
        </div>
      </div>
    );

  return (
    <div>
      {errors.length > 0 && <div className="alert danger">{errors.join(" ")}</div>}

      <div className="card">
        <div className="kindswitch" role="group" aria-label="What this invoice is for">
          <button
            type="button"
            className={v.kind === "services" ? "active" : ""}
            onClick={() => setV({ ...v, kind: "services" })}
          >
            <b>Services</b>
            <span>Work you performed, billed at your rates</span>
          </button>
          <button
            type="button"
            className={v.kind === "reimbursement" ? "active" : ""}
            onClick={() => setV({ ...v, kind: "reimbursement" })}
          >
            <b>Reimbursement</b>
            <span>Costs you carried for the client, billed back</span>
          </button>
        </div>

        {v.kind === "reimbursement" && (
          <p className="hint mb2">
            Billed back gross: the recovery is income and the underlying expense records stay
            deductible. Enter each cost in {v.currency} — what your statement shows it took, not a
            rate worked out here.
          </p>
        )}

        <div className="grid2">
          <label>
            Client
            <span className="withbtn">
              <select value={v.clientId} onChange={(e) => applyClient(e.target.value)}>
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button type="button" className="btn ghost small" onClick={() => setAddingClient(true)}>
                + New
              </button>
            </span>
          </label>
          <label>
            Invoice reference
            <input
              value={v.number ?? ""}
              placeholder={nextNumber || "KC_020926"}
              onChange={(e) => setV({ ...v, number: e.target.value })}
            />
            <span className="hint">
              Defaults to the client&rsquo;s prefix and the issue date. Overwrite it if you need to.
            </span>
          </label>
        </div>

        <div className="grid3">
          <label>
            Issue date
            <input type="date" value={v.issueDate} onChange={(e) => setV({ ...v, issueDate: e.target.value })} />
            <span className="hint">The tax point — sets the FX rate.</span>
          </label>
          <label>
            Due date
            <input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
          </label>
          <label>
            Currency
            <select value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}>
              <option value="AUD">AUD — {currencySymbol("AUD")}</option>
              <option value="USD">USD — {currencySymbol("USD")}</option>
              <option value="GBP">GBP — {currencySymbol("GBP")}</option>
            </select>
          </label>
        </div>

        <label>
          GST
          <select value={v.gstTreatment} onChange={(e) => setV({ ...v, gstTreatment: e.target.value as "gst" | "gst_free" })}>
            <option value="gst_free">GST-free — export of services to an overseas client</option>
            <option value="gst">Add 10% GST — Australian client</option>
          </select>
        </label>
      </div>

      <div className="card mt2">
        <div className="section-head" style={{ margin: "0 0 12px" }}>
          <h2 style={{ margin: 0 }}>{v.kind === "reimbursement" ? "Costs recovered" : "Lines"}</h2>
          {v.kind === "reimbursement" && (
            <button type="button" className="btn ghost small" onClick={() => setPickerOpen((o) => !o)}>
              {pickerOpen ? "Close" : "Add from expenses"}
            </button>
          )}
        </div>

        {v.kind === "reimbursement" && pickerOpen && (
          <div className="picker mb2">
            <input
              type="search"
              placeholder="Search supplier or description"
              value={pickerQ}
              onChange={(e) => setPickerQ(e.target.value)}
            />
            {picked === null ? (
              <p className="muted small">Loading…</p>
            ) : picked.length === 0 ? (
              <p className="muted small">No expense records match.</p>
            ) : (
              <ul className="pickerlist">
                {picked.map((e) => {
                  const used = v.lines.some((l) => l.expenseId === e.id);
                  return (
                    <li key={e.id}>
                      <span className="pk-date">{formatDateAU(e.dateIncurred)}</span>
                      <span className="pk-sup">
                        <b>{e.supplierName}</b>
                        <span className="muted small">{e.description}</span>
                      </span>
                      <span className="pk-amt">
                        {formatCurrency(e.originalAmountCents, e.originalCurrency)}
                      </span>
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={used}
                        onClick={() => addExpenseLine(e)}
                      >
                        {used ? "Added" : "Add"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <table className="lines-table">
          <thead>
            <tr>
              {v.kind === "reimbursement" && <th className="narrow">Date</th>}
              <th>{v.kind === "reimbursement" ? "Merchant / description" : "Description"}</th>
              {v.kind === "reimbursement" ? (
                <>
                  <th className="narrow">Category</th>
                  <th className="narrow">Location</th>
                </>
              ) : (
                <th className="narrow">Qty</th>
              )}
              <th className="narrow">
                {v.kind === "reimbursement" ? `Amount (${v.currency})` : `Unit price (${currencySymbol(v.currency)})`}
              </th>
              {v.kind !== "reimbursement" && <th className="r narrow">Amount</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {v.lines.map((l, i) => {
              const q = Math.round(parseFloat(l.qty || "0") * 1000);
              const u = parseMoneyToCents(l.unit || "0") ?? 0;
              const amt = Number.isFinite(q) ? Math.round((q * u) / 1000) : 0;
              return (
                <tr key={i}>
                  {v.kind === "reimbursement" && (
                    <td className="narrow">
                      <input
                        type="date"
                        value={l.lineDate ?? ""}
                        onChange={(e) => setLine(i, { lineDate: e.target.value })}
                      />
                    </td>
                  )}
                  <td>
                    <input
                      value={l.description}
                      placeholder={v.kind === "reimbursement" ? "easyJet — flight, London to Geneva" : "20 finished reels — edit, grade, music mix"}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                    />
                  </td>
                  {v.kind === "reimbursement" ? (
                    <>
                      <td className="narrow">
                        <input
                          value={l.category ?? ""}
                          placeholder="Transport - flight"
                          onChange={(e) => setLine(i, { category: e.target.value })}
                        />
                      </td>
                      <td className="narrow">
                        <input
                          value={l.location ?? ""}
                          placeholder="Online"
                          onChange={(e) => setLine(i, { location: e.target.value })}
                        />
                      </td>
                    </>
                  ) : (
                    <td className="narrow">
                      <input value={l.qty} inputMode="decimal" onChange={(e) => setLine(i, { qty: e.target.value })} />
                    </td>
                  )}
                  <td className="narrow">
                    <input value={l.unit} inputMode="decimal" placeholder="0.00" onChange={(e) => setLine(i, { unit: e.target.value })} />
                  </td>
                  {v.kind !== "reimbursement" && <td className="r nowrap">{formatCurrency(amt, v.currency)}</td>}
                  <td className="act">
                    {v.lines.length > 1 && (
                      <button
                        className="btn ghost small"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="btnrow mt1">
          <button className="btn ghost small" onClick={() => setV({ ...v, lines: [...v.lines, { ...EMPTY_LINE }] })}>
            + Add line
          </button>
        </div>

        <div className="totals mt2" style={{ marginLeft: "auto", width: 260 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span className="muted">Subtotal</span>
            <b>{formatCurrency(totals.sub, v.currency)}</b>
          </div>
          {v.gstTreatment === "gst" && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
              <span className="muted">GST 10%</span>
              <b>{formatCurrency(totals.gst, v.currency)}</b>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0 0", borderTop: "1px solid var(--line)", marginTop: 5, fontSize: 17 }}>
            <b>Total</b>
            <b>{formatCurrency(totals.total, v.currency)}</b>
          </div>
        </div>
      </div>

      <div className="card mt2">
        <label>
          Payment terms shown on the invoice
          <input value={v.terms} onChange={(e) => setV({ ...v, terms: e.target.value })} placeholder="Leave blank to use your default from Branding" />
        </label>
        <label>
          Notes <span className="muted small">printed at the bottom of the invoice</span>
          <textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </label>
      </div>

      <div className="btnrow mt2">
        <button className="btn" onClick={() => save("view")} disabled={saving || !v.clientId}>
          {saving ? "Saving…" : initial?.id ? "Save changes" : "Create draft"}
        </button>
        <Link href="/invoices" className="btn ghost">Cancel</Link>
        <span className="muted small">
          Creates a draft. Nothing reaches the income ledger until you mark it sent.
        </span>
      </div>
    </div>
  );
}

export { centsToDecimalString };
