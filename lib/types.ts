/** Client-facing DTO types (mirror API responses). */

export type CategoryDto = { id: string; name: string; isEquipment: boolean; sortOrder: number; archived: boolean };
export type PaymentMethodDto = { id: string; name: string; sortOrder: number; archived: boolean };
export type ThresholdDto = { id: string; fyLabel: string; instantWriteoffCents: number | null; note: string | null };
export type SettingsDto = {
  business_name: string;
  receipt_required_over_cents: number;
  gst_receipt_flag_cents: number;
  subscription_stale_days: number;
  ocr_enabled: boolean;
};
export type SupplierSuggestion = { name: string; abn: string | null; categoryId: string | null; paymentMethod: string | null };

export type MetaDto = {
  categories: CategoryDto[];
  paymentMethods: PaymentMethodDto[];
  thresholds: ThresholdDto[];
  settings: SettingsDto;
  suppliers: SupplierSuggestion[];
  financialYears: string[];
  currentFy: string;
  today: string;
};

export type ExpenseDto = {
  id: string;
  createdAt: string;
  updatedAt: string;
  dateIncurred: string;
  supplierName: string;
  supplierAbn: string | null;
  description: string;
  categoryId: string;
  originalAmountCents: number;
  originalCurrency: string;
  fxRate: string | null;
  fxRateSource: string | null;
  fxRateDate: string | null;
  fxStatus: "na" | "auto" | "manual" | "pending";
  fxOverrideNote: string | null;
  audAmountCents: number;
  audIsOverridden: boolean;
  audOverrideNote: string | null;
  gstTreatment: "gst" | "gst_free" | "input_taxed";
  gstAmountCents: number;
  businessUseBp: number;
  deductibleAudCents: number;
  isCapital: boolean;
  assetName: string | null;
  effectiveLifeYears: string | null;
  paymentMethod: string | null;
  notes: string | null;
  financialYear: string;
  status: "draft" | "active" | "void";
  voidReason: string | null;
  voidedAt: string | null;
  source: "manual" | "subscription" | "import" | "agent";
  subscriptionId: string | null;
  importBatchId: string | null;
  missingReceiptAck: boolean;
  receiptCount?: number;
};

export type ReceiptDto = {
  id: string;
  expenseId: string;
  version: number;
  originalFilename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  storageDriver: string;
  storageKey: string;
  uploadedAt: string;
  isCurrent: boolean;
  replacedById: string | null;
};

export type AuditDto = {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  note: string | null;
};

export type SubscriptionDto = {
  id: string;
  createdAt: string;
  vendor: string;
  description: string | null;
  amountCents: number;
  currency: string;
  frequency: "monthly" | "annual";
  nextRenewalDate: string;
  anchorDay: number;
  businessUseBp: number;
  categoryId: string;
  gstTreatment: "gst" | "gst_free" | "input_taxed";
  paymentMethod: string | null;
  supplierAbn: string | null;
  notes: string | null;
  active: boolean;
  canceledAt: string | null;
  lastConfirmedDate: string | null;
  pendingDraftCount: number;
  oldestPendingDraftDate: string | null;
  stale: boolean;
  estAnnualAudCents: number | null;
  estAudPerPeriodCents: number | null;
};

export const COMMON_CURRENCIES = [
  "AUD", "USD", "EUR", "GBP", "JPY", "NZD", "SGD", "HKD", "CAD", "CHF",
  "CNY", "THB", "IDR", "VND", "AED", "INR", "KRW", "MYR", "PHP", "TWD", "ZAR",
];
