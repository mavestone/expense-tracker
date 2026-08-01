import { invertRate } from "../money";

/**
 * RBA daily exchange rates (units of foreign currency per A$1), published at
 * https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv
 * covering roughly the last 3.5 years. Values are inverted to
 * "AUD per 1 unit of foreign currency" for storage. The RBA is the ATO's
 * canonical reference source for exchange rates.
 */

const RBA_CSV_URL = process.env.RBA_CSV_URL || "https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv";

export const RBA_SOURCE = "RBA daily exchange rate";

export type RbaTable = {
  fetchedAt: number;
  /** currency -> sorted array of { date: ISO, rateAudPerUnit } (ascending date) */
  byCurrency: Map<string, { date: string; rateAudPerUnit: string }[]>;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function rbaDateToIso(d: string): string | null {
  const m = d.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

export function parseRbaCsv(text: string): RbaTable {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const titleLine = lines.find((l) => l.startsWith("Title,"));
  if (!titleLine) throw new Error("RBA CSV: Title row not found");
  const headers = titleLine.split(",");
  // Column index -> ISO currency code, from headers like "A$1=USD".
  const colCurrency = new Map<number, string>();
  headers.forEach((h, i) => {
    const m = h.trim().match(/^A\$1=([A-Z]{3})$/);
    if (m && m[1] !== "SDR") colCurrency.set(i, m[1]);
  });
  if (colCurrency.size === 0) throw new Error("RBA CSV: no currency columns found");

  const byCurrency = new Map<string, { date: string; rateAudPerUnit: string }[]>();
  for (const line of lines) {
    const cells = line.split(",");
    const iso = rbaDateToIso(cells[0] ?? "");
    if (!iso) continue;
    for (const [idx, ccy] of colCurrency) {
      const raw = (cells[idx] ?? "").trim();
      if (!raw || !/^\d+(\.\d+)?$/.test(raw)) continue;
      let arr = byCurrency.get(ccy);
      if (!arr) {
        arr = [];
        byCurrency.set(ccy, arr);
      }
      // raw = foreign units per AUD -> invert to AUD per unit.
      arr.push({ date: iso, rateAudPerUnit: invertRate(raw) });
    }
  }
  for (const arr of byCurrency.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { fetchedAt: Date.now(), byCurrency };
}

const g = globalThis as unknown as { __rbaTable?: RbaTable };
const TABLE_TTL_MS = 6 * 60 * 60 * 1000;

export async function getRbaTable(): Promise<RbaTable> {
  if (g.__rbaTable && Date.now() - g.__rbaTable.fetchedAt < TABLE_TTL_MS) return g.__rbaTable;
  const res = await fetch(RBA_CSV_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { "user-agent": "expense-tracker/1.0 (single-user record keeping)" },
  });
  if (!res.ok) throw new Error(`RBA fetch failed: HTTP ${res.status}`);
  const table = parseRbaCsv(await res.text());
  g.__rbaTable = table;
  return table;
}

/**
 * Find the RBA rate for a date. Weekends/public holidays fall back to the
 * most recent published rate within `lookbackDays`, and the actual rate
 * date is returned so it can be recorded on the expense.
 */
export function findRbaRate(
  table: RbaTable,
  dateISO: string,
  currency: string,
  lookbackDays = 10
): { rateAudPerUnit: string; rateDate: string } | null {
  const arr = table.byCurrency.get(currency.toUpperCase());
  if (!arr || arr.length === 0) return null;
  // Binary search for the latest entry with date <= dateISO.
  let lo = 0, hi = arr.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date <= dateISO) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return null;
  const hit = arr[best];
  const gapMs = Date.parse(dateISO) - Date.parse(hit.date);
  if (gapMs > lookbackDays * 86_400_000) return null;
  return { rateAudPerUnit: hit.rateAudPerUnit, rateDate: hit.date };
}
