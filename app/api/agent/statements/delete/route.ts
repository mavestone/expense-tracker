import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { deleteStatement } from "@/lib/statements";

export const runtime = "nodejs";

export const POST = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
    const { statementId } = (await req.json()) as { statementId: string };
    if (!statementId) return json({ error: "statementId is required." }, { status: 400 });
    return json(await deleteStatement(statementId));
  },
  { auth: false }
);
