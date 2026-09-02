import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { listTransactions, type TxnStatus } from "@/lib/statements";

export const runtime = "nodejs";

/** Read-only view of statement lines, so a triage run can be checked rather than assumed. */
export const GET = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
    const p = new URL(req.url).searchParams;
    const statusParam = p.get("status");
    const { transactions, totals } = await listTransactions({
      fy: p.get("fy") || undefined,
      month: p.get("month") || undefined,
      accountId: p.get("accountId") || undefined,
      status: statusParam ? (statusParam.split(",") as TxnStatus[]) : undefined,
      direction: (p.get("direction") as "in" | "out") || undefined,
      q: p.get("q") || undefined,
      limit: p.get("limit") ? Number(p.get("limit")) : 50,
    });
    return json({
      totals,
      transactions: transactions.map((t) => ({
        // The id is what a triage run acts on; without it the only way to
        // change a line from outside the app is to guess at a filter.
        id: t.id,
        date: t.date,
        description: t.description.slice(0, 90),
        direction: t.direction,
        amount: `${t.currency} ${(t.amountCents / 100).toFixed(2)}`,
        status: t.status,
        linked: Boolean(t.matchedExpenseId || t.matchedIncomeId),
        counterparty: t.counterparty,
        reason: t.ignoreReason,
        source: t.matchSource,
      })),
    });
  },
  { auth: false }
);
