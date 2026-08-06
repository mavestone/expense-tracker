/**
 * Closing off a financial year, and the working papers that belong to it.
 *
 * "Finalised" here means *lodged*, not *locked*. A year can legitimately need
 * an amended return, and a system that made that hard would only get worked
 * around — so this records what was lodged and warns loudly on anything dated
 * inside a closed year, rather than refusing the edit.
 */

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { ValidationError, NotFoundError } from "./expenses";
import { writeAudit } from "./audit";
import { isValidIsoDate } from "./fy";
import { getStorage, sha256Hex, extensionForMime } from "./storage";

/** Working papers, plus the lodgement paperwork itself. */
export const FY_DOCUMENT_KINDS = [
  { value: "working_paper", label: "Working paper" },
  { value: "file_note", label: "File note" },
  { value: "lodgement", label: "Lodgement receipt" },
  { value: "correspondence", label: "Correspondence" },
  { value: "other", label: "Other" },
] as const;

/** Wider than receipts: a file note is usually text, not a photo of a docket. */
export const ALLOWED_FY_DOC_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/markdown",
  "text/csv",
]);
export const MAX_FY_DOC_BYTES = 15 * 1024 * 1024;

const FY_RE = /^\d{4}-\d{2}$/;

function assertFy(fy: string) {
  if (!FY_RE.test(fy)) throw new ValidationError([`Invalid financial year label: ${fy}. Expected e.g. 2025-26.`]);
}

export type FinaliseInput = {
  lodgedDate?: string | null;
  atoReceipt?: string | null;
  taxableIncomeCents?: number | null;
  taxPayableCents?: number | null;
  note?: string | null;
};

export async function getFyClosure(fy: string) {
  assertFy(fy);
  const dbi = await db();
  const [row] = await dbi.select().from(schema.fyClosures).where(eq(schema.fyClosures.fyLabel, fy));
  return row ?? null;
}

/** True only while the year is closed — a reopened year is not finalised. */
export async function isFyFinalised(fy: string): Promise<boolean> {
  const c = await getFyClosure(fy);
  return Boolean(c && !c.reopenedAt);
}

export async function finaliseFy(fy: string, input: FinaliseInput = {}) {
  assertFy(fy);
  if (input.lodgedDate && !isValidIsoDate(input.lodgedDate))
    throw new ValidationError(["Lodged date must be a valid date."]);

  const dbi = await db();
  const existing = await getFyClosure(fy);
  const now = new Date().toISOString();
  const values = {
    finalisedAt: now,
    lodgedDate: input.lodgedDate ?? null,
    atoReceipt: input.atoReceipt?.trim() || null,
    taxableIncomeCents: input.taxableIncomeCents ?? null,
    taxPayableCents: input.taxPayableCents ?? null,
    note: input.note?.trim() || null,
    // Re-finalising after a reopen clears the reopen, closing the year again.
    reopenedAt: null,
    reopenedReason: null,
  };

  await dbi.transaction(async (tx) => {
    if (existing) {
      await tx.update(schema.fyClosures).set(values).where(eq(schema.fyClosures.id, existing.id));
    } else {
      await tx.insert(schema.fyClosures).values({ id: randomUUID(), fyLabel: fy, ...values });
    }
    await writeAudit(tx, [
      {
        entityType: "fy",
        entityId: fy,
        action: existing?.reopenedAt ? "reactivate" : "confirm",
        field: "finalised",
        newValue: input.atoReceipt ? `lodged, ATO receipt ${input.atoReceipt}` : "finalised",
        note: input.note ?? null,
      },
    ]);
  });
  return (await getFyClosure(fy))!;
}

export async function reopenFy(fy: string, reason: string) {
  assertFy(fy);
  if (!reason?.trim()) throw new ValidationError(["A reason is required to reopen a finalised year."]);
  const existing = await getFyClosure(fy);
  if (!existing) throw new NotFoundError(`FY ${fy} has not been finalised.`);

  const dbi = await db();
  await dbi.transaction(async (tx) => {
    await tx
      .update(schema.fyClosures)
      .set({ reopenedAt: new Date().toISOString(), reopenedReason: reason.trim() })
      .where(eq(schema.fyClosures.id, existing.id));
    await writeAudit(tx, [
      { entityType: "fy", entityId: fy, action: "update", field: "finalised", oldValue: "finalised", newValue: "reopened", note: reason.trim() },
    ]);
  });
  return (await getFyClosure(fy))!;
}

export async function listFyDocuments(fy: string) {
  assertFy(fy);
  const dbi = await db();
  return dbi
    .select()
    .from(schema.fyDocuments)
    .where(eq(schema.fyDocuments.fyLabel, fy))
    .orderBy(desc(schema.fyDocuments.uploadedAt));
}

export async function addFyDocument(
  fy: string,
  file: { filename: string; mime: string; bytes: Buffer },
  meta: { title?: string | null; description?: string | null; kind?: string }
) {
  assertFy(fy);
  if (!ALLOWED_FY_DOC_MIMES.has(file.mime))
    throw new ValidationError([`Unsupported file type: ${file.mime}. Use PDF, an image, or a text file.`]);
  if (file.bytes.length === 0) throw new ValidationError(["File is empty."]);
  if (file.bytes.length > MAX_FY_DOC_BYTES) throw new ValidationError(["File must be under 15 MB."]);

  const dbi = await db();
  const sha = sha256Hex(file.bytes);
  // Content-addressed, so re-uploading the same bytes is not a new document.
  const [dupe] = await dbi
    .select()
    .from(schema.fyDocuments)
    .where(and(eq(schema.fyDocuments.fyLabel, fy), eq(schema.fyDocuments.sha256, sha)));
  if (dupe) return dupe;

  const storage = getStorage();
  const key = `fy-${fy}-${sha.slice(0, 32)}.${extensionForMime(file.mime, file.filename)}`;
  const storageKey = await storage.put(key, file.bytes, file.mime);

  const id = randomUUID();
  const now = new Date().toISOString();
  await dbi.transaction(async (tx) => {
    await tx.insert(schema.fyDocuments).values({
      id,
      fyLabel: fy,
      kind: meta.kind ?? "working_paper",
      title: meta.title?.trim() || file.filename,
      description: meta.description?.trim() || null,
      originalFilename: file.filename,
      mime: file.mime,
      sizeBytes: file.bytes.length,
      sha256: sha,
      storageDriver: storage.driver,
      storageKey,
      uploadedAt: now,
    });
    await writeAudit(tx, [
      { entityType: "fy", entityId: fy, action: "receipt_add", field: "document", newValue: meta.title?.trim() || file.filename },
    ]);
  });
  const [row] = await dbi.select().from(schema.fyDocuments).where(eq(schema.fyDocuments.id, id));
  return row;
}

export async function getFyDocument(id: string) {
  const dbi = await db();
  const [row] = await dbi.select().from(schema.fyDocuments).where(eq(schema.fyDocuments.id, id));
  return row ?? null;
}

/** Every year that has ever been closed, for the reports header. */
export async function listFyClosures() {
  const dbi = await db();
  return dbi.select().from(schema.fyClosures).orderBy(desc(schema.fyClosures.fyLabel));
}
