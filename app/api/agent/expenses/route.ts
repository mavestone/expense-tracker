import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { listExpenses } from "@/lib/expenses";

export const runtime = "nodejs";

/**
 * Minimal search for automation: find recent records (dedupe checks,
 * locating a record to attach a receipt to). Read-only.
 */
export const GET = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const url = new URL(req.url);
    const q = url.searchParams.get("q") || undefined;
    const statusParam = url.searchParams.get("status");
    const status = statusParam
      ? (statusParam.split(",") as ("draft" | "active" | "void")[])
      : (["draft", "active", "void"] as ("draft" | "active" | "void")[]);

    const { expenses } = await listExpenses({ search: q, status, limit: 25 });
    const origin = url.origin;
    let rows = expenses.map((e) => ({
      id: e.id,
      url: `${origin}/expenses/${e.id}`,
      date: e.dateIncurred,
      supplier: e.supplierName,
      description: e.description,
      originalAmount: `${e.originalCurrency} ${(e.originalAmountCents / 100).toFixed(2)}`,
      audAmount: (e.audAmountCents / 100).toFixed(2),
      // what actually reaches the return: gross less private use, and the GST
      // credit separately so the two are never conflated
      businessUsePct: (e.businessUseBp / 100).toFixed(0),
      deductibleAud: (e.deductibleAudCents / 100).toFixed(2),
      gstTreatment: e.gstTreatment,
      gstAud: (e.gstAmountCents / 100).toFixed(2),
      status: e.status,
      source: e.source,
      receiptCount: e.receiptCount,
      financialYear: e.financialYear,
    }));
    const date = url.searchParams.get("date");
    if (date) rows = rows.filter((r) => r.date === date);
    return json({ expenses: rows });
  },
  { auth: false }
);
