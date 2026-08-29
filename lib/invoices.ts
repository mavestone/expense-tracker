/**
 * Invoicing.
 *
 * An invoice is a *document* — its amounts live in the currency it was issued
 * in and never in AUD. Posting it to income is what puts it in the tax ledger,
 * and that is the only place AUD appears, derived by the FX engine from the
 * rate published on the issue date. Converting in both places is exactly how
 * the invoice and the return end up disagreeing.
 */

import { randomUUID } from "crypto";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { ValidationError, NotFoundError } from "./expenses";
import { writeAudit } from "./audit";
import { isValidIsoDate, addDays, financialYear } from "./fy";
import { divRound } from "./money";
import { createIncome, setIncomePaid } from "./income";
import { INVOICE_CURRENCIES } from "./settings";

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";
export const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "void"];

export type InvoiceLineInput = {
  description: string;
  /** Quantity in thousandths — 1000 = 1, 500 = 0.5, 7500 = 7.5 hours. */
  quantityMilli?: number;
  unitAmountCents: number;
  /** The expense record this line recovers, on a reimbursement. */
  expenseId?: string | null;
  /** Itemisation, used by the reimbursement layout. */
  lineDate?: string | null;
  category?: string | null;
  location?: string | null;
};

/**
 * What the invoice is for.
 *
 * `reimbursement` bills on costs already carried for the client. It is a
 * separate kind rather than a line description because it is posted gross —
 * the recovery is income and the underlying cost stays deductible — and
 * because the document has to say so: a client paying back an airfare is
 * entitled to see it described as a cost recovered, not as a service.
 */
export const INVOICE_KINDS = ["services", "reimbursement"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export type InvoiceInput = {
  clientId: string;
  number?: string | null;
  kind?: InvoiceKind;
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  gstTreatment: "gst" | "gst_free";
  purchaseOrder?: string | null;
  terms?: string | null;
  notes?: string | null;
  lines: InvoiceLineInput[];
};

/** GST is ADDED to ex-GST lines when issuing — the mirror of 1/11 on a purchase. */
export const GST_RATE_BP = 1000;

export function lineAmountCents(l: InvoiceLineInput): number {
  return divRound((l.quantityMilli ?? 1000) * l.unitAmountCents, 1000);
}

export function invoiceTotals(lines: InvoiceLineInput[], gstTreatment: "gst" | "gst_free") {
  const subtotalCents = lines.reduce((s, l) => s + lineAmountCents(l), 0);
  const gstCents = gstTreatment === "gst" ? divRound(subtotalCents * GST_RATE_BP, 10000) : 0;
  return { subtotalCents, gstCents, totalCents: subtotalCents + gstCents };
}

export function validateInvoiceInput(input: InvoiceInput): string[] {
  const errors: string[] = [];
  if (!input.clientId) errors.push("A client is required.");
  if (!isValidIsoDate(input.issueDate)) errors.push("Issue date must be a valid date.");
  if (input.dueDate && !isValidIsoDate(input.dueDate)) errors.push("Due date must be a valid date.");
  if (input.dueDate && input.dueDate < input.issueDate) errors.push("Due date cannot be before the issue date.");
  if (!(INVOICE_CURRENCIES as readonly string[]).includes((input.currency || "").toUpperCase()))
    errors.push(`Currency must be one of ${INVOICE_CURRENCIES.join(", ")}.`);
  if (input.gstTreatment !== "gst" && input.gstTreatment !== "gst_free")
    errors.push("GST treatment must be 'gst' or 'gst_free'.");
  if (input.kind && !(INVOICE_KINDS as readonly string[]).includes(input.kind))
    errors.push(`Kind must be one of ${INVOICE_KINDS.join(", ")}.`);
  if (!input.lines?.length) errors.push("An invoice needs at least one line.");
  input.lines?.forEach((l, i) => {
    if (!l.description?.trim()) errors.push(`Line ${i + 1}: description is required.`);
    if (!Number.isInteger(l.unitAmountCents) || l.unitAmountCents === 0)
      errors.push(`Line ${i + 1}: amount must be a whole number of cents and not zero.`);
    if (l.quantityMilli != null && (!Number.isInteger(l.quantityMilli) || l.quantityMilli <= 0))
      errors.push(`Line ${i + 1}: quantity must be greater than zero.`);
  });
  const t = invoiceTotals(input.lines ?? [], input.gstTreatment);
  if (t.totalCents <= 0) errors.push("Invoice total must be greater than zero.");
  return errors;
}

/**
 * Next number for a client: <prefix>_NN, continuing from the highest sequence
 * already used. Numbers are never reused, including by voided invoices — a gap
 * in a number sequence is a question an auditor asks, and "it was voided" is a
 * better answer than a silently reissued number.
 *
 * Two details this has to get right:
 *
 *  - Refs raised before this module existed live on income records, so those
 *    are read too. Ignoring them would restart every client at 01 and collide.
 *  - A suffix of five digits or more is a DATE, not a sequence. KC_290626 is
 *    29 June 2026; treating it as sequence 290,626 would jump the whole client
 *    to KC_290627 and never recover.
 */
const SEQUENCE_SUFFIX = /_(\d{1,4})$/;

export async function nextInvoiceNumber(clientId: string): Promise<string> {
  const dbi = await db();
  const [client] = await dbi.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!client) throw new NotFoundError("Client not found");
  const prefix = client.invoicePrefix;

  // Prefix match only, then filter exactly in JS — SQLite LIKE treats "_" as a
  // single-character wildcard and drizzle emits no ESCAPE clause, so trying to
  // escape it here silently matches nothing.
  const [rows, legacy] = await Promise.all([
    dbi.select({ number: schema.invoices.number }).from(schema.invoices).where(like(schema.invoices.number, `${prefix}%`)),
    dbi.select({ number: schema.income.invoiceRef }).from(schema.income).where(like(schema.income.invoiceRef, `${prefix}%`)),
  ]);

  let max = 0;
  for (const r of [...rows, ...legacy]) {
    const ref = r.number ?? "";
    if (!ref.startsWith(`${prefix}_`)) continue;
    const m = SEQUENCE_SUFFIX.exec(ref);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}_${String(max + 1).padStart(2, "0")}`;
}

/**
 * Delete a draft outright. Only a draft — it was never issued, so it is not a
 * business record and leaving it behind just clutters the numbering. Anything
 * that has been sent is voided instead, and kept.
 */
export async function deleteDraftInvoice(id: string) {
  const inv = await getInvoice(id);
  if (!inv) throw new NotFoundError("Invoice not found");
  if (inv.status !== "draft")
    throw new ValidationError([`Invoice ${inv.number} has been issued — void it instead of deleting it.`]);
  const dbi = await db();
  await dbi.transaction(async (tx) => {
    await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id));
    await tx.delete(schema.invoices).where(eq(schema.invoices.id, id));
    await writeAudit(tx, [
      { entityType: "invoice", entityId: id, action: "void", oldValue: inv.number, note: "Draft deleted before issue" },
    ]);
  });
  return { deleted: true, number: inv.number };
}

export async function createInvoice(input: InvoiceInput) {
  const errors = validateInvoiceInput(input);
  if (errors.length) throw new ValidationError(errors);

  const dbi = await db();
  const [client] = await dbi.select().from(schema.clients).where(eq(schema.clients.id, input.clientId));
  if (!client) throw new NotFoundError("Client not found");

  const number = input.number?.trim() || (await nextInvoiceNumber(input.clientId));
  const dupe = await dbi.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.number, number));
  if (dupe.length) throw new ValidationError([`Invoice number ${number} already exists.`]);

  const currency = input.currency.toUpperCase();
  const dueDate = input.dueDate || addDays(input.issueDate, client.paymentTermsDays);
  const totals = invoiceTotals(input.lines, input.gstTreatment);
  const id = randomUUID();
  const now = new Date().toISOString();

  await dbi.transaction(async (tx) => {
    await tx.insert(schema.invoices).values({
      id,
      createdAt: now,
      updatedAt: now,
      number,
      clientId: input.clientId,
      status: "draft",
      kind: input.kind ?? "services",
      issueDate: input.issueDate,
      dueDate,
      currency,
      gstTreatment: input.gstTreatment,
      ...totals,
      purchaseOrder: input.purchaseOrder ?? null,
      terms: input.terms ?? null,
      notes: input.notes ?? null,
    });
    await tx.insert(schema.invoiceLines).values(
      input.lines.map((l, i) => ({
        id: randomUUID(),
        invoiceId: id,
        position: i,
        description: l.description.trim(),
        quantityMilli: l.quantityMilli ?? 1000,
        unitAmountCents: l.unitAmountCents,
        amountCents: lineAmountCents(l),
        expenseId: l.expenseId ?? null,
        lineDate: l.lineDate ?? null,
        category: l.category ?? null,
        location: l.location ?? null,
      }))
    );
    await writeAudit(tx, [
      {
        entityType: "invoice",
        entityId: id,
        action: "create",
        newValue: `${number} ${client.name} — ${currency} ${(totals.totalCents / 100).toFixed(2)}`,
      },
    ]);
  });
  return (await getInvoice(id))!;
}

export async function getInvoice(id: string) {
  const dbi = await db();
  const [inv] = await dbi.select().from(schema.invoices).where(eq(schema.invoices.id, id));
  if (!inv) return null;
  const [client] = await dbi.select().from(schema.clients).where(eq(schema.clients.id, inv.clientId));
  const lines = await dbi
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, id))
    .orderBy(schema.invoiceLines.position);
  return { ...inv, client, lines };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/**
 * Replace an invoice's contents. Only a draft can be edited — once an invoice
 * has been issued the document is out in the world, and changing it silently is
 * how a business record stops being a record. Correct an issued invoice by
 * voiding it and raising a new one.
 */
export async function updateInvoice(id: string, input: InvoiceInput) {
  const existing = await getInvoice(id);
  if (!existing) throw new NotFoundError("Invoice not found");
  if (existing.status !== "draft")
    throw new ValidationError([
      `Invoice ${existing.number} has been ${existing.status === "void" ? "voided" : "issued"} and cannot be edited. Void it and raise a new one.`,
    ]);
  const errors = validateInvoiceInput(input);
  if (errors.length) throw new ValidationError(errors);

  const dbi = await db();
  const totals = invoiceTotals(input.lines, input.gstTreatment);
  const now = new Date().toISOString();
  await dbi.transaction(async (tx) => {
    await tx
      .update(schema.invoices)
      .set({
        clientId: input.clientId,
        kind: input.kind ?? existing.kind,
        issueDate: input.issueDate,
        dueDate: input.dueDate || existing.dueDate,
        currency: input.currency.toUpperCase(),
        gstTreatment: input.gstTreatment,
        ...totals,
        purchaseOrder: input.purchaseOrder ?? null,
        terms: input.terms ?? null,
        notes: input.notes ?? null,
        updatedAt: now,
      })
      .where(eq(schema.invoices.id, id));
    await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, id));
    await tx.insert(schema.invoiceLines).values(
      input.lines.map((l, i) => ({
        id: randomUUID(),
        invoiceId: id,
        position: i,
        description: l.description.trim(),
        quantityMilli: l.quantityMilli ?? 1000,
        unitAmountCents: l.unitAmountCents,
        amountCents: lineAmountCents(l),
        expenseId: l.expenseId ?? null,
        lineDate: l.lineDate ?? null,
        category: l.category ?? null,
        location: l.location ?? null,
      }))
    );
    await writeAudit(tx, [
      {
        entityType: "invoice",
        entityId: id,
        action: "update",
        oldValue: `${existing.currency} ${(existing.totalCents / 100).toFixed(2)}`,
        newValue: `${input.currency.toUpperCase()} ${(totals.totalCents / 100).toFixed(2)}`,
      },
    ]);
  });
  return (await getInvoice(id))!;
}

/**
 * Mark an invoice sent, and post it to the income ledger.
 *
 * This is the point the document becomes a tax record. The income record is
 * created on the ISSUE date — the tax point on the accruals basis — and the FX
 * engine freezes the rate published for that date. The invoice keeps its own
 * currency amounts untouched.
 */
export async function markInvoiceSent(id: string, opts: { postToIncome?: boolean } = {}) {
  const inv = await getInvoice(id);
  if (!inv) throw new NotFoundError("Invoice not found");
  if (inv.status === "void") throw new ValidationError(["A voided invoice cannot be sent."]);
  if (inv.status !== "draft") throw new ValidationError([`Invoice ${inv.number} has already been sent.`]);

  let incomeId = inv.incomeId;
  if (opts.postToIncome !== false && !incomeId) {
    const income = await createIncome(
      {
        dateEarned: inv.issueDate,
        clientName: inv.client.name,
        clientAbn: inv.client.abn ?? null,
        invoiceRef: inv.number,
        description: inv.lines.map((l) => l.description).join("; ").slice(0, 500),
        incomeType: inv.kind === "reimbursement" ? "reimbursement" : "client_work",
        originalAmountCents: inv.totalCents,
        originalCurrency: inv.currency,
        gstTreatment: inv.gstTreatment as "gst" | "gst_free",
        notes:
          inv.kind === "reimbursement"
            ? `Raised from reimbursement invoice ${inv.number}. Recovers costs carried for this client; ` +
              `posted gross, so the underlying expense records stay deductible.`
            : `Raised from invoice ${inv.number} in the invoicing module.`,
      },
      { source: "manual", auditNote: `From invoice ${inv.number}` }
    );
    incomeId = income.id;
  }

  const dbi = await db();
  const now = new Date().toISOString();
  await dbi.transaction(async (tx) => {
    await tx
      .update(schema.invoices)
      .set({ status: "sent", sentAt: now, incomeId, updatedAt: now })
      .where(eq(schema.invoices.id, id));
    await writeAudit(tx, [
      { entityType: "invoice", entityId: id, action: "update", field: "status", oldValue: "draft", newValue: "sent" },
    ]);
  });
  return (await getInvoice(id))!;
}

/** Record payment, and reconcile the linked income record's paid date. */
export async function markInvoicePaid(id: string, datePaid: string) {
  const inv = await getInvoice(id);
  if (!inv) throw new NotFoundError("Invoice not found");
  if (inv.status === "void") throw new ValidationError(["A voided invoice cannot be paid."]);
  if (!isValidIsoDate(datePaid)) throw new ValidationError(["Payment date must be a valid date."]);

  const dbi = await db();
  const now = new Date().toISOString();
  await dbi.transaction(async (tx) => {
    await tx
      .update(schema.invoices)
      .set({ status: "paid", paidAt: datePaid, updatedAt: now })
      .where(eq(schema.invoices.id, id));
    await writeAudit(tx, [
      { entityType: "invoice", entityId: id, action: "update", field: "status", oldValue: inv.status, newValue: "paid" },
    ]);
  });
  if (inv.incomeId) await setIncomePaid(inv.incomeId, datePaid);
  return (await getInvoice(id))!;
}

export async function voidInvoice(id: string, reason: string) {
  const inv = await getInvoice(id);
  if (!inv) throw new NotFoundError("Invoice not found");
  if (!reason?.trim()) throw new ValidationError(["A reason is required to void an invoice."]);
  const dbi = await db();
  const now = new Date().toISOString();
  await dbi.transaction(async (tx) => {
    await tx
      .update(schema.invoices)
      .set({ status: "void", voidReason: reason.trim(), updatedAt: now })
      .where(eq(schema.invoices.id, id));
    await writeAudit(tx, [
      { entityType: "invoice", entityId: id, action: "void", oldValue: inv.status, newValue: "void", note: reason.trim() },
    ]);
  });
  // The income record is deliberately left alone: voiding it is a separate,
  // explicit decision, and doing it silently here would move a lodged figure.
  return (await getInvoice(id))!;
}

export async function listInvoices(
  filters: { status?: InvoiceStatus[]; clientId?: string; fy?: string; kind?: InvoiceKind; limit?: number } = {}
) {
  const dbi = await db();
  const where = [];
  if (filters.status?.length)
    where.push(sql`${schema.invoices.status} in (${sql.join(filters.status.map((s) => sql`${s}`), sql`, `)})`);
  if (filters.clientId) where.push(eq(schema.invoices.clientId, filters.clientId));
  if (filters.kind) where.push(eq(schema.invoices.kind, filters.kind));

  const rows = await dbi
    .select()
    .from(schema.invoices)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.invoices.issueDate), desc(schema.invoices.number))
    .limit(filters.limit ?? 200);

  const clients = await dbi.select().from(schema.clients);
  const byId = new Map(clients.map((c) => [c.id, c]));

  const filtered = filters.fy ? rows.filter((r) => financialYear(r.issueDate) === filters.fy) : rows;
  const withClient = filtered.map((r) => ({ ...r, clientName: byId.get(r.clientId)?.name ?? "—" }));

  // Totals stay per-currency: summing USD and AUD into one number would be a
  // lie, and the AUD equivalent lives on the income record, not here.
  const byCurrency = new Map<string, { currency: string; count: number; totalCents: number; outstandingCents: number }>();
  for (const r of withClient) {
    if (r.status === "void") continue;
    const c = byCurrency.get(r.currency) ?? { currency: r.currency, count: 0, totalCents: 0, outstandingCents: 0 };
    c.count++;
    c.totalCents += r.totalCents;
    if (r.status !== "paid") c.outstandingCents += r.totalCents;
    byCurrency.set(r.currency, c);
  }
  return { invoices: withClient, byCurrency: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)) };
}

/**
 * Filename for a downloaded invoice — "KC_04-Kirin-Consulting-LLC.pdf".
 *
 * Recognisable in a downloads folder months later, and safe as a header value:
 * anything outside [A-Za-z0-9] is collapsed to a hyphen, so a client name with
 * a quote or a slash in it cannot break the Content-Disposition header.
 */
export function invoicePdfFilename(inv: { number: string; client: { name: string } }): string {
  // Decompose accents first so "Café Noir" becomes "Cafe-Noir" rather than
  // "Caf-Noir" — stripping the letter along with its accent mangles the name.
  const client = (inv.client?.name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const number = inv.number.replace(/[^A-Za-z0-9_]+/g, "-");
  return client ? `${number}-${client}.pdf` : `${number}.pdf`;
}
