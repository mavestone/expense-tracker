import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { currentFy, fyLabel } from "../fy";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

const g = globalThis as unknown as { __etDb?: Db; __etReady?: Promise<Db> };

function resolveUrl(): string {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  if (url.startsWith("file:")) {
    const p = url.slice("file:".length);
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    return "file:" + abs;
  }
  return url;
}

function createDb(): Db {
  const client = createClient({
    url: resolveUrl(),
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  return drizzle(client, { schema });
}

/** Get the database, running migrations + seed exactly once per process. */
export async function db(): Promise<Db> {
  if (g.__etDb) return g.__etDb;
  if (!g.__etReady) {
    g.__etReady = (async () => {
      const d = createDb();
      await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") });
      // Durability settings for local file databases (no-ops on hosted libSQL).
      try {
        await d.$client.execute("PRAGMA journal_mode=WAL");
        await d.$client.execute("PRAGMA busy_timeout=5000");
        await d.$client.execute("PRAGMA foreign_keys=ON");
      } catch {
        /* hosted libSQL manages these itself */
      }
      await seedIfEmpty(d);
      g.__etDb = d;
      return d;
    })();
  }
  return g.__etReady;
}

export const SEED_CATEGORIES: { name: string; isEquipment: boolean }[] = [
  { name: "Software & Subscriptions", isEquipment: false },
  { name: "Camera & Lens Equipment", isEquipment: true },
  { name: "Computer & Storage Hardware", isEquipment: true },
  { name: "Audio Equipment", isEquipment: true },
  { name: "Lighting & Grip", isEquipment: true },
  { name: "Travel & Accommodation", isEquipment: false },
  { name: "Meals (business)", isEquipment: false },
  { name: "Contractors & Freelancers", isEquipment: false },
  { name: "Stock Footage & Music Licensing", isEquipment: false },
  { name: "Insurance", isEquipment: false },
  { name: "Professional Fees", isEquipment: false },
  { name: "Phone & Internet", isEquipment: false },
  { name: "Bank & Merchant Fees", isEquipment: false },
  { name: "Other", isEquipment: false },
];

const SEED_PAYMENT_METHODS = [
  "Business debit card",
  "Business credit card",
  "Personal card (reimbursed)",
  "Bank transfer",
  "PayPal",
  "Cash",
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  business_name: "",
  // Receipts are required for any expense above this AUD amount (cents).
  receipt_required_over_cents: 8250,
  // GST credits over this amount (GST-inclusive) need a valid tax invoice.
  gst_receipt_flag_cents: 8250,
  subscription_stale_days: 60,
  ocr_enabled: true,
  // Whether the business is registered for GST. Drives GST on sales (1A) and
  // whether GST credits (1B) can be claimed at all. Confirm with your accountant.
  gst_registered: false,

  // Greeting on the overview page. Empty means greet without a name.
  owner_name: "",

  // ── Invoice branding ────────────────────────────────────────────────────
  // Everything that prints on an issued invoice. Held in settings rather than
  // hardcoded so the document can be corrected without a deploy.
  business_abn: "",
  business_email: "",
  business_address: "",
  business_phone: "",
  business_website: "",
  // Uploaded logo: JSON {driver,key,mime} written by the branding route, or "".
  invoice_logo: "",
  invoice_terms_default: "Payment within 14 days of the invoice date.",
  // Payment instructions, one block per currency the business invoices in.
  pay_to_aud: "",
  pay_to_usd: "",
  pay_to_gbp: "",
  invoice_footer: "",
};

async function seedIfEmpty(d: Db) {
  const existing = await d.select().from(schema.categories).limit(1);
  if (existing.length === 0) {
    await d.insert(schema.categories).values(
      SEED_CATEGORIES.map((c, i) => ({
        id: randomUUID(),
        name: c.name,
        isEquipment: c.isEquipment,
        sortOrder: i,
      }))
    );
    await d.insert(schema.paymentMethods).values(
      SEED_PAYMENT_METHODS.map((name, i) => ({ id: randomUUID(), name, sortOrder: i }))
    );
  }

  // Ensure default settings keys exist (never overwrite user values).
  const settingRows = await d.select().from(schema.settings);
  const have = new Set(settingRows.map((r) => r.key));
  const missing = Object.entries(DEFAULT_SETTINGS).filter(([k]) => !have.has(k));
  if (missing.length > 0) {
    await d.insert(schema.settings).values(missing.map(([key, value]) => ({ key, value: JSON.stringify(value) })));
  }

  // Ensure a threshold row exists for the current and previous FY (value
  // deliberately left empty — the user confirms it with their accountant).
  const fyNow = currentFy();
  const startYear = Number(fyNow.slice(0, 4));
  const wanted = [fyLabel(startYear - 1), fyNow];
  const thresholdRows = await d.select().from(schema.fyThresholds);
  const haveFy = new Set(thresholdRows.map((r) => r.fyLabel));
  const missingFy = wanted.filter((f) => !haveFy.has(f));
  if (missingFy.length > 0) {
    await d.insert(schema.fyThresholds).values(
      missingFy.map((f) => ({
        id: randomUUID(),
        fyLabel: f,
        instantWriteoffCents: null,
        note: "Confirm the instant asset write-off threshold with your accountant.",
      }))
    );
  }
}

export { schema };
