import { api, json } from "@/lib/api";
import { getIncome, updateIncome, setIncomePaid, type IncomeInput } from "@/lib/income";
import { getAuditForEntity } from "@/lib/audit";

export const runtime = "nodejs";

export const GET = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const record = await getIncome(id);
  if (!record) return json({ error: "Not found" }, { status: 404 });
  const audit = await getAuditForEntity("income", id);
  return json({ income: record, audit });
});

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { input?: IncomeInput; datePaid?: string | null; editNote?: string };
  if (body.input) {
    return json({ income: await updateIncome(id, body.input, body.editNote ?? null) });
  }
  if (body.datePaid !== undefined) {
    return json({ income: await setIncomePaid(id, body.datePaid) });
  }
  return json({ error: "Nothing to update" }, { status: 400 });
});
