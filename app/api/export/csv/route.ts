import { api } from "@/lib/api";
import { exportExpensesCsv } from "@/lib/csv";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const url = new URL(req.url);
  const fy = url.searchParams.get("fy") || undefined;
  const includeVoid = url.searchParams.get("includeVoid") === "1";
  const csv = await exportExpensesCsv({ fy: fy === "all" ? undefined : fy, includeVoid });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = fy && fy !== "all" ? `expenses-FY${fy}-${stamp}.csv` : `expenses-all-${stamp}.csv`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
});
