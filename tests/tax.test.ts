import { describe, it, expect } from "vitest";
import {
  incomeTaxCents,
  medicareLevyCents,
  bracketFor,
  taxPosition,
  bracketLabel,
  rateLabel,
} from "../lib/tax";

const $ = (dollars: number) => Math.round(dollars * 100);

describe("resident income tax scale (2024-25 onwards)", () => {
  it("is nil under the tax-free threshold", () => {
    expect(incomeTaxCents($(0))).toBe(0);
    expect(incomeTaxCents($(18_200))).toBe(0);
  });

  it("matches the published cumulative figures at each bracket ceiling", () => {
    // $45,000 -> $4,288   ((45,000 - 18,200) * 16%)
    expect(incomeTaxCents($(45_000))).toBe($(4_288));
    // $135,000 -> $31,288   (4,288 + 90,000 * 30%)
    expect(incomeTaxCents($(135_000))).toBe($(31_288));
    // $190,000 -> $51,638   (31,288 + 55,000 * 37%)
    expect(incomeTaxCents($(190_000))).toBe($(51_638));
  });

  it("applies the marginal rate above each ceiling", () => {
    // $200,000 -> 51,638 + 10,000 * 45% = $56,138
    expect(incomeTaxCents($(200_000))).toBe($(56_138));
    // $50,000 -> 4,288 + 5,000 * 30% = $5,788
    expect(incomeTaxCents($(50_000))).toBe($(5_788));
  });

  it("taxes only the first dollar over the threshold at the margin", () => {
    expect(incomeTaxCents($(18_201))).toBe(16);
  });

  it("never returns tax on a loss", () => {
    expect(incomeTaxCents($(-5_000))).toBe(0);
  });
});

describe("Medicare levy", () => {
  it("is a flat 2%", () => {
    expect(medicareLevyCents($(50_000))).toBe($(1_000));
    expect(medicareLevyCents(0)).toBe(0);
    expect(medicareLevyCents($(-100))).toBe(0);
  });
});

describe("bracket lookup", () => {
  it("places income in the right bracket at the boundaries", () => {
    expect(bracketFor($(18_200)).rateBp).toBe(0);
    expect(bracketFor($(18_201)).rateBp).toBe(1600);
    expect(bracketFor($(45_000)).rateBp).toBe(1600);
    expect(bracketFor($(45_001)).rateBp).toBe(3000);
    expect(bracketFor($(135_001)).rateBp).toBe(3700);
    expect(bracketFor($(1_000_000)).rateBp).toBe(4500);
  });
});

describe("tax position", () => {
  it("reports margin, headroom and effective rate", () => {
    const p = taxPosition($(60_000), "2025-26");
    expect(p.marginalRateBp).toBe(3000);
    expect(p.incomeTaxCents).toBe($(8_788)); // 4,288 + 15,000 * 30%
    expect(p.medicareLevyCents).toBe($(1_200));
    expect(p.totalTaxCents).toBe($(9_988));
    expect(p.toNextBracketCents).toBe($(75_000)); // 135,000 - 60,000
    expect(p.nextBracket?.rateBp).toBe(3700);
    expect(p.effectiveRateBp).toBe(1665); // 9,988 / 60,000
  });

  it("has no headroom in the top bracket", () => {
    const p = taxPosition($(250_000), "2025-26");
    expect(p.toNextBracketCents).toBeNull();
    expect(p.nextBracket).toBeNull();
  });

  it("flags financial years the rates were not verified for", () => {
    expect(taxPosition($(50_000), "2025-26").scale.verifiedForFy).toBe(true);
    expect(taxPosition($(50_000), "2026-27").scale.verifiedForFy).toBe(false);
  });
});

describe("display helpers", () => {
  it("formats rates and bracket ranges", () => {
    expect(rateLabel(3000)).toBe("30%");
    expect(rateLabel(1600)).toBe("16%");
    expect(bracketLabel({ fromCents: $(45_001), toCents: $(135_000), rateBp: 3000 }))
      .toBe("$45,001 – $135,000");
    expect(bracketLabel({ fromCents: $(190_001), toCents: null, rateBp: 4500 }))
      .toBe("$190,001+");
  });
});
