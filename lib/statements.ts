import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { financialYear, isValidIsoDate } from "./fy";
import { getStorage, sha256Hex, getReceiptBytes } from "./storage";
import { writeAudit } from "./audit";
import { NotFoundError, ValidationError } from "./expenses";

/**
 * Statement reconciliation.
 *
 * A statement line is not a record — it is a claim that money moved. The job of
 * this module is to sit those claims next to what has actually been entered so
 * a financial year can be closed with every line either matched to a record or
 * deliberately set aside with a reason. Nothing here creates expenses or income.
 */

export type TxnStatus = "unreviewed" | "logged" | "ignored";

export type ParsedTxn = {
  date: string;
  description: string;
  counterparty?: string | null;
  direction: "in" | "out";
  amountCents: number;
  currency?: string;
  audAmountCents?: number | null;
};

/** Matching window: card charges often settle a day or two after the invoice. */
const MATCH_DAY_WINDOW = 4;
/** Tolerance on the AUD comparison, to absorb rounding between rate sources. */
const MATCH_CENTS_TOLERANCE = 200;

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
 * Link statement lines to tracker records by date proximity and AUD amount.
 * Only ever moves a line from "unreviewed" to "logged" — it never overrides a
 * decision already made, and never guesses when two candidates are equally close.
 */
export async function autoMatch(fyLabel?: string) {
  const d = await db();
  const conds = [eq(schema.statementTransactions.status, "unreviewed")];
  if (fyLabel) conds.push(eq(schema.statementTransactions.fyLabel, fyLabel));
  const txns = await d.select().from(schema.statementTransactions).where(and(...conds));

  const expenses = await d
    .select()
    .from(schema.expenses)
    .where(eq(schema.expenses.status, "active"));
  const income = await d.select().from(schema.income).where(eq(schema.income.status, "active"));

  let matched = 0;
  const now = new Date().toISOString();

  for (const t of txns) {
    const aud = t.audAmountCents;
    if (aud == null) continue;
    const lo = shiftDays(t.date, -MATCH_DAY_WINDOW);
    const hi = shiftDays(t.date, MATCH_DAY_WINDOW);

    if (t.direction === "out") {
      const hits = expenses.filter(
        (e) =>
          e.dateIncurred >= lo &&
          e.dateIncurred <= hi &&
          Math.abs(e.audAmountCents - aud) <= MATCH_CENTS_TOLERANCE
      );
      if (hits.length === 1) {
        await d
          .update(schema.statementTransactions)
          .set({ status: "logged", matchedExpenseId: hits[0].id, matchSource: "auto", updatedAt: now })
          .where(eq(schema.statementTransactions.id, t.id));
        matched++;
      }
    } else {
      const hits = income.filter(
        (r) =>
          ((r.datePaid ?? r.dateEarned) >= lo && (r.datePaid ?? r.dateEarned) <= hi) &&
          Math.abs(r.audAmountCents - aud) <= MATCH_CENTS_TOLERANCE
      );
      if (hits.length === 1) {
        await d
          .update(schema.statementTransactions)
          .set({ status: "logged", matchedIncomeId: hits[0].id, matchSource: "auto", updatedAt: now })
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
  if (!["unreviewed", "logged", "ignored"].includes(input.status))
    throw new ValidationError(["Status must be unreviewed, logged or ignored."]);
  if (input.status === "ignored" && !input.ignoreReason?.trim())
    throw new ValidationError(["A reason is required to set a line aside."]);

  const now = new Date().toISOString();
  await d.transaction(async (tx) => {
    await tx
      .update(schema.statementTransactions)
      .set({
        status: input.status,
        ignoreReason: input.status === "ignored" ? input.ignoreReason!.trim() : null,
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
  if (f.minCents != null) conds.push(sql`coalesce(${schema.statementTransactions.audAmountCents}, ${schema.statementTransactions.amountCents}) >= ${f.minCents}`);
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
      outCents: sql<number>`coalesce(sum(case when ${schema.statementTransactions.direction} = 'out' then coalesce(${schema.statementTransactions.audAmountCents}, ${schema.statementTransactions.amountCents}) else 0 end), 0)`,
      inCents: sql<number>`coalesce(sum(case when ${schema.statementTransactions.direction} = 'in' then coalesce(${schema.statementTransactions.audAmountCents}, ${schema.statementTransactions.amountCents}) else 0 end), 0)`,
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
  return {
    total,
    unreviewed: by.unreviewed ?? 0,
    logged: by.logged ?? 0,
    ignored: by.ignored ?? 0,
    donePct: total > 0 ? Math.round((((by.logged ?? 0) + (by.ignored ?? 0)) / total) * 100) : 0,
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
