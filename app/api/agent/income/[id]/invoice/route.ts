import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { getIncome } from "@/lib/income";
import { addIncomeDocument } from "@/lib/income-documents";
import { ALLOWED_RECEIPT_MIMES } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Attach (or version-replace) an invoice document on an existing income record. */
export const POST = api(
  async (req, ctx) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const { id } = await ctx.params;
    if (!(await getIncome(id))) return json({ error: "Income record not found." }, { status: 404 });

    const p = (await req.json()) as { filename?: string; mime?: string; base64?: string };
    if (!p.base64) return json({ error: "base64 document content required." }, { status: 400 });
    if (p.base64.length > 8 * 1024 * 1024) return json({ error: "Document too large (max ~6MB)." }, { status: 413 });
    if (!p.mime || !ALLOWED_RECEIPT_MIMES.has(p.mime))
      return json({ error: `Unsupported type ${p.mime}. Use JPEG, PNG, WebP, HEIC or PDF.` }, { status: 400 });

    let buf: Buffer;
    try {
      buf = Buffer.from(p.base64, "base64");
    } catch {
      return json({ error: "base64 could not be decoded." }, { status: 400 });
    }
    if (buf.length === 0) return json({ error: "Document is empty." }, { status: 400 });

    const doc = await addIncomeDocument(id, { buffer: buf, filename: p.filename || "invoice", mime: p.mime });
    const origin = new URL(req.url).origin;
    return json(
      { id, url: `${origin}/income/${id}`, document: { version: doc.version, filename: doc.originalFilename, sha256: doc.sha256 } },
      { status: 201 }
    );
  },
  { auth: false }
);
