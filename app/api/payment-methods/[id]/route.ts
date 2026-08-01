import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { writeAudit, diffFields } from "@/lib/audit";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { name?: string; archived?: boolean };
  const d = await db();
  const [existing] = await d.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.id, id));
  if (!existing) return json({ error: "Payment method not found" }, { status: 404 });
  const patch: Partial<typeof existing> = {};
  if (body.name?.trim()) patch.name = body.name.trim();
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, { status: 400 });
  const entries = diffFields("payment_method", id, existing as unknown as Record<string, unknown>, patch, ["name", "archived"]);
  await d.update(schema.paymentMethods).set(patch).where(eq(schema.paymentMethods.id, id));
  await writeAudit(d, entries);
  const [paymentMethod] = await d.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.id, id));
  return json({ paymentMethod });
});
