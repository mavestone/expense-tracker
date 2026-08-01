import { api, json } from "@/lib/api";
import { voidExpense } from "@/lib/expenses";

export const runtime = "nodejs";

export const POST = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { reason?: string };
  const expense = await voidExpense(id, body.reason ?? "");
  return json({ expense });
});
