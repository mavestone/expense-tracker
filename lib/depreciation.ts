/**
 * Simplified depreciation for a small business entity (ATO), plus balancing
 * adjustments when an asset is sold, lost or destroyed.
 *
 * Rules encoded here, as they stand for FY 2025-26:
 *
 *  - Instant asset write-off: a small business (aggregated turnover < $10m) can
 *    immediately deduct the BUSINESS PORTION of an asset costing LESS THAN the
 *    threshold, where the asset is first used or installed ready for use inside
 *    the income year. The threshold is $20,000 for 2025-26 and applies per asset.
 *  - Assets costing the threshold or more go to the small business pool and are
 *    written down at 15% in the allocation year, then 30% each year after.
 *  - If the pool balance at the end of a year is below the threshold, the whole
 *    pool balance is deducted.
 *  - A balancing adjustment event (sale, loss, theft, destruction) compares the
 *    asset's adjustable value with its termination value. For a stolen or
 *    destroyed asset the termination value is whatever insurance or other
 *    compensation was received — nil where nothing was received.
 *
 * Thresholds change between years and are NOT hardcoded: they come from the
 * fy_thresholds table so the figure is one the owner has confirmed. A null
 * threshold yields "unknown" rather than a guess.
 *
 * Money is in cents; rates are basis points (1500 bp = 15%).
 */

export const POOL_FIRST_YEAR_BP = 1500;
export const POOL_ONGOING_BP = 3000;

export type WriteOffMethod = "immediate" | "pool" | "unknown";

/** Business-use share of a cost, in cents. */
export function businessPortionCents(costCents: number, businessUseBp: number): number {
  if (costCents <= 0) return 0;
  const bp = Math.min(10_000, Math.max(0, businessUseBp));
  return Math.round((costCents * bp) / 10_000);
}

/**
 * Which treatment applies. The threshold test is on the asset's COST, not the
 * business portion — apportionment affects the deductible amount, not eligibility.
 */
export function writeOffMethod(costCents: number, thresholdCents: number | null): WriteOffMethod {
  if (thresholdCents == null) return "unknown";
  return costCents < thresholdCents ? "immediate" : "pool";
}

/** Immediate deduction under the instant asset write-off. */
export function immediateDeductionCents(
  costCents: number,
  businessUseBp: number,
  thresholdCents: number | null
): number {
  if (writeOffMethod(costCents, thresholdCents) !== "immediate") return 0;
  return businessPortionCents(costCents, businessUseBp);
}

export type PoolYear = {
  /** Pool balance carried in from last year. */
  openingCents: number;
  /** Business portion of assets allocated to the pool this year. */
  addedCents: number;
};

/**
 * Pool deduction for one year: 30% of the opening balance plus 15% of what was
 * added this year. Returns the closing balance before the low-balance test.
 */
export function poolDeductionCents({ openingCents, addedCents }: PoolYear): {
  deductionCents: number;
  closingCents: number;
} {
  const opening = Math.max(0, Math.round(openingCents));
  const added = Math.max(0, Math.round(addedCents));
  const onOpening = Math.round((opening * POOL_ONGOING_BP) / 10_000);
  const onAdded = Math.round((added * POOL_FIRST_YEAR_BP) / 10_000);
  const deduction = onOpening + onAdded;
  return { deductionCents: deduction, closingCents: opening + added - deduction };
}

/**
 * The whole pool is deducted when its closing balance falls under the threshold.
 * Returns the extra deduction and the balance that carries forward.
 */
export function applyPoolWriteOff(
  closingCents: number,
  thresholdCents: number | null
): { extraDeductionCents: number; carryForwardCents: number } {
  if (thresholdCents == null || closingCents <= 0 || closingCents >= thresholdCents) {
    return { extraDeductionCents: 0, carryForwardCents: Math.max(0, closingCents) };
  }
  return { extraDeductionCents: closingCents, carryForwardCents: 0 };
}

export type BalancingEvent = "sold" | "stolen" | "destroyed" | "scrapped" | "ceased_business_use";

export type BalancingAdjustment = {
  /** Deductible where the asset was worth more than what came back. */
  deductionCents: number;
  /** Assessable where more came back than the asset was worth. */
  assessableCents: number;
  /** Signed, business-apportioned: positive = assessable, negative = deduction. */
  netCents: number;
};

/**
 * Balancing adjustment on a disposal event.
 *
 * adjustableValueCents is the asset's written-down value immediately before the
 * event — zero for anything already fully written off under the instant asset
 * write-off. terminationValueCents is the sale proceeds, or the insurance or
 * other compensation received for a loss; nil where nothing was received.
 * Both sides are apportioned by business use.
 */
export function balancingAdjustment(
  adjustableValueCents: number,
  terminationValueCents: number,
  businessUseBp: number
): BalancingAdjustment {
  const adjustable = Math.max(0, Math.round(adjustableValueCents));
  const termination = Math.max(0, Math.round(terminationValueCents));
  const diff = termination - adjustable;
  const apportioned = Math.round((Math.abs(diff) * Math.min(10_000, Math.max(0, businessUseBp))) / 10_000);

  if (diff > 0) return { deductionCents: 0, assessableCents: apportioned, netCents: apportioned };
  if (diff < 0) return { deductionCents: apportioned, assessableCents: 0, netCents: -apportioned };
  return { deductionCents: 0, assessableCents: 0, netCents: 0 };
}

/**
 * Plain-language summary of what happens to one asset, for display next to the
 * record. Deliberately says "unknown" when the threshold has not been set.
 */
export function explainTreatment(
  costCents: number,
  businessUseBp: number,
  thresholdCents: number | null
): { method: WriteOffMethod; deductionCents: number; note: string } {
  const method = writeOffMethod(costCents, thresholdCents);
  const portion = businessPortionCents(costCents, businessUseBp);

  if (method === "unknown") {
    return {
      method,
      deductionCents: 0,
      note: "Set the instant asset write-off threshold for this financial year in Settings to work out the treatment.",
    };
  }
  if (method === "immediate") {
    return {
      method,
      deductionCents: portion,
      note: `Under the threshold — the business portion is deductible in full this year.`,
    };
  }
  const { deductionCents } = poolDeductionCents({ openingCents: 0, addedCents: portion });
  return {
    method,
    deductionCents,
    note: "At or over the threshold — allocated to the small business pool at 15% this year, then 30% a year.",
  };
}
