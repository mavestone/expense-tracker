/**
 * Indicative individual income tax for a sole trader.
 *
 * The tracker only knows business income and deductible spend, so everything
 * here is an estimate on that figure alone. Salary, interest, capital gains,
 * offsets, PAYG credits and the Medicare levy shade-in are all out of scope —
 * the accountant works from the full picture.
 *
 * All money is in cents, matching the rest of the app. Rates are basis points
 * (3000 bp = 30%) so they compose with applyBp() in lib/money.
 */

export type TaxBracket = {
  /** Inclusive lower bound in cents. */
  fromCents: number;
  /** Inclusive upper bound in cents, or null for the top bracket. */
  toCents: number | null;
  /** Marginal rate in basis points. */
  rateBp: number;
};

/**
 * Resident individual rates in force from 1 July 2024 (the revised Stage 3
 * scale). Unchanged for 2025-26.
 */
export const RESIDENT_BRACKETS_2024_25: TaxBracket[] = [
  { fromCents: 0, toCents: 1_820_000, rateBp: 0 },
  { fromCents: 1_820_001, toCents: 4_500_000, rateBp: 1600 },
  { fromCents: 4_500_001, toCents: 13_500_000, rateBp: 3000 },
  { fromCents: 13_500_001, toCents: 19_000_000, rateBp: 3700 },
  { fromCents: 19_000_001, toCents: null, rateBp: 4500 },
];

/** Financial years these rates are known to apply to. */
const KNOWN_FYS = new Set(["2024-25", "2025-26"]);

export const MEDICARE_LEVY_BP = 200;

export type TaxScale = {
  brackets: TaxBracket[];
  /** False when the FY is outside the years the rates were verified for. */
  verifiedForFy: boolean;
  /** The FY whose published rates are being applied. */
  basisFy: string;
};

export function scaleForFy(fy: string): TaxScale {
  return {
    brackets: RESIDENT_BRACKETS_2024_25,
    verifiedForFy: KNOWN_FYS.has(fy),
    basisFy: "2025-26",
  };
}

/** Income tax before the Medicare levy. */
export function incomeTaxCents(taxableCents: number, brackets = RESIDENT_BRACKETS_2024_25): number {
  if (taxableCents <= 0) return 0;
  let tax = 0;
  for (const b of brackets) {
    if (taxableCents < b.fromCents) break;
    const upper = b.toCents == null ? taxableCents : Math.min(taxableCents, b.toCents);
    // fromCents is the first cent taxed at this rate, so the slice starts one below it
    const sliceStart = b.fromCents === 0 ? 0 : b.fromCents - 1;
    const slice = upper - sliceStart;
    if (slice > 0) tax += Math.round((slice * b.rateBp) / 10_000);
  }
  return tax;
}

/**
 * Medicare levy at the flat 2%. The low-income threshold and its shade-in are
 * deliberately not modelled — they are indexed annually and would give false
 * precision here.
 */
export function medicareLevyCents(taxableCents: number): number {
  if (taxableCents <= 0) return 0;
  return Math.round((taxableCents * MEDICARE_LEVY_BP) / 10_000);
}

export function bracketFor(taxableCents: number, brackets = RESIDENT_BRACKETS_2024_25): TaxBracket {
  const t = Math.max(0, taxableCents);
  return (
    brackets.find((b) => t >= b.fromCents && (b.toCents == null || t <= b.toCents)) ??
    brackets[0]
  );
}

export type TaxPosition = {
  taxableCents: number;
  bracket: TaxBracket;
  bracketIndex: number;
  marginalRateBp: number;
  incomeTaxCents: number;
  medicareLevyCents: number;
  totalTaxCents: number;
  /** Total tax as a share of taxable income, in basis points. */
  effectiveRateBp: number;
  /** Cents of extra profit before the next bracket starts; null at the top. */
  toNextBracketCents: number | null;
  nextBracket: TaxBracket | null;
  scale: TaxScale;
};

export function taxPosition(taxableCents: number, fy: string): TaxPosition {
  const scale = scaleForFy(fy);
  const t = Math.max(0, Math.round(taxableCents));
  const bracket = bracketFor(t, scale.brackets);
  const bracketIndex = scale.brackets.indexOf(bracket);
  const nextBracket = scale.brackets[bracketIndex + 1] ?? null;
  const tax = incomeTaxCents(t, scale.brackets);
  const levy = medicareLevyCents(t);
  const total = tax + levy;

  return {
    taxableCents: t,
    bracket,
    bracketIndex,
    marginalRateBp: bracket.rateBp,
    incomeTaxCents: tax,
    medicareLevyCents: levy,
    totalTaxCents: total,
    effectiveRateBp: t > 0 ? Math.round((total / t) * 10_000) : 0,
    toNextBracketCents: bracket.toCents == null ? null : bracket.toCents - t,
    nextBracket,
    scale,
  };
}

/** "30%" / "16%" for display. */
export function rateLabel(rateBp: number): string {
  return `${rateBp / 100}%`;
}

/** "$45,001 – $135,000" / "$190,001+" for display. */
export function bracketLabel(b: TaxBracket): string {
  const fmt = (c: number) => `$${Math.round(c / 100).toLocaleString("en-AU")}`;
  return b.toCents == null ? `${fmt(b.fromCents)}+` : `${fmt(b.fromCents)} – ${fmt(b.toCents)}`;
}
