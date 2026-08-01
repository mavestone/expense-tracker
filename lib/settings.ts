import { eq } from "drizzle-orm";
import { db, schema, DEFAULT_SETTINGS } from "./db";

export type AppSettings = {
  business_name: string;
  receipt_required_over_cents: number;
  gst_receipt_flag_cents: number;
  subscription_stale_days: number;
  ocr_enabled: boolean;
};

export async function getSettings(): Promise<AppSettings> {
  const d = await db();
  const rows = await d.select().from(schema.settings);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out as AppSettings;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const d = await db();
  const json = JSON.stringify(value);
  const existing = await d.select().from(schema.settings).where(eq(schema.settings.key, key));
  if (existing.length > 0) {
    await d.update(schema.settings).set({ value: json }).where(eq(schema.settings.key, key));
  } else {
    await d.insert(schema.settings).values({ key, value: json });
  }
}
