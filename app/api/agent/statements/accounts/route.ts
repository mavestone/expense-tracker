import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { listAccounts } from "@/lib/statements";

export const runtime = "nodejs";

/**
 * The accounts statements can be ingested into.
 *
 * Ingest matches an account on its label and creates one when nothing
 * matches, so an agent that cannot read the labels back is guessing — and a
 * near-miss ("Wise" vs "Wise — USD") silently splits an account's history in
 * two. This exists so the label can be looked up rather than assumed.
 */
export const GET = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
    const accounts = await listAccounts();
    return json({
      count: accounts.length,
      accounts: accounts.map((a) => ({
        id: a.id,
        label: a.label,
        institution: a.institution,
        accountRef: a.accountRef,
        kind: a.kind,
        remindMonthly: a.remindMonthly,
      })),
    });
  },
  { auth: false }
);
