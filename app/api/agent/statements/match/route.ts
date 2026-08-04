import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { autoMatch } from "@/lib/statements";

export const runtime = "nodejs";

/** Re-run the matcher, e.g. after adding records that statement lines should link to. */
export const POST = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
    const fy = new URL(req.url).searchParams.get("fy") || undefined;
    return json({ matching: await autoMatch(fy) });
  },
  { auth: false }
);
