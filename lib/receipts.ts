import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getStorage, sha256Hex, extensionForMime, ALLOWED_RECEIPT_MIMES } from "./storage";
import { writeAudit } from "./audit";
import { NotFoundError, ValidationError, getExpense } from "./expenses";

export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Attach a receipt to an expense. Files are immutable: uploading when a
 * receipt already exists creates a NEW version and keeps every previous
 * version readable forever.
 */
export async function addReceipt(expenseId: string, file: { buffer: Buffer; filename: string; mime: string }) {
  const exp = await getExpense(expenseId);
  if (!exp) throw new NotFoundError("Expense not found");
  if (exp.status === "void") throw new ValidationError(["Receipts cannot be added to voided records."]);
  if (!ALLOWED_RECEIPT_MIMES.has(file.mime)) throw new ValidationError([`Unsupported file type: ${file.mime}. Use JPEG, PNG, WebP, HEIC or PDF.`]);
  if (file.buffer.length === 0) throw new ValidationError(["File is empty."]);
  if (file.buffer.length > MAX_RECEIPT_BYTES) throw new ValidationError(["File exceeds the 15 MB limit."]);

  const d = await db();
  const sha = sha256Hex(file.buffer);
  const key = `${sha}.${extensionForMime(file.mime, file.filename)}`;
  const storage = getStorage();
  const storageKey = await storage.put(key, file.buffer, file.mime);

  const existing = await d
    .select()
    .from(schema.receipts)
    .where(and(eq(schema.receipts.expenseId, expenseId), eq(schema.receipts.isCurrent, true)))
    .orderBy(desc(schema.receipts.version));
  const prev = existing[0] ?? null;
  const version = prev ? prev.version + 1 : 1;
  const id = randomUUID();
  const now = new Date().toISOString();

  await d.transaction(async (tx) => {
    if (prev) {
      await tx.update(schema.receipts).set({ isCurrent: false, replacedById: id }).where(eq(schema.receipts.id, prev.id));
    }
    await tx.insert(schema.receipts).values({
      id,
      expenseId,
      version,
      originalFilename: file.filename,
      mime: file.mime,
      sizeBytes: file.buffer.length,
      sha256: sha,
      storageDriver: storage.driver,
      storageKey,
      uploadedAt: now,
      isCurrent: true,
    });
    await writeAudit(tx, [
      {
        entityType: "expense",
        entityId: expenseId,
        action: prev ? "receipt_replace" : "receipt_add",
        field: "receipt",
        oldValue: prev ? `v${prev.version} ${prev.originalFilename} (sha256 ${prev.sha256.slice(0, 12)}…)` : null,
        newValue: `v${version} ${file.filename} (sha256 ${sha.slice(0, 12)}…)`,
        note: prev ? "Previous version retained (receipts are immutable)." : null,
      },
    ]);
  });

  const [row] = await d.select().from(schema.receipts).where(eq(schema.receipts.id, id));
  return row;
}

export async function listReceipts(expenseId: string) {
  const d = await db();
  return d
    .select()
    .from(schema.receipts)
    .where(eq(schema.receipts.expenseId, expenseId))
    .orderBy(desc(schema.receipts.version));
}

export async function getReceipt(id: string) {
  const d = await db();
  const [row] = await d.select().from(schema.receipts).where(eq(schema.receipts.id, id));
  return row ?? null;
}
