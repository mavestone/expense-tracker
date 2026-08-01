import { api, json } from "@/lib/api";
import { getExpense, updateExpense, expenseFlags, type ExpenseInput } from "@/lib/expenses";
import { listReceipts } from "@/lib/receipts";
import { getAuditForEntity } from "@/lib/audit";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export const GET = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const expense = await getExpense(id);
  if (!expense) return json({ error: "Not found" }, { status: 404 });
  const [receipts, audit] = await Promise.all([listReceipts(id), getAuditForEntity("expense", id)]);
  const d = await db();
  const [category] = await d.select().from(schema.categories).where(eq(schema.categories.id, expense.categoryId));
  const flags = await expenseFlags(expense, receipts.filter((r) => r.isCurrent).length);
  let subscription = null;
  if (expense.subscriptionId) {
    const [sub] = await d.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, expense.subscriptionId));
    subscription = sub ?? null;
  }
  return json({ expense, receipts, audit, flags, category: category ?? null, subscription });
});

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { input: ExpenseInput; editNote?: string };
  const expense = await updateExpense(id, body.input, body.editNote ?? null);
  return json({ expense });
});
