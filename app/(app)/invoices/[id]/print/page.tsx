import { notFound } from "next/navigation";
import Link from "next/link";
import { getInvoice } from "@/lib/invoices";
import { getSettings, payToFor } from "@/lib/settings";
import { formatCurrency } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import PaymentBlock, { linkify } from "@/components/PaymentBlock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The printable invoice. Rendered on the server so the document is a plain
 * page — "Print → Save as PDF" produces the file, with no PDF library and no
 * fonts to embed. Everything that identifies the business comes from Branding
 * settings, so a change to an address is one edit, not a redeploy.
 */
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [inv, s] = await Promise.all([getInvoice(id), getSettings()]);
  if (!inv) notFound();

  const c = inv.client;
  const payTo = payToFor(s, inv.currency);
  const terms = inv.terms || s.invoice_terms_default;
  const fromName = s.business_name || "Mavestone";

  return (
    <>
      <div className="btnrow noprint mb2">
        <Link href={`/invoices/${inv.id}`} className="btn ghost small">← Back</Link>
        <span className="muted small">
          Print this page and choose “Save as PDF”. {inv.status === "draft" && <b>This invoice is still a draft.</b>}
        </span>
      </div>

      <article className="doc">
        <div className="doc-head">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {s.invoice_logo ? <img src="/api/branding/logo" alt={fromName} className="doc-logo" /> : null}
            <div style={{ fontWeight: 700, fontSize: 15 }}>{fromName}</div>
            {s.business_abn && <div>ABN {s.business_abn}</div>}
            {s.business_address && <div style={{ whiteSpace: "pre-wrap" }}>{s.business_address}</div>}
            {s.business_email && <div>{s.business_email}</div>}
            {s.business_website && <div>{s.business_website}</div>}
          </div>
          <div className="doc-meta">
            <h1>{inv.gstTreatment === "gst" ? "Tax Invoice" : "Invoice"}</h1>
            <div style={{ marginTop: 10 }}>
              <div className="lbl">Invoice reference</div>
              <div style={{ fontWeight: 700 }}>{inv.number}</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="lbl">Issue date</div>
              <div>{formatDateAU(inv.issueDate)}</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="lbl">Due date</div>
              <div>{formatDateAU(inv.dueDate)}</div>
            </div>
            {inv.purchaseOrder && (
              <div style={{ marginTop: 10 }}>
                <div className="lbl">Reference</div>
                <div>{inv.purchaseOrder}</div>
              </div>
            )}
          </div>
        </div>

        <div className="doc-parties">
          <div>
            <div className="lbl">Bill to</div>
            <div style={{ fontWeight: 700 }}>{c.name}</div>
            {c.contactName && <div>{c.contactName}</div>}
            {c.addressLines && <div style={{ whiteSpace: "pre-wrap" }}>{c.addressLines}</div>}
            {c.country && <div>{c.country}</div>}
            {c.email && <div>{c.email}</div>}
            {c.abn && <div>ABN {c.abn}</div>}
            {c.taxId && <div>{c.taxLabel || "Tax ID"} {c.taxId}</div>}
          </div>
          <div>
            <div className="lbl">Amount due</div>
            <div style={{ fontSize: 25, fontWeight: 750, letterSpacing: "-0.02em" }}>
              {formatCurrency(inv.totalCents, inv.currency)}
            </div>
            <div style={{ color: "#6b7280", marginTop: 2 }}>{inv.currency}</div>
          </div>
        </div>

        <div className="itemswrap">
        <table className="items">
          <thead>
            <tr>
              <th>Description</th>
              <th className="r" style={{ width: 70 }}>Qty</th>
              <th className="r" style={{ width: 110 }}>Unit price</th>
              <th className="r" style={{ width: 120 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="r">{l.quantityMilli / 1000}</td>
                <td className="r">{formatCurrency(l.unitAmountCents, inv.currency)}</td>
                <td className="r">{formatCurrency(l.amountCents, inv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="totals">
          <div className="row">
            <span>Subtotal</span>
            <span>{formatCurrency(inv.subtotalCents, inv.currency)}</span>
          </div>
          <div className="row">
            <span>{inv.gstTreatment === "gst" ? "GST 10%" : "GST"}</span>
            <span>
              {inv.gstTreatment === "gst" ? formatCurrency(inv.gstCents, inv.currency) : "GST-free"}
            </span>
          </div>
          <div className="row grand">
            <span>Total</span>
            <span>{formatCurrency(inv.totalCents, inv.currency)}</span>
          </div>
        </div>

        <div className="doc-foot">
          {payTo && <PaymentBlock block={payTo} currency={inv.currency} />}

          {terms && (
            <section className="paysec">
              <div className="lbl">Payment terms</div>
              <p className="terms">{linkify(terms)}</p>
            </section>
          )}

          {(inv.notes || inv.gstTreatment === "gst_free" || s.invoice_footer) && (
            <section className="docnotes">
              {inv.notes && <p style={{ whiteSpace: "pre-wrap" }}>{linkify(inv.notes)}</p>}
              {inv.gstTreatment === "gst_free" && (
                <p>
                  This supply is GST-free: an export of services under the A New Tax System (Goods and Services Tax)
                  Act 1999.
                </p>
              )}
              {s.invoice_footer && <p style={{ whiteSpace: "pre-wrap" }}>{linkify(s.invoice_footer)}</p>}
            </section>
          )}
        </div>
      </article>
    </>
  );
}
