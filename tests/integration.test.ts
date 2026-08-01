import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * End-to-end service test against a real (temp) SQLite database:
 * migrations, seed, expense lifecycle with audit, receipt immutability,
 * FX freezing, subscriptions, reports, CSV export and backup.
 */

let T: {
  createExpense: typeof import("../lib/expenses").createExpense;
  updateExpense: typeof import("../lib/expenses").updateExpense;
  voidExpense: typeof import("../lib/expenses").voidExpense;
  confirmExpense: typeof import("../lib/expenses").confirmExpense;
  getExpense: typeof import("../lib/expenses").getExpense;
  listExpenses: typeof import("../lib/expenses").listExpenses;
  addReceipt: typeof import("../lib/receipts").addReceipt;
  listReceipts: typeof import("../lib/receipts").listReceipts;
  getAuditForEntity: typeof import("../lib/audit").getAuditForEntity;
  createSubscription: typeof import("../lib/subscriptions").createSubscription;
  ensureRenewalDrafts: typeof import("../lib/subscriptions").ensureRenewalDrafts;
  subscriptionOverview: typeof import("../lib/subscriptions").subscriptionOverview;
  categorySummary: typeof import("../lib/reports").categorySummary;
  gstSummary: typeof import("../lib/reports").gstSummary;
  depreciationSchedule: typeof import("../lib/reports").depreciationSchedule;
  missingReceipts: typeof import("../lib/reports").missingReceipts;
  exportExpensesCsv: typeof import("../lib/csv").exportExpensesCsv;
  buildBackupStream: typeof import("../lib/backup").buildBackupStream;
  db: typeof import("../lib/db").db;
  schema: typeof import("../lib/db").schema;
};

let softwareCatId = "";
let cameraCatId = "";

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-test-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  process.env.DATA_DIR = dir;
  process.env.STORAGE_DRIVER = "local";
  process.env.APP_TIMEZONE = "Australia/Sydney";

  const [expenses, receipts, audit, subs, reports, csv, backup, dbmod] = await Promise.all([
    import("../lib/expenses"),
    import("../lib/receipts"),
    import("../lib/audit"),
    import("../lib/subscriptions"),
    import("../lib/reports"),
    import("../lib/csv"),
    import("../lib/backup"),
    import("../lib/db"),
  ]);
  T = { ...expenses, ...receipts, ...audit, ...subs, ...reports, ...csv, ...backup, db: dbmod.db, schema: dbmod.schema } as typeof T;

  const d = await T.db();
  const cats = await d.select().from(T.schema.categories);
  softwareCatId = cats.find((c) => c.name === "Software & Subscriptions")!.id;
  cameraCatId = cats.find((c) => c.name === "Camera & Lens Equipment")!.id;
});

describe("expense lifecycle", () => {
  let id = "";

  it("creates an AUD expense with GST defaulting to 1/11", async () => {
    const e = await T.createExpense({
      dateIncurred: "2025-09-14",
      supplierName: "Officeworks",
      supplierAbn: "51824753556",
      description: "SSD enclosure",
      categoryId: cameraCatId,
      originalAmountCents: 11000,
      originalCurrency: "AUD",
      gstTreatment: "gst",
      businessUseBp: 10000,
    });
    id = e.id;
    expect(e.audAmountCents).toBe(11000);
    expect(e.gstAmountCents).toBe(1000);
    expect(e.deductibleAudCents).toBe(11000);
    expect(e.financialYear).toBe("2025-26");
    expect(e.fxStatus).toBe("na");
    expect(e.status).toBe("active");
  });

  it("creates a USD expense with a provided (frozen) rate", async () => {
    const e = await T.createExpense({
      dateIncurred: "2025-08-02", // a Saturday — rate date differs
      supplierName: "Adobe",
      description: "Creative Cloud",
      categoryId: softwareCatId,
      originalAmountCents: 5999,
      originalCurrency: "USD",
      fxMode: "auto",
      fxRate: "1.52835000",
      fxRateSource: "RBA daily exchange rate",
      fxRateDate: "2025-08-01",
      gstTreatment: "gst_free",
      businessUseBp: 10000,
    });
    expect(e.audAmountCents).toBe(9169); // 5999 * 1.52835 = 9168.57 -> 9169
    expect(e.fxRate).toBe("1.52835000");
    expect(e.fxRateDate).toBe("2025-08-01");
    expect(e.gstAmountCents).toBe(0);
    expect(e.financialYear).toBe("2025-26");
  });

  it("requires a note for manual FX overrides", async () => {
    await expect(
      T.createExpense({
        dateIncurred: "2025-08-02",
        supplierName: "B&H",
        description: "Lens filter",
        categoryId: cameraCatId,
        originalAmountCents: 10000,
        originalCurrency: "USD",
        fxMode: "manual",
        fxRate: "1.50",
        gstTreatment: "gst_free",
        businessUseBp: 10000,
      })
    ).rejects.toThrow(/note is required/i);
  });

  it("records field-level edit history with old and new values", async () => {
    await T.updateExpense(
      id,
      {
        dateIncurred: "2025-09-14",
        supplierName: "Officeworks",
        supplierAbn: "51824753556",
        description: "SSD enclosure (USB-C)",
        categoryId: cameraCatId,
        originalAmountCents: 11000,
        originalCurrency: "AUD",
        gstTreatment: "gst",
        businessUseBp: 8000, // now 80% business use
      },
      "Corrected business use"
    );
    const e = (await T.getExpense(id))!;
    expect(e.businessUseBp).toBe(8000);
    expect(e.deductibleAudCents).toBe(8800);
    const audit = await T.getAuditForEntity("expense", id);
    const fields = audit.filter((a) => a.action === "update").map((a) => a.field);
    expect(fields).toContain("businessUseBp");
    expect(fields).toContain("deductibleAudCents");
    expect(fields).toContain("description");
    const bu = audit.find((a) => a.field === "businessUseBp")!;
    expect(bu.oldValue).toBe("10000");
    expect(bu.newValue).toBe("8000");
    expect(bu.note).toBe("Corrected business use");
  });

  it("voids instead of deleting, keeps the record readable", async () => {
    const tmp = await T.createExpense({
      dateIncurred: "2025-10-01",
      supplierName: "Duplicate Pty Ltd",
      description: "Accidental duplicate",
      categoryId: softwareCatId,
      originalAmountCents: 5000,
      originalCurrency: "AUD",
      gstTreatment: "gst",
      businessUseBp: 10000,
    });
    const voided = await T.voidExpense(tmp.id, "Duplicate entry");
    expect(voided.status).toBe("void");
    expect(voided.voidReason).toBe("Duplicate entry");
    const list = await T.listExpenses({ status: ["void"] });
    expect(list.expenses.some((e) => e.id === tmp.id)).toBe(true);
    await expect(T.voidExpense(tmp.id, "again")).rejects.toThrow(/already void/i);
    await expect(
      T.updateExpense(tmp.id, {
        dateIncurred: "2025-10-01",
        supplierName: "X",
        description: "Y",
        categoryId: softwareCatId,
        originalAmountCents: 5000,
        originalCurrency: "AUD",
        gstTreatment: "gst",
        businessUseBp: 10000,
      })
    ).rejects.toThrow(/cannot be edited/i);
  });

  it("stores immutable receipt versions", async () => {
    const v1 = Buffer.from("FAKE-RECEIPT-V1");
    const v2 = Buffer.from("FAKE-RECEIPT-V2-DIFFERENT");
    const r1 = await T.addReceipt(id, { buffer: v1, filename: "receipt.png", mime: "image/png" });
    expect(r1.version).toBe(1);
    expect(r1.isCurrent).toBe(true);
    const r2 = await T.addReceipt(id, { buffer: v2, filename: "receipt-fixed.png", mime: "image/png" });
    expect(r2.version).toBe(2);
    const all = await T.listReceipts(id);
    expect(all.length).toBe(2);
    const old = all.find((r) => r.version === 1)!;
    expect(old.isCurrent).toBe(false);
    expect(old.replacedById).toBe(r2.id);
    // Old file still readable from disk
    const { getReceiptBytes } = await import("../lib/storage");
    expect((await getReceiptBytes(old)).toString()).toBe("FAKE-RECEIPT-V1");
    expect((await getReceiptBytes(r2)).toString()).toBe("FAKE-RECEIPT-V2-DIFFERENT");
    const audit = await T.getAuditForEntity("expense", id);
    expect(audit.some((a) => a.action === "receipt_add")).toBe(true);
    expect(audit.some((a) => a.action === "receipt_replace")).toBe(true);
  });
});

describe("capital assets & reports", () => {
  it("creates a capital asset and reports it in the depreciation schedule", async () => {
    await T.createExpense({
      dateIncurred: "2025-11-20",
      supplierName: "Georges Cameras",
      supplierAbn: "51824753556",
      description: "Sony FX6 body",
      categoryId: cameraCatId,
      originalAmountCents: 989900,
      originalCurrency: "AUD",
      gstTreatment: "gst",
      businessUseBp: 9000,
      isCapital: true,
      assetName: "Sony FX6",
      effectiveLifeYears: "5",
    });
    const sched = await T.depreciationSchedule("2025-26");
    const fx6 = sched.find((a) => a.assetName === "Sony FX6")!;
    expect(fx6).toBeTruthy();
    expect(fx6.costAudCents).toBe(989900);
    expect(fx6.businessUseBp).toBe(9000);
    expect(fx6.effectiveLifeYears).toBe("5");
  });

  it("produces a BAS-mapped GST summary with the $82.50 invoice rule", async () => {
    const gst = await T.gstSummary("2025-26");
    // Q1: Officeworks $110 (has receipt, GST $10, 80% business use -> 1B 800)
    const q1 = gst.quarters.find((q) => q.quarter === "Q1")!;
    expect(q1.oneBCents).toBe(800);
    expect(q1.g11Cents).toBeGreaterThan(0);
    // Q2: FX6 is capital -> G10 (90% of 989900 = 890910); GST 89991*0.9... but no receipt & > $82.50 -> excluded + flagged
    const q2 = gst.quarters.find((q) => q.quarter === "Q2")!;
    expect(q2.g10Cents).toBe(890910);
    expect(q2.flaggedNoInvoice.length).toBe(1);
    expect(q2.oneBCents).toBe(0);
    // GST = 1/11 of 989900 = 89991 (89990.90 rounds up); 90% business use = 80991.9 -> 80992
    expect(q2.excludedGstCents).toBe(80992);
  });

  it("category summary adds up", async () => {
    const cat = await T.categorySummary("2025-26");
    expect(cat.totals.count).toBeGreaterThanOrEqual(3);
    const camera = cat.categories.find((c) => c.category === "Camera & Lens Equipment")!;
    expect(camera.audCents).toBe(11000 + 989900);
  });

  it("missing receipts report lists records without attachments", async () => {
    const missing = await T.missingReceipts("2025-26");
    expect(missing.some((m) => m.supplier === "Georges Cameras" && m.severity === "gst_invoice_required")).toBe(true);
    expect(missing.some((m) => m.supplier === "Officeworks")).toBe(false); // has receipt
  });
});

describe("subscriptions", () => {
  it("generates confirmable drafts for every due renewal and flags stale ones", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const fourMonthsAgo = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    await T.createSubscription({
      vendor: "Frame.io",
      amountCents: 1500,
      currency: "USD",
      frequency: "monthly",
      nextRenewalDate: fourMonthsAgo,
      businessUseBp: 10000,
      categoryId: softwareCatId,
      gstTreatment: "gst_free",
    });
    const { generated } = await T.ensureRenewalDrafts();
    expect(generated).toBeGreaterThanOrEqual(4); // ~4 months of missed renewals
    // Idempotent
    const again = await T.ensureRenewalDrafts();
    expect(again.generated).toBe(0);

    const overview = await T.subscriptionOverview();
    const sub = overview.subscriptions.find((s) => s.vendor === "Frame.io")!;
    expect(sub.pendingDraftCount).toBeGreaterThanOrEqual(4);
    expect(sub.stale).toBe(true); // oldest draft is ~120 days unconfirmed
    expect(sub.nextRenewalDate > today).toBe(true);

    // Drafts never appear in reports until confirmed
    const gst = await T.gstSummary("2025-26");
    const flat = gst.quarters.flatMap((q) => q.flaggedNoInvoice.map((f) => f.supplier));
    expect(flat).not.toContain("Frame.io");
  });

  it("confirming a draft makes it an active expense", async () => {
    const list = await T.listExpenses({ status: ["draft"] });
    const draft = list.expenses.find((e) => e.supplierName === "Frame.io")!;
    expect(draft).toBeTruthy();
    const confirmed = await T.confirmExpense(draft.id);
    expect(confirmed.status).toBe("active");
    const audit = await T.getAuditForEntity("expense", draft.id);
    expect(audit.some((a) => a.action === "confirm")).toBe(true);
  });
});

describe("exports", () => {
  it("produces accountant-ready CSV with BOM, CRLF and all fields", async () => {
    const csv = await T.exportExpensesCsv({ fy: "2025-26" });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    const lines = csv.slice(1).split("\r\n").filter(Boolean);
    expect(lines[0]).toContain("Date,Supplier,Supplier ABN");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(csv).toContain("14/09/2025"); // AU date format
    expect(csv).toContain("Sony FX6");
    expect(csv).toContain("GST included (claimable)");
  });

  it("builds a full backup zip with data.json and receipt files", async () => {
    const { stream, filename } = await T.buildBackupStream();
    expect(filename).toMatch(/expense-backup-full-/);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.slice(0, 2).toString()).toBe("PK"); // zip magic
    const text = buf.toString("latin1");
    expect(text).toContain("data.json");
    expect(text).toContain("manifest.json");
    expect(text).toContain("receipts/");
  });
});
