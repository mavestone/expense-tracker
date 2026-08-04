import { api, json } from "@/lib/api";
import { deleteStatement } from "@/lib/statements";

export const runtime = "nodejs";

export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json(await deleteStatement(id));
});
