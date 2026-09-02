/**
 * Accounting basis, per financial year.
 *
 * **Accruals** recognises income when it is invoiced. **Cash** recognises it
 * when the money arrives. The ATO's general position for income from personal
 * services is that the receipts method better reflects income, so a year can
 * legitimately be lodged on either — but it is a per-year fact, not a switch.
 * A year already lodged cannot have its basis rewritten underneath it.
 *
 * The dangerous part is the change itself. An invoice raised in an accruals
 * year and paid in the following cash year has already been declared once; if
 * the cash year simply counts everything it received, it is declared twice.
 * `belongsToFy` carries that transitional rule so no caller has to remember it.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { financialYear } from "./fy";

export const ACCOUNTING_BASES = ["accruals", "cash"] as const;
export type AccountingBasis = (typeof ACCOUNTING_BASES)[number];

export function isAccountingBasis(v: unknown): v is AccountingBasis {
  return v === "accruals" || v === "cash";
}

/** Every year's basis. Years with no row default to accruals. */
export async function fyBases(): Promise<Map<string, AccountingBasis>> {
  const d = await db();
  const rows = await d.select().from(schema.fyThresholds);
  return new Map(
    rows.map((r) => [r.fyLabel, isAccountingBasis(r.incomeBasis) ? r.incomeBasis : "accruals"])
  );
}

export async function getFyBasis(fy: string): Promise<AccountingBasis> {
  const d = await db();
  const [row] = await d.select().from(schema.fyThresholds).where(eq(schema.fyThresholds.fyLabel, fy));
  return isAccountingBasis(row?.incomeBasis) ? row.incomeBasis : "accruals";
}

export type IncomeLike = {
  dateEarned: string;
  datePaid: string | null;
  financialYear: string;
};

/**
 * Does this income record count towards `fy`, on that year's basis?
 *
 * On accruals: the year it was invoiced in, paid or not.
 *
 * On cash: the year the money arrived — except where it was already declared.
 * A record earned in an *earlier* year that was itself on accruals has been
 * counted there, and counting it again here would overstate the year by its
 * full value. KC_290626 is exactly this: invoiced 29 Jun 2026, declared in
 * FY 2025-26 on accruals, banked 2 Jul 2026.
 */
export function belongsToFy(
  r: IncomeLike,
  fy: string,
  basis: AccountingBasis,
  bases: Map<string, AccountingBasis>
): boolean {
  if (basis === "accruals") return r.financialYear === fy;
  if (!r.datePaid) return false;
  if (financialYear(r.datePaid) !== fy) return false;
  return !alreadyDeclared(r, fy, bases);
}

/**
 * True when an earlier, accruals year has already counted this record — the
 * transitional case, and the one worth naming rather than silently dropping.
 */
export function alreadyDeclared(
  r: IncomeLike,
  fy: string,
  bases: Map<string, AccountingBasis>
): boolean {
  const earned = r.financialYear;
  if (earned >= fy) return false;
  return (bases.get(earned) ?? "accruals") === "accruals";
}

/** The month a record falls in, on the given basis — null when it does not fall anywhere. */
export function incomeMonthKey(r: IncomeLike, basis: AccountingBasis): string | null {
  if (basis === "accruals") return r.dateEarned.slice(0, 7);
  return r.datePaid ? r.datePaid.slice(0, 7) : null;
}

/**
 * Expenses on a cash basis.
 *
 * There is no payment date on an expense record: nearly everything here is a
 * card charge, where incurring and paying are the same event. A bill on terms
 * (the Three mobile bill is invoiced on the 12th and debited on the 27th) can
 * therefore sit in the wrong month under cash, though only when the two fall
 * either side of a month end. Recorded as a known limit rather than pretended
 * away — adding a payment date to expenses is the real fix.
 */
export const EXPENSE_CASH_CAVEAT =
  "Expenses are dated when incurred. For card spend that is also when it was paid; a bill on terms could sit a few days early.";
