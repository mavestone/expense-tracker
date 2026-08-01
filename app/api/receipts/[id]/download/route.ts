import { api } from "@/lib/api";
import { getReceipt } from "@/lib/receipts";
import { getReceiptBytes } from "@/lib/storage";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Receipts are served only through this authenticated route — storage URLs
 * are never exposed to the browser. */
export const GET = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const receipt = await getReceipt(id);
  if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await getReceiptBytes(receipt);
  const disposition = new URL(req.url).searchParams.get("dl") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": receipt.mime,
      "content-length": String(bytes.length),
      "content-disposition": `${disposition}; filename="${receipt.originalFilename.replace(/[^\w.\- ]/g, "_")}"`,
      "cache-control": "private, max-age=3600",
      "x-receipt-sha256": receipt.sha256,
    },
  });
});
