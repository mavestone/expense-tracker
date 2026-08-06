import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { applyBp } from "./money";
import { fyQuarter, quarterLabel, type BasQuarter } from "./fy";
import { getSettings } from "./settings";
import { receiptCountMap } from "./expenses";
import { explainTreatment, businessPortionCents, balancingAdjustment } from "./depreciation";

/** Active (confirmed, non-void) expenses for an FY. Reports never include drafts or voids. */
async function activeExpensesForFy(fy: string) {
  const d = await db();
  return d
    .select()
    .from(schema.expenses)
    .where(and(eq(schema.expenses.financialYear, fy), eq(schema.expenses.status, "active")));
}

export async function categorySummary(fy: string) {
  const d = await db();
  const cats = await d.select().from(schema.categories);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const rows = await activeExpensesForFy(fy);

  const byCat = new Map<string, { categoryId: string; category: string; count: number; audCents: number; deductibleCents: number; claimableGstCents: number }>();
  for (const e of rows) {
    const key = e.categoryId;
    let agg = byCat.get(key);
    if (!agg) {
      agg = { categoryId: key, category: catName.get(key) ?? "(unknown)", count: 0, audCents: 0, deductibleCents: 0, claimableGstCents: 0 };
      byCat.set(key, agg);
    }
    agg.count++;
    agg.audCents += e.audAmountCents;
    agg.deductibleCents += e.deductibleAudCents;
    if (e.gstTreatment === "gst") agg.claimableGstCents += applyBp(e.gstAmountCents, e.businessUseBp);
  }
  const categories = [...byCat.values()].sort((a, b) => b.deductibleCents - a.deductibleCents);
  const totals = categories.reduce(
    (t, c) => ({
      count: t.count + c.count,
      audCents: t.audCents + c.audCents,
      deductibleCents: t.deductibleCents + c.deductibleCents,
      claimableGstCents: t.claimableGstCents + c.claimableGstCents,
    }),
    { count: 0, audCents: 0, deductibleCents: 0, claimableGstCents: 0 }
  );
  return { fy, categories, totals };
}

export type GstQuarter = {
  quarter: BasQuarter;
  label: string;
  /** G10 — capital purchases (GST-inclusive AUD, business-use portion) */
  g10Cents: number;
  /** G11 — non-capital purchases (GST-inclusive AUD, business-use portion) */
  g11Cents: number;
  /** 1B — GST credits on purchases (business-use portion of GST on "gst" records) */
  oneBCents: number;
  /** GST credits excluded from 1B because the record lacks a tax invoice */
  excludedGstCents: number;
  byTreatment: Record<string, { count: number; audCents: number; businessAudCents: number }>;
  flaggedNoInvoice: { id: string; date: string; supplier: string; audCents: number; claimableGstCents: number }[];
};

/**
 * Quarterly GST / BAS summary.
 * Methodology (stated on the report for the accountant):
 *  - Amounts are GST-inclusive AUD, reduced to the business-use portion.
 *  - G10 = capital purchases, G11 = non-capital purchases (all GST treatments,
 *    per the ATO calculation worksheet; the by-treatment breakdown lets the
 *    accountant adjust, e.g. G14 for no-GST purchases).
 *  - 1B = business-use portion of GST on records marked "GST included".
 *  - Records flagged "no tax invoice" are GST-claimable purchases over the
 *    configured threshold (default $82.50) with no receipt attached — the
 *    credit cannot be claimed without a valid tax invoice.
 */
export async function gstSummary(fy: string) {
  const rows = await activeExpensesForFy(fy);
  const settings = await getSettings();
  const receiptCounts = await receiptCountMap(rows.map((r) => r.id));

  const quarters = new Map<BasQuarter, GstQuarter>();
  for (const q of ["Q1", "Q2", "Q3", "Q4"] as BasQuarter[]) {
    quarters.set(q, {
      quarter: q,
      label: quarterLabel(fy, q),
      g10Cents: 0,
      g11Cents: 0,
      oneBCents: 0,
      excludedGstCents: 0,
      byTreatment: {
        gst: { count: 0, audCents: 0, businessAudCents: 0 },
        gst_free: { count: 0, audCents: 0, businessAudCents: 0 },
        input_taxed: { count: 0, audCents: 0, businessAudCents: 0 },
      },
      flaggedNoInvoice: [],
    });
  }

  for (const e of rows) {
    const q = quarters.get(fyQuarter(e.dateIncurred))!;
    const businessAud = applyBp(e.audAmountCents, e.businessUseBp);
    const t = q.byTreatment[e.gstTreatment] ?? (q.byTreatment[e.gstTreatment] = { count: 0, audCents: 0, businessAudCents: 0 });
    t.count++;
    t.audCents += e.audAmountCents;
    t.businessAudCents += businessAud;

    if (e.isCapital) q.g10Cents += businessAud;
    else q.g11Cents += businessAud;

    if (e.gstTreatment === "gst") {
      const claimable = applyBp(e.gstAmountCents, e.businessUseBp);
      const hasReceipt = (receiptCounts.get(e.id) ?? 0) > 0;
      if (e.audAmountCents > settings.gst_receipt_flag_cents && !hasReceipt) {
        // A valid tax invoice is required to claim the credit — excluded from
        // 1B until a receipt is attached, and shown separately so nothing is hidden.
        q.flaggedNoInvoice.push({ id: e.id, date: e.dateIncurred, supplier: e.supplierName, audCents: e.audAmountCents, claimableGstCents: claimable });
        q.excludedGstCents += claimable;
      } else {
        q.oneBCents += claimable;
      }
    }
  }

  const list = [...quarters.values()];
  const totals = {
    g10Cents: list.reduce((s, q) => s + q.g10Cents, 0),
    g11Cents: list.reduce((s, q) => s + q.g11Cents, 0),
    oneBCents: list.reduce((s, q) => s + q.oneBCents, 0),
    excludedGstCents: list.reduce((s, q) => s + q.excludedGstCents, 0),
    flaggedCount: list.reduce((s, q) => s + q.flaggedNoInvoice.length, 0),
  };
  return { fy, quarters: list, totals, thresholdCents: settings.gst_receipt_flag_cents };
}

/** Depreciation schedule inputs for the accountant — no deduction is calculated. */
/**
 * Capital assets with their simplified-depreciation treatment worked out, plus
 * any balancing adjustment where the asset has been disposed of.
 *
 * The instant asset write-off threshold comes from fy_thresholds — when it has
 * not been set the treatment is reported as "unknown" rather than assumed.
 */
export async function depreciationSchedule(fy?: string) {
  const d = await db();
  const conds = [eq(schema.expenses.status, "active"), eq(schema.expenses.isCapital, true)];
  if (fy) conds.push(eq(schema.expenses.financialYear, fy));
  const rows = await d
    .select()
    .from(schema.expenses)
    .where(and(...conds))
    .orderBy(schema.expenses.dateIncurred);
  const receiptCounts = await receiptCountMap(rows.map((r) => r.id));

  const thresholdRows = await d.select().from(schema.fyThresholds);
  const thresholdFor = new Map(thresholdRows.map((t) => [t.fyLabel, t.instantWriteoffCents]));

  const assets = rows.map((e) => {
    const threshold = thresholdFor.get(e.financialYear) ?? null;
    const treatment = explainTreatment(e.audAmountCents, e.businessUseBp, threshold);

    // Adjustable value defaults to nil for anything instant-written-off, which is
    // what makes an uninsured theft of such an asset a no-op rather than a windfall.
    const adjustable =
      e.adjustableValueCents ?? (treatment.method === "immediate" ? 0 : null);
    const balancing =
      e.disposalDate && adjustable != null
        ? balancingAdjustment(adjustable, e.terminationValueCents ?? 0, e.businessUseBp)
        : null;

    return {
      id: e.id,
      assetName: e.assetName || e.description,
      purchaseDate: e.dateIncurred,
      supplier: e.supplierName,
      costAudCents: e.audAmountCents,
      originalAmountCents: e.originalAmountCents,
      originalCurrency: e.originalCurrency,
      businessUseBp: e.businessUseBp,
      businessPortionCents: businessPortionCents(e.audAmountCents, e.businessUseBp),
      effectiveLifeYears: e.effectiveLifeYears,
      financialYear: e.financialYear,
      gstTreatment: e.gstTreatment,
      gstAmountCents: e.gstAmountCents,
      hasReceipt: (receiptCounts.get(e.id) ?? 0) > 0,
      thresholdCents: threshold,
      method: treatment.method,
      deductionCents: treatment.deductionCents,
      treatmentNote: treatment.note,
      disposal: e.disposalDate
        ? {
            date: e.disposalDate,
            reason: e.disposalReason,
            terminationValueCents: e.terminationValueCents ?? 0,
            adjustableValueCents: adjustable,
            note: e.disposalNote,
            deductionCents: balancing?.deductionCents ?? 0,
            assessableCents: balancing?.assessableCents ?? 0,
          }
        : null,
    };
  });

  const totals = {
    count: assets.length,
    costCents: assets.reduce((s, a) => s + a.costAudCents, 0),
    deductionCents: assets.reduce((s, a) => s + a.deductionCents, 0),
    balancingDeductionCents: assets.reduce((s, a) => s + (a.disposal?.deductionCents ?? 0), 0),
    balancingAssessableCents: assets.reduce((s, a) => s + (a.disposal?.assessableCents ?? 0), 0),
    unknownTreatment: assets.filter((a) => a.method === "unknown").length,
  };

  return { assets, totals };
}

/** Every non-void record without a current receipt attachment. */
export async function missingReceipts(fy?: string) {
  const d = await db();
  const settings = await getSettings();
  const conds = [inArray(schema.expenses.status, ["active", "draft"])];
  if (fy) conds.push(eq(schema.expenses.financialYear, fy));
  const rows = await d
    .select()
    .from(schema.expenses)
    .where(and(...conds))
    .orderBy(schema.expenses.dateIncurred);
  const receiptCounts = await receiptCountMap(rows.map((r) => r.id));
  return rows
    .filter((e) => (receiptCounts.get(e.id) ?? 0) === 0)
    .map((e) => ({
      id: e.id,
      date: e.dateIncurred,
      supplier: e.supplierName,
      description: e.description,
      audCents: e.audAmountCents,
      status: e.status,
      gstTreatment: e.gstTreatment,
      severity:
        e.gstTreatment === "gst" && e.audAmountCents > settings.gst_receipt_flag_cents
          ? ("gst_invoice_required" as const)
          : e.audAmountCents > settings.receipt_required_over_cents
            ? ("receipt_required" as const)
            : ("info" as const),
    }));
}

/** Distinct financial years present in the data (for pickers), newest first. */
export async function financialYearsInData(): Promise<string[]> {
  const d = await db();
  const rows = await d.selectDistinct({ fy: schema.expenses.financialYear }).from(schema.expenses);
  return rows.map((r) => r.fy).sort((a, b) => (a < b ? 1 : -1));
}

/**
 * Income and deductible spend per month across a financial year, for the
 * overview chart. Months always run Jul → Jun and every month is present even
 * when nothing happened in it — a gap in a time series reads as missing data,
 * and a quiet month is information, not an absence of it.
 */
export async function monthlyTrend(fy: string) {
  const { fyRange } = await import("./fy");
  const dbi = await db();
  const range = fyRange(fy);

  const [inc, exp] = await Promise.all([
    dbi
      .select()
      .from(schema.income)
      .where(and(eq(schema.income.financialYear, fy), eq(schema.income.status, "active"))),
    dbi
      .select()
      .from(schema.expenses)
      .where(and(eq(schema.expenses.financialYear, fy), eq(schema.expenses.status, "active"))),
  ]);

  const startYear = parseInt(range.start.slice(0, 4), 10);
  const months: { key: string; label: string; incomeCents: number; expenseCents: number; netCents: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((6 + i) % 12) + 1; // July = 7
    const y = startYear + (m >= 7 ? 0 : 1);
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push({
      key,
      label: new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-AU", { month: "short", timeZone: "UTC" }),
      incomeCents: 0,
      expenseCents: 0,
      netCents: 0,
    });
  }
  const byKey = new Map(months.map((m) => [m.key, m]));

  for (const r of inc) {
    // Interest is income but not client revenue; it still belongs in the
    // profit picture, so it is counted here (unlike G1 on the BAS).
    byKey.get(r.dateEarned.slice(0, 7))!.incomeCents += r.audAmountCents;
  }
  for (const e of exp) {
    const m = byKey.get(e.dateIncurred.slice(0, 7));
    if (m) m.expenseCents += e.deductibleAudCents;
  }
  for (const m of months) m.netCents = m.incomeCents - m.expenseCents;

  return {
    fy,
    months,
    totals: {
      incomeCents: months.reduce((s, m) => s + m.incomeCents, 0),
      expenseCents: months.reduce((s, m) => s + m.expenseCents, 0),
    },
  };
}
