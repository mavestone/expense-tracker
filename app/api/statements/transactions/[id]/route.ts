import { api, json } from "@/lib/api";
import { setTxnReview, type TxnStatus } from "@/lib/statements";

export const runtime = "nodejs";

/** Tick a line off: matched to a record, or deliberately set aside with a reason. */
export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    status: TxnStatus;
    ignoreReason?: string | null;
    note?: string | null;
    matchedExpenseId?: string | null;
    matchedIncomeId?: string | null;
  };
  const row = await setTxnReview(id, body);
  return json({ transaction: row });
});
