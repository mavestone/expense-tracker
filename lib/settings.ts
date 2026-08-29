import { eq } from "drizzle-orm";
import { db, schema, DEFAULT_SETTINGS } from "./db";

export type AppSettings = {
  business_name: string;
  receipt_required_over_cents: number;
  gst_receipt_flag_cents: number;
  subscription_stale_days: number;
  ocr_enabled: boolean;
  gst_registered: boolean;

  owner_name: string;
  business_abn: string;
  business_email: string;
  business_phone: string;
  business_address: string;
  business_website: string;
  invoice_logo: string;
  invoice_terms_default: string;
  pay_to_aud: string;
  pay_to_usd: string;
  pay_to_gbp: string;
  invoice_footer: string;
};

/** The currencies invoices can be issued in. */
export const INVOICE_CURRENCIES = ["AUD", "USD", "GBP"] as const;
export type InvoiceCurrency = (typeof INVOICE_CURRENCIES)[number];

/** Payment instructions for the currency an invoice is issued in. */
export function payToFor(s: AppSettings, currency: string): string {
  const key = `pay_to_${currency.toLowerCase()}` as keyof AppSettings;
  return (s[key] as string) || "";
}

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
