import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { listExpenses } from "@/lib/expenses";
import { ensureRenewalDrafts, subscriptionOverview } from "@/lib/subscriptions";
import { missingReceipts, gstSummary } from "@/lib/reports";
import { currentFy } from "@/lib/fy";
import { and, eq, sql } from "drizzle-orm";
import { applyBp } from "@/lib/money";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  // Lazy renewal generation on app open.
  await ensureRenewalDrafts().catch(() => ({ generated: 0 }));

  const url = new URL(req.url);
  const fy = url.searchParams.get("fy") || currentFy();
  const d = await db();

  const [fyRows, drafts, pendingFx, recent, missing, subs, gst] = await Promise.all([
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
    listExpenses({ limit: 8 }),
    missingReceipts(fy),
    subscriptionOverview(),
    gstSummary(fy),
  ]);

  const totals = {
    count: fyRows.length,
    audCents: fyRows.reduce((s, e) => s + e.audAmountCents, 0),
    deductibleCents: fyRows.reduce((s, e) => s + e.deductibleAudCents, 0),
    claimableGstCents: fyRows.reduce((s, e) => s + (e.gstTreatment === "gst" ? applyBp(e.gstAmountCents, e.businessUseBp) : 0), 0),
    capitalCount: fyRows.filter((e) => e.isCapital).length,
    capitalCents: fyRows.filter((e) => e.isCapital).reduce((s, e) => s + e.audAmountCents, 0),
  };

  return json({
    fy,
    totals,
    alerts: {
      pendingDrafts: drafts[0]?.n ?? 0,
      pendingFx: pendingFx[0]?.n ?? 0,
      missingReceiptsImportant: missing.filter((m) => m.severity !== "info").length,
      missingReceiptsTotal: missing.length,
      staleSubscriptions: subs.subscriptions.filter((s) => s.stale).length,
      gstInvoiceFlags: gst.totals.flaggedCount,
    },
    recent: recent.expenses,
  });
});
