import { inArray, eq, and, asc } from "drizzle-orm";
import { db, schema } from "./db";
import { centsToDecimalString, applyBp, bpToPercentString } from "./money";
import { formatDateAU, fyQuarter } from "./fy";

/**
 * Accountant-ready CSV export: one row per expense, every field, AUD amounts
 * as plain decimals, dates as DD/MM/YYYY (Australian convention, matching
 * Xero/MYOB import expectations), UTF-8 with BOM so Excel opens it cleanly.
 */

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_HEADERS = [
  "Date",
  "Supplier",
  "Supplier ABN",
  "Description",
  "Category",
  "Original Amount",
  "Original Currency",
  "FX Rate (AUD per unit)",
  "FX Rate Source",
  "FX Rate Date",
  "AUD Amount",
  "AUD Manually Overridden",
  "AUD Override Reason",
  "GST Treatment",
  "GST Amount AUD",
  "Business Use %",
  "Deductible AUD",
  "Claimable GST AUD",
  "Capital Asset",
  "Asset Name",
  "Effective Life (years)",
  "Payment Method",
  "Notes",
  "Financial Year",
  "BAS Quarter",
  "Status",
  "Source",
  "Receipt Attached",
  "Receipt Filename",
  "Receipt SHA-256",
  "Record ID",
  "Created At",
  "Last Updated At",
];

const GST_LABELS: Record<string, string> = {
  gst: "GST included (claimable)",
  gst_free: "GST-free / no GST",
  input_taxed: "Input taxed / not claimable",
};

export async function exportExpensesCsv(opts: { fy?: string; includeVoid?: boolean } = {}): Promise<string> {
  const d = await db();
  const cats = await d.select().from(schema.categories);
  const catName = new Map(cats.map((c) => [c.id, c.name]));

  const statuses = opts.includeVoid ? ["active", "void"] : ["active"];
  const conds = [inArray(schema.expenses.status, statuses)];
  if (opts.fy) conds.push(eq(schema.expenses.financialYear, opts.fy));

  const rows = await d
    .select()
    .from(schema.expenses)
    .where(and(...conds))
    .orderBy(asc(schema.expenses.dateIncurred), asc(schema.expenses.createdAt));

  const receiptRows = rows.length
    ? await d
        .select()
        .from(schema.receipts)
        .where(and(inArray(schema.receipts.expenseId, rows.map((r) => r.id)), eq(schema.receipts.isCurrent, true)))
    : [];
  const receiptByExpense = new Map(receiptRows.map((r) => [r.expenseId, r]));

  const lines = [CSV_HEADERS.map(esc).join(",")];
  for (const e of rows) {
    const receipt = receiptByExpense.get(e.id);
    const claimable = e.gstTreatment === "gst" ? applyBp(e.gstAmountCents, e.businessUseBp) : 0;
    lines.push(
      [
        formatDateAU(e.dateIncurred),
        e.supplierName,
        e.supplierAbn ?? "",
        e.description,
        catName.get(e.categoryId) ?? "",
        centsToDecimalString(e.originalAmountCents),
        e.originalCurrency,
        e.fxRate ?? (e.originalCurrency === "AUD" ? "1" : ""),
        e.fxRateSource ?? "",
        e.fxRateDate ? formatDateAU(e.fxRateDate) : "",
        centsToDecimalString(e.audAmountCents),
        e.audIsOverridden ? "Yes" : "No",
        e.audOverrideNote ?? "",
        GST_LABELS[e.gstTreatment] ?? e.gstTreatment,
        centsToDecimalString(e.gstAmountCents),
        bpToPercentString(e.businessUseBp),
        centsToDecimalString(e.deductibleAudCents),
        centsToDecimalString(claimable),
        e.isCapital ? "Yes" : "No",
        e.assetName ?? "",
        e.effectiveLifeYears ?? "",
        e.paymentMethod ?? "",
        e.notes ?? "",
        e.financialYear,
        fyQuarter(e.dateIncurred),
        e.status,
        e.source,
        receipt ? "Yes" : "No",
        receipt?.originalFilename ?? "",
        receipt?.sha256 ?? "",
        e.id,
        e.createdAt,
        e.updatedAt,
      ]
        .map(esc)
        .join(",")
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
