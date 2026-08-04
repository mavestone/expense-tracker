import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { financialYear, isValidIsoDate } from "./fy";
import { getStorage, sha256Hex, getReceiptBytes } from "./storage";
import { writeAudit } from "./audit";
import { NotFoundError, ValidationError } from "./expenses";
import { classify, namesLookAlike } from "./classify";

/**
 * Statement reconciliation.
 *
 * A statement line is not a record — it is a claim that money moved. The job of
 * this module is to sit those claims next to what has actually been entered so
 * a financial year can be closed with every line either matched to a record or
 * deliberately set aside with a reason. Nothing here creates expenses or income.
 */

/**
 * unreviewed — still needs a look
 * logged     — matched to a business expense or income record
 * personal   — private spending, deliberately out of the books
 * ignored    — not spending at all (own transfers, card repayments, reversals)
 */
export type TxnStatus = "unreviewed" | "logged" | "personal" | "ignored";

export type ParsedTxn = {
  date: string;
  description: string;
  counterparty?: string | null;
  direction: "in" | "out";
  amountCents: number;
  currency?: string;
  audAmountCents?: number | null;
};

/**
 * Card settlement lags the invoice, sometimes by weeks — Adobe's 6 Feb invoice
 * was charged on the 22nd. A wide window is only safe because the merchant name
 * must agree first; among the survivors the closest date wins.
 */
const MATCH_DAY_WINDOW = 45;
/**
 * The card is charged at the provider's rate, the record is converted at the
 * RBA's, so the two rarely agree to the cent: Namecheap's invoice converts to
 * A$183.66 against a card charge of A$186.03.
 */
const MATCH_CENTS_TOLERANCE = 600;

function daysApart(a: string, b: string): number {
  return Math.abs(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
  );
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function listAccounts() {
  const d = await db();
  return d.select().from(schema.statementAccounts).orderBy(asc(schema.statementAccounts.sortOrder));
}

export async function upsertAccount(input: {
  label: string;
  institution: string;
  accountRef?: string | null;
  kind?: "bank" | "card";
  sortOrder?: number;
}) {
  const d = await db();
  const [existing] = await d
    .select()
    .from(schema.statementAccounts)
    .where(eq(schema.statementAccounts.label, input.label));
  if (existing) return existing;
  const row = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    label: input.label,
    institution: input.institution,
    accountRef: input.accountRef ?? null,
    kind: input.kind ?? "bank",
    sortOrder: input.sortOrder ?? 0,
  };
  await d.insert(schema.statementAccounts).values(row);
  return row;
}

/**
 * Store a statement file with its parsed lines. Re-ingesting the same file
 * (same sha256 on the same account) replaces its transactions rather than
 * duplicating them, so a corrected parse can simply be pushed again — but any
 * review already done on those lines is preserved by date+amount.
 */
export async function ingestStatement(input: {
  accountId: string;
  fyLabel: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  filename: string;
  mime?: string;
  fileBuffer?: Buffer | null;
  transactions: ParsedTxn[];
}) {
  const errors: string[] = [];
  if (!input.accountId) errors.push("accountId is required.");
  if (!input.fyLabel) errors.push("fyLabel is required.");
  if (!input.filename) errors.push("filename is required.");
  for (const t of input.transactions) {
    if (!isValidIsoDate(t.date)) errors.push(`Bad transaction date: ${t.date}`);
    if (!Number.isInteger(t.amountCents) || t.amountCents < 0)
      errors.push(`Bad amount on ${t.date}: ${t.amountCents}`);
    if (t.direction !== "in" && t.direction !== "out")
      errors.push(`Bad direction on ${t.date}: ${t.direction}`);
    if (errors.length > 8) break;
  }
  if (errors.length) throw new ValidationError(errors);

  const d = await db();
  const now = new Date().toISOString();

  let storageDriver = "none";
  let storageKey = "";
  let sha = "";
  let sizeBytes = 0;
  if (input.fileBuffer) {
    const s = getStorage();
    sha = sha256Hex(input.fileBuffer);
    sizeBytes = input.fileBuffer.length;
    storageDriver = s.driver;
    storageKey = await s.put(`statements/${sha}.pdf`, input.fileBuffer, input.mime ?? "application/pdf");
  } else {
    sha = sha256Hex(Buffer.from(`${input.accountId}:${input.filename}`));
  }

  // Preserve review decisions across a re-ingest of the same statement.
  const [prior] = await d
    .select()
    .from(schema.statements)
    .where(and(eq(schema.statements.accountId, input.accountId), eq(schema.statements.sha256, sha)));

  const reviewed = new Map<string, { status: string; ignoreReason: string | null; note: string | null; matchedExpenseId: string | null; matchedIncomeId: string | null; matchSource: string | null }>();
  if (prior) {
    const old = await d
      .select()
      .from(schema.statementTransactions)
      .where(eq(schema.statementTransactions.statementId, prior.id));
    for (const o of old) {
      if (o.status !== "unreviewed")
        reviewed.set(`${o.date}|${o.direction}|${o.amountCents}|${o.currency}`, {
          status: o.status,
          ignoreReason: o.ignoreReason,
          note: o.note,
          matchedExpenseId: o.matchedExpenseId,
          matchedIncomeId: o.matchedIncomeId,
          matchSource: o.matchSource,
        });
    }
    await d.delete(schema.statementTransactions).where(eq(schema.statementTransactions.statementId, prior.id));
    await d.delete(schema.statements).where(eq(schema.statements.id, prior.id));
  }

  const statementId = randomUUID();
  await d.insert(schema.statements).values({
    id: statementId,
    createdAt: now,
    accountId: input.accountId,
    fyLabel: input.fyLabel,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    filename: input.filename,
    mime: input.mime ?? "application/pdf",
    sizeBytes,
    sha256: sha,
    storageDriver,
    storageKey,
    txnCount: input.transactions.length,
  });

  const rows = input.transactions.map((t) => {
    const keep = reviewed.get(`${t.date}|${t.direction}|${t.amountCents}|${t.currency ?? "AUD"}`);
    return {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      statementId,
      accountId: input.accountId,
      fyLabel: input.fyLabel,
      date: t.date,
      description: t.description.slice(0, 400),
      counterparty: t.counterparty ?? null,
      direction: t.direction,
      amountCents: t.amountCents,
      currency: (t.currency ?? "AUD").toUpperCase(),
      audAmountCents: t.audAmountCents ?? (!t.currency || t.currency === "AUD" ? t.amountCents : null),
      status: keep?.status ?? "unreviewed",
      matchedExpenseId: keep?.matchedExpenseId ?? null,
      matchedIncomeId: keep?.matchedIncomeId ?? null,
      matchSource: keep?.matchSource ?? null,
      ignoreReason: keep?.ignoreReason ?? null,
      note: keep?.note ?? null,
    };
  });

  for (let i = 0; i < rows.length; i += 200) {
    await d.insert(schema.statementTransactions).values(rows.slice(i, i + 200));
  }

  return { statementId, inserted: rows.length, preservedReviews: reviewed.size, replaced: Boolean(prior) };
}

/**
 * Link statement lines to tracker records.
 *
 * Date proximity and amount alone are not enough — a $40 lunch four days from a
 * $40 software invoice looked like a match and produced a lot of wrong ones. The
 * merchant name now has to agree as well, so "logged" means what it says: this
 * line is a business expense or income record that exists in the tracker.
 *
 * Only ever moves a line out of "unreviewed", never overrides a decision already
 * made, and declines to guess when two candidates are equally close.
 */
export async function autoMatch(fyLabel?: string) {
  const d = await db();
  // Unreviewed lines, plus any already marked business that never got linked to
  // their record — a line ticked by hand still deserves the link back.
  const scope = or(
    eq(schema.statementTransactions.status, "unreviewed"),
    and(
      eq(schema.statementTransactions.status, "logged"),
      isNull(schema.statementTransactions.matchedExpenseId),
      isNull(schema.statementTransactions.matchedIncomeId)
    )
  )!;
  const conds = [scope];
  if (fyLabel) conds.push(eq(schema.statementTransactions.fyLabel, fyLabel));
  const txns = await d.select().from(schema.statementTransactions).where(and(...conds));

  const expenses = await d
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.status, "active"));
  const income = await d.select().from(schema.income).where(eq(schema.income.status, "active"));

  let matched = 0;
  const now = new Date().toISOString();

  // One record should not be claimed by two different statement lines.
  const usedExpense = new Set<string>();
  const usedIncome = new Set<string>();

  for (const t of txns) {
    // -1 never matches on the AUD leg, leaving the original-currency test to do the work
    const aud = t.audAmountCents ?? -1;
    const text = `${t.counterparty ?? ""} ${t.description}`;

    const amountAgrees = (recAud: number, recAmt: number, recCur: string) =>
      Math.abs(recAud - aud) <= MATCH_CENTS_TOLERANCE ||
      (recCur === t.currency && recAmt === t.amountCents);

    if (t.direction === "out") {
      const viable = expenses
        .filter((e) => !usedExpense.has(e.id))
        .filter((e) => namesLookAlike(text, e.supplierName))
        .filter((e) => amountAgrees(e.audAmountCents, e.originalAmountCents, e.originalCurrency))
        .filter((e) => daysApart(e.dateIncurred, t.date) <= MATCH_DAY_WINDOW)
        .sort(
          (a, b) =>
            daysApart(a.dateIncurred, t.date) - daysApart(b.dateIncurred, t.date) ||
            Math.abs(a.audAmountCents - aud) - Math.abs(b.audAmountCents - aud)
        );
      // decline when the two best are indistinguishable
      const best = viable[0];
      const tie =
        viable.length > 1 &&
        daysApart(viable[1].dateIncurred, t.date) === daysApart(best.dateIncurred, t.date) &&
        Math.abs(viable[1].audAmountCents - aud) === Math.abs(best.audAmountCents - aud);
      if (best && !tie) {
        usedExpense.add(best.id);
        await d
          .update(schema.statementTransactions)
          .set({
            status: "logged",
            matchedExpenseId: best.id,
            matchSource: t.matchSource ?? "auto",
            updatedAt: now,
          })
          .where(eq(schema.statementTransactions.id, t.id));
        matched++;
      }
    } else {
      const viable = income
        .filter((r) => !usedIncome.has(r.id))
        .filter((r) => namesLookAlike(text, r.clientName))
        .filter((r) => amountAgrees(r.audAmountCents, r.originalAmountCents, r.originalCurrency))
        .filter((r) => daysApart(r.datePaid ?? r.dateEarned, t.date) <= MATCH_DAY_WINDOW)
        .sort(
          (a, b) =>
            daysApart(a.datePaid ?? a.dateEarned, t.date) - daysApart(b.datePaid ?? b.dateEarned, t.date) ||
            Math.abs(a.audAmountCents - aud) - Math.abs(b.audAmountCents - aud)
        );
      const best = viable[0];
      const tie =
        viable.length > 1 &&
        daysApart(viable[1].datePaid ?? viable[1].dateEarned, t.date) ===
          daysApart(best.datePaid ?? best.dateEarned, t.date) &&
        Math.abs(viable[1].audAmountCents - aud) === Math.abs(best.audAmountCents - aud);
      if (best && !tie) {
        usedIncome.add(best.id);
        await d
          .update(schema.statementTransactions)
          .set({
            status: "logged",
            matchedIncomeId: best.id,
            matchSource: t.matchSource ?? "auto",
            updatedAt: now,
          })
          .where(eq(schema.statementTransactions.id, t.id));
        matched++;
      }
    }
  }

  return { scanned: txns.length, matched };
}

export async function setTxnReview(
  id: string,
  input: { status: TxnStatus; ignoreReason?: string | null; note?: string | null; matchedExpenseId?: string | null; matchedIncomeId?: string | null }
) {
  const d = await db();
  const [existing] = await d
    .select()
    .from(schema.statementTransactions)
    .where(eq(schema.statementTransactions.id, id));
  if (!existing) throw new NotFoundError("Statement transaction not found");
  if (!["unreviewed", "logged", "personal", "ignored"].includes(input.status))
    throw new ValidationError(["Status must be unreviewed, logged, personal or ignored."]);
  if (input.status === "ignored" && !input.ignoreReason?.trim())
    throw new ValidationError(["A reason is required to set a line aside."]);

  const now = new Date().toISOString();
  await d.transaction(async (tx) => {
    await tx
      .update(schema.statementTransactions)
      .set({
        status: input.status,
        ignoreReason: input.status === "ignored" || input.status === "personal" ? (input.ignoreReason?.trim() || null) : null,
        note: input.note ?? existing.note,
        matchedExpenseId: input.matchedExpenseId ?? (input.status === "logged" ? existing.matchedExpenseId : null),
        matchedIncomeId: input.matchedIncomeId ?? (input.status === "logged" ? existing.matchedIncomeId : null),
        matchSource: input.status === "unreviewed" ? null : "manual",
        updatedAt: now,
      })
      .where(eq(schema.statementTransactions.id, id));
    await writeAudit(tx, [
      {
        entityType: "statement_txn",
        entityId: id,
        action: "update",
        field: "status",
        oldValue: existing.status,
        newValue: input.status,
        note: input.ignoreReason ?? null,
      },
    ]);
  });
  return (await d.select().from(schema.statementTransactions).where(eq(schema.statementTransactions.id, id)))[0];
}

export type TxnFilters = {
  fy?: string;
  accountId?: string;
  status?: TxnStatus[];
  direction?: "in" | "out";
  q?: string;
  minCents?: number;
  limit?: number;
  offset?: number;
};

export async function listTransactions(f: TxnFilters = {}) {
  const d = await db();
  const conds = [];
  if (f.fy) conds.push(eq(schema.statementTransactions.fyLabel, f.fy));
  if (f.accountId) conds.push(eq(schema.statementTransactions.accountId, f.accountId));
  if (f.status?.length) conds.push(inArray(schema.statementTransactions.status, f.status));
  if (f.direction) conds.push(eq(schema.statementTransactions.direction, f.direction));
  if (f.minCents != null) conds.push(sql`coalesce(${schema.statementTransactions.audAmountCents}, 0) >= ${f.minCents}`);
  if (f.q?.trim()) {
    const q = `%${f.q.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(like(schema.statementTransactions.description, q), like(schema.statementTransactions.counterparty, q))!);
  }
  const where = conds.length ? and(...conds) : undefined;

  const limit = Math.min(f.limit ?? 200, 1000);
  const rows = await d
    .select()
    .from(schema.statementTransactions)
    .where(where)
    .orderBy(desc(schema.statementTransactions.date), desc(schema.statementTransactions.amountCents))
    .limit(limit)
    .offset(f.offset ?? 0);

  const [totals] = await d
    .select({
      count: sql<number>`count(*)`,
      // only rows with a real AUD figure — a raw IDR amount summed as dollars is nonsense
      outCents: sql<number>`coalesce(sum(case when ${schema.statementTransactions.direction} = 'out' then coalesce(${schema.statementTransactions.audAmountCents}, 0) else 0 end), 0)`,
      inCents: sql<number>`coalesce(sum(case when ${schema.statementTransactions.direction} = 'in' then coalesce(${schema.statementTransactions.audAmountCents}, 0) else 0 end), 0)`,
      unconverted: sql<number>`sum(case when ${schema.statementTransactions.audAmountCents} is null then 1 else 0 end)`,
    })
    .from(schema.statementTransactions)
    .where(where);

  return { transactions: rows, totals, hasMore: rows.length === limit };
}

/** Per-status counts for the current filter, so the UI can show progress. */
export async function reviewProgress(f: Pick<TxnFilters, "fy" | "accountId">) {
  const d = await db();
  const conds = [];
  if (f.fy) conds.push(eq(schema.statementTransactions.fyLabel, f.fy));
  if (f.accountId) conds.push(eq(schema.statementTransactions.accountId, f.accountId));
  const rows = await d
    .select({ status: schema.statementTransactions.status, n: sql<number>`count(*)` })
    .from(schema.statementTransactions)
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(schema.statementTransactions.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const total = rows.reduce((s, r) => s + r.n, 0);
  const done = (by.logged ?? 0) + (by.personal ?? 0) + (by.ignored ?? 0);
  return {
    total,
    unreviewed: by.unreviewed ?? 0,
    logged: by.logged ?? 0,
    personal: by.personal ?? 0,
    ignored: by.ignored ?? 0,
    donePct: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

/** Accounts with their statements and per-account progress, for the index view. */
export async function statementsOverview(fy?: string) {
  const d = await db();
  const accounts = await listAccounts();
  const stConds = fy ? [eq(schema.statements.fyLabel, fy)] : [];
  const sts = await d
    .select()
    .from(schema.statements)
    .where(stConds.length ? and(...stConds) : undefined)
    .orderBy(asc(schema.statements.periodStart));

  const out = [];
  for (const a of accounts) {
    const mine = sts.filter((s) => s.accountId === a.id);
    if (fy && mine.length === 0) continue;
    out.push({
      ...a,
      progress: await reviewProgress({ fy, accountId: a.id }),
      statements: mine.map((s) => ({
        id: s.id,
        fyLabel: s.fyLabel,
        filename: s.filename,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        sizeBytes: s.sizeBytes,
        txnCount: s.txnCount,
        hasFile: Boolean(s.storageKey),
      })),
    });
  }
  return { accounts: out, financialYears: [...new Set(sts.map((s) => s.fyLabel))].sort().reverse() };
}

export async function getStatementFile(id: string) {
  const d = await db();
  const [s] = await d.select().from(schema.statements).where(eq(schema.statements.id, id));
  if (!s) throw new NotFoundError("Statement not found");
  if (!s.storageKey) throw new NotFoundError("No original file was stored for this statement");
  const buf = await getReceiptBytes({ storageDriver: s.storageDriver, storageKey: s.storageKey });
  return { buffer: buf, filename: s.filename, mime: s.mime };
}

/** Remove a statement and its lines — for a file uploaded in error or parsed wrongly. */
export async function deleteStatement(id: string) {
  const d = await db();
  const [s] = await d.select().from(schema.statements).where(eq(schema.statements.id, id));
  if (!s) throw new NotFoundError("Statement not found");
  const [{ n }] = await d
    .select({ n: sql<number>`count(*)` })
    .from(schema.statementTransactions)
    .where(eq(schema.statementTransactions.statementId, id));
  await d.delete(schema.statementTransactions).where(eq(schema.statementTransactions.statementId, id));
  await d.delete(schema.statements).where(eq(schema.statements.id, id));
  // The stored file is content-addressed and may be shared; it is left in place.
  return { deleted: true, filename: s.filename, removedTransactions: n };
}


/**
 * Clear every automatic decision, leaving anything the owner touched by hand.
 * Used when the matcher itself changes and its previous output can't be trusted.
 */
export async function resetAutoDecisions(fyLabel?: string) {
  const d = await db();
  const conds = [eq(schema.statementTransactions.matchSource, "auto")];
  if (fyLabel) conds.push(eq(schema.statementTransactions.fyLabel, fyLabel));
  const now = new Date().toISOString();
  const [{ n }] = await d
    .select({ n: sql<number>`count(*)` })
    .from(schema.statementTransactions)
    .where(and(...conds));
  // one statement, not one per row — this runs against remote SQLite
  await d
    .update(schema.statementTransactions)
    .set({ status: "unreviewed", matchedExpenseId: null, matchedIncomeId: null, matchSource: null, ignoreReason: null, updatedAt: now })
    .where(and(...conds));
  return { cleared: n };
}

/**
 * Sort the obvious noise out of the way: everyday private spending becomes
 * "personal", movements between the owner's own accounts become "ignored".
 * Only touches unreviewed lines, and never classifies a retailer that sells both
 * business and personal goods.
 */
export async function triage(fyLabel?: string) {
  const d = await db();
  const conds = [eq(schema.statementTransactions.status, "unreviewed")];
  if (fyLabel) conds.push(eq(schema.statementTransactions.fyLabel, fyLabel));
  const rows = await d.select().from(schema.statementTransactions).where(and(...conds));

  const now = new Date().toISOString();
  // Group by the decision so this is a couple of dozen statements, not a thousand.
  const buckets = new Map<string, { status: string; label: string; ids: string[] }>();
  for (const r of rows) {
    // a nil-value line moved no money — a card verification hold, not spending
    const c =
      r.amountCents === 0
        ? { verdict: "internal" as const, label: "Zero value — no money moved" }
        : classify(`${r.counterparty ?? ""} ${r.description}`);
    if (c.verdict === "unsure") continue;
    const status = c.verdict === "personal" ? "personal" : "ignored";
    const key = `${status}|${c.label}`;
    const b = buckets.get(key) ?? { status, label: c.label ?? "", ids: [] };
    b.ids.push(r.id);
    buckets.set(key, b);
  }

  let personal = 0;
  let internal = 0;
  for (const b of buckets.values()) {
    for (let i = 0; i < b.ids.length; i += 400) {
      const chunk = b.ids.slice(i, i + 400);
      await d
        .update(schema.statementTransactions)
        .set({ status: b.status, ignoreReason: b.label, matchSource: "auto", updatedAt: now })
        .where(inArray(schema.statementTransactions.id, chunk));
    }
    if (b.status === "personal") personal += b.ids.length;
    else internal += b.ids.length;
  }
  return { scanned: rows.length, personal, internal, left: rows.length - personal - internal };
}

/** Apply one decision to many lines at once, for working through a backlog. */
export async function bulkReview(
  ids: string[],
  input: { status: TxnStatus; ignoreReason?: string | null }
) {
  if (!ids.length) return { updated: 0 };
  if (!["unreviewed", "logged", "personal", "ignored"].includes(input.status))
    throw new ValidationError(["Status must be unreviewed, logged, personal or ignored."]);
  if (input.status === "ignored" && !input.ignoreReason?.trim())
    throw new ValidationError(["A reason is required to set lines aside."]);

  const d = await db();
  const now = new Date().toISOString();
  const reason =
    input.status === "ignored" || input.status === "personal" ? input.ignoreReason?.trim() || null : null;

  let updated = 0;
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    await d
      .update(schema.statementTransactions)
      .set({
        status: input.status,
        ignoreReason: reason,
        matchSource: input.status === "unreviewed" ? null : "manual",
        updatedAt: now,
      })
      .where(inArray(schema.statementTransactions.id, chunk));
    updated += chunk.length;
  }

  await d.transaction(async (tx) => {
    await writeAudit(tx, [
      {
        entityType: "statement_txn",
        entityId: `bulk:${ids.length}`,
        action: "update",
        field: "status",
        oldValue: null,
        newValue: input.status,
        note: reason ?? `${ids.length} lines`,
      },
    ]);
  });
  return { updated };
}
