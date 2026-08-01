import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { getExpense, expenseFlags } from "@/lib/expenses";
import { addReceipt } from "@/lib/receipts";
import { ALLOWED_RECEIPT_MIMES } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Attach (or version-replace) a receipt on an existing expense via the
 * agent API — e.g. when the receipt arrives after the record, or to recover
 * from a storage failure. Same immutability rules as in-app uploads.
 */
export const POST = api(
  async (req, ctx) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const { id } = await ctx.params;
    const expense = await getExpense(id);
    if (!expense) return json({ error: "Expense not found." }, { status: 404 });

    const p = (await req.json()) as { filename?: string; mime?: string; base64?: string };
    if (!p.base64) return json({ error: "base64 receipt content required." }, { status: 400 });
    if (p.base64.length > 8 * 1024 * 1024) return json({ error: "Receipt too large (max ~6MB)." }, { status: 413 });
    if (!p.mime || !ALLOWED_RECEIPT_MIMES.has(p.mime))
      return json({ error: `Unsupported receipt type ${p.mime}. Use JPEG, PNG, WebP, HEIC or PDF.` }, { status: 400 });

    let buf: Buffer;
    try {
      buf = Buffer.from(p.base64, "base64");
    } catch {
      return json({ error: "Receipt base64 could not be decoded." }, { status: 400 });
    }
    if (buf.length === 0) return json({ error: "Receipt is empty." }, { status: 400 });

    const receipt = await addReceipt(id, { buffer: buf, filename: p.filename || "receipt", mime: p.mime });
    const flags = await expenseFlags((await getExpense(id))!, 1);
    const origin = new URL(req.url).origin;
    return json(
      {
        id,
        url: `${origin}/expenses/${id}`,
        receipt: { version: receipt.version, filename: receipt.originalFilename, sha256: receipt.sha256 },
        flags,
      },
      { status: 201 }
    );
  },
  { auth: false }
);
