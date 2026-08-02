import archiver from "archiver";
import { PassThrough, Readable } from "stream";
import { db, schema } from "./db";
import { getReceiptBytes } from "./storage";
import { eq } from "drizzle-orm";

/**
 * One-click full backup: a zip containing
 *   - data.json      (every table, verbatim)
 *   - manifest.json  (schema version, table counts, receipt hashes)
 *   - receipts/      (every receipt file version, named <sha256>.<ext>)
 * Everything is plain JSON + original files, readable without this app —
 * that's the 7-year retention story even if the software stops running.
 */

export const BACKUP_SCHEMA_VERSION = 1;

export async function buildBackupStream(opts: { fy?: string } = {}): Promise<{ stream: Readable; filename: string }> {
  const d = await db();

  const [
    expensesRows,
    receiptRows,
    subscriptionRows,
    categoryRows,
    paymentMethodRows,
    auditRows,
    settingsRows,
    thresholdRows,
    fxRows,
    importBatchRows,
    incomeRows,
    incomeDocRows,
  ] = await Promise.all([
    opts.fy
      ? d.select().from(schema.expenses).where(eq(schema.expenses.financialYear, opts.fy))
      : d.select().from(schema.expenses),
    d.select().from(schema.receipts),
    d.select().from(schema.subscriptions),
    d.select().from(schema.categories),
    d.select().from(schema.paymentMethods),
    d.select().from(schema.auditLog),
    d.select().from(schema.settings),
    d.select().from(schema.fyThresholds),
    d.select().from(schema.fxRates),
    d.select().from(schema.importBatches),
    opts.fy
      ? d.select().from(schema.income).where(eq(schema.income.financialYear, opts.fy))
      : d.select().from(schema.income),
    d.select().from(schema.incomeDocuments),
  ]);

  const expenseIds = new Set(expensesRows.map((e) => e.id));
  const receipts = opts.fy ? receiptRows.filter((r) => expenseIds.has(r.expenseId)) : receiptRows;
  const incomeIds = new Set(incomeRows.map((r) => r.id));
  const incomeDocs = opts.fy ? incomeDocRows.filter((r) => incomeIds.has(r.incomeId)) : incomeDocRows;

  const data = {
    exportedAt: new Date().toISOString(),
    schemaVersion: BACKUP_SCHEMA_VERSION,
    scope: opts.fy ?? "all",
    expenses: expensesRows,
    income: incomeRows,
    incomeDocuments: incomeDocs,
    receipts,
    subscriptions: subscriptionRows,
    categories: categoryRows,
    paymentMethods: paymentMethodRows,
    auditLog: auditRows,
    settings: settingsRows,
    fyThresholds: thresholdRows,
    fxRates: fxRows,
    importBatches: importBatchRows,
  };

  const manifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: data.exportedAt,
    scope: data.scope,
    counts: {
      expenses: expensesRows.length,
      income: incomeRows.length,
      receipts: receipts.length,
      incomeDocuments: incomeDocs.length,
      subscriptions: subscriptionRows.length,
      auditLog: auditRows.length,
    },
    receiptFiles: receipts.map((r) => ({
      file: `receipts/${r.sha256}.${r.originalFilename.split(".").pop() || "bin"}`,
      sha256: r.sha256,
      expenseId: r.expenseId,
      version: r.version,
      originalFilename: r.originalFilename,
    })),
    invoiceFiles: incomeDocs.map((r) => ({
      file: `invoices/${r.sha256}.${r.originalFilename.split(".").pop() || "bin"}`,
      sha256: r.sha256,
      incomeId: r.incomeId,
      version: r.version,
      originalFilename: r.originalFilename,
    })),
  };

  const archive = archiver("zip", { zlib: { level: 6 } });
  const out = new PassThrough();
  archive.pipe(out);

  archive.append(JSON.stringify(data, null, 2), { name: "data.json" });
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  archive.append(
    [
      "Expense Tracker backup",
      `Exported: ${data.exportedAt}`,
      `Scope: ${data.scope === "all" ? "all financial years" : "FY " + data.scope}`,
      "",
      "data.json      — every record (expenses, income, receipts metadata, subscriptions, audit log, settings).",
      "manifest.json  — table counts and the SHA-256 of every receipt file for integrity checks.",
      "receipts/      — every expense receipt version, named by content hash.",
      "invoices/      — every income invoice document version, named by content hash.",
      "",
      "All amounts in data.json are integer cents. Dates are YYYY-MM-DD.",
    ].join("\n"),
    { name: "README.txt" }
  );

  // Deduplicate by content hash (same file may back multiple versions/records).
  const seen = new Set<string>();
  const appendFiles = async (rows: { id: string; sha256: string; originalFilename: string; storageDriver: string; storageKey: string }[], dir: string) => {
    for (const r of rows) {
      const ext = r.originalFilename.split(".").pop() || "bin";
      const name = `${dir}/${r.sha256}.${ext}`;
      if (seen.has(name)) continue;
      seen.add(name);
      try {
        archive.append(await getReceiptBytes(r), { name });
      } catch (e) {
        archive.append(`Could not read ${r.id} (${r.originalFilename}): ${(e as Error).message}\n`, {
          name: `${dir}/MISSING-${r.sha256}.txt`,
        });
      }
    }
  };
  await appendFiles(receipts, "receipts");
  await appendFiles(incomeDocs, "invoices");

  void archive.finalize();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = opts.fy ? `expense-backup-FY${opts.fy}-${stamp}.zip` : `expense-backup-full-${stamp}.zip`;
  return { stream: out, filename };
}
