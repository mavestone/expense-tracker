import { api } from "@/lib/api";
import { getFyDocument } from "@/lib/fy-close";
import { getReceiptBytes } from "@/lib/storage";
import { NotFoundError } from "@/lib/expenses";

export const runtime = "nodejs";

export const GET = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const doc = await getFyDocument(id);
  if (!doc) throw new NotFoundError("Document not found");
  const buf = await getReceiptBytes(doc);
  // Inline for anything a browser renders; the ?download=1 form forces a save.
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.originalFilename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});
