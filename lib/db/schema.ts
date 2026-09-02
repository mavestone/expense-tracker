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

/** Per-financial-year settings the owner sets and the app never guesses. */
export const fyThresholds = sqliteTable("fy_thresholds", {
  id: text("id").primaryKey(),
  fyLabel: text("fy_label").notNull().unique(), // e.g. "2025-26"
  instantWriteoffCents: integer("instant_writeoff_cents"), // null = not confirmed yet

  /**
   * How income is recognised for income tax in this year: accruals (when
   * invoiced) or cash (when received). Per year, not global — a year that has
   * been lodged cannot have its basis rewritten underneath it, and the change
   * from one to the other is exactly where income gets counted twice.
   */
  incomeBasis: text("income_basis").notNull().default("accruals"),

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

    // Balancing adjustment event: set when a capital asset is sold, lost, stolen,
    // destroyed or taken out of business use. Termination value is the proceeds,
    // or the insurance/compensation received for a loss — nil where none was.
    disposalDate: text("disposal_date"),
    disposalReason: text("disposal_reason"), // sold | stolen | destroyed | scrapped | ceased_business_use
    terminationValueCents: integer("termination_value_cents"),
    // Written-down value immediately before the event; 0 once instant-written-off.
    adjustableValueCents: integer("adjustable_value_cents"),
    disposalNote: text("disposal_note"),

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

/**
 * Income — deliberately a separate ledger from expenses. Covers invoiced
 * client work and any other money the business earns. Same integrity rules:
 * never hard-deleted, FX frozen on the record, full audit history.
 */
export const income = sqliteTable(
  "income",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),

    // Date the income was earned/invoiced (the record's tax point).
    dateEarned: text("date_earned").notNull(),
    // Set when the money actually landed; null means still outstanding.
    datePaid: text("date_paid"),

    clientName: text("client_name").notNull(),
    clientAbn: text("client_abn"),
    invoiceRef: text("invoice_ref"),
    description: text("description").notNull(),
    incomeType: text("income_type").notNull().default("client_work"),

    originalAmountCents: integer("original_amount_cents").notNull(),
    originalCurrency: text("original_currency").notNull(),

    fxRate: text("fx_rate"),
    fxRateSource: text("fx_rate_source"),
    fxRateDate: text("fx_rate_date"),
    fxStatus: text("fx_status").notNull().default("na"), // na | auto | manual | pending
    fxOverrideNote: text("fx_override_note"),

    audAmountCents: integer("aud_amount_cents").notNull(),

    // GST on sales: gst (1/11 included) | gst_free | no_gst (not registered / export)
    gstTreatment: text("gst_treatment").notNull().default("no_gst"),
    gstAmountCents: integer("gst_amount_cents").notNull().default(0),

    paymentAccount: text("payment_account"),
    notes: text("notes"),
    financialYear: text("financial_year").notNull(),

    status: text("status").notNull().default("active"), // active | void
    voidReason: text("void_reason"),
    voidedAt: text("voided_at"),
    source: text("source").notNull().default("manual"), // manual | agent | import
  },
  (t) => [
    index("idx_income_fy").on(t.financialYear),
    index("idx_income_date").on(t.dateEarned),
    index("idx_income_status").on(t.status),
  ]
);

/**
 * Invoice documents attached to income records. Same immutability contract as
 * expense receipts: content-addressed, never overwritten, replacement creates
 * a new version and the old one is kept forever.
 */
export const incomeDocuments = sqliteTable(
  "income_documents",
  {
    id: text("id").primaryKey(),
    incomeId: text("income_id").notNull().references(() => income.id),
    version: integer("version").notNull(),
    originalFilename: text("original_filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageDriver: text("storage_driver").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedAt: text("uploaded_at").notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
    replacedById: text("replaced_by_id"),
  },
  (t) => [index("idx_income_docs_income").on(t.incomeId)]
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

/**
 * Bank and card statements, kept so a financial year can be reconciled line by
 * line against what has actually been recorded. The original file is retained
 * because a parsed row is a convenience, not evidence.
 */
export const statementAccounts = sqliteTable("statement_accounts", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  label: text("label").notNull(), // "Up — Spending"
  institution: text("institution").notNull(), // "Up (Bendigo and Adelaide Bank)"
  accountRef: text("account_ref"), // masked: "BSB 633-123 · 200645521"
  kind: text("kind").notNull().default("bank"), // bank | card
  sortOrder: integer("sort_order").notNull().default(0),

  /**
   * Whether the overview should chase a statement for this account once the
   * month it covers has ended. Off by default: an account nobody has agreed
   * to reconcile monthly should not start nagging on its own.
   */
  remindMonthly: integer("remind_monthly", { mode: "boolean" }).notNull().default(false),
});

export const statements = sqliteTable(
  "statements",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    accountId: text("account_id").notNull().references(() => statementAccounts.id),
    fyLabel: text("fy_label").notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    filename: text("filename").notNull(),
    mime: text("mime").notNull().default("application/pdf"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sha256: text("sha256").notNull(),
    storageDriver: text("storage_driver").notNull(),
    storageKey: text("storage_key").notNull(),
    txnCount: integer("txn_count").notNull().default(0),
  },
  (t) => [index("idx_statements_fy").on(t.fyLabel), index("idx_statements_account").on(t.accountId)]
);

export const statementTransactions = sqliteTable(
  "statement_transactions",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    statementId: text("statement_id").notNull().references(() => statements.id),
    accountId: text("account_id").notNull().references(() => statementAccounts.id),
    fyLabel: text("fy_label").notNull(),

    /**
     * The bank's own reference for the line — Wise's TransferWise ID.
     *
     * Wise bills a card charge and its FX fee as two separate debits, named
     * `CARD-123` and `FEE-CARD-123`. Without the reference the fee is just
     * another unexplained row: 97 of 323 lines in one two-month load, none of
     * which can be decided on its own merits because a fee is not a purchase.
     * With it, a fee is paired to the charge it belongs to and follows
     * whatever that charge is decided to be.
     */
    externalRef: text("external_ref"),

    date: text("date").notNull(),
    description: text("description").notNull(),
    counterparty: text("counterparty"),
    direction: text("direction").notNull(), // in | out
    amountCents: integer("amount_cents").notNull(), // as charged, in `currency`
    currency: text("currency").notNull().default("AUD"),
    /** Indicative AUD for foreign rows; the tracker freezes the real rate on the record. */
    audAmountCents: integer("aud_amount_cents"),

    // unreviewed | logged (has a tracker record) | ignored (deliberately out of scope)
    status: text("status").notNull().default("unreviewed"),
    matchedExpenseId: text("matched_expense_id"),
    matchedIncomeId: text("matched_income_id"),
    /** auto = matched by the matcher, manual = ticked by the owner */
    matchSource: text("match_source"),
    ignoreReason: text("ignore_reason"),
    note: text("note"),
  },
  (t) => [
    index("idx_sttxn_fy").on(t.fyLabel),
    index("idx_sttxn_account").on(t.accountId),
    index("idx_sttxn_status").on(t.status),
    index("idx_sttxn_date").on(t.date),
  ]
);

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type Receipt = typeof receipts.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type StatementAccount = typeof statementAccounts.$inferSelect;
export type Statement = typeof statements.$inferSelect;
export type StatementTransaction = typeof statementTransactions.$inferSelect;

/**
 * Clients the business invoices. Held separately from the `client_name` text on
 * an income record so that details worth reusing — address, tax id, currency,
 * payment terms — are entered once and stay consistent across every invoice.
 */
export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  addressLines: text("address_lines"), // free text, one line per newline
  country: text("country"),

  // An Australian client has an ABN; an overseas one usually has some other
  // registration number whose label differs by country (VAT no., EIN, ...).
  abn: text("abn"),
  taxLabel: text("tax_label"),
  taxId: text("tax_id"),

  // Invoice numbers are <prefix>_<n> — KC_01, LEVEE_02 — matching the refs
  // already used across the income ledger.
  invoicePrefix: text("invoice_prefix").notNull(),
  defaultCurrency: text("default_currency").notNull().default("AUD"),
  defaultGstTreatment: text("default_gst_treatment").notNull().default("gst_free"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(14),

  notes: text("notes"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
}, (t) => [uniqueIndex("uq_clients_prefix").on(t.invoicePrefix)]);

/**
 * An issued invoice. Amounts are in the invoice's own currency — the AUD figure
 * is never stored here, because it belongs to the income record and is derived
 * from the rate published on the tax point. Converting in two places is how the
 * two disagree.
 */
export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),

    number: text("number").notNull(),
    clientId: text("client_id").notNull().references(() => clients.id),

    // draft | sent | paid | void
    status: text("status").notNull().default("draft"),

    /**
     * services — work performed, billed at your rates.
     * reimbursement — costs you carried on the client's behalf, billed on.
     *
     * The distinction is not cosmetic. A reimbursement recovers money already
     * spent, so it is posted gross: the recovery is income and the underlying
     * cost stays deductible. Keeping the kind on the record is what makes that
     * pairing legible a year later, when only the bank line survives.
     */
    kind: text("kind").notNull().default("services"),

    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),

    currency: text("currency").notNull(),
    // gst (10% added to the lines) | gst_free (export of services)
    gstTreatment: text("gst_treatment").notNull().default("gst_free"),

    subtotalCents: integer("subtotal_cents").notNull().default(0),
    gstCents: integer("gst_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),

    purchaseOrder: text("purchase_order"),
    terms: text("terms"),
    notes: text("notes"),

    // The link into the tax ledger. Set when the invoice is posted to income;
    // null while it is still only a document.
    incomeId: text("income_id"),

    sentAt: text("sent_at"),
    paidAt: text("paid_at"),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("uq_invoices_number").on(t.number),
    index("idx_invoices_client").on(t.clientId),
    index("idx_invoices_status").on(t.status),
    index("idx_invoices_issue").on(t.issueDate),
  ]
);

/** Line items. Quantity is in thousandths so half-days and hourly rates work. */
export const invoiceLines = sqliteTable(
  "invoice_lines",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id").notNull().references(() => invoices.id),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull().default(1000),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),

    /**
     * Itemisation columns, used by the reimbursement layout. A recovered cost
     * is evidence rather than a priced service, so the client is shown when it
     * was incurred, what sort of cost it was and where — the same columns they
     * would see on a card statement. Null on a services invoice, which prices
     * work instead and has no use for them.
     */
    lineDate: text("line_date"),
    category: text("category"),
    location: text("location"),

    /**
     * The expense this line recovers, on a reimbursement invoice. Optional —
     * a cost can be billed on before it has been entered as a record, and
     * some are never entered at all. When it is set it is the only thing
     * tying the income back to the deduction it offsets.
     *
     * No amount is derived from it. The expense is in the currency it was
     * paid in and the invoice is in the client's; converting between them
     * here would put a second, disagreeing rate next to the frozen one.
     */
    expenseId: text("expense_id").references(() => expenses.id),
  },
  (t) => [
    index("idx_invoice_lines_invoice").on(t.invoiceId),
    index("idx_invoice_lines_expense").on(t.expenseId),
  ]
);

/**
 * Closing a financial year off. Records that the return has been lodged and
 * what it was lodged as, so the figures an amendment would have to reconcile
 * to are held next to the ledger rather than in a person's memory.
 *
 * Finalising does not lock anything — a year can legitimately need an amended
 * return, and a system that made that hard would just be worked around. It
 * warns instead, on every record dated inside a closed year.
 */
export const fyClosures = sqliteTable(
  "fy_closures",
  {
    id: text("id").primaryKey(),
    fyLabel: text("fy_label").notNull(),
    finalisedAt: text("finalised_at").notNull(),
    lodgedDate: text("lodged_date"),
    atoReceipt: text("ato_receipt"),
    taxableIncomeCents: integer("taxable_income_cents"),
    taxPayableCents: integer("tax_payable_cents"),
    note: text("note"),
    // Set when a finalised year is deliberately reopened; the row is kept.
    reopenedAt: text("reopened_at"),
    reopenedReason: text("reopened_reason"),
  },
  (t) => [uniqueIndex("uq_fy_closures_fy").on(t.fyLabel)]
);

/**
 * Working papers attached to a financial year rather than to one record — a
 * PSI file note, a lodgement receipt, an accountant's letter. Same immutability
 * contract as receipts: content-addressed, never overwritten.
 */
export const fyDocuments = sqliteTable(
  "fy_documents",
  {
    id: text("id").primaryKey(),
    fyLabel: text("fy_label").notNull(),
    kind: text("kind").notNull().default("working_paper"),
    title: text("title").notNull(),
    description: text("description"),
    originalFilename: text("original_filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageDriver: text("storage_driver").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedAt: text("uploaded_at").notNull(),
  },
  (t) => [index("idx_fy_docs_fy").on(t.fyLabel)]
);
