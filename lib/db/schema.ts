import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * All money columns are INTEGER CENTS. All dates are "YYYY-MM-DD" strings.
 * All timestamps are ISO-8601 UTC strings. FX rates are decimal strings.
 * Records are never hard-deleted: expenses are voided, receipts are
 * versioned, and every change is written to audit_log.
 */

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON-encoded
});

/** Instant asset write-off threshold per financial year (set by the user, never hardcoded). */
export const fyThresholds = sqliteTable("fy_thresholds", {
  id: text("id").primaryKey(),
  fyLabel: text("fy_label").notNull().unique(), // e.g. "2025-26"
  instantWriteoffCents: integer("instant_writeoff_cents"), // null = not confirmed yet
  note: text("note"),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isEquipment: integer("is_equipment", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const paymentMethods = sqliteTable("payment_methods", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),

    dateIncurred: text("date_incurred").notNull(),
    supplierName: text("supplier_name").notNull(),
    supplierAbn: text("supplier_abn"),
    description: text("description").notNull(),
    categoryId: text("category_id").notNull().references(() => categories.id),

    originalAmountCents: integer("original_amount_cents").notNull(),
    originalCurrency: text("original_currency").notNull(), // ISO 4217

    // FX — frozen on the record; never silently recalculated.
    fxRate: text("fx_rate"), // AUD per 1 unit of original currency (decimal string); null while pending / for AUD
    fxRateSource: text("fx_rate_source"),
    fxRateDate: text("fx_rate_date"),
    fxStatus: text("fx_status").notNull().default("na"), // na | auto | manual | pending
    fxOverrideNote: text("fx_override_note"),

    audAmountCents: integer("aud_amount_cents").notNull(),
    audIsOverridden: integer("aud_is_overridden", { mode: "boolean" }).notNull().default(false),
    audOverrideNote: text("aud_override_note"),

    gstTreatment: text("gst_treatment").notNull(), // gst | gst_free | input_taxed
    gstAmountCents: integer("gst_amount_cents").notNull().default(0),

    businessUseBp: integer("business_use_bp").notNull().default(10000), // 0..10000 basis points
    deductibleAudCents: integer("deductible_aud_cents").notNull(),

    isCapital: integer("is_capital", { mode: "boolean" }).notNull().default(false),
    assetName: text("asset_name"),
    effectiveLifeYears: text("effective_life_years"), // manual entry, decimal string

    paymentMethod: text("payment_method"),
    notes: text("notes"),
    financialYear: text("financial_year").notNull(), // derived from dateIncurred

    status: text("status").notNull().default("active"), // draft | active | void
    voidReason: text("void_reason"),
    voidedAt: text("voided_at"),

    source: text("source").notNull().default("manual"), // manual | subscription | import | agent
    subscriptionId: text("subscription_id"),
    importBatchId: text("import_batch_id"),
    missingReceiptAck: integer("missing_receipt_ack", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("idx_expenses_fy").on(t.financialYear),
    index("idx_expenses_date").on(t.dateIncurred),
    index("idx_expenses_status").on(t.status),
    index("idx_expenses_subscription").on(t.subscriptionId),
  ]
);

/** Receipt files are immutable; replacement creates a new version and keeps the old. */
export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    expenseId: text("expense_id").notNull().references(() => expenses.id),
    version: integer("version").notNull(),
    originalFilename: text("original_filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageDriver: text("storage_driver").notNull(), // local | vercel-blob
    storageKey: text("storage_key").notNull(),
    uploadedAt: text("uploaded_at").notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
    replacedById: text("replaced_by_id"),
  },
  (t) => [index("idx_receipts_expense").on(t.expenseId)]
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(), // create | update | void | confirm | receipt_add | receipt_replace | import | cancel | reactivate
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    note: text("note"),
  },
  (t) => [index("idx_audit_entity").on(t.entityType, t.entityId), index("idx_audit_at").on(t.at)]
);

export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  vendor: text("vendor").notNull(),
  description: text("description"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  frequency: text("frequency").notNull(), // monthly | annual
  nextRenewalDate: text("next_renewal_date").notNull(),
  anchorDay: integer("anchor_day").notNull().default(1), // day-of-month billing anchor
  businessUseBp: integer("business_use_bp").notNull().default(10000),
  categoryId: text("category_id").notNull().references(() => categories.id),
  gstTreatment: text("gst_treatment").notNull().default("gst_free"),
  paymentMethod: text("payment_method"),
  supplierAbn: text("supplier_abn"),
  notes: text("notes"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  canceledAt: text("canceled_at"),
});

/** Cache of externally sourced FX rates (a record's own rate is stored on the record). */
export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: text("id").primaryKey(),
    date: text("date").notNull(), // the rate's actual published date
    currency: text("currency").notNull(),
    rateAudPerUnit: text("rate_aud_per_unit").notNull(),
    source: text("source").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [uniqueIndex("uq_fx_date_ccy_source").on(t.date, t.currency, t.source)]
);

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull(),
  mappingJson: text("mapping_json").notNull(),
  status: text("status").notNull().default("committed"),
});

export const loginAttempts = sqliteTable("login_attempts", {
  id: text("id").primaryKey(),
  at: text("at").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull(),
});

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type Receipt = typeof receipts.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Category = typeof categories.$inferSelect;
