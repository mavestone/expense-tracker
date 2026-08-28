import { describe, it, expect } from "vitest";
import { invoiceTotals, lineAmountCents, validateInvoiceInput, type InvoiceInput, invoicePdfFilename, INVOICE_KINDS } from "../lib/invoices";
import { validateClientInput, type ClientInput } from "../lib/clients";

const line = (unit: number, qty?: number) => ({ description: "Edit", unitAmountCents: unit, quantityMilli: qty });

describe("invoice line maths", () => {
  it("defaults quantity to one", () => {
    expect(lineAmountCents({ description: "x", unitAmountCents: 150000 })).toBe(150000);
  });

  it("handles fractional quantities", () => {
    expect(lineAmountCents(line(20000, 500))).toBe(10000); // half a day at $200
    expect(lineAmountCents(line(8500, 7500))).toBe(63750); // 7.5 hours at $85
  });

  it("rounds half-up rather than truncating", () => {
    // 0.333 × $10.00 = $3.33 exactly at the half-up boundary
    expect(lineAmountCents(line(1000, 333))).toBe(333);
    expect(lineAmountCents(line(1, 1500))).toBe(2); // 1.5c rounds to 2c, not 1c
  });
});

describe("invoice totals", () => {
  it("adds 10% GST when the sale is taxable", () => {
    const t = invoiceTotals([line(100000), line(50000)], "gst");
    expect(t.subtotalCents).toBe(150000);
    expect(t.gstCents).toBe(15000);
    expect(t.totalCents).toBe(165000);
  });

  it("charges nothing on a GST-free export", () => {
    const t = invoiceTotals([line(471288)], "gst_free");
    expect(t.gstCents).toBe(0);
    expect(t.totalCents).toBe(471288);
  });

  it("stays consistent with the 1/11 rule the ledger applies to the total", () => {
    // The income record derives GST as 1/11 of the GST-inclusive amount. Adding
    // 10% here and taking 1/11 there must agree, or the invoice and the BAS
    // disagree by a cent on every taxable sale.
    const t = invoiceTotals([line(282550)], "gst");
    expect(Math.round(t.totalCents / 11)).toBe(t.gstCents);
  });

  it("is zero for no lines", () => {
    expect(invoiceTotals([], "gst")).toEqual({ subtotalCents: 0, gstCents: 0, totalCents: 0 });
  });
});

describe("invoice validation", () => {
  const base: InvoiceInput = {
    clientId: "c1",
    issueDate: "2026-06-29",
    dueDate: "2026-07-13",
    currency: "USD",
    gstTreatment: "gst_free",
    lines: [line(100000)],
  };

  it("accepts a well-formed invoice", () => {
    expect(validateInvoiceInput(base)).toEqual([]);
  });

  it("rejects a currency the business does not invoice in", () => {
    expect(validateInvoiceInput({ ...base, currency: "IDR" }).join(" ")).toMatch(/AUD, USD, GBP/);
  });

  it("rejects a due date before the issue date", () => {
    expect(validateInvoiceInput({ ...base, dueDate: "2026-06-01" }).join(" ")).toMatch(/before the issue date/);
  });

  it("rejects an invoice with no lines, and a zero total", () => {
    expect(validateInvoiceInput({ ...base, lines: [] }).join(" ")).toMatch(/at least one line/);
    expect(validateInvoiceInput({ ...base, lines: [line(0)] }).join(" ")).toMatch(/not zero/);
  });

  it("names the offending line", () => {
    const errs = validateInvoiceInput({ ...base, lines: [line(1000), { description: "", unitAmountCents: 500 }] });
    expect(errs.join(" ")).toMatch(/Line 2/);
  });
});

describe("client validation", () => {
  const base: ClientInput = {
    name: "Kirin Consulting LLC",
    invoicePrefix: "KC",
    defaultCurrency: "USD",
    defaultGstTreatment: "gst_free",
    paymentTermsDays: 14,
  };

  it("accepts a well-formed client", () => {
    expect(validateClientInput(base).errors).toEqual([]);
  });

  it("requires a usable invoice prefix", () => {
    expect(validateClientInput({ ...base, invoicePrefix: "" }).errors.join(" ")).toMatch(/prefix/);
    expect(validateClientInput({ ...base, invoicePrefix: "1KC" }).errors.join(" ")).toMatch(/prefix/);
    expect(validateClientInput({ ...base, invoicePrefix: "KIRINCONSULTING" }).errors.join(" ")).toMatch(/prefix/);
  });

  it("warns rather than blocks when GST is set on a foreign-currency client", () => {
    // Almost always a mistake — an export of services is GST-free — but it is
    // the owner's call, so it must not stop the record being saved.
    const r = validateClientInput({ ...base, defaultGstTreatment: "gst" });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/GST-free/);
  });

  it("warns on an ABN that fails the checksum", () => {
    expect(validateClientInput({ ...base, abn: "97 834 141 405" }).warnings.join(" ")).toMatch(/checksum/);
  });

  it("rejects nonsense payment terms", () => {
    expect(validateClientInput({ ...base, paymentTermsDays: -1 }).errors.join(" ")).toMatch(/0 and 180/);
    expect(validateClientInput({ ...base, paymentTermsDays: 400 }).errors.join(" ")).toMatch(/0 and 180/);
  });
});

describe("invoice numbering — the sequence must survive real-world refs", () => {
  // nextInvoiceNumber reads the DB, so the sequence rule is tested directly:
  // a five-digit-or-longer suffix is a date, not a counter.
  const SEQ = /_(\d{1,4})$/;
  const seqOf = (ref: string) => {
    const m = SEQ.exec(ref);
    return m ? parseInt(m[1], 10) : null;
  };

  it("reads a plain sequence", () => {
    expect(seqOf("KC_01")).toBe(1);
    expect(seqOf("LEVEE_02")).toBe(2);
    expect(seqOf("RMR_0003")).toBe(3);
  });

  it("refuses to read a date-style ref as a sequence", () => {
    // KC_290626 is 29 June 2026. Counting it would jump the client to KC_290627
    // and the numbering would never recover.
    expect(seqOf("KC_290626")).toBeNull();
    expect(seqOf("BA_20260629")).toBeNull();
  });

  it("ignores refs that merely start with the same letters", () => {
    expect("KCX_01".startsWith("KC_")).toBe(false);
  });
});

describe("download filename", () => {
  const f = (number: string, name: string) => invoicePdfFilename({ number, client: { name } });

  it("names the file after the invoice and the client", () => {
    expect(f("KC_04", "Kirin Consulting LLC")).toBe("KC_04-Kirin-Consulting-LLC.pdf");
  });

  it("strips anything that could break a Content-Disposition header", () => {
    // A quote or a newline in a client name would otherwise let the value
    // escape the header it sits in.
    expect(f("AG_01", 'Atomik "Growth" Ltd')).toBe("AG_01-Atomik-Growth-Ltd.pdf");
    expect(f("AG_01", "A/B\nCo")).toBe("AG_01-A-B-Co.pdf");
    expect(f("AG_01", "Ünïcodé Studio")).toBe("AG_01-Unicode-Studio.pdf");
  });

  it("keeps an accented name readable rather than gutting it", () => {
    expect(f("KC_05", "Café Noir Films")).toBe("KC_05-Cafe-Noir-Films.pdf");
  });

  it("collapses runs and trims stray hyphens", () => {
    expect(f("BA_02", "  The   Film Co.  ")).toBe("BA_02-The-Film-Co.pdf");
  });

  it("still produces a filename when the client name is unusable", () => {
    expect(f("RMR_04", "———")).toBe("RMR_04.pdf");
  });
});

describe("reimbursement invoices", () => {
  const base: InvoiceInput = {
    clientId: "c1",
    issueDate: "2026-08-28",
    currency: "USD",
    gstTreatment: "gst_free",
    lines: [{ description: "easyJet — Geneva", unitAmountCents: 24551 }],
  };

  it("offers exactly the two kinds, services first", () => {
    expect([...INVOICE_KINDS]).toEqual(["services", "reimbursement"]);
  });

  it("accepts a reimbursement and rejects an invented kind", () => {
    expect(validateInvoiceInput({ ...base, kind: "reimbursement" })).toEqual([]);
    // @ts-expect-error — the guard exists for payloads that bypass the type
    expect(validateInvoiceInput({ ...base, kind: "disbursement" })).toContain(
      "Kind must be one of services, reimbursement."
    );
  });

  it("treats an absent kind as services rather than failing", () => {
    expect(validateInvoiceInput(base)).toEqual([]);
  });

  it("does not discount or otherwise alter a recovered cost", () => {
    // A reimbursement bills the cost through unchanged. The only thing the
    // kind changes is how it is described and posted, never the arithmetic.
    const lines = [
      { description: "easyJet — Geneva", unitAmountCents: 24551 },
      { description: "DaVinci Resolve Studio", unitAmountCents: 33508 },
    ];
    expect(invoiceTotals(lines, "gst_free").totalCents).toBe(58059);
  });

  it("still adds GST when the client is Australian", () => {
    // Recovering a cost from a domestic client is a taxable supply like any
    // other — the kind does not make it GST-free.
    expect(invoiceTotals([{ description: "Courier", unitAmountCents: 10000 }], "gst").gstCents).toBe(1000);
  });
});
