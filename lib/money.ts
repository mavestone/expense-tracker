/**
 * Money handling. All amounts are stored as INTEGER CENTS to avoid floating
 * point errors. FX rates are stored as DECIMAL STRINGS and applied with
 * BigInt arithmetic. Rounding is half-up throughout, applied once at the
 * final step of each calculation.
 */

const RATE_SCALE = 10n; // rates carry 10 decimal places internally
const RATE_POW = 10n ** RATE_SCALE;

/** Parse a user-entered money string (e.g. "1,234.56") into integer cents. */
export function parseMoneyToCents(input: string): number | null {
  const s = String(input).trim().replace(/[,\s$]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = parseInt(whole, 10) * 100 + (frac ? parseInt(frac.padEnd(2, "0"), 10) : 0);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

/** Integer cents -> "1234.56" (machine format, no separators). */
export function centsToDecimalString(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

/** Display formatting, e.g. "$1,234.56". */
export function formatAUD(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
}

/** Display an amount in an arbitrary ISO currency, e.g. "US$52.99". */
export function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${currency} ${centsToDecimalString(cents)}`;
  }
}

/** Integer division with half-up rounding. n may be any int, d > 0. */
export function divRound(n: number, d: number): number {
  if (d <= 0) throw new Error("divRound: divisor must be > 0");
  const neg = n < 0;
  const a = Math.abs(n);
  const q = Math.floor(a / d);
  const r = a % d;
  const rounded = r * 2 >= d ? q + 1 : q;
  return neg ? -rounded : rounded;
}

/** Parse a decimal-string rate into a BigInt scaled by 10^10. */
function parseRateScaled(rateStr: string): bigint {
  const m = String(rateStr).trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Invalid FX rate: "${rateStr}"`);
  const frac = (m[2] ?? "").slice(0, Number(RATE_SCALE)).padEnd(Number(RATE_SCALE), "0");
  return BigInt(m[1]) * RATE_POW + BigInt(frac);
}

/** Validate that a string is a positive decimal usable as an FX rate. */
export function isValidRate(rateStr: string): boolean {
  try {
    return parseRateScaled(rateStr) > 0n;
  } catch {
    return false;
  }
}

/**
 * Convert original-currency cents to AUD cents using a decimal-string rate
 * expressed as "AUD per 1 unit of the original currency". Half-up rounding.
 */
export function applyRate(cents: number, rateStr: string): number {
  const scaled = parseRateScaled(rateStr);
  const v = BigInt(cents) * scaled;
  const q = v / RATE_POW;
  const r = v % RATE_POW;
  const half = RATE_POW / 2n;
  const out = r >= half ? q + 1n : q;
  const n = Number(out);
  if (!Number.isSafeInteger(n)) throw new Error("applyRate: result exceeds safe integer range");
  return n;
}

/**
 * Invert a decimal-string rate (units-of-foreign per 1 AUD -> AUD per 1 unit
 * of foreign). Returns a decimal string with 8 decimal places.
 */
export function invertRate(foreignPerAud: string | number): string {
  const s = typeof foreignPerAud === "number" ? foreignPerAud.toString() : foreignPerAud;
  const scaled = parseRateScaled(s); // value * 10^10
  if (scaled === 0n) throw new Error("invertRate: rate is zero");
  // 1/value scaled to 10^10: (10^20 / scaled). Round half-up to 8 dp.
  const invScaled = 10n ** 20n / scaled; // * 10^10
  return formatScaled(invScaled, 8);
}

/** Normalise a decimal-string rate to a canonical 8 dp representation. */
export function normalizeRate(rateStr: string): string {
  return formatScaled(parseRateScaled(rateStr), 8);
}

/** Format a BigInt scaled by 10^10 as a decimal string with `dp` places (half-up). */
function formatScaled(scaled: bigint, dp: number): string {
  const cut = 10n ** BigInt(Number(RATE_SCALE) - dp);
  const half = cut / 2n;
  const rounded = (scaled + half) / cut; // value * 10^dp
  const pow = 10n ** BigInt(dp);
  const whole = rounded / pow;
  const frac = (rounded % pow).toString().padStart(dp, "0");
  return `${whole}.${frac}`;
}

/**
 * Apply a business-use percentage expressed in basis points (0..10000)
 * to an amount in cents. Half-up rounding.
 */
export function applyBp(cents: number, bp: number): number {
  if (bp < 0 || bp > 10000 || !Number.isInteger(bp)) throw new Error(`Invalid basis points: ${bp}`);
  return divRound(cents * bp, 10000);
}

/** "87.5" (percent string) -> 8750 basis points. Accepts 0..100, up to 2dp. */
export function percentToBp(input: string | number): number | null {
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const bp = parseInt(w, 10) * 100 + (f ? parseInt(f.padEnd(2, "0"), 10) : 0);
  if (bp < 0 || bp > 10000) return null;
  return bp;
}

/** 8750 -> "87.5" */
export function bpToPercentString(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}
