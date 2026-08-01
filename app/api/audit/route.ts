import { api, json } from "@/lib/api";
import { getRecentAudit } from "@/lib/audit";
import { listExpenses } from "@/lib/expenses";

export const runtime = "nodejs";

/** Audit view: recent audit log entries plus all voided records. */
export const GET = api(async (req) => {
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset") || 0);
  const [audit, voided] = await Promise.all([
    getRecentAudit(200, offset),
    listExpenses({ status: ["void"], limit: 500 }),
  ]);
  return json({ audit, voided: voided.expenses });
});
