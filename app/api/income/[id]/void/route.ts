import { api, json } from "@/lib/api";
import { voidIncome } from "@/lib/income";

export const runtime = "nodejs";

export const POST = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { reason?: string };
  return json({ income: await voidIncome(id, body.reason ?? "") });
});
