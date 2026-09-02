import { describe, it, expect } from "vitest";
import { belongsToFy, alreadyDeclared, incomeMonthKey, type AccountingBasis } from "../lib/basis";

const bases = new Map<string, AccountingBasis>([
  ["2025-26", "accruals"],
  ["2026-27", "cash"],
]);

/** KC_290626 — invoiced 29 Jun 2026, declared in FY 2025-26, banked 2 Jul 2026. */
const kc290626 = { dateEarned: "2026-06-29", datePaid: "2026-07-02", financialYear: "2025-26" };
/** AG_02 — invoiced in the cash year, still unpaid. */
const unpaid = { dateEarned: "2026-08-12", datePaid: null, financialYear: "2026-27" };
/** Invoiced and paid inside the cash year. */
const paid = { dateEarned: "2026-08-01", datePaid: "2026-08-03", financialYear: "2026-27" };

describe("accruals", () => {
  it("counts the year it was invoiced in, paid or not", () => {
    expect(belongsToFy(unpaid, "2026-27", "accruals", bases)).toBe(true);
    expect(belongsToFy(kc290626, "2025-26", "accruals", bases)).toBe(true);
  });

  it("does not reach into the year the money actually arrived", () => {
    expect(belongsToFy(kc290626, "2026-27", "accruals", bases)).toBe(false);
  });
});

describe("cash", () => {
  it("counts money received, not invoices raised", () => {
    expect(belongsToFy(paid, "2026-27", "cash", bases)).toBe(true);
    expect(belongsToFy(unpaid, "2026-27", "cash", bases)).toBe(false);
  });

  it("does NOT count an invoice a prior accruals year already declared", () => {
    // The whole point of the transitional rule: KC_290626 was banked inside
    // FY 2026-27 but declared in FY 2025-26. Counting it again would overstate
    // the year by A$4,712.88.
    expect(alreadyDeclared(kc290626, "2026-27", bases)).toBe(true);
    expect(belongsToFy(kc290626, "2026-27", "cash", bases)).toBe(false);
  });

  it("does count it when the prior year was itself on cash", () => {
    // Then it was never declared on invoicing, so the receipt is its first and
    // only appearance.
    const allCash = new Map<string, AccountingBasis>([["2025-26", "cash"], ["2026-27", "cash"]]);
    expect(belongsToFy(kc290626, "2026-27", "cash", allCash)).toBe(true);
  });

  it("buckets by the date the money moved", () => {
    expect(incomeMonthKey(kc290626, "cash")).toBe("2026-07");
    expect(incomeMonthKey(kc290626, "accruals")).toBe("2026-06");
    expect(incomeMonthKey(unpaid, "cash")).toBeNull();
  });
});
