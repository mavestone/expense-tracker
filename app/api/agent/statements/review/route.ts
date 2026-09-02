import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { bulkReview, setTxnReview, type TxnStatus } from "@/lib/statements";

export const runtime = "nodejs";

/**
 * Apply one triage decision to a set of lines, by id.
 *
 * Deliberately id-based rather than filter-based. A filter like "everything
 * matching /Moved/" is a convenient thing to hand an agent and a dangerous
 * one: the caller cannot see what it caught until after it has run. Ids force
 * the selection to be read back from GET /transactions and inspected first,
 * and they make the audit entry mean something.
 *
 * `ignored` still requires a reason, exactly as the app does — setting a line
 * aside is a decision that has to explain itself a year later.
 *
 * Naming the record a line belongs to goes through the single-line path, which
 * writes the link and an audit entry per line. Marking something business
 * without saying what it is leaves a line that claims to be reconciled and
 * points at nothing.
 */
export const POST = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const b = (await req.json()) as {
      ids?: string[];
      status?: TxnStatus;
      ignoreReason?: string | null;
      matchedExpenseId?: string | null;
      matchedIncomeId?: string | null;
    };
    if (!Array.isArray(b.ids) || b.ids.length === 0)
      return json({ error: "ids must be a non-empty array." }, { status: 400 });
    if (b.ids.length > 2000) return json({ error: "Too many lines in one go (max 2000)." }, { status: 400 });
    if (!b.status) return json({ error: "status is required." }, { status: 400 });

    if (b.matchedExpenseId || b.matchedIncomeId) {
      const updated = [];
      for (const id of b.ids) {
        updated.push(
          await setTxnReview(id, {
            status: b.status,
            ignoreReason: b.ignoreReason,
            matchedExpenseId: b.matchedExpenseId ?? null,
            matchedIncomeId: b.matchedIncomeId ?? null,
          })
        );
      }
      return json({ updated: updated.length, linked: b.matchedExpenseId ?? b.matchedIncomeId });
    }

    return json(await bulkReview(b.ids, { status: b.status, ignoreReason: b.ignoreReason }));
  },
  { auth: false }
);
