import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { autoMatch, triage, resetAutoDecisions, reviewProgress } from "@/lib/statements";

export const runtime = "nodejs";

/**
 * Re-run triage and matching over a financial year.
 *
 * ?reset=1 clears previous automatic decisions first, leaving anything reviewed
 * by hand alone — for when the rules themselves have changed.
 */
export const POST = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
    const p = new URL(req.url).searchParams;
    const fy = p.get("fy") || undefined;

    const reset = p.get("reset") === "1" ? await resetAutoDecisions(fy) : null;
    const triaged = p.get("triage") === "0" ? null : await triage(fy);
    const matching = p.get("match") === "0" ? null : await autoMatch(fy);
    // report the resulting state so a run can be verified, not inferred
    return json({ reset, triage: triaged, matching, progress: await reviewProgress({ fy }) });
  },
  { auth: false }
);
