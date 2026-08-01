import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { advanceRenewal, daysBetween, isValidIsoDate, todayInTz } from "./fy";
import { isGstTreatment } from "./gst";
import { writeAudit, diffFields } from "./audit";
import { createExpense, ValidationError, NotFoundError } from "./expenses";
import { getRateForDate } from "./fx";
import { applyRate } from "./money";
import { getSettings } from "./settings";
import type { Subscription } from "./db/schema";

export type SubscriptionInput = {
  vendor: string;
  description?: string | null;
  amountCents: number;
  currency: string;
  frequency: "monthly" | "annual";
  nextRenewalDate: string;
  businessUseBp: number;
  categoryId: string;
  gstTreatment: string;
  paymentMethod?: string | null;
  supplierAbn?: string | null;
  notes?: string | null;
};

function validate(input: SubscriptionInput): string[] {
  const errors: string[] = [];
  if (!input.vendor?.trim()) errors.push("Vendor is required.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) errors.push("Amount must be greater than zero.");
  if (!/^[A-Z]{3}$/.test((input.currency || "").toUpperCase())) errors.push("Currency must be a 3-letter ISO code.");
  if (input.frequency !== "monthly" && input.frequency !== "annual") errors.push("Frequency must be monthly or annual.");
  if (!isValidIsoDate(input.nextRenewalDate)) errors.push("Next renewal date is invalid.");
  if (!Number.isInteger(input.businessUseBp) || input.businessUseBp < 0 || input.businessUseBp > 10000) errors.push("Business use must be 0–100%.");
  if (!input.categoryId) errors.push("Category is required.");
  if (!isGstTreatment(input.gstTreatment)) errors.push("Invalid GST treatment.");
  return errors;
}

export async function createSubscription(input: SubscriptionInput): Promise<Subscription> {
  const errors = validate(input);
  if (errors.length) throw new ValidationError(errors);
  const d = await db();
  const id = randomUUID();
  const anchorDay = Number(input.nextRenewalDate.split("-")[2]);
  await d.transaction(async (tx) => {
    await tx.insert(schema.subscriptions).values({
      id,
      createdAt: new Date().toISOString(),
      vendor: input.vendor.trim(),
      description: input.description?.trim() || null,
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      frequency: input.frequency,
      nextRenewalDate: input.nextRenewalDate,
      anchorDay,
      businessUseBp: input.businessUseBp,
      categoryId: input.categoryId,
      gstTreatment: input.gstTreatment,
      paymentMethod: input.paymentMethod?.trim() || null,
      supplierAbn: input.supplierAbn?.trim() || null,
      notes: input.notes?.trim() || null,
      active: true,
    });
    await writeAudit(tx, [
      { entityType: "subscription", entityId: id, action: "create", newValue: `${input.vendor} ${input.currency} ${(input.amountCents / 100).toFixed(2)} ${input.frequency}` },
    ]);
  });
  const [row] = await d.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id));
  return row;
}

const SUB_AUDITED_FIELDS = [
  "vendor", "description", "amountCents", "currency", "frequency", "nextRenewalDate",
  "businessUseBp", "categoryId", "gstTreatment", "paymentMethod", "supplierAbn", "notes",
];

export async function updateSubscription(id: string, input: SubscriptionInput): Promise<Subscription> {
  const errors = validate(input);
  if (errors.length) throw new ValidationError(errors);
  const d = await db();
  const [existing] = await d.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id));
  if (!existing) throw new NotFoundError("Subscription not found");
  const patch = {
    vendor: input.vendor.trim(),
    description: input.description?.trim() || null,
    amountCents: input.amountCents,
    currency: input.currency.toUpperCase(),
    frequency: input.frequency,
    nextRenewalDate: input.nextRenewalDate,
    anchorDay: Number(input.nextRenewalDate.split("-")[2]),
    businessUseBp: input.businessUseBp,
    categoryId: input.categoryId,
    gstTreatment: input.gstTreatment,
    paymentMethod: input.paymentMethod?.trim() || null,
    supplierAbn: input.supplierAbn?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  const entries = diffFields("subscription", id, existing as unknown as Record<string, unknown>, patch, SUB_AUDITED_FIELDS as string[]);
  await d.transaction(async (tx) => {
    await tx.update(schema.subscriptions).set(patch).where(eq(schema.subscriptions.id, id));
    await writeAudit(tx, entries);
  });
  const [row] = await d.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id));
  return row;
}

export async function setSubscriptionActive(id: string, active: boolean): Promise<Subscription> {
  const d = await db();
  const [existing] = await d.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id));
  if (!existing) throw new NotFoundError("Subscription not found");
  await d.transaction(async (tx) => {
    await tx
      .update(schema.subscriptions)
      .set({ active, canceledAt: active ? null : new Date().toISOString() })
      .where(eq(schema.subscriptions.id, id));
    await writeAudit(tx, [
      { entityType: "subscription", entityId: id, action: active ? "reactivate" : "cancel", field: "active", oldValue: existing.active, newValue: active },
    ]);
  });
  const [row] = await d.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id));
  return row;
}

/**
 * Generate DRAFT expense records for every renewal that has fallen due.
 * Drafts are confirmed (or edited/skipped) by the user — nothing posts
 * silently. Safe to call repeatedly (idempotent per renewal date) and is
 * invoked lazily on app use plus optionally by Vercel Cron.
 */
export async function ensureRenewalDrafts(): Promise<{ generated: number }> {
  const d = await db();
  const today = todayInTz();
  const subs = await d.select().from(schema.subscriptions).where(eq(schema.subscriptions.active, true));
  let generated = 0;

  for (const sub of subs) {
    let renewal = sub.nextRenewalDate;
    let guard = 0;
    while (renewal <= today && guard < 64) {
      guard++;
      // Idempotency: skip if a non-void expense already exists for this sub + date.
      const existing = await d
        .select({ id: schema.expenses.id })
        .from(schema.expenses)
        .where(
          and(
            eq(schema.expenses.subscriptionId, sub.id),
            eq(schema.expenses.dateIncurred, renewal),
            inArray(schema.expenses.status, ["draft", "active"])
          )
        )
        .limit(1);
      if (existing.length === 0) {
        await createExpense(
          {
            dateIncurred: renewal,
            supplierName: sub.vendor,
            supplierAbn: sub.supplierAbn,
            description: sub.description || `${sub.vendor} subscription (${sub.frequency})`,
            categoryId: sub.categoryId,
            originalAmountCents: sub.amountCents,
            originalCurrency: sub.currency,
            gstTreatment: sub.gstTreatment as "gst" | "gst_free" | "input_taxed",
            businessUseBp: sub.businessUseBp,
            paymentMethod: sub.paymentMethod,
            notes: null,
          },
          { status: "draft", source: "subscription", subscriptionId: sub.id, resolveFx: true, auditNote: "Draft generated on renewal date" }
        );
        generated++;
      }
      renewal = advanceRenewal(renewal, sub.frequency as "monthly" | "annual", sub.anchorDay);
    }
    if (renewal !== sub.nextRenewalDate) {
      await d.update(schema.subscriptions).set({ nextRenewalDate: renewal }).where(eq(schema.subscriptions.id, sub.id));
    }
  }
  return { generated };
}

export type SubscriptionOverview = Subscription & {
  lastConfirmedDate: string | null;
  pendingDraftCount: number;
  oldestPendingDraftDate: string | null;
  stale: boolean;
  estAnnualAudCents: number | null;
  estAudPerPeriodCents: number | null;
};

/**
 * Overview with staleness: a subscription is flagged when a generated
 * renewal draft has sat unconfirmed for more than the configured number of
 * days (default 60) — i.e. a renewal happened but no payment was ever
 * confirmed against it. Likely a subscription you forgot to cancel.
 */
export async function subscriptionOverview(): Promise<{
  subscriptions: SubscriptionOverview[];
  totalAnnualAudCents: number;
  fxIncomplete: boolean;
}> {
  const d = await db();
  const today = todayInTz();
  const settings = await getSettings();
  const staleDays = settings.subscription_stale_days ?? 60;
  const subs = await d.select().from(schema.subscriptions).orderBy(desc(schema.subscriptions.active), schema.subscriptions.vendor);

  const out: SubscriptionOverview[] = [];
  let totalAnnual = 0;
  let fxIncomplete = false;

  for (const sub of subs) {
    const linked = await d
      .select({ date: schema.expenses.dateIncurred, status: schema.expenses.status })
      .from(schema.expenses)
      .where(and(eq(schema.expenses.subscriptionId, sub.id), inArray(schema.expenses.status, ["draft", "active"])))
      .orderBy(desc(schema.expenses.dateIncurred));

    const lastConfirmed = linked.find((l) => l.status === "active")?.date ?? null;
    const drafts = linked.filter((l) => l.status === "draft");
    const oldestDraft = drafts.length ? drafts[drafts.length - 1].date : null;
    const stale = !!(sub.active && oldestDraft && daysBetween(oldestDraft, today) > staleDays);

    // Annual AUD estimate at the most recent known rate (display-only, marked approximate).
    let perPeriodAud: number | null = null;
    if (sub.currency === "AUD") {
      perPeriodAud = sub.amountCents;
    } else {
      try {
        const r = await getRateForDate(today, sub.currency);
        perPeriodAud = applyRate(sub.amountCents, r.rateAudPerUnit);
      } catch {
        fxIncomplete = true;
      }
    }
    const estAnnual = perPeriodAud == null ? null : sub.frequency === "monthly" ? perPeriodAud * 12 : perPeriodAud;
    if (sub.active && estAnnual != null) totalAnnual += estAnnual;

    out.push({
      ...sub,
      lastConfirmedDate: lastConfirmed,
      pendingDraftCount: drafts.length,
      oldestPendingDraftDate: oldestDraft,
      stale,
      estAnnualAudCents: estAnnual,
      estAudPerPeriodCents: perPeriodAud,
    });
  }

  return { subscriptions: out, totalAnnualAudCents: totalAnnual, fxIncomplete };
}
