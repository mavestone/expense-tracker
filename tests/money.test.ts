import { describe, it, expect } from "vitest";
import { parseMoneyToCents, centsToDecimalString, divRound, applyRate, invertRate, applyBp, percentToBp, bpToPercentString, normalizeRate, isValidRate, formatCurrency, currencySymbol, formatWithCode, formatAmount } from "../lib/money";

describe("parseMoneyToCents", () => {
  it("parses plain and formatted amounts", () => {
    expect(parseMoneyToCents("123.45")).toBe(12345);
    expect(parseMoneyToCents("1,234.56")).toBe(123456);
    expect(parseMoneyToCents("0.05")).toBe(5);
    expect(parseMoneyToCents("100")).toBe(10000);
    expect(parseMoneyToCents("99.9")).toBe(9990);
    expect(parseMoneyToCents("$82.50")).toBe(8250);
  });
  it("rejects garbage", () => {
    expect(parseMoneyToCents("12.345")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("-5")).toBeNull();
  });
});

describe("divRound (half-up)", () => {
  it("computes 1/11 GST correctly", () => {
    expect(divRound(11000, 11)).toBe(1000); // $110.00 -> $10.00
    expect(divRound(8250, 11)).toBe(750); // $82.50 -> $7.50
    expect(divRound(10000, 11)).toBe(909); // $100.00 -> $9.09 (909.09...)
    expect(divRound(5, 11)).toBe(0); // 0.45c rounds down
    expect(divRound(6, 11)).toBe(1); // 0.54c rounds up
    expect(divRound(16.5 * 100, 11)).toBe(150);
  });
});

describe("applyRate (BigInt, half-up)", () => {
  it("converts USD to AUD exactly", () => {
    // USD 52.99 at 1.52835 = 80.98727... AUD -> 8099 cents
    expect(applyRate(5299, "1.52835")).toBe(8099);
    // JPY-style small rates
    expect(applyRate(1000000, "0.01029700")).toBe(10297);
    // Identity
    expect(applyRate(12345, "1")).toBe(12345);
    expect(applyRate(12345, "1.00000000")).toBe(12345);
  });
  it("rounds half-up at exact midpoints", () => {
    expect(applyRate(100, "1.005")).toBe(101); // 100.5 -> 101
    expect(applyRate(100, "1.004")).toBe(100);
  });
  it("handles huge IDR-style amounts without float loss", () => {
    // IDR 10,000,000.00 at 0.00009496 AUD/IDR = 949.60 AUD
    expect(applyRate(1000000000, "0.00009496")).toBe(94960);
  });
});

describe("invertRate", () => {
  it("inverts foreign-per-AUD to AUD-per-unit", () => {
    expect(invertRate("0.6828")).toBe("1.46455770"); // 1/0.6828
    expect(invertRate(0.5)).toBe("2.00000000");
    expect(invertRate("1")).toBe("1.00000000");
    // JPY: 88.48 per AUD -> 0.01130198 AUD per JPY
    expect(invertRate("88.48")).toBe("0.01130199");
  });
  it("round-trips sensibly", () => {
    const audPerUsd = invertRate("0.69826");
    // USD 100 should be ~143.21 AUD
    expect(applyRate(10000, audPerUsd)).toBe(14321);
  });
});

describe("business use apportionment", () => {
  it("applies basis points with half-up rounding", () => {
    expect(applyBp(10000, 10000)).toBe(10000); // 100%
    expect(applyBp(10000, 5000)).toBe(5000); // 50%
    expect(applyBp(999, 3333)).toBe(333); // 33.33% of $9.99 = 332.96... -> 333
    expect(applyBp(10000, 0)).toBe(0);
  });
  it("percent conversion", () => {
    expect(percentToBp("100")).toBe(10000);
    expect(percentToBp("87.5")).toBe(8750);
    expect(percentToBp("0")).toBe(0);
    expect(percentToBp("100.01")).toBeNull();
    expect(percentToBp("-1")).toBeNull();
    expect(bpToPercentString(8750)).toBe("87.5");
    expect(bpToPercentString(10000)).toBe("100");
    expect(bpToPercentString(3333)).toBe("33.33");
  });
});

describe("rate validation", () => {
  it("validates and normalises", () => {
    expect(isValidRate("1.5")).toBe(true);
    expect(isValidRate("0")).toBe(false);
    expect(isValidRate("abc")).toBe(false);
    expect(normalizeRate("1.5")).toBe("1.50000000");
  });
});

describe("centsToDecimalString", () => {
  it("formats", () => {
    expect(centsToDecimalString(12345)).toBe("123.45");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(0)).toBe("0.00");
  });
});

describe("currency display", () => {
  it("uses the symbol rather than the ISO code", () => {
    // en-AU prints "USD 2,000.00" by default, which is what appeared on the
    // invoice. The symbol is what a client expects to see.
    expect(formatCurrency(200000, "USD")).toBe("US$2,000.00");
    expect(formatCurrency(3312, "GBP")).toBe("£33.12");
    expect(formatCurrency(5000, "EUR")).toBe("€50.00");
  });

  it("keeps AUD as the bare dollar and disambiguates the others", () => {
    // Both are dollars; on a page that shows AUD totals beside a USD invoice
    // a bare "$" on each would be genuinely ambiguous.
    expect(formatCurrency(200000, "AUD")).toBe("$2,000.00");
    expect(formatCurrency(200000, "NZD")).toBe("NZ$2,000.00");
  });

  it("puts the minus sign outside the symbol", () => {
    expect(formatCurrency(-5000, "USD")).toBe("-US$50.00");
  });

  it("respects each currency's own decimal places", () => {
    // JPY has none — treating every currency as 2dp would print ¥1,500.00.
    expect(formatCurrency(150000, "JPY")).toBe("¥1,500");
  });

  it("falls back to the code for an unrecognised currency", () => {
    // Intl separates the code from the amount with a non-breaking space, which
    // is what we want in HTML — normalised here so the assertion is readable.
    expect(formatCurrency(1000, "ZZZ").replace(/\u00a0/g, " ")).toBe("ZZZ 10.00");
  });

  it("states the currency once with its code, for a document headline", () => {
    expect(formatWithCode(200000, "USD")).toBe("USD 2,000.00");
    expect(formatWithCode(3312, "GBP")).toBe("GBP 33.12");
  });

  it("drops the country prefix once the currency has been stated", () => {
    // Inside one invoice the currency is already declared, so repeating it on
    // every line is noise. This form is only safe in that context.
    expect(formatAmount(200000, "USD")).toBe("$2,000.00");
    expect(formatAmount(3312, "GBP")).toBe("£33.12");
    expect(formatAmount(150000, "JPY")).toBe("¥1,500");
  });

  it("exposes the symbol alone for labelling an input", () => {
    expect(currencySymbol("AUD")).toBe("$");
    expect(currencySymbol("USD")).toBe("US$");
    expect(currencySymbol("GBP")).toBe("£");
  });
});
