/**
 * Australian financial year helpers. FY runs 1 July – 30 June.
 * FY labels look like "2025-26" (the year beginning 1 July 2025).
 * Dates are plain "YYYY-MM-DD" strings — no timezone math is ever applied
 * to a stored date.
 */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(d: string): boolean {
  if (!ISO_DATE_RE.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return day >= 1 && day <= dim;
}

/** "2025-09-14" -> "2025-26" */
export function financialYear(dateISO: string): string {
  const [y, m] = dateISO.split("-").map(Number);
  const startYear = m >= 7 ? y : y - 1;
  return fyLabel(startYear);
}

export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** "2025-26" -> { start: "2025-07-01", end: "2026-06-30" } */
export function fyRange(label: string): { start: string; end: string } {
  const m = label.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`Invalid FY label: ${label}`);
  const startYear = Number(m[1]);
  return { start: `${startYear}-07-01`, end: `${startYear + 1}-06-30` };
}

export type BasQuarter = "Q1" | "Q2" | "Q3" | "Q4";

/** BAS quarters within an FY: Q1 Jul–Sep, Q2 Oct–Dec, Q3 Jan–Mar, Q4 Apr–Jun. */
export function fyQuarter(dateISO: string): BasQuarter {
  const m = Number(dateISO.split("-")[1]);
  if (m >= 7 && m <= 9) return "Q1";
  if (m >= 10) return "Q2";
  if (m <= 3) return "Q3";
  return "Q4";
}

export function quarterLabel(fy: string, q: BasQuarter): string {
  const startYear = Number(fy.slice(0, 4));
  switch (q) {
    case "Q1": return `Jul–Sep ${startYear}`;
    case "Q2": return `Oct–Dec ${startYear}`;
    case "Q3": return `Jan–Mar ${startYear + 1}`;
    case "Q4": return `Apr–Jun ${startYear + 1}`;
  }
}

/** Today's date (YYYY-MM-DD) in the configured business timezone. */
export function todayInTz(tz?: string): string {
  const timeZone = tz || process.env.APP_TIMEZONE || "Australia/Sydney";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function currentFy(tz?: string): string {
  return financialYear(todayInTz(tz));
}

/** Add days to an ISO date (UTC-safe on plain dates). */
export function addDays(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Difference in whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * Advance a renewal date by one billing period. Monthly billing keeps the
 * anchor day-of-month where possible (clamping to the end of shorter months).
 */
export function advanceRenewal(dateISO: string, frequency: "monthly" | "annual", anchorDay?: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const day = anchorDay ?? d;
  if (frequency === "annual") {
    const dim = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    return `${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(day, dim)).padStart(2, "0")}`;
  }
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(day, dim)).padStart(2, "0")}`;
}

/** Display helper: "2025-09-14" -> "14/09/2025" (Australian convention). */
export function formatDateAU(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  return `${d}/${m}/${y}`;
}
