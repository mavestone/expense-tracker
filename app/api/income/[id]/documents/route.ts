import { api, json } from "@/lib/api";
import { addIncomeDocument, MAX_DOC_BYTES } from "@/lib/income-documents";

export const runtime = "nodejs";

export const POST = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file uploaded." }, { status: 400 });
  if (file.size > MAX_DOC_BYTES) return json({ error: "File exceeds the 15 MB limit." }, { status: 413 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const doc = await addIncomeDocument(id, {
    buffer,
    filename: file.name || "invoice",
    mime: file.type || "application/octet-stream",
  });
  return json({ document: doc }, { status: 201 });
});
