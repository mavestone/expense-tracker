import { api, json } from "@/lib/api";
import { addFyDocument, listFyDocuments } from "@/lib/fy-close";
import { ValidationError } from "@/lib/expenses";

export const runtime = "nodejs";

export const GET = api(async (_req, ctx) => {
  const { fy } = await ctx.params;
  return json({ documents: await listFyDocuments(fy) });
});

export const POST = api(async (req, ctx) => {
  const { fy } = await ctx.params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError(["A file is required."]);
  const doc = await addFyDocument(
    fy,
    { filename: file.name, mime: file.type || "application/octet-stream", bytes: Buffer.from(await file.arrayBuffer()) },
    {
      title: (form.get("title") as string) || null,
      description: (form.get("description") as string) || null,
      kind: (form.get("kind") as string) || "working_paper",
    }
  );
  return json({ document: doc }, { status: 201 });
});
