import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { getFyClosure, finaliseFy, addFyDocument, listFyDocuments, ALLOWED_FY_DOC_MIMES } from "@/lib/fy-close";
import { ValidationError } from "@/lib/expenses";

export const runtime = "nodejs";

function guard(req: Request): Response | null {
  if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
  if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
  return null;
}

export const GET = api(
  async (req, ctx) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    const { fy } = await ctx.params;
    const [closure, documents] = await Promise.all([getFyClosure(fy), listFyDocuments(fy)]);
    const origin = new URL(req.url).origin;
    return json({
      fy,
      finalised: Boolean(closure && !closure.reopenedAt),
      closure,
      documents: documents.map((d) => ({
        id: d.id,
        title: d.title,
        kind: d.kind,
        filename: d.originalFilename,
        sizeBytes: d.sizeBytes,
        uploadedAt: d.uploadedAt,
        url: `${origin}/api/fy/documents/${d.id}`,
      })),
    });
  },
  { auth: false }
);

/** Finalise the year, and/or attach a working paper supplied as base64. */
export const POST = api(
  async (req, ctx) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    const { fy } = await ctx.params;
    const b = (await req.json()) as {
      action?: "finalise" | "attach";
      lodgedDate?: string;
      atoReceipt?: string;
      taxableIncomeCents?: number;
      taxPayableCents?: number;
      note?: string;
      document?: { filename: string; mime: string; base64: string; title?: string; description?: string; kind?: string };
    };

    if (b.document) {
      if (!ALLOWED_FY_DOC_MIMES.has(b.document.mime))
        throw new ValidationError([`Unsupported file type: ${b.document.mime}.`]);
      await addFyDocument(
        fy,
        { filename: b.document.filename, mime: b.document.mime, bytes: Buffer.from(b.document.base64, "base64") },
        { title: b.document.title ?? null, description: b.document.description ?? null, kind: b.document.kind ?? "working_paper" }
      );
    }

    const closure = b.action === "finalise" ? await finaliseFy(fy, b) : await getFyClosure(fy);
    const documents = await listFyDocuments(fy);
    return json({ fy, finalised: Boolean(closure && !closure.reopenedAt), closure, documentCount: documents.length });
  },
  { auth: false }
);
