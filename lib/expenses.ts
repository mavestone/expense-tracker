import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { applyBp, applyRate, divRound, isValidRate, normalizeRate } from "./money";
import { financialYear, fyQuarter, fyRange, isValidIsoDate, todayInTz, type BasQuarter } from "./fy";
import { defaultGstCents, isGstTreatment, type GstTreatment } from "./gst";
import { isValidAbn, cleanAbn } from "./abn";
import { getRateForDate, FxUnavailableError } from "./fx";
import { diffFields, writeAudit, type AuditEntry } from "./audit";
import { getSettings } from "./settings";
import type { Expense } from "./db/schema";

export type FxMode = "auto" | "manual" | "pending";

export type ExpenseInput = {
  dateIncurred: string;
  supplierName: string;
  supplierAbn?: string | null;
  description: string;
  categoryId: string;
  originalAmountCents: number;
  originalCurrency: string;
  fxMode?: FxMode;
  fxRate?: string | null;
  fxRateSource?: string | null;
  fxRateDate?: string | null;
  fxOverrideNote?: string | null;
  audOverrideCents?: number | null;
  audOverrideNote?: string | null;
  gstTreatment: GstTreatment;
  gstAmountCents?: number | null;
  businessUseBp: number;
  isCapital?: boolean;
  assetName?: string | null;
  effectiveLifeYears?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  missingReceiptAck?: boolean;
};

export type ValidationResult = { errors: string[]; warnings: string[] };

export function validateExpenseInput(input: ExpenseInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ccy = (input.originalCurrency || "").toUpperCase();

  if (!isValidIsoDate(input.dateIncurred)) errors.push("Date incurred must be a valid date (YYYY-MM-DD).");
  else if (input.dateIncurred > todayInTz()) warnings.push("Date incurred is in the future.");
  if (!input.supplierName?.trim()) errors.push("Supplier name is required.");
  if (!input.description?.trim()) errors.push("Description is required.");
  if (!input.categoryId) errors.push("Category is required.");
  if (!/^[A-Z]{3}$/.test(ccy)) errors.push("Currency must be a 3-letter ISO 4217 code.");
  if (!Number.isInteger(input.originalAmountCents) || input.originalAmountCents <= 0)
    errors.push("Amount must be greater than zero.");
  if (!Number.isInteger(input.businessUseBp) || input.businessUseBp < 0 || input.businessUseBp > 10000)
    errors.push("Business use must be between 0% and 100%.");
  if (!isGstTreatment(input.gstTreatment)) errors.push("Invalid GST treatment.");

  if (input.supplierAbn && cleanAbn(input.supplierAbn).length > 0 && !isValidAbn(input.supplierAbn))
    warnings.push("Supplier ABN fails the checksum — double-check for a typo.");

  if (ccy !== "AUD") {
    const mode = input.fxMode ?? "auto";
    if (mode === "manual") {
      if (!input.fxRate || !isValidRate(input.fxRate)) errors.push("A valid manual FX rate is required.");
      if (!input.fxOverrideNote?.trim()) errors.push("A note is required when overriding the FX rate.");
    }
    if (input.audOverrideCents != null) {
      if (!Number.isInteger(input.audOverrideCents) || input.audOverrideCents < 0)
        errors.push("Overridden AUD amount is invalid.");
      if (!input.audOverrideNote?.trim()) errors.push("A reason is required when overriding the AUD amount.");
    }
    if (input.gstTreatment === "gst")
      warnings.push("GST marked claimable on a foreign-currency purchase — valid only if the vendor charges Australian GST (some digital services do).");
  }

  if (input.gstAmountCents != null && (!Number.isInteger(input.gstAmountCents) || input.gstAmountCents < 0))
    errors.push("GST amount is invalid.");
  if (input.effectiveLifeYears && !/^\d+(\.\d{1,2})?$/.test(String(input.effectiveLifeYears).trim()))
    errors.push("Effective life must be a number of years, e.g. 5 or 6.67.");

  return { errors, warnings };
}

export type DerivedValues = {
  audAmountCents: number;
  audIsOverridden: boolean;
  gstAmountCents: number;
  deductibleAudCents: number;
  financialYear: string;
  fxRate: string | null;
  fxRateSource: string | null;
  fxRateDate: string | null;
  fxStatus: "na" | "auto" | "manual" | "pending";
};

/**
 * Compute the authoritative derived values for an expense from its raw
 * inputs. If `resolveFx` is true and no rate is supplied for a foreign
 * amount, the FX service is consulted; failures leave the record in a
 * visible "pending" state (never a silent guess).
 */
export async function deriveExpenseValues(input: ExpenseInput, opts: { resolveFx: boolean }): Promise<DerivedValues> {
  const ccy = input.originalCurrency.toUpperCase();
  const fy = financialYear(input.dateIncurred);

  let fxRate: string | null = null;
  let fxRateSource: string | null = null;
  let fxRateDate: string | null = null;
  let fxStatus: DerivedValues["fxStatus"] = "na";
  let audAmountCents: number;
  let audIsOverridden = false;

  if (ccy === "AUD") {
    audAmountCents = input.originalAmountCents;
  } else {
    const mode: FxMode = input.fxMode ?? "auto";
    if (mode === "manual") {
      fxRate = normalizeRate(input.fxRate!);
      fxRateSource = "Manual entry";
      fxRateDate = input.fxRateDate && isValidIsoDate(input.fxRateDate) ? input.fxRateDate : input.dateIncurred;
      fxStatus = "manual";
    } else if (input.fxRate && isValidRate(input.fxRate)) {
      // Client already resolved the rate via /api/fx — trust but normalise.
      fxRate = normalizeRate(input.fxRate);
      fxRateSource = input.fxRateSource || "Unknown source";
      fxRateDate = input.fxRateDate && isValidIsoDate(input.fxRateDate) ? input.fxRateDate : input.dateIncurred;
      fxStatus = "auto";
    } else if (opts.resolveFx) {
      try {
        const r = await getRateForDate(input.dateIncurred, ccy);
        fxRate = r.rateAudPerUnit;
        fxRateSource = r.source;
        fxRateDate = r.rateDate;
        fxStatus = "auto";
      } catch (e) {
        if (!(e instanceof FxUnavailableError)) throw e;
        fxStatus = "pending";
      }
    } else {
      fxStatus = "pending";
    }

    if (input.audOverrideCents != null) {
      audAmountCents = input.audOverrideCents;
      audIsOverridden = true;
    } else if (fxRate) {
      audAmountCents = applyRate(input.originalAmountCents, fxRate);
    } else {
      audAmountCents = 0; // pending FX — resolved later, surfaced prominently
    }
  }

  let gstAmountCents = 0;
  if (input.gstTreatment === "gst") {
    gstAmountCents = input.gstAmountCents != null ? Math.min(input.gstAmountCents, audAmountCents) : defaultGstCents("gst", audAmountCents);
  }
  const deductibleAudCents = applyBp(audAmountCents, input.businessUseBp);

  return { audAmountCents, audIsOverridden, gstAmountCents, deductibleAudCents, financialYear: fy, fxRate, fxRateSource, fxRateDate, fxStatus };
}

function inputToRow(input: ExpenseInput, derived: DerivedValues) {
  return {
    dateIncurred: input.dateIncurred,
    supplierName: input.supplierName.trim(),
    supplierAbn: input.supplierAbn ? cleanAbn(input.supplierAbn) : null,
    description: input.description.trim(),
    categoryId: input.categoryId,
    originalAmountCents: input.originalAmountCents,
    originalCurrency: input.originalCurrency.toUpperCase(),
    fxRate: derived.fxRate,
    fxRateSource: derived.fxRateSource,
    fxRateDate: derived.fxRateDate,
    fxStatus: derived.fxStatus,
    fxOverrideNote: derived.fxStatus === "manual" ? input.fxOverrideNote?.trim() || null : null,
    audAmountCents: derived.audAmountCents,
    audIsOverridden: derived.audIsOverridden,
    audOverrideNote: derived.audIsOverridden ? input.audOverrideNote?.trim() || null : null,
    gstTreatment: input.gstTreatment,
    gstAmountCents: derived.gstAmountCents,
    businessUseBp: input.businessUseBp,
    deductibleAudCents: derived.deductibleAudCents,
    isCapital: !!input.isCapital,
    assetName: input.isCapital ? input.assetName?.trim() || input.description.trim() : null,
    effectiveLifeYears: input.isCapital ? (input.effectiveLifeYears ? String(input.effectiveLifeYears).trim() : null) : null,
    paymentMethod: input.paymentMethod?.trim() || null,
    notes: input.notes?.trim() || null,
    financialYear: derived.financialYear,
    missingReceiptAck: !!input.missingReceiptAck,
  };
}

/** Human-auditable field list for edit-history diffs. */
const AUDITED_FIELDS = [
  "dateIncurred", "supplierName", "supplierAbn", "description", "categoryId",
  "originalAmountCents", "originalCurrency",
  "fxRate", "fxRateSource", "fxRateDate", "fxStatus", "fxOverrideNote",
  "audAmountCents", "audIsOverridden", "audOverrideNote",
  "gstTreatment", "gstAmountCents", "businessUseBp", "deductibleAudCents",
  "isCapital", "assetName", "effectiveLifeYears",
  "paymentMethod", "notes", "financialYear", "missingReceiptAck",
] as const;

export async function createExpense(
  input: ExpenseInput,
  opts: {
    status?: "draft" | "active";
    source?: "manual" | "subscription" | "import";
    subscriptionId?: string | null;
    importBatchId?: string | null;
    resolveFx?: boolean;
    auditNote?: string | null;
  } = {}
): Promise<Expense> {
  const { errors } = validateExpenseInput(input);
  if (errors.length > 0) throw new ValidationError(errors);

  const derived = await deriveExpenseValues(input, { resolveFx: opts.resolveFx ?? true });
  const d = await db();
  const now = new Date().toISOString();
  const id = randomUUID();
  const row = {
    id,
    createdAt: now,
    updatedAt: now,
    ...inputToRow(input, derived),
    status: opts.status ?? "active",
    source: opts.source ?? "manual",
    subscriptionId: opts.subscriptionId ?? null,
    importBatchId: opts.importBatchId ?? null,
  };

  await d.transaction(async (tx) => {
    await tx.insert(schema.expenses).values(row);
    await writeAudit(tx, [
      {
        entityType: "expense",
        entityId: id,
        action: "create",
        newValue: `${row.dateIncurred} ${row.supplierName} — ${row.originalCurrency} ${(row.originalAmountCents / 100).toFixed(2)} (${row.status}, ${row.source})`,
        note: opts.auditNote ?? null,
      },
    ]);
  });

  const [created] = await d.select().from(schema.expenses).where(eq(schema.expenses.id, id));
  return created;
}

export class ValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export async function getExpense(id: string) {
  const d = await db();
  const [exp] = await d.select().from(schema.expenses).where(eq(schema.expenses.id, id));
  return exp ?? null;
}

export async function updateExpense(id: string, input: ExpenseInput, editNote?: string | null): Promise<Expense> {
  const d = await db();
  const existing = await getExpense(id);
  if (!existing) throw new NotFoundError("Expense not found");
  if (existing.status === "void") throw new ValidationError(["Voided records cannot be edited."]);

  const { errors } = validateExpenseInput(input);
  if (errors.length > 0) throw new ValidationError(errors);

  const derived = await deriveExpenseValues(input, { resolveFx: true });
  const patch = { ...inputToRow(input, derived), updatedAt: new Date().toISOString() };

  const entries = diffFields(
    "expense",
    id,
    existing as unknown as Record<string, unknown>,
    patch as unknown as Record<string, unknown>,
    AUDITED_FIELDS as unknown as string[],
    editNote ?? null
  );

  await d.transaction(async (tx) => {
    await tx.update(schema.expenses).set(patch).where(eq(schema.expenses.id, id));
    await writeAudit(tx, entries);
  });

  return (await getExpense(id))!;
}

/** Void (never delete). The record stays readable and exportable forever. */
export async function voidExpense(id: string, reason: string): Promise<Expense> {
  if (!reason?.trim()) throw new ValidationError(["A reason is required to void a record."]);
  const d = await db();
  const existing = await getExpense(id);
  if (!existing) throw new NotFoundError("Expense not found");
  if (existing.status === "void") throw new ValidationError(["Record is already void."]);

  const now = new Date().toISOString();
  await d.transaction(async (tx) => {
    await tx
      .update(schema.expenses)
      .set({ status: "void", voidReason: reason.trim(), voidedAt: now, updatedAt: now })
      .where(eq(schema.expenses.id, id));
    await writeAudit(tx, [
      { entityType: "expense", entityId: id, action: "void", field: "status", oldValue: existing.status, newValue: "void", note: reason.trim() },
    ]);
  });
  return (await getExpense(id))!;
}

/** Confirm a subscription-generated draft (after optional edits). */
export async function confirmExpense(id: string): Promise<Expense> {
  const d = await db();
  const existing = await getExpense(id);
  if (!existing) throw new NotFoundError("Expense not found");
  if (existing.status !== "draft") throw new ValidationError(["Only draft records can be confirmed."]);
  const now = new Date().toISOString();
  await d.transaction(async (tx) => {
    await tx.update(schema.expenses).set({ status: "active", updatedAt: now }).where(eq(schema.expenses.id, id));
    await writeAudit(tx, [
      { entityType: "expense", entityId: id, action: "confirm", field: "status", oldValue: "draft", newValue: "active" },
    ]);
  });
  return (await getExpense(id))!;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// ── Listing ────────────────────────────────────────────────────────────────

export type ExpenseFilters = {
  fy?: string;
  quarter?: BasQuarter;
  categoryId?: string;
  status?: ("draft" | "active" | "void")[];
  capitalOnly?: boolean;
  missingReceiptOnly?: boolean;
  pendingFxOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listExpenses(filters: ExpenseFilters = {}) {
  const d = await db();
  const conds = [];
  if (filters.fy) {
    if (filters.quarter) {
      const { start, end } = quarterRange(filters.fy, filters.quarter);
      conds.push(gte(schema.expenses.dateIncurred, start), lte(schema.expenses.dateIncurred, end));
    } else {
      conds.push(eq(schema.expenses.financialYear, filters.fy));
    }
  }
  if (filters.categoryId) conds.push(eq(schema.expenses.categoryId, filters.categoryId));
  conds.push(inArray(schema.expenses.status, filters.status && filters.status.length > 0 ? filters.status : ["draft", "active"]));
  if (filters.capitalOnly) conds.push(eq(schema.expenses.isCapital, true));
  if (filters.pendingFxOnly) conds.push(eq(schema.expenses.fxStatus, "pending"));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(like(schema.expenses.supplierName, q), like(schema.expenses.description, q), like(schema.expenses.notes, q))!);
  }

  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = filters.offset ?? 0;

  const rows = await d
    .select()
    .from(schema.expenses)
    .where(and(...conds))
    .orderBy(desc(schema.expenses.dateIncurred), desc(schema.expenses.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const receiptMap = await receiptCountMap(page.map((r) => r.id));
  let result = page.map((r) => ({ ...r, receiptCount: receiptMap.get(r.id) ?? 0 }));
  if (filters.missingReceiptOnly) result = result.filter((r) => r.receiptCount === 0);

  const [totals] = await d
    .select({
      count: sql<number>`count(*)`,
      audTotal: sql<number>`coalesce(sum(${schema.expenses.audAmountCents}), 0)`,
      deductibleTotal: sql<number>`coalesce(sum(${schema.expenses.deductibleAudCents}), 0)`,
    })
    .from(schema.expenses)
    .where(and(...conds));

  return { expenses: result, hasMore, totals };
}

export function quarterRange(fy: string, q: BasQuarter): { start: string; end: string } {
  const { start } = fyRange(fy);
  const y = Number(start.slice(0, 4));
  switch (q) {
    case "Q1": return { start: `${y}-07-01`, end: `${y}-09-30` };
    case "Q2": return { start: `${y}-10-01`, end: `${y}-12-31` };
    case "Q3": return { start: `${y + 1}-01-01`, end: `${y + 1}-03-31` };
    case "Q4": return { start: `${y + 1}-04-01`, end: `${y + 1}-06-30` };
  }
}

export async function receiptCountMap(expenseIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (expenseIds.length === 0) return map;
  const d = await db();
  const rows = await d
    .select({ expenseId: schema.receipts.expenseId, n: sql<number>`count(*)` })
    .from(schema.receipts)
    .where(and(inArray(schema.receipts.expenseId, expenseIds), eq(schema.receipts.isCurrent, true)))
    .groupBy(schema.receipts.expenseId);
  for (const r of rows) map.set(r.expenseId, r.n);
  return map;
}

/** Distinct suppliers with their most recent ABN / category / payment method, for fast entry autofill. */
export async function supplierSuggestions(): Promise<
  { name: string; abn: string | null; categoryId: string | null; paymentMethod: string | null }[]
> {
  const d = await db();
  const rows = await d
    .select({
      name: schema.expenses.supplierName,
      abn: schema.expenses.supplierAbn,
      categoryId: schema.expenses.categoryId,
      paymentMethod: schema.expenses.paymentMethod,
      date: schema.expenses.dateIncurred,
    })
    .from(schema.expenses)
    .where(inArray(schema.expenses.status, ["active", "draft"]))
    .orderBy(desc(schema.expenses.dateIncurred))
    .limit(1000);
  const seen = new Map<string, { name: string; abn: string | null; categoryId: string | null; paymentMethod: string | null }>();
  for (const r of rows) {
    const key = r.name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name: r.name, abn: r.abn, categoryId: r.categoryId, paymentMethod: r.paymentMethod });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Resolve a pending FX record ────────────────────────────────────────────

export async function resolvePendingFx(id: string): Promise<Expense> {
  const existing = await getExpense(id);
  if (!existing) throw new NotFoundError("Expense not found");
  if (existing.fxStatus !== "pending") return existing;
  const r = await getRateForDate(existing.dateIncurred, existing.originalCurrency); // throws FxUnavailableError if still offline
  const aud = applyRate(existing.originalAmountCents, r.rateAudPerUnit);
  const gst = existing.gstTreatment === "gst" ? divRound(aud, 11) : 0;
  const deductible = applyBp(aud, existing.businessUseBp);
  const d = await db();
  const patch = {
    fxRate: r.rateAudPerUnit,
    fxRateSource: r.source,
    fxRateDate: r.rateDate,
    fxStatus: "auto" as const,
    audAmountCents: aud,
    gstAmountCents: gst,
    deductibleAudCents: deductible,
    updatedAt: new Date().toISOString(),
  };
  const entries: AuditEntry[] = diffFields(
    "expense",
    id,
    existing as unknown as Record<string, unknown>,
    patch as unknown as Record<string, unknown>,
    ["fxRate", "fxRateSource", "fxRateDate", "fxStatus", "audAmountCents", "gstAmountCents", "deductibleAudCents"],
    "Pending FX rate resolved"
  );
  await d.transaction(async (tx) => {
    await tx.update(schema.expenses).set(patch).where(eq(schema.expenses.id, id));
    await writeAudit(tx, entries);
  });
  return (await getExpense(id))!;
}

// ── Flags ──────────────────────────────────────────────────────────────────

export async function expenseFlags(exp: Expense, receiptCount: number) {
  const settings = await getSettings();
  const flags: string[] = [];
  if (exp.fxStatus === "pending") flags.push("fx_pending");
  if (exp.status !== "void" && receiptCount === 0) {
    if (exp.gstTreatment === "gst" && exp.audAmountCents > settings.gst_receipt_flag_cents)
      flags.push("gst_invoice_required"); // can't claim the credit without a tax invoice
    if (exp.audAmountCents > settings.receipt_required_over_cents) flags.push("receipt_required");
  }
  return flags;
}
