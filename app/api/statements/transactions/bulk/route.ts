import { api, json } from "@/lib/api";
import { bulkReview, type TxnStatus } from "@/lib/statements";

export const runtime = "nodejs";

/** One decision applied to many lines — the backlog is 600+ rows deep. */
export const POST = api(async (req) => {
  const body = (await req.json()) as { ids: string[]; status: TxnStatus; ignoreReason?: string | null };
  if (!Array.isArray(body.ids) || body.ids.length === 0)
    return json({ error: "ids must be a non-empty array." }, { status: 400 });
  if (body.ids.length > 2000) return json({ error: "Too many lines in one go (max 2000)." }, { status: 400 });
  return json(await bulkReview(body.ids, { status: body.status, ignoreReason: body.ignoreReason }));
});
