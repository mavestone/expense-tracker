import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db";

/**
 * Append-only audit trail. Every create, field-level update, void, receipt
 * event and import writes rows here. Nothing in the app ever deletes or
 * updates audit rows.
 */

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string | null;
};

type TxLike = { insert: (typeof schema.auditLog extends never ? never : any) };

function serialize(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function auditRow(e: AuditEntry) {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    field: e.field ?? null,
    oldValue: serialize(e.oldValue),
    newValue: serialize(e.newValue),
    note: e.note ?? null,
  };
}

/** Write audit rows inside an existing drizzle transaction (or plain db). */
export async function writeAudit(tx: TxLike, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await (tx as any).insert(schema.auditLog).values(entries.map(auditRow));
}

/**
 * Diff two objects across the given fields, producing one audit entry per
 * changed field with old and new values.
 */
export function diffFields<T extends Record<string, unknown>>(
  entityType: string,
  entityId: string,
  before: T,
  after: Partial<T>,
  fields: (keyof T & string)[],
  note?: string | null
): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (const f of fields) {
    if (!(f in after)) continue;
    const oldV = before[f];
    const newV = after[f];
    const same =
      oldV === newV ||
      (oldV === null && (newV === null || newV === "")) ||
      ((oldV === "" || oldV === undefined) && (newV === null || newV === ""));
    if (same) continue;
    entries.push({ entityType, entityId, action: "update", field: f, oldValue: oldV, newValue: newV, note });
  }
  return entries;
}

export async function getAuditForEntity(entityType: string, entityId: string) {
  const d = await db();
  return d
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.entityType, entityType), eq(schema.auditLog.entityId, entityId)))
    .orderBy(desc(schema.auditLog.at));
}

export async function getRecentAudit(limit = 200, offset = 0) {
  const d = await db();
  return d.select().from(schema.auditLog).orderBy(desc(schema.auditLog.at)).limit(limit).offset(offset);
}
