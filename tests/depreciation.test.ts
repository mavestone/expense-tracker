import { describe, it, expect } from "vitest";
import {
  businessPortionCents,
  writeOffMethod,
  immediateDeductionCents,
  poolDeductionCents,
  applyPoolWriteOff,
  balancingAdjustment,
  explainTreatment,
} from "../lib/depreciation";

const $ = (d: number) => Math.round(d * 100);
const THRESHOLD_2025_26 = $(20_000);

describe("business-use apportionment", () => {
  it("scales the cost by the business-use percentage", () => {
    expect(businessPortionCents($(2_199), 10_000)).toBe($(2_199));
    expect(businessPortionCents($(2_199), 6_000)).toBe($(1_319.4));
    expect(businessPortionCents($(2_199), 0)).toBe(0);
  });
  it("clamps out-of-range percentages and ignores negative costs", () => {
    expect(businessPortionCents($(1_000), 12_000)).toBe($(1_000));
    expect(businessPortionCents($(-500), 10_000)).toBe(0);
  });
});

describe("instant asset write-off vs pool", () => {
  it("tests the threshold on cost, not the business portion", () => {
    // $25,000 asset at 50% business use is still a POOL asset, not immediate
    expect(writeOffMethod($(25_000), THRESHOLD_2025_26)).toBe("pool");
    expect(writeOffMethod($(19_999.99), THRESHOLD_2025_26)).toBe("immediate");
  });
  it("treats an asset exactly on the threshold as a pool asset", () => {
    // the concession is for assets costing LESS THAN the limit
    expect(writeOffMethod($(20_000), THRESHOLD_2025_26)).toBe("pool");
  });
  it("returns unknown when no threshold is set rather than guessing", () => {
    expect(writeOffMethod($(2_199), null)).toBe("unknown");
    expect(immediateDeductionCents($(2_199), 10_000, null)).toBe(0);
  });
  it("deducts the business portion immediately under the threshold", () => {
    expect(immediateDeductionCents($(2_199), 10_000, THRESHOLD_2025_26)).toBe($(2_199));
    expect(immediateDeductionCents($(2_199), 7_000, THRESHOLD_2025_26)).toBe($(1_539.3));
    expect(immediateDeductionCents($(30_000), 10_000, THRESHOLD_2025_26)).toBe(0);
  });
});

describe("small business pool", () => {
  it("writes down additions at 15% in the allocation year", () => {
    const r = poolDeductionCents({ openingCents: 0, addedCents: $(30_000) });
    expect(r.deductionCents).toBe($(4_500));
    expect(r.closingCents).toBe($(25_500));
  });
  it("writes down the opening balance at 30% thereafter", () => {
    const r = poolDeductionCents({ openingCents: $(25_500), addedCents: 0 });
    expect(r.deductionCents).toBe($(7_650));
    expect(r.closingCents).toBe($(17_850));
  });
  it("combines 30% on opening with 15% on this year's additions", () => {
    const r = poolDeductionCents({ openingCents: $(10_000), addedCents: $(20_000) });
    expect(r.deductionCents).toBe($(3_000) + $(3_000));
    expect(r.closingCents).toBe($(24_000));
  });
  it("writes off the whole pool once it falls under the threshold", () => {
    const r = applyPoolWriteOff($(17_850), THRESHOLD_2025_26);
    expect(r.extraDeductionCents).toBe($(17_850));
    expect(r.carryForwardCents).toBe(0);
  });
  it("carries the pool forward while it is at or above the threshold", () => {
    const r = applyPoolWriteOff($(25_500), THRESHOLD_2025_26);
    expect(r.extraDeductionCents).toBe(0);
    expect(r.carryForwardCents).toBe($(25_500));
  });
});

describe("balancing adjustments", () => {
  it("gives a deduction when nothing comes back for a written-down asset", () => {
    // stolen, uninsured, $800 still on the books, fully business use
    const r = balancingAdjustment($(800), 0, 10_000);
    expect(r.deductionCents).toBe($(800));
    expect(r.assessableCents).toBe(0);
    expect(r.netCents).toBe($(-800));
  });
  it("is nil where the asset was already fully written off and nothing came back", () => {
    // the instant asset write-off case: adjustable value is already zero
    const r = balancingAdjustment(0, 0, 10_000);
    expect(r.deductionCents).toBe(0);
    expect(r.assessableCents).toBe(0);
    expect(r.netCents).toBe(0);
  });
  it("is assessable where an insurance payout exceeds the written-down value", () => {
    const r = balancingAdjustment(0, $(1_500), 10_000);
    expect(r.assessableCents).toBe($(1_500));
    expect(r.deductionCents).toBe(0);
  });
  it("apportions both directions by business use", () => {
    expect(balancingAdjustment($(1_000), 0, 5_000).deductionCents).toBe($(500));
    expect(balancingAdjustment(0, $(1_000), 5_000).assessableCents).toBe($(500));
  });
  it("handles a sale above the written-down value", () => {
    // sold for $900, $400 left on the books, 80% business use
    const r = balancingAdjustment($(400), $(900), 8_000);
    expect(r.assessableCents).toBe($(400));
    expect(r.netCents).toBe($(400));
  });
});

describe("plain-language treatment", () => {
  it("explains an under-threshold asset", () => {
    const r = explainTreatment($(2_199), 10_000, THRESHOLD_2025_26);
    expect(r.method).toBe("immediate");
    expect(r.deductionCents).toBe($(2_199));
    expect(r.note).toContain("deductible in full");
  });
  it("explains a pooled asset at 15% in year one", () => {
    const r = explainTreatment($(30_000), 10_000, THRESHOLD_2025_26);
    expect(r.method).toBe("pool");
    expect(r.deductionCents).toBe($(4_500));
    expect(r.note).toContain("15%");
  });
  it("asks for the threshold instead of guessing", () => {
    const r = explainTreatment($(2_199), 10_000, null);
    expect(r.method).toBe("unknown");
    expect(r.deductionCents).toBe(0);
    expect(r.note).toContain("Settings");
  });
});
