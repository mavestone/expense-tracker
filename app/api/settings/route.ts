import { api, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { getSettings, setSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import { isAccountingBasis } from "@/lib/basis";
import { eq, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export const GET = api(async () => {
  const d = await db();
  const [settings, thresholds] = await Promise.all([
    getSettings(),
    d.select().from(schema.fyThresholds).orderBy(asc(schema.fyThresholds.fyLabel)),
  ]);
  return json({ settings, thresholds });
});

const EDITABLE_SETTINGS = new Set([
  "business_name",
  "receipt_required_over_cents",
  "gst_receipt_flag_cents",
  "subscription_stale_days",
  "ocr_enabled",
  "gst_registered",
  // Greeting + invoice branding. Free-text, and only ever rendered as text —
  // the invoice document escapes them like any other React child.
  "owner_name",
  "business_abn",
  "business_email",
  "business_address",
  "business_website",
  "invoice_terms_default",
  "pay_to_aud",
  "pay_to_usd",
  "pay_to_gbp",
  "invoice_footer",
]);

export const PATCH = api(async (req) => {
  const body = (await req.json()) as {
    settings?: Record<string, unknown>;
    thresholds?: {
      fyLabel: string;
      instantWriteoffCents?: number | null;
      incomeBasis?: string | null;
      note?: string | null;
    }[];
  };
  const d = await db();
  const before = await getSettings();

  if (body.settings) {
    for (const [key, value] of Object.entries(body.settings)) {
      if (!EDITABLE_SETTINGS.has(key)) continue;
      const old = (before as Record<string, unknown>)[key];
      if (old === value) continue;
      await setSetting(key, value);
      await writeAudit(d, [{ entityType: "settings", entityId: key, action: "update", field: key, oldValue: old, newValue: value }]);
    }
  }

  if (body.thresholds) {
    for (const t of body.thresholds) {
      if (!/^\d{4}-\d{2}$/.test(t.fyLabel)) return json({ error: `Invalid FY label: ${t.fyLabel}` }, { status: 400 });
      if (t.instantWriteoffCents != null && (!Number.isInteger(t.instantWriteoffCents) || t.instantWriteoffCents < 0))
        return json({ error: "Invalid threshold amount" }, { status: 400 });
      const [existing] = await d.select().from(schema.fyThresholds).where(eq(schema.fyThresholds.fyLabel, t.fyLabel));
      if (t.incomeBasis != null && !isAccountingBasis(t.incomeBasis))
        return json({ error: "Income basis must be accruals or cash." }, { status: 400 });
      const nextWriteoff =
        t.instantWriteoffCents !== undefined ? t.instantWriteoffCents : undefined;
      if (existing) {
        const nextBasis = t.incomeBasis ?? existing.incomeBasis;
        const nextThreshold = nextWriteoff !== undefined ? nextWriteoff : existing.instantWriteoffCents;
        if (
          existing.instantWriteoffCents !== nextThreshold ||
          existing.incomeBasis !== nextBasis ||
          existing.note !== (t.note ?? existing.note)
        ) {
          await d
            .update(schema.fyThresholds)
            .set({ instantWriteoffCents: nextThreshold, incomeBasis: nextBasis, note: t.note ?? existing.note })
            .where(eq(schema.fyThresholds.id, existing.id));
          await writeAudit(d, [
            {
              entityType: "fy_threshold",
              entityId: existing.id,
              action: "update",
              field: t.fyLabel,
              oldValue: existing.instantWriteoffCents,
              newValue: t.instantWriteoffCents,
              note: t.note ?? null,
            },
          ]);
        }
      } else {
        const id = randomUUID();
        await d.insert(schema.fyThresholds).values({ id, fyLabel: t.fyLabel, instantWriteoffCents: t.instantWriteoffCents, note: t.note ?? null });
        await writeAudit(d, [
          { entityType: "fy_threshold", entityId: id, action: "create", field: t.fyLabel, newValue: t.instantWriteoffCents },
        ]);
      }
    }
  }

  const d2 = await db();
  const [settings, thresholds] = await Promise.all([
    getSettings(),
    d2.select().from(schema.fyThresholds).orderBy(asc(schema.fyThresholds.fyLabel)),
  ]);
  return json({ settings, thresholds });
});
