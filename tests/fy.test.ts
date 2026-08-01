import { describe, it, expect } from "vitest";
import { financialYear, fyQuarter, fyRange, quarterLabel, advanceRenewal, addDays, daysBetween, isValidIsoDate, formatDateAU } from "../lib/fy";

describe("financialYear (1 July – 30 June)", () => {
  it("assigns dates to the right FY", () => {
    expect(financialYear("2025-07-01")).toBe("2025-26");
    expect(financialYear("2025-06-30")).toBe("2024-25");
    expect(financialYear("2026-01-15")).toBe("2025-26");
    expect(financialYear("2026-06-30")).toBe("2025-26");
    expect(financialYear("2026-07-01")).toBe("2026-27");
    expect(financialYear("1999-08-01")).toBe("1999-00"); // century wrap
  });
});

describe("fyQuarter (BAS quarters)", () => {
  it("maps months to quarters", () => {
    expect(fyQuarter("2025-07-15")).toBe("Q1");
    expect(fyQuarter("2025-09-30")).toBe("Q1");
    expect(fyQuarter("2025-10-01")).toBe("Q2");
    expect(fyQuarter("2025-12-31")).toBe("Q2");
    expect(fyQuarter("2026-01-01")).toBe("Q3");
    expect(fyQuarter("2026-03-31")).toBe("Q3");
    expect(fyQuarter("2026-04-01")).toBe("Q4");
    expect(fyQuarter("2026-06-30")).toBe("Q4");
  });
  it("labels quarters with the right calendar year", () => {
    expect(quarterLabel("2025-26", "Q1")).toBe("Jul–Sep 2025");
    expect(quarterLabel("2025-26", "Q3")).toBe("Jan–Mar 2026");
  });
});

describe("fyRange", () => {
  it("computes start and end", () => {
    expect(fyRange("2025-26")).toEqual({ start: "2025-07-01", end: "2026-06-30" });
  });
});

describe("date helpers", () => {
  it("validates ISO dates", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false); // not a leap year
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-1-01")).toBe(false);
  });
  it("adds days across boundaries", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-01-01", "2026-03-02")).toBe(60);
  });
  it("formats AU dates", () => {
    expect(formatDateAU("2026-07-01")).toBe("01/07/2026");
  });
});

describe("advanceRenewal", () => {
  it("advances monthly with day-of-month anchor and clamping", () => {
    expect(advanceRenewal("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    expect(advanceRenewal("2026-02-28", "monthly", 31)).toBe("2026-03-31"); // anchor restores
    expect(advanceRenewal("2026-12-15", "monthly", 15)).toBe("2027-01-15");
  });
  it("advances annual, clamping 29 Feb", () => {
    expect(advanceRenewal("2024-02-29", "annual", 29)).toBe("2025-02-28");
    expect(advanceRenewal("2026-05-10", "annual", 10)).toBe("2027-05-10");
  });
});
