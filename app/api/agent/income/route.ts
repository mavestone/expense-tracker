import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { createIncome, isIncomeGst, type IncomeInput } from "@/lib/income";
import { parseMoneyToCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

type Payload = {
  dateEarned: string;
  datePaid?: string | null;
  clientName: string;
  clientAbn?: string | null;
  invoiceRef?: string | null;
  description: string;
  incomeType?: string;
  amount?: string;
  amountCents?: number;
  currency: string;
  gstTreatment?: string;
  paymentAccount?: string | null;
  notes?: string | null;
};

/** Log business income (invoiced work or other) from an AI assistant. */
export const POST = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const p = (await req.json()) as Payload;
    const amountCents =
      p.amountCents != null && Number.isInteger(p.amountCents) && p.amountCents > 0
        ? p.amountCents
        : p.amount != null
          ? parseMoneyToCents(String(p.amount))
          : null;
    if (amountCents == null || amountCents <= 0) return json({ error: "Invalid amount." }, { status: 400 });

    const settings = await getSettings();
    const currency = String(p.currency || "").toUpperCase();
    const treatment = p.gstTreatment && isIncomeGst(p.gstTreatment)
      ? p.gstTreatment
      : settings.gst_registered && currency === "AUD"
        ? "gst"
        : "no_gst";

    const input: IncomeInput = {
      dateEarned: p.dateEarned,
      datePaid: p.datePaid ?? null,
      clientName: p.clientName,
      clientAbn: p.clientAbn ?? null,
      invoiceRef: p.invoiceRef ?? null,
      description: p.description,
      incomeType: p.incomeType || "client_work",
      originalAmountCents: amountCents,
      originalCurrency: currency,
      gstTreatment: treatment,
      paymentAccount: p.paymentAccount ?? null,
      notes: p.notes ?? null,
    };

    const rec = await createIncome(input, { source: "agent", resolveFx: true, auditNote: "Created via Hyperagent agent API" });
    const origin = new URL(req.url).origin;
    return json(
      {
        id: rec.id,
        url: `${origin}/income`,
        summary: {
          date: rec.dateEarned,
          paid: rec.datePaid ?? "outstanding",
          client: rec.clientName,
          original: `${rec.originalCurrency} ${(rec.originalAmountCents / 100).toFixed(2)}`,
          audAmount: (rec.audAmountCents / 100).toFixed(2),
          fx: rec.fxRate ? { rate: rec.fxRate, source: rec.fxRateSource, rateDate: rec.fxRateDate } : rec.fxStatus,
          gstTreatment: rec.gstTreatment,
          gstOnSalesAud: (rec.gstAmountCents / 100).toFixed(2),
          financialYear: rec.financialYear,
        },
      },
      { status: 201 }
    );
  },
  { auth: false }
);
