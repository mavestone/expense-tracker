import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { getExpense, setExpenseDisposal, isDisposalReason, DISPOSAL_REASONS } from "@/lib/expenses";
import { balancingAdjustment, explainTreatment } from "@/lib/depreciation";
import { parseMoneyToCents } from "@/lib/money";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

type Payload = {
  disposalDate?: string;
  disposalReason?: string;
  /** Proceeds or insurance received. Omit or "0" for an uninsured loss. */
  terminationValue?: string;
  terminationValueCents?: number;
  /** Written-down value just before the event; omitted lets it be inferred. */
  adjustableValue?: string;
  adjustableValueCents?: number;
  note?: string | null;
  /** Pass true to remove a disposal recorded in error. */
  clear?: boolean;
};

/**
 * Record (or clear) a balancing adjustment event on a capital asset: sold,
 * stolen, destroyed, scrapped, or taken out of business use.
 *
 * The response reports the adjustment so the caller can see immediately whether
 * anything is deductible or assessable — for an asset already written off in
 * full under the instant asset write-off, an uninsured loss correctly nets to nil.
 */
export const POST = api(
  async (req, ctx) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const { id } = await ctx.params;
    const existing = await getExpense(id);
    if (!existing) return json({ error: "Expense not found." }, { status: 404 });

    const p = (await req.json()) as Payload;

    if (p.clear) {
      const rec = await setExpenseDisposal(id, null);
      return json({ id: rec.id, url: `${new URL(req.url).origin}/expenses/${rec.id}`, disposal: null });
    }

    if (!p.disposalDate) return json({ error: "disposalDate is required (YYYY-MM-DD)." }, { status: 400 });
    if (!isDisposalReason(p.disposalReason))
      return json({ error: `disposalReason must be one of: ${DISPOSAL_REASONS.join(", ")}.` }, { status: 400 });

    const termination =
      p.terminationValueCents != null
        ? p.terminationValueCents
        : p.terminationValue != null
          ? parseMoneyToCents(String(p.terminationValue))
          : 0;
    if (termination == null || termination < 0)
      return json({ error: "terminationValue could not be read as an amount." }, { status: 400 });

    let adjustable: number | null = null;
    if (p.adjustableValueCents != null) adjustable = p.adjustableValueCents;
    else if (p.adjustableValue != null) {
      adjustable = parseMoneyToCents(String(p.adjustableValue));
      if (adjustable == null) return json({ error: "adjustableValue could not be read as an amount." }, { status: 400 });
    }

    const rec = await setExpenseDisposal(id, {
      disposalDate: p.disposalDate,
      disposalReason: p.disposalReason,
      terminationValueCents: termination,
      adjustableValueCents: adjustable,
      disposalNote: p.note ?? null,
    });

    // Work the adjustment out for the response using the same rules the report uses.
    const d = await db();
    const [threshold] = await d
      .select()
      .from(schema.fyThresholds)
      .where(eq(schema.fyThresholds.fyLabel, rec.financialYear));
    const treatment = explainTreatment(
      rec.audAmountCents,
      rec.businessUseBp,
      threshold?.instantWriteoffCents ?? null
    );
    const effectiveAdjustable =
      rec.adjustableValueCents ?? (treatment.method === "immediate" ? 0 : null);
    const adj =
      effectiveAdjustable == null
        ? null
        : balancingAdjustment(effectiveAdjustable, rec.terminationValueCents ?? 0, rec.businessUseBp);

    return json({
      id: rec.id,
      url: `${new URL(req.url).origin}/expenses/${rec.id}`,
      asset: rec.assetName || rec.description,
      disposal: {
        date: rec.disposalDate,
        reason: rec.disposalReason,
        terminationValueAud: ((rec.terminationValueCents ?? 0) / 100).toFixed(2),
        adjustableValueAud: effectiveAdjustable == null ? null : (effectiveAdjustable / 100).toFixed(2),
        note: rec.disposalNote,
      },
      treatment: { method: treatment.method, note: treatment.note },
      balancingAdjustment: adj
        ? {
            deductionAud: (adj.deductionCents / 100).toFixed(2),
            assessableAud: (adj.assessableCents / 100).toFixed(2),
            summary:
              adj.netCents === 0
                ? "No adjustment — nothing further is deductible and nothing is assessable."
                : adj.netCents < 0
                  ? `Deductible balancing adjustment of $${(adj.deductionCents / 100).toFixed(2)}.`
                  : `Assessable balancing adjustment of $${(adj.assessableCents / 100).toFixed(2)}.`,
          }
        : {
            deductionAud: null,
            assessableAud: null,
            summary:
              "Adjustable value is unknown — set it on the record, or set the write-off threshold for this financial year.",
          },
    });
  },
  { auth: false }
);
