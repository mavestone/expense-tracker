import { api, json } from "@/lib/api";
import { createIncome, listIncome, type IncomeInput } from "@/lib/income";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const p = new URL(req.url).searchParams;
  return json(
    await listIncome({
      fy: p.get("fy") || undefined,
      status: p.get("status") ? (p.get("status")!.split(",") as ("active" | "void")[]) : undefined,
      outstandingOnly: p.get("outstanding") === "1",
      search: p.get("q") || undefined,
      limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    })
  );
});

export const POST = api(async (req) => {
  const body = (await req.json()) as { input: IncomeInput };
  const record = await createIncome(body.input, { source: "manual", resolveFx: true });
  return json({ income: record }, { status: 201 });
});
