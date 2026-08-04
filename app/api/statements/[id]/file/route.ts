import { api } from "@/lib/api";
import { getStatementFile } from "@/lib/statements";

export const runtime = "nodejs";

/** Download the original statement PDF — the evidence behind the parsed lines. */
export const GET = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const { buffer, filename, mime } = await getStatementFile(id);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": mime,
      "content-disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "content-length": String(buffer.length),
      "cache-control": "private, max-age=300",
    },
  });
});
