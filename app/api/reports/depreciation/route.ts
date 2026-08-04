import { api, json } from "@/lib/api";
import { depreciationSchedule } from "@/lib/reports";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const fy = new URL(req.url).searchParams.get("fy") || undefined;
  // depreciationSchedule already returns { assets, totals } — do not re-wrap it.
  return json(await depreciationSchedule(fy === "all" ? undefined : fy));
});
