import { randomUUID } from "crypto";
import { db, schema } from "./db";
import { applyRate, parseMoneyToCents, percentToBp } from "./money";
import { isValidIsoDate } from "./fy";
import { defaultTreatmentForCurrency, isGstTreatment, type GstTreatment } from "./gst";
import { getRateForDate, FxUnavailableError, type FxResult } from "./fx";
import { createExpense, validateExpenseInput, type ExpenseInput } from "./expenses";
import { writeAudit } from "./audit";

/**
 * Bulk CSV import for backfilling from bank / card statements.
 * The client parses the CSV and sends raw rows + a column mapping;
 * validation returns per-row results (including resolved FX) for preview,
 * and commit writes everything in one batch with full audit trail.
 */

export type ColumnMapping = {
  date: number;            // required
  description: number;     // required
  amount: number;          // required
  supplier?: number;       // falls back to description if unmapped
  currency?: number;       // falls back to defaultCurrency
  abn?: number;
  notes?: number;
  gstTreatment?: number;   // "gst" | "gst_free" | "input_taxed" or blank
  businessUsePct?: number;
};

export type ImportDefaults = {
  dateFormat: "DMY" | "YMD" | "MDY";
  defaultCurrency: string;
  defaultCategoryId: string;
  defaultPaymentMethod?: string | null;
  defaultBusinessUseBp: number;
};

export type RawRow = string[];

export type ValidatedRow = {
  index: number;
  status: "ok" | "warning" | "error" | "skip";
  messages: string[];
  input?: ExpenseInput;
  fx?: FxResult | null;
  audPreviewCents?: number | null;
};

function parseDate(raw: string, format: ImportDefaults["dateFormat"]): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    const [dd, mm] = format === "MDY" ? [b, a] : [a, b];
    const iso = `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  const ymd = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
    return isValidIsoDate(iso) ? iso : null;
  }
  return null;
}

function cell(row: RawRow, idx: number | undefined): string {
  if (idx == null || idx < 0) return "";
  return (row[idx] ?? "").trim();
}

export async function validateImportRows(
  rows: RawRow[],
  mapping: ColumnMapping,
  defaults: ImportDefaults
): Promise<{ rows: ValidatedRow[]; summary: { ok: number; warning: number; error: number; skip: number } }> {
  const out: ValidatedRow[] = [];
  const fxCache = new Map<string, FxResult | null>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const messages: string[] = [];
    const rawAmount = cell(row, mapping.amount);
    const rawDate = cell(row, mapping.date);
    const rawDesc = cell(row, mapping.description);

    // Blank lines / header remnants are skipped quietly.
    if (!rawAmount && !rawDate && !rawDesc) {
      out.push({ index: i, status: "skip", messages: ["Empty row"] });
      continue;
    }

    const date = parseDate(rawDate, defaults.dateFormat);
    if (!date) {
      out.push({ index: i, status: "error", messages: [`Unparseable date: "${rawDate}"`] });
      continue;
    }

    // Negative amounts in statements are usually credits/refunds — skipped, not guessed at.
    const cleaned = rawAmount.replace(/[()]/g, (c) => (c === "(" ? "-" : ""));
    const isNegative = /^-/.test(cleaned.trim());
    const cents = parseMoneyToCents(cleaned.replace(/^-/, ""));
    if (cents == null || cents === 0) {
      out.push({ index: i, status: "error", messages: [`Unparseable amount: "${rawAmount}"`] });
      continue;
    }
    if (isNegative) {
      out.push({ index: i, status: "skip", messages: ["Negative amount (credit/refund) — skipped. Enter manually if it's a real expense."] });
      continue;
    }

    const currency = (cell(row, mapping.currency) || defaults.defaultCurrency || "AUD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      out.push({ index: i, status: "error", messages: [`Invalid currency: "${currency}"`] });
      continue;
    }

    let treatment: GstTreatment = defaultTreatmentForCurrency(currency);
    const rawTreatment = cell(row, mapping.gstTreatment).toLowerCase().replace(/[\s-]/g, "_");
    if (rawTreatment) {
      if (isGstTreatment(rawTreatment)) treatment = rawTreatment;
      else messages.push(`Unknown GST treatment "${rawTreatment}" — defaulted to "${treatment}".`);
    }

    let businessUseBp = defaults.defaultBusinessUseBp;
    const rawPct = cell(row, mapping.businessUsePct);
    if (rawPct) {
      const bp = percentToBp(rawPct.replace("%", ""));
      if (bp == null) messages.push(`Invalid business use "${rawPct}" — defaulted to ${defaults.defaultBusinessUseBp / 100}%.`);
      else businessUseBp = bp;
    }

    // Resolve FX for preview (cached per date+currency pair).
    let fx: FxResult | null = null;
    if (currency !== "AUD") {
      const key = `${date}|${currency}`;
      if (fxCache.has(key)) fx = fxCache.get(key)!;
      else {
        try {
          fx = await getRateForDate(date, currency);
        } catch (e) {
          if (!(e instanceof FxUnavailableError)) throw e;
          fx = null;
        }
        fxCache.set(key, fx);
      }
      if (!fx) messages.push(`No FX rate found for ${currency} on ${date} — the record will be saved with FX pending.`);
    }

    const input: ExpenseInput = {
      dateIncurred: date,
      supplierName: cell(row, mapping.supplier) || rawDesc.slice(0, 80) || "Unknown supplier",
      supplierAbn: cell(row, mapping.abn) || null,
      description: rawDesc || cell(row, mapping.supplier) || "Imported transaction",
      categoryId: defaults.defaultCategoryId,
      originalAmountCents: cents,
      originalCurrency: currency,
      fxMode: fx ? "auto" : "pending",
      fxRate: fx?.rateAudPerUnit ?? null,
      fxRateSource: fx?.source ?? null,
      fxRateDate: fx?.rateDate ?? null,
      gstTreatment: treatment,
      businessUseBp,
      paymentMethod: defaults.defaultPaymentMethod ?? null,
      notes: cell(row, mapping.notes) || null,
    };

    const v = validateExpenseInput(input);
    if (v.errors.length > 0) {
      out.push({ index: i, status: "error", messages: [...messages, ...v.errors] });
      continue;
    }
    messages.push(...v.warnings);

    const audPreview = currency === "AUD" ? cents : fx ? applyRate(cents, fx.rateAudPerUnit) : null;

    out.push({ index: i, status: messages.length > 0 ? "warning" : "ok", messages, input, fx, audPreviewCents: audPreview });
  }

  const summary = {
    ok: out.filter((r) => r.status === "ok").length,
    warning: out.filter((r) => r.status === "warning").length,
    error: out.filter((r) => r.status === "error").length,
    skip: out.filter((r) => r.status === "skip").length,
  };
  return { rows: out, summary };
}

export async function commitImport(
  filename: string,
  mapping: ColumnMapping,
  defaults: ImportDefaults,
  rows: RawRow[]
): Promise<{ batchId: string; imported: number; skipped: number; errors: number }> {
  const { rows: validated } = await validateImportRows(rows, mapping, defaults);
  const d = await db();
  const batchId = randomUUID();
  const importable = validated.filter((r) => (r.status === "ok" || r.status === "warning") && r.input);

  await d.insert(schema.importBatches).values({
    id: batchId,
    createdAt: new Date().toISOString(),
    filename,
    rowCount: rows.length,
    mappingJson: JSON.stringify({ mapping, defaults }),
    status: "committed",
  });

  let imported = 0;
  for (const r of importable) {
    await createExpense(r.input!, {
      status: "active",
      source: "import",
      importBatchId: batchId,
      resolveFx: false, // already resolved (or explicitly pending) during validation
      auditNote: `Imported from ${filename} (row ${r.index + 1})`,
    });
    imported++;
  }

  await writeAudit(d, [
    {
      entityType: "import_batch",
      entityId: batchId,
      action: "import",
      newValue: `${imported} records imported from ${filename}`,
    },
  ]);

  return {
    batchId,
    imported,
    skipped: validated.filter((r) => r.status === "skip").length,
    errors: validated.filter((r) => r.status === "error").length,
  };
}
