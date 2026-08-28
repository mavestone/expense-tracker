import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lte, or, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { applyRate, divRound, isValidRate, normalizeRate } from "./money";
import { financialYear, isValidIsoDate } from "./fy";
import { getRateForDate, FxUnavailableError } from "./fx";
import { cleanAbn, isValidAbn } from "./abn";
import { diffFields, writeAudit } from "./audit";
import { getSettings } from "./settings";
import { ValidationError, NotFoundError } from "./expenses";

/**
 * Income ledger — invoiced client work plus any other business income.
 * Kept deliberately separate from expenses; same integrity guarantees.
 */

export type IncomeGst = "gst" | "gst_free" | "no_gst";

export const INCOME_GST_TREATMENTS: { value: IncomeGst; label: string }[] = [
  { value: "gst", label: "GST included in price (you collected 1/11)" },
  { value: "gst_free", label: "GST-free sale (e.g. export of services)" },
  { value: "no_gst", label: "No GST (not registered / out of scope)" },
];

export const INCOME_TYPES: { value: string; label: string }[] = [
  { value: "client_work", label: "Client work" },
  // Costs carried for a client and billed back. Assessable like any other
  // trading income — it is separated so the return can be read against the
  // deductions it offsets, not because it is taxed differently.
  { value: "reimbursement", label: "Cost reimbursement" },
  { value: "licensing", label: "Licensing / royalties" },
  { value: "grant", label: "Grant / rebate" },
  { value: "interest", label: "Interest" },
  { value: "other", label: "Other income" },
];

export function isIncomeGst(v: unknown): v is IncomeGst {
  return v === "gst" || v === "gst_free" || v === "no_gst";
}

export type IncomeInput = {
  dateEarned: string;
  datePaid?: string | null;
  clientName: string;
  clientAbn?: string | null;
  invoiceRef?: string | null;
  description: string;
  incomeType: string;
  originalAmountCents: number;
  originalCurrency: string;
  fxMode?: "auto" | "manual" | "pending";
  fxRate?: string | null;
  fxRateSource?: string | null;
  fxRateDate?: string | null;
  fxOverrideNote?: string | null;
  gstTreatment: IncomeGst;
  gstAmountCents?: number | null;
  paymentAccount?: string | null;
  notes?: string | null;
};

export function validateIncomeInput(input: IncomeInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ccy = (input.originalCurrency || "").toUpperCase();

  if (!isValidIsoDate(input.dateEarned)) errors.push("Income date must be a valid date.");
  if (input.datePaid && !isValidIsoDate(input.datePaid)) errors.push("Paid date must be a valid date.");
  if (input.datePaid && input.datePaid < input.dateEarned) warnings.push("Paid date is before the income date.");
  if (!input.clientName?.trim()) errors.push("Client / payer name is required.");
  if (!input.description?.trim()) errors.push("Description is required.");
  if (!/^[A-Z]{3}$/.test(ccy)) errors.push("Currency must be a 3-letter ISO 4217 code.");
  if (!Number.isInteger(input.originalAmountCents) || input.originalAmountCents <= 0)
    errors.push("Amount must be greater than zero.");
  if (!isIncomeGst(input.gstTreatment)) errors.push("Invalid GST treatment.");
  if (input.clientAbn && cleanAbn(input.clientAbn).length > 0 && !isValidAbn(input.clientAbn))
    warnings.push("Client ABN fails the checksum — double-check for a typo.");
  if (input.fxMode === "manual") {
    if (!input.fxRate || !isValidRate(input.fxRate)) errors.push("A valid manual FX rate is required.");
    if (!input.fxOverrideNote?.trim()) errors.push("A note is required when overriding the FX rate.");
  }
  return { errors, warnings };
}

async function derive(input: IncomeInput, resolveFx: boolean) {
  const ccy = input.originalCurrency.toUpperCase();
  let fxRate: string | null = null;
  let fxRateSource: string | null = null;
  let fxRateDate: string | null = null;
  let fxStatus: "na" | "auto" | "manual" | "pending" = "na";
  let audAmountCents: number;

  if (ccy === "AUD") {
    audAmountCents = input.originalAmountCents;
  } else {
    const mode = input.fxMode ?? "auto";
    if (mode === "manual") {
      fxRate = normalizeRate(input.fxRate!);
      fxRateSource = "Manual entry";
      fxRateDate = input.fxRateDate && isValidIsoDate(input.fxRateDate) ? input.fxRateDate : input.dateEarned;
      fxStatus = "manual";
    } else if (input.fxRate && isValidRate(input.fxRate)) {
      fxRate = normalizeRate(input.fxRate);
      fxRateSource = input.fxRateSource || "Unknown source";
      fxRateDate = input.fxRateDate && isValidIsoDate(input.fxRateDate) ? input.fxRateDate : input.dateEarned;
      fxStatus = "auto";
    } else if (resolveFx) {
      try {
        // Rate for the date the income was earned, frozen on the record.
        const r = await getRateForDate(input.dateEarned, ccy);
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
    audAmountCents = fxRate ? applyRate(input.originalAmountCents, fxRate) : 0;
  }

  // GST on sales: 1/11 of the GST-inclusive AUD amount when GST was collected.
  const settings = await getSettings();
  let gstAmountCents = 0;
  if (input.gstTreatment === "gst" && settings.gst_registered) {
    gstAmountCents = input.gstAmountCents != null ? Math.min(input.gstAmountCents, audAmountCents) : divRound(audAmountCents, 11);
  }

  return {
    audAmountCents,
    gstAmountCents,
    financialYear: financialYear(input.dateEarned),
    fxRate,
    fxRateSource,
    fxRateDate,
    fxStatus,
  };
}

function toRow(input: IncomeInput, d: Awaited<ReturnType<typeof derive>>) {
  return {
    dateEarned: input.dateEarned,
    datePaid: input.datePaid || null,
    clientName: input.clientName.trim(),
    clientAbn: input.clientAbn ? cleanAbn(input.clientAbn) : null,
    invoiceRef: input.invoiceRef?.trim() || null,
    description: input.description.trim(),
    incomeType: input.incomeType || "client_work",
    originalAmountCents: input.originalAmountCents,
    originalCurrency: input.originalCurrency.toUpperCase(),
    fxRate: d.fxRate,
    fxRateSource: d.fxRateSource,
    fxRateDate: d.fxRateDate,
    fxStatus: d.fxStatus,
    fxOverrideNote: d.fxStatus === "manual" ? input.fxOverrideNote?.trim() || null : null,
    audAmountCents: d.audAmountCents,
    gstTreatment: input.gstTreatment,
    gstAmountCents: d.gstAmountCents,
    paymentAccount: input.paymentAccount?.trim() || null,
    notes: input.notes?.trim() || null,
    financialYear: d.financialYear,
  };
}

const AUDITED = [
  "dateEarned", "datePaid", "clientName", "clientAbn", "invoiceRef", "description", "incomeType",
  "originalAmountCents", "originalCurrency", "fxRate", "fxRateSource", "fxRateDate", "fxStatus",
  "audAmountCents", "gstTreatment", "gstAmountCents", "paymentAccount", "notes", "financialYear",
];

export async function createIncome(
  input: IncomeInput,
  opts: { source?: "manual" | "agent" | "import"; resolveFx?: boolean; auditNote?: string | null } = {}
) {
  const { errors } = validateIncomeInput(input);
  if (errors.length) throw new ValidationError(errors);
  const d = await derive(input, opts.resolveFx ?? true);
  const dbi = await db();
  const now = new Date().toISOString();
  const id = randomUUID();
  await dbi.transaction(async (tx) => {
    await tx.insert(schema.income).values({
      id,
      createdAt: now,
      updatedAt: now,
      ...toRow(input, d),
      status: "active",
      source: opts.source ?? "manual",
    });
    await writeAudit(tx, [
      {
        entityType: "income",
        entityId: id,
        action: "create",
        newValue: `${input.dateEarned} ${input.clientName} — ${input.originalCurrency} ${(input.originalAmountCents / 100).toFixed(2)}`,
        note: opts.auditNote ?? null,
      },
    ]);
  });
  return (await getIncome(id))!;
}

export async function getIncome(id: string) {
  const dbi = await db();
  const [row] = await dbi.select().from(schema.income).where(eq(schema.income.id, id));
  return row ?? null;
}

export async function updateIncome(id: string, input: IncomeInput, editNote?: string | null) {
  const existing = await getIncome(id);
  if (!existing) throw new NotFoundError("Income record not found");
  if (existing.status === "void") throw new ValidationError(["Voided records cannot be edited."]);
  const { errors } = validateIncomeInput(input);
  if (errors.length) throw new ValidationError(errors);
  const d = await derive(input, true);
  const patch = { ...toRow(input, d), updatedAt: new Date().toISOString() };
  const entries = diffFields("income", id, existing as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>, AUDITED, editNote ?? null);
  const dbi = await db();
  await dbi.transaction(async (tx) => {
    await tx.update(schema.income).set(patch).where(eq(schema.income.id, id));
    await writeAudit(tx, entries);
  });
  return (await getIncome(id))!;
}

/** Mark an outstanding invoice as paid (or clear the paid date). */
export async function setIncomePaid(id: string, datePaid: string | null) {
  const existing = await getIncome(id);
  if (!existing) throw new NotFoundError("Income record not found");
  if (existing.status === "void") throw new ValidationError(["Voided records cannot be edited."]);
  if (datePaid && !isValidIsoDate(datePaid)) throw new ValidationError(["Paid date must be a valid date."]);
  const dbi = await db();
  await dbi.transaction(async (tx) => {
    await tx.update(schema.income).set({ datePaid, updatedAt: new Date().toISOString() }).where(eq(schema.income.id, id));
    await writeAudit(tx, [
      { entityType: "income", entityId: id, action: "update", field: "datePaid", oldValue: existing.datePaid, newValue: datePaid },
    ]);
  });
  return (await getIncome(id))!;
}

export async function voidIncome(id: string, reason: string) {
  if (!reason?.trim()) throw new ValidationError(["A reason is required to void a record."]);
  const existing = await getIncome(id);
  if (!existing) throw new NotFoundError("Income record not found");
  if (existing.status === "void") throw new ValidationError(["Record is already void."]);
  const dbi = await db();
  const now = new Date().toISOString();
  await dbi.transaction(async (tx) => {
    await tx.update(schema.income).set({ status: "void", voidReason: reason.trim(), voidedAt: now, updatedAt: now }).where(eq(schema.income.id, id));
    await writeAudit(tx, [
      { entityType: "income", entityId: id, action: "void", field: "status", oldValue: existing.status, newValue: "void", note: reason.trim() },
    ]);
  });
  return (await getIncome(id))!;
}

export async function listIncome(filters: { fy?: string; status?: ("active" | "void")[]; outstandingOnly?: boolean; search?: string; limit?: number; offset?: number } = {}) {
  const dbi = await db();
  const conds = [];
  if (filters.fy) conds.push(eq(schema.income.financialYear, filters.fy));
  conds.push(inArray(schema.income.status, filters.status?.length ? filters.status : ["active"]));
  if (filters.outstandingOnly) conds.push(isNull(schema.income.datePaid));
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(like(schema.income.clientName, q), like(schema.income.description, q), like(schema.income.invoiceRef, q))!);
  }
  const limit = Math.min(filters.limit ?? 200, 500);
  const rows = await dbi
    .select()
    .from(schema.income)
    .where(and(...conds))
    .orderBy(desc(schema.income.dateEarned), desc(schema.income.createdAt))
    .limit(limit)
    .offset(filters.offset ?? 0);

  const [totals] = await dbi
    .select({
      count: sql<number>`count(*)`,
      audTotal: sql<number>`coalesce(sum(${schema.income.audAmountCents}), 0)`,
      gstTotal: sql<number>`coalesce(sum(${schema.income.gstAmountCents}), 0)`,
    })
    .from(schema.income)
    .where(and(...conds));

  const [outstanding] = await dbi
    .select({
      count: sql<number>`count(*)`,
      audTotal: sql<number>`coalesce(sum(${schema.income.audAmountCents}), 0)`,
    })
    .from(schema.income)
    .where(and(eq(schema.income.status, "active"), isNull(schema.income.datePaid), ...(filters.fy ? [eq(schema.income.financialYear, filters.fy)] : [])));

  return { income: rows, totals, outstanding };
}

/** Income summary for a financial year, split by type and by client. */
export async function incomeSummary(fy: string) {
  const dbi = await db();
  const rows = await dbi
    .select()
    .from(schema.income)
    .where(and(eq(schema.income.financialYear, fy), eq(schema.income.status, "active")));

  const byType = new Map<string, { type: string; count: number; audCents: number; gstCents: number }>();
  const byClient = new Map<string, { client: string; count: number; audCents: number }>();
  for (const r of rows) {
    const t = byType.get(r.incomeType) ?? { type: r.incomeType, count: 0, audCents: 0, gstCents: 0 };
    t.count++; t.audCents += r.audAmountCents; t.gstCents += r.gstAmountCents;
    byType.set(r.incomeType, t);
    const c = byClient.get(r.clientName) ?? { client: r.clientName, count: 0, audCents: 0 };
    c.count++; c.audCents += r.audAmountCents;
    byClient.set(r.clientName, c);
  }
  const totals = {
    count: rows.length,
    audCents: rows.reduce((s, r) => s + r.audAmountCents, 0),
    gstCents: rows.reduce((s, r) => s + r.gstAmountCents, 0),
    outstandingCents: rows.filter((r) => !r.datePaid).reduce((s, r) => s + r.audAmountCents, 0),
    outstandingCount: rows.filter((r) => !r.datePaid).length,
  };
  return {
    fy,
    byType: [...byType.values()].sort((a, b) => b.audCents - a.audCents),
    byClient: [...byClient.values()].sort((a, b) => b.audCents - a.audCents),
    totals,
  };
}

export type GstBasis = "accruals" | "cash";

/**
 * Income totals per BAS quarter: G1 (total sales) and 1A (GST on sales).
 *
 * Two things here are easy to get wrong and both change the number you lodge:
 *
 * **Basis.** On ACCRUALS a sale belongs to the quarter it was invoiced in; on
 * CASH, to the quarter the money arrived. They differ whenever an invoice
 * straddles a period end, and the cash view deliberately reaches across
 * financial years — an invoice raised in June and paid in July is FY-N sales
 * on accruals and FY-N+1 sales on cash. Report on whichever basis you are
 * actually registered for, not whichever the ledger happens to store.
 *
 * **Interest.** Bank interest is an input-taxed financial supply, not a sale,
 * so it never belongs at G1. It is excluded here and returned separately so it
 * is visible rather than silently dropped.
 */
export async function incomeByQuarter(fy: string, basis: GstBasis = "accruals") {
  const { fyQuarter, fyRange } = await import("./fy");
  const dbi = await db();
  const range = fyRange(fy);

  const rows = await dbi
    .select()
    .from(schema.income)
    .where(
      and(
        eq(schema.income.status, "active"),
        basis === "cash"
          ? and(
              isNotNull(schema.income.datePaid),
              gte(schema.income.datePaid, range.start),
              lte(schema.income.datePaid, range.end)
            )
          : eq(schema.income.financialYear, fy)
      )
    );

  const q: Record<string, { g1Cents: number; oneACents: number }> = {
    Q1: { g1Cents: 0, oneACents: 0 }, Q2: { g1Cents: 0, oneACents: 0 },
    Q3: { g1Cents: 0, oneACents: 0 }, Q4: { g1Cents: 0, oneACents: 0 },
  };
  let excludedInterestCents = 0;
  const deferred: { invoiceRef: string | null; client: string; audCents: number; dateEarned: string; datePaid: string | null }[] = [];

  for (const r of rows) {
    if (r.incomeType === "interest") {
      excludedInterestCents += r.audAmountCents;
      continue;
    }
    const k = fyQuarter(basis === "cash" ? r.datePaid! : r.dateEarned);
    q[k].g1Cents += r.audAmountCents;
    q[k].oneACents += r.gstAmountCents;
  }

  // On cash, name what the basis moved out of this year — an invoice dated in
  // the FY whose money landed after it. This is the reconciling item between
  // the two views, and it is the one an accountant always asks about.
  if (basis === "cash") {
    const accrued = await dbi
      .select()
      .from(schema.income)
      .where(and(eq(schema.income.status, "active"), eq(schema.income.financialYear, fy)));
    for (const r of accrued) {
      if (r.incomeType === "interest") continue;
      if (!r.datePaid || r.datePaid > range.end) {
        deferred.push({
          invoiceRef: r.invoiceRef,
          client: r.clientName,
          audCents: r.audAmountCents,
          dateEarned: r.dateEarned,
          datePaid: r.datePaid,
        });
      }
    }
  }

  return { quarters: q, excludedInterestCents, deferred };
}

/**
 * Append a line to an income record's notes.
 *
 * Deliberately narrow: it touches the notes column and nothing else. The full
 * updateIncome path re-derives FX and would risk moving a frozen rate — and a
 * frozen rate is the whole point of the record.
 */
export async function appendIncomeNote(id: string, text: string) {
  const existing = await getIncome(id);
  if (!existing) throw new NotFoundError("Income record not found");
  if (!text?.trim()) throw new ValidationError(["Note text is required."]);
  const note = text.trim();
  const next = existing.notes ? `${existing.notes}\n\n${note}` : note;

  const dbi = await db();
  await dbi.transaction(async (tx) => {
    await tx
      .update(schema.income)
      .set({ notes: next, updatedAt: new Date().toISOString() })
      .where(eq(schema.income.id, id));
    await writeAudit(tx, [
      { entityType: "income", entityId: id, action: "update", field: "notes", oldValue: existing.notes, newValue: note },
    ]);
  });
  return (await getIncome(id))!;
}
