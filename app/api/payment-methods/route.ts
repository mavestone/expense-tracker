import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";

export const runtime = "nodejs";

export const GET = api(async () => {
  const d = await db();
  const paymentMethods = await d
    .select()
    .from(schema.paymentMethods)
    .orderBy(asc(schema.paymentMethods.sortOrder), asc(schema.paymentMethods.name));
  return json({ paymentMethods });
});

export const POST = api(async (req) => {
  const body = (await req.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) return json({ error: "Name is required." }, { status: 400 });
  const d = await db();
  const existing = await d.select().from(schema.paymentMethods);
  if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase()))
    return json({ error: "That payment method already exists." }, { status: 400 });
  const id = randomUUID();
  await d.insert(schema.paymentMethods).values({ id, name, sortOrder: Math.max(0, ...existing.map((p) => p.sortOrder)) + 1 });
  await writeAudit(d, [{ entityType: "payment_method", entityId: id, action: "create", newValue: name }]);
  const [paymentMethod] = await d.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.id, id));
  return json({ paymentMethod }, { status: 201 });
});
