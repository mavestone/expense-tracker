/**
 * Date and money formatting for the reimbursement document.
 *
 * Shared because that document is rendered twice — once as the printable page
 * and once as the PDF — and those two drifting is the standing risk in this
 * area. Anything visible on both belongs here rather than in either one.
 */

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08-04" -> "04 Aug". The year lives in the period line, not on every row. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d} ${SHORT_MONTHS[Number(m) - 1] ?? ""}`.trim();
}

/** "2026-08-28" -> "28 August 2026". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${LONG_MONTHS[Number(m) - 1] ?? ""} ${y}`.replace(/\s+/g, " ").trim();
}

/**
 * The span the costs were incurred over, collapsed as far as it honestly can
 * be: "4 – 20 August 2026" inside one month, "4 August – 3 September 2026"
 * across two. A single date prints on its own rather than as a range of one.
 */
export function periodLabel(dates: string[]): string {
  const sorted = [...dates].filter(Boolean).sort();
  if (sorted.length === 0) return "";
  const one = (iso: string, withMonth = true, withYear = true) => {
    const [y, m, d] = iso.split("-");
    return [String(Number(d)), withMonth ? LONG_MONTHS[Number(m) - 1] : null, withYear ? y : null]
      .filter(Boolean)
      .join(" ");
  };
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  if (a === b) return one(a);
  const [ay, am] = a.split("-");
  const [by, bm] = b.split("-");
  if (ay === by && am === bm) return `${one(a, false, false)} – ${one(b)}`;
  if (ay === by) return `${one(a, true, false)} – ${one(b)}`;
  return `${one(a)} – ${one(b)}`;
}

/** Bare decimal — the currency is stated once, in the column head and total. */
export function plainAmount(cents: number): string {
  return (cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function isUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}
