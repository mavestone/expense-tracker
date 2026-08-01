import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { currentFy, todayInTz } from "@/lib/fy";
import { asc } from "drizzle-orm";

export const runtime = "nodejs";

/** Machine-readable meta for automation: categories, payment methods, thresholds. */
export const GET = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const d = await db();
    const [categories, paymentMethods, thresholds, settings] = await Promise.all([
      d.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder)),
      d.select().from(schema.paymentMethods).orderBy(asc(schema.paymentMethods.sortOrder)),
      d.select().from(schema.fyThresholds).orderBy(asc(schema.fyThresholds.fyLabel)),
      getSettings(),
    ]);
    return json({
      categories: categories.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, isEquipment: c.isEquipment })),
      paymentMethods: paymentMethods.filter((p) => !p.archived).map((p) => p.name),
      thresholds: thresholds.map((t) => ({ fyLabel: t.fyLabel, instantWriteoffCents: t.instantWriteoffCents })),
      gstReceiptFlagCents: settings.gst_receipt_flag_cents,
      receiptRequiredOverCents: settings.receipt_required_over_cents,
      currentFy: currentFy(),
      today: todayInTz(),
    });
  },
  { auth: false }
);
