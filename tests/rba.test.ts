import { describe, it, expect } from "vitest";
import { parseRbaCsv, findRbaRate } from "../lib/fx/rba";

const SAMPLE = [
  "﻿F11.1  EXCHANGE RATES",
  "Title,A$1=USD,Trade-weighted Index May 1970 = 100,A$1=CNY,A$1=JPY,A$1=EUR",
  "Description,AUD/USD Exchange Rate,TWI,AUD/CNY,AUD/JPY,AUD/EUR",
  "Frequency,Daily,Daily,Daily,Daily,Daily",
  "Type,Indicative,Indicative,Indicative,Indicative,Indicative",
  "Units,USD,Index,CNY,JPY,EUR",
  "",
  "Source,WM/Reuters,RBA,RBA,RBA,RBA",
  "Publication date,31-Jul-2026,31-Jul-2026,31-Jul-2026,31-Jul-2026,31-Jul-2026",
  "Series ID,FXRUSD,FXRTWI,FXRCR,FXRJY,FXREUR",
  "03-Jan-2023,0.6828,61.40,4.6994,88.48,0.6400",
  "04-Jan-2023,0.6809,61.50,4.6906,89.08,0.6439",
  "06-Jan-2023,0.6769,61.20,4.6378,90.63,0.6431",
].join("\n");

describe("RBA CSV parser", () => {
  it("parses currencies from Title row and inverts to AUD-per-unit", () => {
    const t = parseRbaCsv(SAMPLE);
    expect([...t.byCurrency.keys()].sort()).toEqual(["CNY", "EUR", "JPY", "USD"]);
    const usd = t.byCurrency.get("USD")!;
    expect(usd[0]).toEqual({ date: "2023-01-03", rateAudPerUnit: "1.46455770" });
  });

  it("skips the trade-weighted index column", () => {
    const t = parseRbaCsv(SAMPLE);
    expect(t.byCurrency.has("TWI")).toBe(false);
  });

  it("finds exact-date rates", () => {
    const t = parseRbaCsv(SAMPLE);
    const hit = findRbaRate(t, "2023-01-04", "USD")!;
    expect(hit.rateDate).toBe("2023-01-04");
  });

  it("falls back to the most recent published day for weekends/holidays", () => {
    const t = parseRbaCsv(SAMPLE);
    const hit = findRbaRate(t, "2023-01-05", "USD")!; // gap day in sample
    expect(hit.rateDate).toBe("2023-01-04");
    const hit2 = findRbaRate(t, "2023-01-08", "USD")!; // Sunday
    expect(hit2.rateDate).toBe("2023-01-06");
  });

  it("refuses stale rates beyond the lookback window", () => {
    const t = parseRbaCsv(SAMPLE);
    expect(findRbaRate(t, "2023-03-01", "USD")).toBeNull();
  });

  it("returns null for unknown currencies", () => {
    const t = parseRbaCsv(SAMPLE);
    expect(findRbaRate(t, "2023-01-04", "VND")).toBeNull();
  });
});
