import { api, json } from "@/lib/api";
import { incomeSummary } from "@/lib/income";
import { categorySummary } from "@/lib/reports";
import { currentFy } from "@/lib/fy";

export const runtime = "nodejs";

/** Income summary plus a simple profit view (income − deductible expenses). */
export const GET = api(async (req) => {
  const fy = new URL(req.url).searchParams.get("fy") || currentFy();
  const [inc, exp] = await Promise.all([incomeSummary(fy), categorySummary(fy)]);
  return json({
    fy,
    income: inc,
    expenses: exp.totals,
    profit: {
      incomeAudCents: inc.totals.audCents,
      // Net of GST collected — that money is the ATO's, not revenue.
      incomeExGstCents: inc.totals.audCents - inc.totals.gstCents,
      deductibleExpenseCents: exp.totals.deductibleCents,
      claimableGstCents: exp.totals.claimableGstCents,
      netCents: inc.totals.audCents - inc.totals.gstCents - (exp.totals.deductibleCents - exp.totals.claimableGstCents),
    },
  });
});
