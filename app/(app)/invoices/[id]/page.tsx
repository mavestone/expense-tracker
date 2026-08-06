"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiSend, ApiError } from "@/lib/client";
import { formatCurrency } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import InvoiceForm, { type InvoiceFormValue } from "@/components/InvoiceForm";

type Line = { id: string; description: string; quantityMilli: number; unitAmountCents: number; amountCents: number };
type Invoice = {
  id: string;
  number: string;
  status: "draft" | "sent" | "paid" | "void";
  issueDate: string;
  dueDate: string;
  currency: string;
  gstTreatment: "gst" | "gst_free";
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  purchaseOrder: string | null;
  terms: string | null;
  notes: string | null;
  incomeId: string | null;
  sentAt: string | null;
  paidAt: string | null;
  voidReason: string | null;
  client: { id: string; name: string };
  lines: Line[];
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));

  function load() {
    apiGet<{ invoice: Invoice }>(`/api/invoices/${id}`).then((r) => setInv(r.invoice)).catch((e) => setErrors([e.message]));
  }
  useEffect(load, [id]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setErrors([]);
    try {
      await apiSend(`/api/invoices/${id}`, "POST", body);
      load();
    } catch (e) {
      setErrors(e instanceof ApiError && e.errors?.length ? e.errors : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  if (!inv) return <div className="empty"><span className="spin" /> Loading…</div>;

  if (editing) {
    const initial: InvoiceFormValue = {
      id: inv.id,
      clientId: inv.client.id,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency,
      gstTreatment: inv.gstTreatment,
      purchaseOrder: inv.purchaseOrder ?? "",
      terms: inv.terms ?? "",
      notes: inv.notes ?? "",
      lines: inv.lines.map((l) => ({
        description: l.description,
        qty: String(l.quantityMilli / 1000),
        unit: (l.unitAmountCents / 100).toFixed(2),
      })),
    };
    return (
      <div>
        <div className="section-head">
          <h1>Edit {inv.number}</h1>
          <button className="btn ghost small" onClick={() => setEditing(false)}>Back</button>
        </div>
        <InvoiceForm initial={initial} />
      </div>
    );
  }

  const overdue = inv.status === "sent" && inv.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="section-head">
        <div>
          <h1>{inv.number}</h1>
          <p className="muted small" style={{ marginTop: 2 }}>
            {inv.client.name} · issued {formatDateAU(inv.issueDate)} · due {formatDateAU(inv.dueDate)}
          </p>
        </div>
        <span className={`pill ${overdue ? "overdue" : inv.status}`}>{overdue ? "overdue" : inv.status}</span>
      </div>

      {errors.length > 0 && <div className="alert danger">{errors.join(" ")}</div>}

      {inv.status === "void" && (
        <div className="alert danger">Voided — {inv.voidReason}</div>
      )}

      <div className="stats">
        <div className="stat">
          <div className="label">Total</div>
          <div className="value">{formatCurrency(inv.totalCents, inv.currency)}</div>
          <div className="sub">
            {formatCurrency(inv.subtotalCents, inv.currency)} + {inv.gstTreatment === "gst" ? `${formatCurrency(inv.gstCents, inv.currency)} GST` : "no GST (export)"}
          </div>
        </div>
        <div className="stat">
          <div className="label">In the ledger</div>
          <div className="value" style={{ fontSize: 17 }}>{inv.incomeId ? "Yes" : "Not yet"}</div>
          <div className="sub">
            {inv.incomeId ? <Link href={`/income/${inv.incomeId}`}>View income record →</Link> : "Posts when marked sent"}
          </div>
        </div>
        <div className="stat">
          <div className="label">Paid</div>
          <div className="value" style={{ fontSize: 17 }}>{inv.paidAt ? formatDateAU(inv.paidAt) : "—"}</div>
          <div className="sub">{inv.sentAt ? `Sent ${formatDateAU(inv.sentAt.slice(0, 10))}` : "Draft"}</div>
        </div>
      </div>

      <div className="card mt2">
        <table className="lines-table">
          <thead>
            <tr><th>Description</th><th className="r">Qty</th><th className="r">Unit</th><th className="r">Amount</th></tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="r small">{l.quantityMilli / 1000}</td>
                <td className="r small">{formatCurrency(l.unitAmountCents, inv.currency)}</td>
                <td className="r nowrap">{formatCurrency(l.amountCents, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="btnrow mt2">
        <Link href={`/invoices/${inv.id}/print`} className="btn">View / print PDF</Link>
        {inv.status === "draft" && <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>}
        {inv.status === "draft" && (
          <button className="btn" onClick={() => act({ action: "send" })} disabled={busy}>
            Mark sent &amp; post to income
          </button>
        )}
        {inv.status === "sent" && (
          <>
            <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} style={{ width: 160 }} />
            <button className="btn" onClick={() => act({ action: "paid", datePaid: paidDate })} disabled={busy}>
              Mark paid
            </button>
          </>
        )}
        {inv.status === "draft" && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Delete this draft? It was never issued, so nothing is lost from the record.")) return;
              await apiSend(`/api/invoices/${id}`, "DELETE");
              window.location.href = "/invoices";
            }}
          >
            Delete draft
          </button>
        )}
        {inv.status !== "void" && inv.status !== "draft" && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => {
              const reason = prompt("Why is this invoice being voided?");
              if (reason?.trim()) act({ action: "void", reason });
            }}
          >
            Void
          </button>
        )}
      </div>

      {inv.status === "draft" && (
        <p className="muted small mt2">
          Marking it sent creates the income record on the issue date and freezes the FX rate published for that day.
          After that the invoice can no longer be edited — correct an issued invoice by voiding it and raising a new one.
        </p>
      )}
    </div>
  );
}
