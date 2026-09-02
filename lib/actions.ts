/**
 * The three things that might need the owner today.
 *
 * The overview asks one question — "am I behind?" — and most weeks the answer
 * is no. So this returns only what is genuinely outstanding: an unpaid
 * invoice, statement lines nobody has decided, a GST credit being forfeited
 * for want of a tax invoice. When all three are clear the screen says so,
 * which is a real state rather than a fallback.
 *
 * Everything here is derived from records already in the ledger. Nothing is
 * estimated and nothing is seeded.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { getSettings } from "./settings";
import { reviewProgress, statementsDue, monthLabel } from "./statements";
import { receiptCountMap } from "./expenses";
import { applyBp } from "./money";
import { todayInTz, daysBetween } from "./fy";

export type ActionStack = Awaited<ReturnType<typeof actionStack>>;

export async function actionStack(fy: string) {
  const d = await db();
  const settings = await getSettings();
  const today = todayInTz(process.env.APP_TIMEZONE);

  // ── 1. Money owed to the business ──────────────────────────────────────
  // Sent invoices with no payment date, oldest first — the one most overdue
  // is the one worth surfacing.
  const unpaidRows = await d
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.status, "sent"), isNull(schema.invoices.paidAt)))
    .orderBy(asc(schema.invoices.dueDate));

  const clients = unpaidRows.length ? await d.select().from(schema.clients) : [];
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "—";

  // Every unpaid invoice, not just the oldest. "1 other invoice outstanding"
  // tells you something is there without telling you what, which is the one
  // thing a prompt to chase money should never do.
  const items = unpaidRows.map((r) => ({
    id: r.id,
    number: r.number,
    client: clientName(r.clientId),
    currency: r.currency,
    totalCents: r.totalCents,
    issueDate: r.issueDate,
    dueDate: r.dueDate,
    gstTreatment: r.gstTreatment,
    overdueDays: r.dueDate < today ? daysBetween(r.dueDate, today) : 0,
  }));

  const unpaid = items.length
    ? {
        count: items.length,
        // Currencies are not summed: an invoice in USD and one in AUD have no
        // meaningful total, and the AUD figure lives on the income record.
        byCurrency: [...new Map(
          unpaidRows.map((r) => [r.currency, unpaidRows.filter((x) => x.currency === r.currency)
            .reduce((s, x) => s + x.totalCents, 0)]),
        )].map(([currency, cents]) => ({ currency, cents })),
        items,
        /** The one most overdue — the card leads with it. */
        first: items[0],
      }
    : null;

  // ── 2. Statement lines nobody has decided ──────────────────────────────
  const progress = await reviewProgress({ fy });
  const triage =
    progress.total > 0
      ? {
          undecided: progress.unreviewed,
          total: progress.total,
          // What the classifier already took off the owner's hands.
          autoFiled: progress.personal + progress.ignored,
          business: progress.logged,
        }
      : null;

  // ── 3. Statements not yet handed over ──────────────────────────────────
  // Only for accounts set to remind monthly, and only for months that have
  // actually ended — the 1st is when last month becomes uploadable.
  const due = await statementsDue(today);
  const statementDue = due.length
    ? {
        count: due.reduce((n, a) => n + a.months.length, 0),
        accounts: due.map((a) => ({ label: a.label, months: a.months.map(monthLabel) })),
        first: { label: due[0].label, month: monthLabel(due[0].months[0]) },
      }
    : null;

  // ── 4. GST credits being forfeited ─────────────────────────────────────
  // A GST purchase over the threshold with no tax invoice cannot be claimed.
  // It stays visible because it is the only thing on the screen costing money.
  const expenses = await d
    .select()
    .from(schema.expenses)
    .where(and(eq(schema.expenses.financialYear, fy), eq(schema.expenses.status, "active")));
  const receipts = await receiptCountMap(expenses.map((e) => e.id));
  const blockedRows = expenses
    .filter(
      (e) =>
        e.gstTreatment === "gst" &&
        e.audAmountCents > settings.gst_receipt_flag_cents &&
        (receipts.get(e.id) ?? 0) === 0
    )
    .sort((a, b) => applyBp(b.gstAmountCents, b.businessUseBp) - applyBp(a.gstAmountCents, a.businessUseBp));

  const blockedGst = blockedRows.length
    ? {
        count: blockedRows.length,
        totalCents: blockedRows.reduce((s, e) => s + applyBp(e.gstAmountCents, e.businessUseBp), 0),
        thresholdCents: settings.gst_receipt_flag_cents,
        first: {
          id: blockedRows[0].id,
          supplier: blockedRows[0].supplierName,
          date: blockedRows[0].dateIncurred,
          audCents: blockedRows[0].audAmountCents,
          gstCents: applyBp(blockedRows[0].gstAmountCents, blockedRows[0].businessUseBp),
        },
      }
    : null;

  return {
    fy,
    today,
    unpaid,
    triage,
    statementDue,
    blockedGst,
    /** True when nothing is outstanding — the screen's most common state. */
    allClear: !unpaid && !blockedGst && !statementDue && !(triage && triage.undecided > 0),
  };
}
