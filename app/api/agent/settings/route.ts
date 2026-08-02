import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { getSettings, setSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Read settings, and update the narrow subset it's safe for an assistant to
 * set on the owner's instruction. Thresholds and money rules stay UI-only —
 * those need a human in Settings.
 */
const AGENT_WRITABLE = new Set(["gst_registered", "business_name"]);

export const GET = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
    return json({ settings: await getSettings() });
  },
  { auth: false }
);

export const PATCH = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const body = (await req.json()) as Record<string, unknown>;
    const before = await getSettings() as unknown as Record<string, unknown>;
    const d = await db();
    const changed: string[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (!AGENT_WRITABLE.has(key)) {
        return json(
          { error: `"${key}" can only be changed in the app's Settings screen. Agent-writable: ${[...AGENT_WRITABLE].join(", ")}` },
          { status: 403 }
        );
      }
      if (key === "gst_registered" && typeof value !== "boolean")
        return json({ error: "gst_registered must be true or false." }, { status: 400 });
      if (before[key] === value) continue;
      await setSetting(key, value);
      await writeAudit(d, [
        {
          entityType: "settings",
          entityId: key,
          action: "update",
          field: key,
          oldValue: before[key],
          newValue: value,
          note: "Changed via Hyperagent agent API on the owner's instruction",
        },
      ]);
      changed.push(key);
    }

    return json({ settings: await getSettings(), changed });
  },
  { auth: false }
);
