import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/** Income ledger: FX, GST on sales, outstanding invoices, profit, BAS G1/1A. */

let T: {
  createIncome: typeof import("../lib/income").createIncome;
  updateIncome: typeof import("../lib/income").updateIncome;
  setIncomePaid: typeof import("../lib/income").setIncomePaid;
  voidIncome: typeof import("../lib/income").voidIncome;
  listIncome: typeof import("../lib/income").listIncome;
  incomeSummary: typeof import("../lib/income").incomeSummary;
  incomeByQuarter: typeof import("../lib/income").incomeByQuarter;
  getAuditForEntity: typeof import("../lib/audit").getAuditForEntity;
  setSetting: typeof import("../lib/settings").setSetting;
};

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "et-income-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  process.env.DATA_DIR = dir;
  process.env.STORAGE_DRIVER = "local";
  process.env.APP_TIMEZONE = "Australia/Sydney";
  const [income, audit, settings] = await Promise.all([
    import("../lib/income"),
    import("../lib/audit"),
    import("../lib/settings"),
  ]);
  T = { ...income, ...audit, ...settings } as typeof T;
});

describe("income — not GST registered (default)", () => {
  it("records AUD income with no GST", async () => {
    const r = await T.createIncome({
      dateEarned: "2026-02-22",
      datePaid: "2026-02-22",
      clientName: "Levee Pty Ltd",
      description: "Post production",
      incomeType: "client_work",
      originalAmountCents: 260150,
      originalCurrency: "AUD",
      gstTreatment: "no_gst",
    });
    expect(r.audAmountCents).toBe(260150);
    expect(r.gstAmountCents).toBe(0);
    expect(r.financialYear).toBe("2025-26");
    expect(r.datePaid).toBe("2026-02-22");
  });

  it("ignores a GST treatment when not registered", async () => {
    const r = await T.createIncome({
      dateEarned: "2026-03-01",
      clientName: "Someone",
      description: "Work",
      incomeType: "client_work",
      originalAmountCents: 11000,
      originalCurrency: "AUD",
      gstTreatment: "gst", // claims GST but registration is off
    });
    expect(r.gstAmountCents).toBe(0); // no GST collected if not registered
  });
});

describe("income — GST registered", () => {
  beforeAll(async () => {
    await T.setSetting("gst_registered", true);
  });

  it("computes 1/11 GST on sales", async () => {
    const r = await T.createIncome({
      dateEarned: "2026-04-15",
      clientName: "Aussie Client",
      description: "Brand film",
      incomeType: "client_work",
      originalAmountCents: 550000, // $5,500 incl GST
      originalCurrency: "AUD",
      gstTreatment: "gst",
    });
    expect(r.gstAmountCents).toBe(50000); // $500
  });

  it("treats GST-free sales as zero GST", async () => {
    const r = await T.createIncome({
      dateEarned: "2026-04-16",
      clientName: "Overseas Client",
      description: "Export of services",
      incomeType: "client_work",
      originalAmountCents: 100000,
      originalCurrency: "AUD",
      gstTreatment: "gst_free",
    });
    expect(r.gstAmountCents).toBe(0);
  });

  it("converts foreign income with a frozen rate", async () => {
    const r = await T.createIncome({
      dateEarned: "2026-06-01",
      clientName: "Kirin Consulting",
      description: "Consulting retainer",
      incomeType: "client_work",
      originalAmountCents: 300000, // USD 3,000
      originalCurrency: "USD",
      fxMode: "auto",
      fxRate: "1.39120667",
      fxRateSource: "RBA daily exchange rate",
      fxRateDate: "2026-06-01",
      gstTreatment: "gst_free",
    });
    expect(r.audAmountCents).toBe(417362); // 300000 * 1.39120667
    expect(r.fxRate).toBe("1.39120667");
    expect(r.fxRateDate).toBe("2026-06-01");
  });
});

describe("outstanding invoices", () => {
  let unpaidId = "";
  it("tracks unpaid invoices", async () => {
    const r = await T.createIncome({
      dateEarned: "2026-05-10",
      clientName: "Slow Payer Pty Ltd",
      invoiceRef: "INV-021",
      description: "Edit + grade",
      incomeType: "client_work",
      originalAmountCents: 220000,
      originalCurrency: "AUD",
      gstTreatment: "gst",
    });
    unpaidId = r.id;
    expect(r.datePaid).toBeNull();
    const list = await T.listIncome({ outstandingOnly: true });
    expect(list.income.some((x) => x.id === unpaidId)).toBe(true);
    expect(list.outstanding.count).toBeGreaterThanOrEqual(1);
  });

  it("marks paid and audits the change", async () => {
    const paid = await T.setIncomePaid(unpaidId, "2026-06-20");
    expect(paid.datePaid).toBe("2026-06-20");
    const audit = await T.getAuditForEntity("income", unpaidId);
    expect(audit.some((a) => a.field === "datePaid" && a.newValue === "2026-06-20")).toBe(true);
    const list = await T.listIncome({ outstandingOnly: true });
    expect(list.income.some((x) => x.id === unpaidId)).toBe(false);
  });
});

describe("integrity", () => {
  it("voids instead of deleting, and blocks edits after void", async () => {
    const r = await T.createIncome({
      dateEarned: "2026-05-01",
      clientName: "Mistake Co",
      description: "Duplicate",
      incomeType: "other",
      originalAmountCents: 5000,
      originalCurrency: "AUD",
      gstTreatment: "no_gst",
    });
    const v = await T.voidIncome(r.id, "Duplicate entry");
    expect(v.status).toBe("void");
    expect(v.voidReason).toBe("Duplicate entry");
    const visible = await T.listIncome({ status: ["void"] });
    expect(visible.income.some((x) => x.id === r.id)).toBe(true);
    await expect(T.setIncomePaid(r.id, "2026-05-02")).rejects.toThrow(/void/i);
  });

  it("records field-level edit history", async () => {
    const r = await T.createIncome({
      dateEarned: "2026-05-05",
      clientName: "Typo Client",
      description: "Job",
      incomeType: "client_work",
      originalAmountCents: 10000,
      originalCurrency: "AUD",
      gstTreatment: "no_gst",
    });
    await T.updateIncome(
      r.id,
      {
        dateEarned: "2026-05-05",
        clientName: "Correct Client",
        description: "Job",
        incomeType: "client_work",
        originalAmountCents: 12000,
        originalCurrency: "AUD",
        gstTreatment: "no_gst",
      },
      "Fixed client name and amount"
    );
    const audit = await T.getAuditForEntity("income", r.id);
    const nameChange = audit.find((a) => a.field === "clientName")!;
    expect(nameChange.oldValue).toBe("Typo Client");
    expect(nameChange.newValue).toBe("Correct Client");
    expect(nameChange.note).toBe("Fixed client name and amount");
  });
});

describe("reporting", () => {
  it("summarises by client and type, excluding voids", async () => {
    const s = await T.incomeSummary("2025-26");
    expect(s.byClient.some((c) => c.client === "Levee Pty Ltd")).toBe(true);
    expect(s.byClient.some((c) => c.client === "Mistake Co")).toBe(false); // voided
    expect(s.totals.audCents).toBeGreaterThan(0);
  });

  it("maps income to BAS quarters (G1 / 1A)", async () => {
    const q = await T.incomeByQuarter("2025-26");
    // Feb 2026 = Q3, Apr–Jun 2026 = Q4
    expect(q.Q3.g1Cents).toBeGreaterThanOrEqual(260150);
    expect(q.Q4.g1Cents).toBeGreaterThanOrEqual(550000);
    expect(q.Q4.oneACents).toBeGreaterThanOrEqual(50000); // GST collected on the $5,500 job
    expect(q.Q1.g1Cents).toBe(0);
  });
});
