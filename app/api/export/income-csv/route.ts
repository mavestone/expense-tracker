import { api } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { centsToDecimalString } from "@/lib/money";
import { formatDateAU, fyQuarter } from "@/lib/fy";

export const runtime = "nodejs";

const HEADERS = [
  "Date Earned", "Date Paid", "Status", "Client", "Client ABN", "Invoice Ref", "Description", "Income Type",
  "Original Amount", "Original Currency", "FX Rate (AUD per unit)", "FX Rate Source", "FX Rate Date",
  "AUD Amount", "GST Treatment", "GST on Sales AUD", "Paid Into", "Notes",
  "Financial Year", "BAS Quarter", "Record Status", "Source", "Record ID", "Created At",
];

const GST_LABELS: Record<string, string> = {
  gst: "GST included (collected)",
  gst_free: "GST-free sale",
  no_gst: "No GST",
};

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Accountant-ready income CSV, mirroring the expense export conventions. */
export const GET = api(async (req) => {
  const url = new URL(req.url);
  const fy = url.searchParams.get("fy") || undefined;
  const includeVoid = url.searchParams.get("includeVoid") === "1";
  const d = await db();
  const conds = [inArray(schema.income.status, includeVoid ? ["active", "void"] : ["active"])];
  if (fy && fy !== "all") conds.push(eq(schema.income.financialYear, fy));
  const rows = await d.select().from(schema.income).where(and(...conds)).orderBy(asc(schema.income.dateEarned));

  const lines = [HEADERS.map(esc).join(",")];
  for (const r of rows) {
    lines.push(
      [
        formatDateAU(r.dateEarned),
        r.datePaid ? formatDateAU(r.datePaid) : "",
        r.datePaid ? "Paid" : "Outstanding",
        r.clientName,
        r.clientAbn ?? "",
        r.invoiceRef ?? "",
        r.description,
        r.incomeType,
        centsToDecimalString(r.originalAmountCents),
        r.originalCurrency,
        r.fxRate ?? (r.originalCurrency === "AUD" ? "1" : ""),
        r.fxRateSource ?? "",
        r.fxRateDate ? formatDateAU(r.fxRateDate) : "",
        centsToDecimalString(r.audAmountCents),
        GST_LABELS[r.gstTreatment] ?? r.gstTreatment,
        centsToDecimalString(r.gstAmountCents),
        r.paymentAccount ?? "",
        r.notes ?? "",
        r.financialYear,
        fyQuarter(r.dateEarned),
        r.status,
        r.source,
        r.id,
        r.createdAt,
      ].map(esc).join(",")
    );
  }
  const csv = "﻿" + lines.join("\r\n") + "\r\n";
  const stamp = new Date().toISOString().slice(0, 10);
  const name = fy && fy !== "all" ? `income-FY${fy}-${stamp}.csv` : `income-all-${stamp}.csv`;
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
});
