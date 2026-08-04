import { api, json } from "@/lib/api";
import { statementsOverview, reviewProgress } from "@/lib/statements";

export const runtime = "nodejs";

/** Accounts, their statements and review progress for a financial year. */
export const GET = api(async (req) => {
  const fy = new URL(req.url).searchParams.get("fy") || undefined;
  const overview = await statementsOverview(fy);
  return json({ ...overview, progress: await reviewProgress({ fy }) });
});
