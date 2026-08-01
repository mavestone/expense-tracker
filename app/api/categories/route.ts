import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";

export const runtime = "nodejs";

export const GET = api(async () => {
  const d = await db();
  const categories = await d.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
  return json({ categories });
});

export const POST = api(async (req) => {
  const body = (await req.json()) as { name?: string; isEquipment?: boolean };
  const name = body.name?.trim();
  if (!name) return json({ error: "Category name is required." }, { status: 400 });
  const d = await db();
  const existing = await d.select().from(schema.categories);
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase()))
    return json({ error: "A category with that name already exists." }, { status: 400 });
  const id = randomUUID();
  await d.insert(schema.categories).values({
    id,
    name,
    isEquipment: !!body.isEquipment,
    sortOrder: Math.max(0, ...existing.map((c) => c.sortOrder)) + 1,
  });
  await writeAudit(d, [{ entityType: "category", entityId: id, action: "create", newValue: name }]);
  const [category] = await d.select().from(schema.categories).where(eq(schema.categories.id, id));
  return json({ category }, { status: 201 });
});
