import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { getIncome, setIncomePaid } from "@/lib/income";

export const runtime = "nodejs";

/**
 * Mark an income record paid (or clear the paid date) — the bank-statement
 * reconciliation step. Audited like any other change.
 */
export const POST = api(
  async (req, ctx) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const { id } = await ctx.params;
    if (!(await getIncome(id))) return json({ error: "Income record not found." }, { status: 404 });

    const body = (await req.json()) as { datePaid?: string | null };
    const rec = await setIncomePaid(id, body.datePaid ?? null);
    const origin = new URL(req.url).origin;
    return json({
      id: rec.id,
      url: `${origin}/income/${rec.id}`,
      client: rec.clientName,
      invoiceRef: rec.invoiceRef,
      datePaid: rec.datePaid,
      audAmount: (rec.audAmountCents / 100).toFixed(2),
    });
  },
  { auth: false }
);
