import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { receiptCountMap } from "@/lib/expenses";
import { ensureRenewalDrafts, subscriptionOverview } from "@/lib/subscriptions";
import { missingReceipts, gstSummary } from "@/lib/reports";
import { currentFy } from "@/lib/fy";
import { getSettings } from "@/lib/settings";
import { and, eq, isNull, sql } from "drizzle-orm";
import { applyBp } from "@/lib/money";
import { actionStack } from "@/lib/actions";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  // Lazy renewal generation on app open.
  await ensureRenewalDrafts().catch(() => ({ generated: 0 }));

  const url = new URL(req.url);
  const fy = url.searchParams.get("fy") || currentFy();
  const d = await db();

  const [fyRows, drafts, pendingFx, missing, subs, gst, incomeRows, unpaid] = await Promise.all([
    d
      .select()
      .from(schema.expenses)
      .where(and(eq(schema.expenses.financialYear, fy), eq(schema.expenses.status, "active"))),
    d
      .select({ n: sql<number>`count(*)` })
      .from(schema.expenses)
      .where(eq(schema.expenses.status, "draft")),
    d
      .select({ n: sql<number>`count(*)` })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.fxStatus, "pending"), sql`${schema.expenses.status} != 'void'`)),
    missingReceipts(fy),
    subscriptionOverview(),
    gstSummary(fy),
    d
      .select()
      .from(schema.income)
      .where(and(eq(schema.income.financialYear, fy), eq(schema.income.status, "active"))),
    d
      .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${schema.income.audAmountCents}), 0)` })
      .from(schema.income)
      // scope to the selected year — unpaid invoices from a later FY were being
      // reported against whichever year was on screen
      .where(and(eq(schema.income.financialYear, fy), eq(schema.income.status, "active"), isNull(schema.income.datePaid))),
  ]);

  const [dashReceipts, actions] = await Promise.all([
    receiptCountMap(fyRows.map((r) => r.id)),
    actionStack(fy),
  ]);
  const gstFlagCents = (await getSettings()).gst_receipt_flag_cents;

  const totals = {
    count: fyRows.length,
    audCents: fyRows.reduce((s, e) => s + e.audAmountCents, 0),
    deductibleCents: fyRows.reduce((s, e) => s + e.deductibleAudCents, 0),
    // Match the BAS report: a GST purchase over the threshold with no tax
    // invoice cannot be claimed at 1B, so it must not be counted here either.
    claimableGstCents: fyRows.reduce(
      (s, e) =>
        s +
        (e.gstTreatment === "gst" &&
        !(e.audAmountCents > gstFlagCents && (dashReceipts.get(e.id) ?? 0) === 0)
          ? applyBp(e.gstAmountCents, e.businessUseBp)
          : 0),
      0
    ),
    blockedGstCents: fyRows.reduce(
      (s, e) =>
        s +
        (e.gstTreatment === "gst" &&
        e.audAmountCents > gstFlagCents &&
        (dashReceipts.get(e.id) ?? 0) === 0
          ? applyBp(e.gstAmountCents, e.businessUseBp)
          : 0),
      0
    ),
    capitalCount: fyRows.filter((e) => e.isCapital).length,
    capitalCents: fyRows.filter((e) => e.isCapital).reduce((s, e) => s + e.audAmountCents, 0),
  };

  const incomeAud = incomeRows.reduce((s, r) => s + r.audAmountCents, 0);
  const incomeGst = incomeRows.reduce((s, r) => s + r.gstAmountCents, 0);
  const incomeTotals = {
    count: incomeRows.length,
    audCents: incomeAud,
    gstCents: incomeGst,
    netCents: incomeAud - incomeGst - (totals.deductibleCents - totals.claimableGstCents),
    outstandingCount: unpaid[0]?.n ?? 0,
    outstandingCents: unpaid[0]?.total ?? 0,
  };

  return json({
    fy,
    actions,
    totals,
    income: incomeTotals,
    alerts: {
      pendingDrafts: drafts[0]?.n ?? 0,
      pendingFx: pendingFx[0]?.n ?? 0,
      missingReceiptsImportant: missing.filter((m) => m.severity !== "info").length,
      missingReceiptsTotal: missing.length,
      staleSubscriptions: subs.subscriptions.filter((s) => s.stale).length,
      gstInvoiceFlags: gst.totals.flaggedCount,
      unpaidInvoices: unpaid[0]?.n ?? 0,
    },
  });
});
