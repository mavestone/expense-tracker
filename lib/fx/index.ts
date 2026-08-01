import { and, desc, eq, gte, lte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, schema } from "../db";
import { addDays } from "../fy";
import { getRbaTable, findRbaRate, RBA_SOURCE } from "./rba";
import { fetchEcbRate, ECB_SOURCE } from "./frankfurter";

export type FxResult = {
  rateAudPerUnit: string; // decimal string, AUD per 1 unit of foreign currency
  rateDate: string;       // actual date of the published rate
  source: string;
};

export class FxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxUnavailableError";
  }
}

const LOOKBACK_DAYS = 10;

/**
 * Resolve the exchange rate for the date an expense was incurred.
 * Order: local cache -> RBA daily table -> ECB via Frankfurter.
 * Weekends/holidays resolve to the most recent published rate; the actual
 * rate date is returned and stored on the record. Once written to an
 * expense the rate is frozen — this function is only consulted at entry
 * time (or when the user explicitly re-fetches).
 */
export async function getRateForDate(dateISO: string, currency: string): Promise<FxResult> {
  const ccy = currency.toUpperCase();
  if (ccy === "AUD") return { rateAudPerUnit: "1.00000000", rateDate: dateISO, source: "n/a (AUD)" };

  const d = await db();

  // 1) Cache: EXACT-date hit only (a rate published on the requested day).
  const exact = await d
    .select()
    .from(schema.fxRates)
    .where(and(eq(schema.fxRates.currency, ccy), eq(schema.fxRates.date, dateISO)))
    .limit(1);
  if (exact.length > 0) {
    const c = exact[0];
    return { rateAudPerUnit: c.rateAudPerUnit, rateDate: c.date, source: c.source };
  }

  // 2) RBA daily table (canonical Australian source) — finds the nearest
  //    published day at or before the requested date.
  try {
    const table = await getRbaTable();
    const hit = findRbaRate(table, dateISO, ccy, LOOKBACK_DAYS);
    if (hit) {
      await cacheRate(hit.rateDate, ccy, hit.rateAudPerUnit, RBA_SOURCE);
      return { ...hit, source: RBA_SOURCE };
    }
  } catch {
    // fall through to ECB
  }

  // 3) ECB reference rates via Frankfurter (longer history, more currencies).
  try {
    const hit = await fetchEcbRate(dateISO, ccy);
    if (hit) {
      await cacheRate(hit.rateDate, ccy, hit.rateAudPerUnit, ECB_SOURCE);
      return { ...hit, source: ECB_SOURCE };
    }
  } catch {
    // fall through
  }

  // 4) Last resort when offline: most recent cached rate within the
  //    lookback window (the true rate date is recorded on the record).
  const floor = addDays(dateISO, -LOOKBACK_DAYS);
  const cached = await d
    .select()
    .from(schema.fxRates)
    .where(and(eq(schema.fxRates.currency, ccy), lte(schema.fxRates.date, dateISO), gte(schema.fxRates.date, floor)))
    .orderBy(desc(schema.fxRates.date))
    .limit(1);
  if (cached.length > 0) {
    const c = cached[0];
    return { rateAudPerUnit: c.rateAudPerUnit, rateDate: c.date, source: c.source };
  }

  throw new FxUnavailableError(
    `No rate available for ${ccy} on ${dateISO}. Enter a rate manually (with a note), or retry when online.`
  );
}

async function cacheRate(date: string, currency: string, rate: string, source: string) {
  const d = await db();
  try {
    await d
      .insert(schema.fxRates)
      .values({ id: randomUUID(), date, currency, rateAudPerUnit: rate, source, fetchedAt: new Date().toISOString() })
      .onConflictDoNothing();
  } catch {
    /* cache failures are never fatal */
  }
}
