import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/expenses";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * Per-account settings. Only the monthly reminder for now — everything else
 * about an account is derived from the statements ingested against it.
 */
export const PATCH = api(async (req, ctx) => {
  const { id } = (await (ctx as { params: Promise<{ id: string }> }).params) ?? {};
  const body = (await req.json()) as { remindMonthly?: boolean };

  const d = await db();
  const [account] = await d
    .select()
    .from(schema.statementAccounts)
    .where(eq(schema.statementAccounts.id, id));
  if (!account) throw new NotFoundError("Account not found");

  if (typeof body.remindMonthly !== "boolean") return json({ account });

  await d.transaction(async (tx) => {
    await tx
      .update(schema.statementAccounts)
      .set({ remindMonthly: body.remindMonthly })
      .where(eq(schema.statementAccounts.id, id));
    await writeAudit(tx, [
      {
        entityType: "statement_account",
        entityId: id,
        action: "update",
        field: "remindMonthly",
        oldValue: String(account.remindMonthly),
        newValue: String(body.remindMonthly),
        note: `${account.label} monthly statement reminder`,
      },
    ]);
  });

  return json({ account: { ...account, remindMonthly: body.remindMonthly } });
});
