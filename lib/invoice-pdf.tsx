/**
 * The invoice as a real PDF — vector text, selectable and searchable, with no
 * headless browser to keep alive.
 *
 * This is a second rendering of the same document (the other is the printable
 * HTML page), so the two CAN drift. That is a deliberate trade: the only way to
 * avoid it would be to drive headless Chrome, which on serverless means
 * shipping a ~50 MB browser and a class of timeout failures for a document
 * that changes a few times a year. Anything that alters the invoice needs
 * changing in both places — the print page and here.
 */

// Explicit React import: this module is rendered by @react-pdf's own
// reconciler and can be loaded outside Next's automatic-JSX transform.
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { InvoiceDetail } from "./invoices";
export { invoicePdfFilename } from "./invoices";
import type { AppSettings } from "./settings";
import { payToFor } from "./settings";
import { formatWithCode, formatAmount } from "./money";
import { formatDateAU } from "./fy";
import { parsePaymentBlock } from "./payment-block";

const INK = "#111111";
const MUTED = "#6b7280";
const BODY = "#374151";
const RULE = "#e5e7eb";

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 52, paddingHorizontal: 46, fontSize: 9.5, color: BODY, fontFamily: "Helvetica", lineHeight: 1.5 },
  head: { flexDirection: "row", justifyContent: "space-between" },
  headLeft: { width: "55%" },
  headRight: { width: "42%", textAlign: "right" },
  logo: { maxWidth: 150, maxHeight: 54, marginBottom: 9, objectFit: "contain" },
  owner: { fontSize: 12, fontFamily: "Helvetica-Bold", color: INK },
  business: { fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 1 },
  title: { fontSize: 21, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 14 },
  lbl: { fontSize: 7, color: MUTED, letterSpacing: 0.8, marginBottom: 2, textTransform: "uppercase" },
  metaBlock: { marginBottom: 8 },
  strong: { fontFamily: "Helvetica-Bold", color: INK },

  parties: { flexDirection: "row", justifyContent: "space-between", marginTop: 30 },
  party: { width: "48%" },
  amountDue: { fontSize: 18, fontFamily: "Helvetica-Bold", color: INK },

  table: { marginTop: 28 },
  th: { flexDirection: "row", borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 5 },
  thText: { fontSize: 7, color: MUTED, letterSpacing: 0.8, textTransform: "uppercase" },
  tr: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: RULE, paddingVertical: 8 },
  cDesc: { width: "58%", paddingRight: 10 },
  cQty: { width: "10%", textAlign: "right" },
  cUnit: { width: "16%", textAlign: "right" },
  cAmt: { width: "16%", textAlign: "right" },

  totals: { marginTop: 14, marginLeft: "auto", width: 210 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grandRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.2, borderTopColor: INK, marginTop: 5, paddingTop: 8 },
  grandText: { fontSize: 13, fontFamily: "Helvetica-Bold", color: INK },

  foot: { marginTop: 34, paddingTop: 16, borderTopWidth: 0.6, borderTopColor: RULE },
  section: { marginBottom: 16 },
  // Matches the hairline rules between footer blocks on the HTML invoice.
  sectionRuled: { marginBottom: 16, paddingTop: 14, borderTopWidth: 0.6, borderTopColor: RULE },
  payRow: { flexDirection: "row", paddingVertical: 1.5 },
  payLabel: { width: 108, color: MUTED },
  payValue: { flex: 1, color: INK, fontFamily: "Courier", fontSize: 9 },
  payFull: { color: INK },
  terms: { color: INK },
  note: { marginBottom: 5 },
  pageNum: { position: "absolute", bottom: 26, left: 46, right: 46, textAlign: "center", fontSize: 7.5, color: MUTED },

  // ── Reimbursement layout ────────────────────────────────────────────
  // A recovered cost is evidence, not a priced service, so this reads as a
  // statement of what was spent: one row per charge, with the date, category
  // and place the client would recognise from their own records.
  rTitle: { fontSize: 30, fontFamily: "Helvetica-Bold", color: "#1f2a44", letterSpacing: -0.5 },
  rRule: { borderBottomWidth: 1.6, borderBottomColor: "#1f2a44", marginTop: 16, marginBottom: 20 },
  rMetaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  rMetaCol: { width: "52%" },
  rMetaColRight: { width: "44%", textAlign: "right" },
  rAmountDue: { fontSize: 19, fontFamily: "Helvetica-Bold", color: INK, marginTop: 1 },
  rSection: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK, marginTop: 14, marginBottom: 8 },

  rTh: { flexDirection: "row", borderBottomWidth: 0.8, borderBottomColor: "#cfd4dc", paddingBottom: 4 },
  rTr: { flexDirection: "row", paddingVertical: 6, alignItems: "flex-start" },
  rTrAlt: { flexDirection: "row", paddingVertical: 6, alignItems: "flex-start", backgroundColor: "#f4f4f2" },
  rcDate: { width: "10%", paddingLeft: 4, paddingRight: 4 },
  rcDesc: { width: "42%", paddingRight: 8 },
  rcCat: { width: "17%", paddingRight: 6 },
  rcLoc: { width: "16%", paddingRight: 6 },
  rcAmt: { width: "15%", textAlign: "right", paddingRight: 4 },

  rTotalRow: { flexDirection: "row", paddingTop: 12, paddingBottom: 6, alignItems: "baseline" },
  rTotalLabel: { width: "52%", paddingLeft: 4, fontFamily: "Helvetica-Bold", color: INK, fontSize: 10 },
  rTotalCcy: { width: "33%", textAlign: "right", color: BODY },
  rTotalAmt: { width: "15%", textAlign: "right", fontFamily: "Helvetica-Bold", color: INK, fontSize: 14, paddingRight: 4 },

  rPayWrap: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#f4f4f2", padding: 14, marginTop: 20 },
  rPayLeft: { width: "58%" },
  rPayRight: { width: "38%", textAlign: "right" },
  rOnline: { backgroundColor: "#ededea", paddingHorizontal: 14, paddingVertical: 9 },
  rFoot: { position: "absolute", bottom: 26, left: 46, right: 46, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.6, borderTopColor: RULE, paddingTop: 8, fontSize: 7.5, color: MUTED },
});


/** "2026-08-04" -> "04 Aug". The year lives in the period line, not on every row. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[Number(m) - 1] ?? ""}`.trim();
}

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The span the costs were incurred over, collapsed as far as it honestly can
 * be: "4 – 20 August 2026" inside one month, "4 August – 3 September 2026"
 * across two. A single date prints on its own rather than as a range of one.
 */
function periodLabel(dates: string[]): string {
  const sorted = [...dates].filter(Boolean).sort();
  if (sorted.length === 0) return "";
  const one = (iso: string, withMonth = true, withYear = true) => {
    const [y, m, d] = iso.split("-");
    return [String(Number(d)), withMonth ? LONG_MONTHS[Number(m) - 1] : null, withYear ? y : null]
      .filter(Boolean)
      .join(" ");
  };
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  if (a === b) return one(a);
  const [ay, am] = a.split("-");
  const [by, bm] = b.split("-");
  if (ay === by && am === bm) return `${one(a, false, false)} – ${one(b)}`;
  if (ay === by) return `${one(a, true, false)} – ${one(b)}`;
  return `${one(a)} – ${one(b)}`;
}

/** Bare decimal — the currency is stated once, in the column head and total. */
function plainAmount(cents: number): string {
  return (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

/**
 * The reimbursement document: an itemised statement of costs carried for the
 * client. No terms block and no explanatory footnote — the rows are the
 * explanation, and anything else just invites the client to read past them.
 */
function ReimbursementBody({ invoice: inv, settings }: { invoice: InvoiceDetail; settings: AppSettings }) {
  const c = inv.client;
  const payTo = payToFor(settings, inv.currency);
  const allRows = payTo ? parsePaymentBlock(payTo) : [];
  const online = allRows.find((r) => isUrl(r.value));
  const payRows = allRows.filter((r) => r !== online);
  const owner = settings.owner_name || settings.business_name || "Mavestone";
  const period = periodLabel(inv.lines.map((l) => l.lineDate ?? "").filter(Boolean));

  return (
    <Page size="A4" style={s.page}>
      <View style={s.head}>
        <View style={s.headLeft}>
          <Text style={s.rTitle}>INVOICE</Text>
        </View>
        <View style={s.headRight}>
          <Text style={s.strong}>{owner}</Text>
          {settings.business_abn ? <Text>ABN {settings.business_abn}</Text> : null}
          {settings.business_email ? <Text>{settings.business_email}</Text> : null}
          {settings.business_phone ? <Text>{settings.business_phone}</Text> : null}
        </View>
      </View>
      <View style={s.rRule} />

      <View style={s.rMetaRow}>
        <View style={s.rMetaCol}>
          <Text style={s.lbl}>Bill to</Text>
          <Text style={s.strong}>{c.name}</Text>
        </View>
        <View style={s.rMetaColRight}>
          <Text style={s.lbl}>Invoice number</Text>
          <Text style={s.strong}>{inv.number}</Text>
        </View>
      </View>

      <View style={s.rMetaRow}>
        <View style={s.rMetaCol}>
          <Text style={s.lbl}>Period</Text>
          <Text>{period || formatDateAU(inv.issueDate)}</Text>
        </View>
        <View style={s.rMetaColRight}>
          <Text style={s.lbl}>Invoice date</Text>
          <Text>{formatDateAU(inv.issueDate)}</Text>
        </View>
      </View>

      <View style={s.rMetaRow}>
        <View style={s.rMetaCol}>
          {inv.notes ? (
            <>
              <Text style={s.lbl}>Description</Text>
              <Text>{inv.notes}</Text>
            </>
          ) : null}
        </View>
        <View style={s.rMetaColRight}>
          <Text style={s.lbl}>Amount due</Text>
          <Text style={s.rAmountDue}>{formatWithCode(inv.totalCents, inv.currency)}</Text>
        </View>
      </View>

      <Text style={s.rSection}>Expense detail</Text>

      <View style={s.rTh} fixed>
        <Text style={[s.thText, s.rcDate]}>Date</Text>
        <Text style={[s.thText, s.rcDesc]}>Merchant / description</Text>
        <Text style={[s.thText, s.rcCat]}>Category</Text>
        <Text style={[s.thText, s.rcLoc]}>Location</Text>
        <Text style={[s.thText, s.rcAmt]}>Amount ({inv.currency})</Text>
      </View>

      {inv.lines.map((l, i) => (
        <View style={i % 2 === 1 ? s.rTrAlt : s.rTr} key={l.id} wrap={false}>
          <Text style={s.rcDate}>{l.lineDate ? shortDate(l.lineDate) : ""}</Text>
          <Text style={s.rcDesc}>{l.description}</Text>
          <Text style={s.rcCat}>{l.category ?? ""}</Text>
          <Text style={s.rcLoc}>{l.location ?? ""}</Text>
          <Text style={s.rcAmt}>{plainAmount(l.amountCents)}</Text>
        </View>
      ))}

      <View style={s.rTotalRow} wrap={false}>
        <Text style={s.rTotalLabel}>TOTAL DUE</Text>
        <Text style={s.rTotalCcy}>{inv.currency}</Text>
        <Text style={s.rTotalAmt}>{plainAmount(inv.totalCents)}</Text>
      </View>

      {(payRows.length > 0 || settings.business_email) && (
        <View style={s.rPayWrap} wrap={false}>
          <View style={s.rPayLeft}>
            <Text style={s.lbl}>Payment instructions</Text>
            <Text>Payment to: {owner}</Text>
            <Text>Reference: {inv.number}</Text>
            {payRows.map((r, i) => (
              <Text key={i}>{r.label ? `${r.label}: ${r.value}` : r.value}</Text>
            ))}
          </View>
          <View style={s.rPayRight}>
            <Text style={s.lbl}>Contact</Text>
            {settings.business_phone ? <Text>{settings.business_phone}</Text> : null}
            {settings.business_email ? <Text>{settings.business_email}</Text> : null}
            {settings.business_abn ? <Text>{`ABN: ${settings.business_abn}`}</Text> : null}
          </View>
        </View>
      )}

      {online ? (
        <View style={s.rOnline} wrap={false}>
          <Text>Or pay online: {online.value}</Text>
        </View>
      ) : null}

      <View style={s.rFoot} fixed>
        <Text>
          {`Invoice ${inv.number}  ·  ${owner}`}
          {settings.business_abn ? `  ·  ABN ${settings.business_abn}` : ""}
        </Text>
        <Text render={({ pageNumber }) => `Page ${pageNumber}`} />
      </View>
    </Page>
  );
}

export type InvoicePdfProps = {
  invoice: InvoiceDetail;
  settings: AppSettings;
  /** Raw logo bytes, already fetched — @react-pdf cannot go and get them itself. */
  logo?: { data: Buffer; format: "png" | "jpg" } | null;
};

export function InvoicePdf({ invoice: inv, settings, logo }: InvoicePdfProps) {
  const c = inv.client;
  const payTo = payToFor(settings, inv.currency);
  const payRows = payTo ? parsePaymentBlock(payTo) : [];
  const terms = inv.terms || settings.invoice_terms_default;
  const fromName = settings.business_name || "Mavestone";
  const isTaxInvoice = inv.gstTreatment === "gst";
  const isReimbursement = inv.kind === "reimbursement";

  return (
    <Document
      title={`${inv.number} — ${c.name}`}
      author={settings.owner_name || fromName}
      subject={`Invoice ${inv.number}`}
      creator={fromName}
      producer={fromName}
    >
      {isReimbursement ? (
        <ReimbursementBody invoice={inv} settings={settings} />
      ) : (
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View style={s.headLeft}>
            {logo ? <Image style={s.logo} src={{ data: logo.data, format: logo.format }} /> : null}
            {settings.owner_name ? <Text style={s.owner}>{settings.owner_name}</Text> : null}
            <Text style={settings.owner_name ? s.business : s.owner}>{fromName}</Text>
            {settings.business_abn ? <Text>ABN {settings.business_abn}</Text> : null}
            {settings.business_address
              ? settings.business_address.split(/\r?\n/).map((l, i) => <Text key={i}>{l}</Text>)
              : null}
            {settings.business_email ? <Text>{settings.business_email}</Text> : null}
            {settings.business_website ? <Text>{settings.business_website}</Text> : null}
          </View>

          <View style={s.headRight}>
            <Text style={s.title}>
              {isReimbursement
                ? isTaxInvoice
                  ? "Tax Invoice — Expenses"
                  : "Expense Reimbursement"
                : isTaxInvoice
                  ? "Tax Invoice"
                  : "Invoice"}
            </Text>
            <View style={s.metaBlock}>
              <Text style={s.lbl}>Invoice reference</Text>
              <Text style={s.strong}>{inv.number}</Text>
            </View>
            <View style={s.metaBlock}>
              <Text style={s.lbl}>Issue date</Text>
              <Text>{formatDateAU(inv.issueDate)}</Text>
            </View>
            <View style={s.metaBlock}>
              <Text style={s.lbl}>Due date</Text>
              <Text>{formatDateAU(inv.dueDate)}</Text>
            </View>
            {inv.purchaseOrder ? (
              <View style={s.metaBlock}>
                <Text style={s.lbl}>Reference</Text>
                <Text>{inv.purchaseOrder}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.party}>
            <Text style={s.lbl}>Bill to</Text>
            <Text style={s.strong}>{c.name}</Text>
            {c.contactName ? <Text>{c.contactName}</Text> : null}
            {c.addressLines ? c.addressLines.split(/\r?\n/).map((l, i) => <Text key={i}>{l}</Text>) : null}
            {c.country ? <Text>{c.country}</Text> : null}
            {c.email ? <Text>{c.email}</Text> : null}
            {c.abn ? <Text>ABN {c.abn}</Text> : null}
            {c.taxId ? <Text>{`${c.taxLabel || "Tax ID"} ${c.taxId}`}</Text> : null}
          </View>
          <View style={s.party}>
            <Text style={s.lbl}>Amount due</Text>
            <Text style={s.amountDue}>{formatWithCode(inv.totalCents, inv.currency)}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={[s.thText, s.cDesc]}>{isReimbursement ? "Cost incurred" : "Description"}</Text>
            <Text style={[s.thText, s.cQty]}>Qty</Text>
            <Text style={[s.thText, s.cUnit]}>Unit price</Text>
            <Text style={[s.thText, s.cAmt]}>Amount</Text>
          </View>
          {inv.lines.map((l) => (
            <View style={s.tr} key={l.id} wrap={false}>
              <Text style={s.cDesc}>{l.description}</Text>
              <Text style={s.cQty}>{l.quantityMilli / 1000}</Text>
              <Text style={s.cUnit}>{formatAmount(l.unitAmountCents, inv.currency)}</Text>
              <Text style={s.cAmt}>{formatAmount(l.amountCents, inv.currency)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text>Subtotal</Text>
            <Text>{formatAmount(inv.subtotalCents, inv.currency)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text>{isTaxInvoice ? "GST 10%" : "GST"}</Text>
            <Text>{isTaxInvoice ? formatAmount(inv.gstCents, inv.currency) : "GST-free"}</Text>
          </View>
          <View style={s.grandRow}>
            <Text style={s.grandText}>Total</Text>
            <Text style={s.grandText}>{formatAmount(inv.totalCents, inv.currency)}</Text>
          </View>
        </View>

        <View style={s.foot}>
          {payRows.length > 0 ? (
            <View style={s.section}>
              <Text style={s.lbl}>Payment details — {inv.currency}</Text>
              {payRows.map((r, i) =>
                r.label ? (
                  <View style={s.payRow} key={i}>
                    <Text style={s.payLabel}>{r.label}</Text>
                    <Text style={s.payValue}>{r.value}</Text>
                  </View>
                ) : (
                  <Text style={s.payFull} key={i}>
                    {r.value}
                  </Text>
                )
              )}
            </View>
          ) : null}

          {terms ? (
            <View style={payRows.length > 0 ? s.sectionRuled : s.section}>
              <Text style={s.lbl}>Payment terms</Text>
              <Text style={s.terms}>{terms}</Text>
            </View>
          ) : null}

          {inv.notes || settings.invoice_footer ? (
            <View style={terms || payRows.length > 0 ? s.sectionRuled : s.section}>
              {inv.notes ? <Text style={s.note}>{inv.notes}</Text> : null}
              {settings.invoice_footer ? <Text style={s.note}>{settings.invoice_footer}</Text> : null}
            </View>
          ) : null}
        </View>

        {/* Only rendered when the invoice actually runs to more than one page. */}
        <Text
          style={s.pageNum}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `${inv.number} — page ${pageNumber} of ${totalPages}` : ""
          }
          fixed
        />
      </Page>
      )}
    </Document>
  );
}
