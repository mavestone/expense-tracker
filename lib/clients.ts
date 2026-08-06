/**
 * The client book. Details worth reusing across invoices live here so they are
 * entered once — an address typed fresh each time is an address that drifts.
 */

import { randomUUID } from "crypto";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { ValidationError, NotFoundError } from "./expenses";
import { writeAudit } from "./audit";
import { isValidAbn, cleanAbn } from "./abn";
import { INVOICE_CURRENCIES } from "./settings";

export type ClientInput = {
  name: string;
  contactName?: string | null;
  email?: string | null;
  addressLines?: string | null;
  country?: string | null;
  abn?: string | null;
  taxLabel?: string | null;
  taxId?: string | null;
  invoicePrefix: string;
  defaultCurrency: string;
  defaultGstTreatment: "gst" | "gst_free";
  paymentTermsDays: number;
  notes?: string | null;
};

export function validateClientInput(input: ClientInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.name?.trim()) errors.push("Client name is required.");
  if (!/^[A-Z][A-Z0-9]{0,11}$/.test(input.invoicePrefix?.trim().toUpperCase() ?? ""))
    errors.push("Invoice prefix must be 1–12 letters or digits, starting with a letter (e.g. KC).");
  if (!(INVOICE_CURRENCIES as readonly string[]).includes((input.defaultCurrency || "").toUpperCase()))
    errors.push(`Default currency must be one of ${INVOICE_CURRENCIES.join(", ")}.`);
  if (input.defaultGstTreatment !== "gst" && input.defaultGstTreatment !== "gst_free")
    errors.push("Default GST treatment must be 'gst' or 'gst_free'.");
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 180)
    errors.push("Payment terms must be between 0 and 180 days.");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))
    errors.push("Email address is not valid.");
  if (input.abn && cleanAbn(input.abn).length > 0 && !isValidAbn(input.abn))
    warnings.push("Client ABN fails the checksum — double-check for a typo.");
  // An overseas client charged GST is nearly always a mistake: an export of
  // services is GST-free, and getting this wrong overstates 1A on every invoice.
  if (input.defaultGstTreatment === "gst" && input.defaultCurrency.toUpperCase() !== "AUD")
    warnings.push("GST on a foreign-currency invoice is unusual — exports of services are normally GST-free.");
  return { errors, warnings };
}

function toRow(input: ClientInput) {
  return {
    name: input.name.trim(),
    contactName: input.contactName?.trim() || null,
    email: input.email?.trim() || null,
    addressLines: input.addressLines?.trim() || null,
    country: input.country?.trim() || null,
    abn: input.abn?.trim() || null,
    taxLabel: input.taxLabel?.trim() || null,
    taxId: input.taxId?.trim() || null,
    invoicePrefix: input.invoicePrefix.trim().toUpperCase(),
    defaultCurrency: input.defaultCurrency.toUpperCase(),
    defaultGstTreatment: input.defaultGstTreatment,
    paymentTermsDays: input.paymentTermsDays,
    notes: input.notes?.trim() || null,
  };
}

export async function createClient(input: ClientInput) {
  const { errors } = validateClientInput(input);
  if (errors.length) throw new ValidationError(errors);
  const dbi = await db();
  const prefix = input.invoicePrefix.trim().toUpperCase();
  const clash = await dbi.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.invoicePrefix, prefix));
  if (clash.length) throw new ValidationError([`Invoice prefix ${prefix} is already used by another client.`]);

  const id = randomUUID();
  const now = new Date().toISOString();
  await dbi.transaction(async (tx) => {
    await tx.insert(schema.clients).values({ id, createdAt: now, updatedAt: now, ...toRow(input), archived: false });
    await writeAudit(tx, [{ entityType: "client", entityId: id, action: "create", newValue: input.name.trim() }]);
  });
  return (await getClient(id))!;
}

export async function getClient(id: string) {
  const dbi = await db();
  const [row] = await dbi.select().from(schema.clients).where(eq(schema.clients.id, id));
  return row ?? null;
}

export async function updateClient(id: string, input: ClientInput) {
  const existing = await getClient(id);
  if (!existing) throw new NotFoundError("Client not found");
  const { errors } = validateClientInput(input);
  if (errors.length) throw new ValidationError(errors);
  const dbi = await db();
  const prefix = input.invoicePrefix.trim().toUpperCase();
  if (prefix !== existing.invoicePrefix) {
    const clash = await dbi.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.invoicePrefix, prefix));
    if (clash.length) throw new ValidationError([`Invoice prefix ${prefix} is already used by another client.`]);
  }
  await dbi.transaction(async (tx) => {
    await tx.update(schema.clients).set({ ...toRow(input), updatedAt: new Date().toISOString() }).where(eq(schema.clients.id, id));
    await writeAudit(tx, [
      { entityType: "client", entityId: id, action: "update", oldValue: existing.name, newValue: input.name.trim() },
    ]);
  });
  return (await getClient(id))!;
}

export async function setClientArchived(id: string, archived: boolean) {
  const existing = await getClient(id);
  if (!existing) throw new NotFoundError("Client not found");
  const dbi = await db();
  await dbi.transaction(async (tx) => {
    await tx.update(schema.clients).set({ archived, updatedAt: new Date().toISOString() }).where(eq(schema.clients.id, id));
    await writeAudit(tx, [
      { entityType: "client", entityId: id, action: "update", field: "archived", newValue: String(archived) },
    ]);
  });
  return (await getClient(id))!;
}

/** Clients with their invoice history summarised, newest activity first. */
export async function listClients(opts: { includeArchived?: boolean } = {}) {
  const dbi = await db();
  const rows = await dbi.select().from(schema.clients).orderBy(asc(schema.clients.name));
  const stats = await dbi
    .select({
      clientId: schema.invoices.clientId,
      currency: schema.invoices.currency,
      status: schema.invoices.status,
      n: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${schema.invoices.totalCents}), 0)`,
    })
    .from(schema.invoices)
    .groupBy(schema.invoices.clientId, schema.invoices.currency, schema.invoices.status);

  const byClient = new Map<string, { invoiceCount: number; outstanding: { currency: string; cents: number }[] }>();
  for (const s of stats) {
    if (s.status === "void") continue;
    const e = byClient.get(s.clientId) ?? { invoiceCount: 0, outstanding: [] };
    e.invoiceCount += s.n;
    if (s.status !== "paid") {
      const o = e.outstanding.find((x) => x.currency === s.currency);
      if (o) o.cents += s.total;
      else e.outstanding.push({ currency: s.currency, cents: s.total });
    }
    byClient.set(s.clientId, e);
  }

  return rows
    .filter((c) => opts.includeArchived || !c.archived)
    .map((c) => ({ ...c, ...(byClient.get(c.id) ?? { invoiceCount: 0, outstanding: [] }) }));
}
