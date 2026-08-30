import { api, json } from "@/lib/api";
import { monthBreakdown } from "@/lib/reports";

export const runtime = "nodejs";

/** One calendar month, both ledgers — what a bar on the trend chart is made of. */
export const GET = api(async (req) => {
  const month = new URL(req.url).searchParams.get("month") ?? "";
  return json(await monthBreakdown(month));
});
