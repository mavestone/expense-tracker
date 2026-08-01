import { describe, it, expect } from "vitest";
import { defaultGstCents, defaultTreatmentForCurrency, claimableGstCents, gstReceiptFlag } from "../lib/gst";

describe("GST defaults", () => {
  it("computes 1/11 of GST-inclusive totals", () => {
    expect(defaultGstCents("gst", 11000)).toBe(1000); // $110 incl -> $10 GST
    expect(defaultGstCents("gst", 8250)).toBe(750); // $82.50 -> $7.50
    expect(defaultGstCents("gst_free", 11000)).toBe(0);
    expect(defaultGstCents("input_taxed", 11000)).toBe(0);
  });
  it("defaults AUD to claimable, foreign to no-GST", () => {
    expect(defaultTreatmentForCurrency("AUD")).toBe("gst");
    expect(defaultTreatmentForCurrency("USD")).toBe("gst_free");
    expect(defaultTreatmentForCurrency("eur")).toBe("gst_free");
  });
});

describe("claimable GST (1B) with business-use apportionment", () => {
  it("apportions", () => {
    expect(claimableGstCents("gst", 1000, 10000)).toBe(1000);
    expect(claimableGstCents("gst", 1000, 5000)).toBe(500);
    expect(claimableGstCents("gst", 999, 3333)).toBe(333);
    expect(claimableGstCents("gst_free", 1000, 10000)).toBe(0);
    expect(claimableGstCents("input_taxed", 1000, 10000)).toBe(0);
  });
});

describe("$82.50 tax-invoice flag", () => {
  const base = { treatment: "gst" as const, thresholdCents: 8250 };
  it("flags claimable purchases over the threshold with no receipt", () => {
    expect(gstReceiptFlag({ ...base, audAmountCents: 8251, hasReceipt: false })).toBe(true);
    expect(gstReceiptFlag({ ...base, audAmountCents: 8250, hasReceipt: false })).toBe(false); // not OVER
    expect(gstReceiptFlag({ ...base, audAmountCents: 20000, hasReceipt: true })).toBe(false);
    expect(gstReceiptFlag({ treatment: "gst_free", audAmountCents: 20000, hasReceipt: false, thresholdCents: 8250 })).toBe(false);
  });
});
