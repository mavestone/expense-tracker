import { api, json } from "@/lib/api";
import { confirmExpense } from "@/lib/expenses";

export const runtime = "nodejs";

export const POST = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const expense = await confirmExpense(id);
  return json({ expense });
});
