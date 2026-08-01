import { api, json } from "@/lib/api";
import { createExpense, listExpenses, type ExpenseFilters, type ExpenseInput } from "@/lib/expenses";
import type { BasQuarter } from "@/lib/fy";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const url = new URL(req.url);
  const p = url.searchParams;
  const filters: ExpenseFilters = {
    fy: p.get("fy") || undefined,
    quarter: (p.get("quarter") as BasQuarter) || undefined,
    categoryId: p.get("categoryId") || undefined,
    status: p.get("status") ? (p.get("status")!.split(",") as ("draft" | "active" | "void")[]) : undefined,
    capitalOnly: p.get("capital") === "1",
    missingReceiptOnly: p.get("missingReceipt") === "1",
    pendingFxOnly: p.get("pendingFx") === "1",
    search: p.get("q") || undefined,
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    offset: p.get("offset") ? Number(p.get("offset")) : undefined,
  };
  return json(await listExpenses(filters));
});

export const POST = api(async (req) => {
  const body = (await req.json()) as { input: ExpenseInput };
  const expense = await createExpense(body.input, { status: "active", source: "manual", resolveFx: true });
  return json({ expense }, { status: 201 });
});
