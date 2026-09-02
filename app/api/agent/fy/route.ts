import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { db, schema } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { isAccountingBasis } from "@/lib/basis";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

/** The per-year settings, so a basis can be read back rather than assumed. */
export const GET = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
    const d = await db();
    const rows = await d.select().from(schema.fyThresholds);
    return json({
      years: rows
        .map((r) => ({
          fyLabel: r.fyLabel,
          incomeBasis: r.incomeBasis,
          instantWriteoffCents: r.instantWriteoffCents,
          note: r.note,
        }))
        .sort((a, b) => b.fyLabel.localeCompare(a.fyLabel)),
    });
  },
  { auth: false }
);

/**
 * Set a year's income basis.
 *
 * Deliberately the only thing this writes. Which year is on which basis
 * decides what counts as that year's income, and it belongs next to the
 * ledger it governs rather than behind a browser session — but it is also
 * the whole of the surface, so nothing else about settings is reachable here.
 */
export const PATCH = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const b = (await req.json()) as { fyLabel?: string; incomeBasis?: string };
    if (!b.fyLabel || !/^\d{4}-\d{2}$/.test(b.fyLabel))
      return json({ error: 'fyLabel must look like "2026-27".' }, { status: 400 });
    if (!isAccountingBasis(b.incomeBasis))
      return json({ error: "incomeBasis must be accruals or cash." }, { status: 400 });

    const d = await db();
    const [existing] = await d
      .select()
      .from(schema.fyThresholds)
      .where(eq(schema.fyThresholds.fyLabel, b.fyLabel));

    if (existing) {
      if (existing.incomeBasis === b.incomeBasis) return json({ fyLabel: b.fyLabel, incomeBasis: b.incomeBasis, changed: false });
      await d
        .update(schema.fyThresholds)
        .set({ incomeBasis: b.incomeBasis })
        .where(eq(schema.fyThresholds.id, existing.id));
      await writeAudit(d, [
        {
          entityType: "fy_threshold",
          entityId: existing.id,
          action: "update",
          field: "incomeBasis",
          oldValue: existing.incomeBasis,
          newValue: b.incomeBasis,
          note: `FY ${b.fyLabel} income basis`,
        },
      ]);
    } else {
      const id = randomUUID();
      await d.insert(schema.fyThresholds).values({
        id,
        fyLabel: b.fyLabel,
        instantWriteoffCents: null,
        incomeBasis: b.incomeBasis,
        note: null,
      });
      await writeAudit(d, [
        {
          entityType: "fy_threshold",
          entityId: id,
          action: "create",
          field: "incomeBasis",
          newValue: b.incomeBasis,
          note: `FY ${b.fyLabel} income basis`,
        },
      ]);
    }
    return json({ fyLabel: b.fyLabel, incomeBasis: b.incomeBasis, changed: true });
  },
  { auth: false }
);
