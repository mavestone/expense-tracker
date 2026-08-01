import { api, json } from "@/lib/api";
import { gstSummary } from "@/lib/reports";
import { currentFy } from "@/lib/fy";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const fy = new URL(req.url).searchParams.get("fy") || currentFy();
  return json(await gstSummary(fy));
});
