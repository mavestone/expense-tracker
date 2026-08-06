import { api, json } from "@/lib/api";
import { getFyClosure, finaliseFy, reopenFy, listFyDocuments, type FinaliseInput } from "@/lib/fy-close";
import { ValidationError } from "@/lib/expenses";

export const runtime = "nodejs";

export const GET = api(async (_req, ctx) => {
  const { fy } = await ctx.params;
  const [closure, documents] = await Promise.all([getFyClosure(fy), listFyDocuments(fy)]);
  return json({ fy, closure, finalised: Boolean(closure && !closure.reopenedAt), documents });
});

export const POST = api(async (req, ctx) => {
  const { fy } = await ctx.params;
  const body = (await req.json()) as { action: string; reason?: string } & FinaliseInput;
  switch (body.action) {
    case "finalise":
      return json({ closure: await finaliseFy(fy, body) });
    case "reopen":
      return json({ closure: await reopenFy(fy, body.reason ?? "") });
    default:
      throw new ValidationError([`Unknown action '${body.action}'.`]);
  }
});
