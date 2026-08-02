import { api } from "@/lib/api";
import { getIncomeDocument } from "@/lib/income-documents";
import { getReceiptBytes } from "@/lib/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Invoice documents are served only through this authenticated route. */
export const GET = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const doc = await getIncomeDocument(id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await getReceiptBytes(doc);
  const disposition = new URL(req.url).searchParams.get("dl") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": doc.mime,
      "content-length": String(bytes.length),
      "content-disposition": `${disposition}; filename="${doc.originalFilename.replace(/[^\w.\- ]/g, "_")}"`,
      "cache-control": "private, max-age=3600",
      "x-document-sha256": doc.sha256,
    },
  });
});
