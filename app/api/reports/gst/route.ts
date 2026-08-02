import { api, json } from "@/lib/api";
import { gstSummary } from "@/lib/reports";
import { incomeByQuarter } from "@/lib/income";
import { currentFy } from "@/lib/fy";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const fy = new URL(req.url).searchParams.get("fy") || currentFy();
  const [purchases, sales] = await Promise.all([gstSummary(fy), incomeByQuarter(fy)]);
  // Attach the sales side (G1 total sales, 1A GST on sales) to each quarter.
  const quarters = purchases.quarters.map((q) => ({
    ...q,
    g1Cents: sales[q.quarter]?.g1Cents ?? 0,
    oneACents: sales[q.quarter]?.oneACents ?? 0,
    netGstCents: (sales[q.quarter]?.oneACents ?? 0) - q.oneBCents,
  }));
  const totals = {
    ...purchases.totals,
    g1Cents: quarters.reduce((s, q) => s + q.g1Cents, 0),
    oneACents: quarters.reduce((s, q) => s + q.oneACents, 0),
    netGstCents: quarters.reduce((s, q) => s + q.netGstCents, 0),
  };
  return json({ ...purchases, quarters, totals });
});
