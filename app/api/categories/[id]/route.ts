import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { writeAudit, diffFields } from "@/lib/audit";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { name?: string; isEquipment?: boolean; archived?: boolean };
  const d = await db();
  const [existing] = await d.select().from(schema.categories).where(eq(schema.categories.id, id));
  if (!existing) return json({ error: "Category not found" }, { status: 404 });

  const patch: Partial<typeof existing> = {};
  if (body.name?.trim()) patch.name = body.name.trim();
  if (typeof body.isEquipment === "boolean") patch.isEquipment = body.isEquipment;
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  if (Object.keys(patch).length === 0) return json({ error: "Nothing to update" }, { status: 400 });

  const entries = diffFields("category", id, existing as unknown as Record<string, unknown>, patch, ["name", "isEquipment", "archived"]);
  await d.update(schema.categories).set(patch).where(eq(schema.categories.id, id));
  await writeAudit(d, entries);
  const [category] = await d.select().from(schema.categories).where(eq(schema.categories.id, id));
  return json({ category });
});
