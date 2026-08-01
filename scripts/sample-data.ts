/**
 * Loads realistic sample data for trying the app out (media production
 * business flavour). Run with: npm run sample-data
 * Never run this against your real database — it's for evaluation only.
 */
import { db, schema } from "../lib/db";
import { createExpense } from "../lib/expenses";
import { addReceipt } from "../lib/receipts";
import { createSubscription, ensureRenewalDrafts } from "../lib/subscriptions";
import { setSetting } from "../lib/settings";
import { todayInTz, addDays, financialYear } from "../lib/fy";
import { eq } from "drizzle-orm";

// A tiny valid PNG (1x1 white pixel) used as a stand-in receipt image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function main() {
  const d = await db();
  const existing = await d.select({ id: schema.expenses.id }).from(schema.expenses).limit(1);
  if (existing.length > 0) {
    console.log("Database already has expenses — refusing to load sample data.");
    process.exit(1);
  }

  const cats = await d.select().from(schema.categories);
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const today = todayInTz();
  const fy = financialYear(today);
  const fyStartYear = Number(fy.slice(0, 4));

  // Set a sample instant asset write-off threshold for the current FY ($20,000)
  const [thr] = await d.select().from(schema.fyThresholds).where(eq(schema.fyThresholds.fyLabel, fy));
  if (thr) await d.update(schema.fyThresholds).set({ instantWriteoffCents: 2000000, note: "SAMPLE VALUE — confirm with accountant" }).where(eq(schema.fyThresholds.id, thr.id));
  await setSetting("business_name", "Sample Films Pty Ltd");

  const mk = (m: number, day: number) => {
    // month within FY: 7..12 = first calendar year, 1..6 = second
    const y = m >= 7 ? fyStartYear : fyStartYear + 1;
    const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return date > today ? null : date;
  };

  const rows: Array<Parameters<typeof createExpense>[0] & { receipt?: boolean }> = [];

  const d1 = mk(7, 3);
  if (d1) rows.push({ dateIncurred: d1, supplierName: "Officeworks", supplierAbn: "51824753556", description: "Backup drives x2 (4TB)", categoryId: cat("Computer & Storage Hardware"), originalAmountCents: 41800, originalCurrency: "AUD", gstTreatment: "gst", businessUseBp: 10000, paymentMethod: "Business debit card", receipt: true });
  const d2 = mk(7, 14);
  if (d2) rows.push({ dateIncurred: d2, supplierName: "Adobe", description: "Creative Cloud All Apps (monthly)", categoryId: cat("Software & Subscriptions"), originalAmountCents: 5999, originalCurrency: "USD", gstTreatment: "gst_free", businessUseBp: 10000, paymentMethod: "Business credit card" });
  const d3 = mk(8, 2);
  if (d3) rows.push({ dateIncurred: d3, supplierName: "B&H Photo Video", description: "Sigma 24-70mm f/2.8 lens", categoryId: cat("Camera & Lens Equipment"), originalAmountCents: 109900, originalCurrency: "USD", gstTreatment: "gst_free", businessUseBp: 10000, paymentMethod: "Business credit card", notes: "Bought in New York during client shoot", receipt: true });
  const d4 = mk(8, 18);
  if (d4) rows.push({ dateIncurred: d4, supplierName: "Georges Cameras", supplierAbn: "51824753556", description: "Sony FX6 camera body", categoryId: cat("Camera & Lens Equipment"), originalAmountCents: 1089000, originalCurrency: "AUD", gstTreatment: "gst", businessUseBp: 9000, isCapital: true, assetName: "Sony FX6", effectiveLifeYears: "5", paymentMethod: "Bank transfer", receipt: true });
  const d5 = mk(9, 9);
  if (d5) rows.push({ dateIncurred: d5, supplierName: "Qantas", supplierAbn: "16009661901", description: "SYD–SIN return, client shoot", categoryId: cat("Travel & Accommodation"), originalAmountCents: 142350, originalCurrency: "AUD", gstTreatment: "gst", businessUseBp: 10000, paymentMethod: "Business credit card", receipt: true });
  const d6 = mk(9, 12);
  if (d6) rows.push({ dateIncurred: d6, supplierName: "Grand Hyatt Singapore", description: "3 nights, client shoot", categoryId: cat("Travel & Accommodation"), originalAmountCents: 98500, originalCurrency: "SGD", gstTreatment: "gst_free", businessUseBp: 10000, paymentMethod: "Business credit card", receipt: true });
  const d7 = mk(10, 5);
  if (d7) rows.push({ dateIncurred: d7, supplierName: "Artlist", description: "Music licensing — annual", categoryId: cat("Stock Footage & Music Licensing"), originalAmountCents: 19900, originalCurrency: "USD", gstTreatment: "gst_free", businessUseBp: 10000, paymentMethod: "PayPal" });
  const d8 = mk(10, 22);
  if (d8) rows.push({ dateIncurred: d8, supplierName: "Telstra", supplierAbn: "33051775556", description: "Business mobile + data", categoryId: cat("Phone & Internet"), originalAmountCents: 12000, originalCurrency: "AUD", gstTreatment: "gst", businessUseBp: 8000, paymentMethod: "Bank transfer", receipt: true });
  const d9 = mk(11, 1);
  if (d9) rows.push({ dateIncurred: d9, supplierName: "BizCover", supplierAbn: "68127707975", description: "Public liability insurance (annual)", categoryId: cat("Insurance"), originalAmountCents: 89000, originalCurrency: "AUD", gstTreatment: "gst", businessUseBp: 10000, paymentMethod: "Business debit card" });

  for (const r of rows) {
    const { receipt, ...input } = r;
    const e = await createExpense(input, { resolveFx: true, auditNote: "Sample data" });
    if (receipt) await addReceipt(e.id, { buffer: PNG, filename: `receipt-${e.supplierName.toLowerCase().replace(/\W+/g, "-")}.png`, mime: "image/png" });
    console.log(`  + ${e.dateIncurred} ${e.supplierName} (${e.originalCurrency}) fx:${e.fxStatus}`);
  }

  // Subscriptions: one healthy, one overdue (stale flag demo)
  await createSubscription({ vendor: "Adobe", description: "Creative Cloud All Apps (monthly)", amountCents: 5999, currency: "USD", frequency: "monthly", nextRenewalDate: addDays(today, 12), businessUseBp: 10000, categoryId: cat("Software & Subscriptions"), gstTreatment: "gst_free", paymentMethod: "Business credit card" });
  await createSubscription({ vendor: "Frame.io", description: "Team plan", amountCents: 1500, currency: "USD", frequency: "monthly", nextRenewalDate: addDays(today, -75), businessUseBp: 10000, categoryId: cat("Software & Subscriptions"), gstTreatment: "gst_free", paymentMethod: "Business credit card" });
  const gen = await ensureRenewalDrafts();
  console.log(`  + 2 subscriptions, ${gen.generated} renewal drafts generated`);

  console.log("\nSample data loaded. Log in and explore.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
