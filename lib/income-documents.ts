import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { getStorage, sha256Hex, extensionForMime, ALLOWED_RECEIPT_MIMES } from "./storage";
import { writeAudit } from "./audit";
import { NotFoundError, ValidationError } from "./expenses";
import { getIncome } from "./income";

export const MAX_DOC_BYTES = 15 * 1024 * 1024;

/**
 * Attach an invoice document to an income record. Immutable: uploading when a
 * document already exists creates a NEW version; every previous version stays
 * readable forever (same contract as expense receipts).
 */
export async function addIncomeDocument(incomeId: string, file: { buffer: Buffer; filename: string; mime: string }) {
  const rec = await getIncome(incomeId);
  if (!rec) throw new NotFoundError("Income record not found");
  if (rec.status === "void") throw new ValidationError(["Documents cannot be added to voided records."]);
  if (!ALLOWED_RECEIPT_MIMES.has(file.mime))
    throw new ValidationError([`Unsupported file type: ${file.mime}. Use JPEG, PNG, WebP, HEIC or PDF.`]);
  if (file.buffer.length === 0) throw new ValidationError(["File is empty."]);
  if (file.buffer.length > MAX_DOC_BYTES) throw new ValidationError(["File exceeds the 15 MB limit."]);

  const d = await db();
  const sha = sha256Hex(file.buffer);
  const key = `${sha}.${extensionForMime(file.mime, file.filename)}`;
  const storage = getStorage();
  const storageKey = await storage.put(key, file.buffer, file.mime);

  const existing = await d
    .select()
    .from(schema.incomeDocuments)
    .where(and(eq(schema.incomeDocuments.incomeId, incomeId), eq(schema.incomeDocuments.isCurrent, true)))
    .orderBy(desc(schema.incomeDocuments.version));
  const prev = existing[0] ?? null;
  const version = prev ? prev.version + 1 : 1;
  const id = randomUUID();
  const now = new Date().toISOString();

  await d.transaction(async (tx) => {
    if (prev) {
      await tx.update(schema.incomeDocuments).set({ isCurrent: false, replacedById: id }).where(eq(schema.incomeDocuments.id, prev.id));
    }
    await tx.insert(schema.incomeDocuments).values({
      id,
      incomeId,
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
        entityType: "income",
        entityId: incomeId,
        action: prev ? "invoice_replace" : "invoice_add",
        field: "invoice_document",
        oldValue: prev ? `v${prev.version} ${prev.originalFilename} (sha256 ${prev.sha256.slice(0, 12)}…)` : null,
        newValue: `v${version} ${file.filename} (sha256 ${sha.slice(0, 12)}…)`,
        note: prev ? "Previous version retained (documents are immutable)." : null,
      },
    ]);
  });

  const [row] = await d.select().from(schema.incomeDocuments).where(eq(schema.incomeDocuments.id, id));
  return row;
}

export async function listIncomeDocuments(incomeId: string) {
  const d = await db();
  return d
    .select()
    .from(schema.incomeDocuments)
    .where(eq(schema.incomeDocuments.incomeId, incomeId))
    .orderBy(desc(schema.incomeDocuments.version));
}

export async function getIncomeDocument(id: string) {
  const d = await db();
  const [row] = await d.select().from(schema.incomeDocuments).where(eq(schema.incomeDocuments.id, id));
  return row ?? null;
}

/** Map of incomeId -> current document count, for list badges. */
export async function incomeDocumentCounts(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const d = await db();
  const { inArray, sql } = await import("drizzle-orm");
  const rows = await d
    .select({ incomeId: schema.incomeDocuments.incomeId, n: sql<number>`count(*)` })
    .from(schema.incomeDocuments)
    .where(and(inArray(schema.incomeDocuments.incomeId, ids), eq(schema.incomeDocuments.isCurrent, true)))
    .groupBy(schema.incomeDocuments.incomeId);
  for (const r of rows) map.set(r.incomeId, r.n);
  return map;
}
