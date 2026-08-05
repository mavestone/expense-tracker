import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { appendIncomeNote } from "@/lib/income";

export const runtime = "nodejs";

/** Append a note to an income record. Notes only — no other field is touched. */
export const POST = api(
  async (req, ctx) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
    const { id } = await ctx.params;
    const { note } = (await req.json()) as { note: string };
    const rec = await appendIncomeNote(id, note);
    return json({
      id: rec.id,
      url: `${new URL(req.url).origin}/income/${rec.id}`,
      invoiceRef: rec.invoiceRef,
      audAmount: (rec.audAmountCents / 100).toFixed(2),
      financialYear: rec.financialYear,
      notes: rec.notes,
    });
  },
  { auth: false }
);
