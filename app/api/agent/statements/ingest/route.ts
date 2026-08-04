import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { upsertAccount, ingestStatement, autoMatch, type ParsedTxn } from "@/lib/statements";

export const runtime = "nodejs";

type Payload = {
  account: { label: string; institution: string; accountRef?: string; kind?: "bank" | "card"; sortOrder?: number };
  fyLabel: string;
  periodStart?: string;
  periodEnd?: string;
  filename: string;
  /** The original statement, base64. Optional but strongly preferred — it is the evidence. */
  fileBase64?: string;
  mime?: string;
  transactions: ParsedTxn[];
  /** Run the matcher after ingesting. Defaults to true. */
  match?: boolean;
};

/**
 * Ingest one parsed statement plus its original file.
 *
 * Re-posting the same file replaces its lines rather than duplicating them, and
 * carries across any review already done, so a corrected parse is safe to push.
 */
export const POST = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const p = (await req.json()) as Payload;
    if (!p.account?.label) return json({ error: "account.label is required." }, { status: 400 });
    if (!Array.isArray(p.transactions)) return json({ error: "transactions must be an array." }, { status: 400 });

    let fileBuffer: Buffer | null = null;
    if (p.fileBase64) {
      if (p.fileBase64.length > 12 * 1024 * 1024)
        return json({ error: "Statement file too large (max ~9MB)." }, { status: 413 });
      try {
        fileBuffer = Buffer.from(p.fileBase64, "base64");
      } catch {
        return json({ error: "fileBase64 could not be decoded." }, { status: 400 });
      }
    }

    const account = await upsertAccount(p.account);
    const result = await ingestStatement({
      accountId: account.id,
      fyLabel: p.fyLabel,
      periodStart: p.periodStart ?? null,
      periodEnd: p.periodEnd ?? null,
      filename: p.filename,
      mime: p.mime ?? "application/pdf",
      fileBuffer,
      transactions: p.transactions,
    });

    const matching = p.match === false ? null : await autoMatch(p.fyLabel);

    return json({
      account: { id: account.id, label: account.label },
      statementId: result.statementId,
      inserted: result.inserted,
      replaced: result.replaced,
      preservedReviews: result.preservedReviews,
      fileStored: Boolean(fileBuffer),
      matching,
    });
  },
  { auth: false }
);
