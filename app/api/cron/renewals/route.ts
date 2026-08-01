import { json } from "@/lib/api";
import { ensureRenewalDrafts } from "@/lib/subscriptions";

export const runtime = "nodejs";

/**
 * Vercel Cron target (vercel.json schedules a daily GET). Secured with
 * CRON_SECRET per Vercel convention. Local/self-hosted installs don't need
 * it — drafts are generated lazily whenever the app is used.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "CRON_SECRET not configured" }, { status: 503 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, { status: 401 });
  const result = await ensureRenewalDrafts();
  return json({ ok: true, ...result });
}
