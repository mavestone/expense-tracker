import { invertRate } from "../money";

/**
 * Frankfurter (https://frankfurter.dev) serves ECB reference rates back to
 * 1999 for ~30 currencies, free, no API key. Used as fallback when the RBA
 * table doesn't cover a currency or date. The API automatically snaps
 * weekend/holiday requests to the previous business day and reports the
 * actual rate date in the response.
 */

const BASE = process.env.FRANKFURTER_URL || "https://api.frankfurter.dev/v1";

export const ECB_SOURCE = "ECB reference rate (via Frankfurter)";

export async function fetchEcbRate(
  dateISO: string,
  currency: string
): Promise<{ rateAudPerUnit: string; rateDate: string } | null> {
  const ccy = currency.toUpperCase();
  const res = await fetch(`${BASE}/${dateISO}?base=AUD&symbols=${encodeURIComponent(ccy)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null; // unsupported currency or out-of-range date
  if (!res.ok) throw new Error(`Frankfurter fetch failed: HTTP ${res.status}`);
  const j = (await res.json()) as { date?: string; rates?: Record<string, number> };
  const v = j?.rates?.[ccy];
  if (typeof v !== "number" || v <= 0 || !j.date) return null;
  // v = units of currency per 1 AUD -> invert to AUD per unit.
  return { rateAudPerUnit: invertRate(v), rateDate: j.date };
}
