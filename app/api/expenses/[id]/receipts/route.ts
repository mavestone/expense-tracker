import { api, json } from "@/lib/api";
import { addReceipt, MAX_RECEIPT_BYTES } from "@/lib/receipts";

export const runtime = "nodejs";

export const POST = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > MAX_RECEIPT_BYTES) return json({ error: "File exceeds the 15 MB limit." }, { status: 413 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const receipt = await addReceipt(id, { buffer, filename: file.name || "receipt", mime: file.type || "application/octet-stream" });
  return json({ receipt }, { status: 201 });
});
