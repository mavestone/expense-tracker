import { divRound, applyBp } from "./money";

/**
 * GST treatments:
 *  - "gst"         : Australian purchase from a GST-registered supplier;
 *                    GST is claimable. Default GST = 1/11 of the
 *                    GST-inclusive AUD total.
 *  - "gst_free"    : No GST in the price (most overseas purchases, plus
 *                    GST-free Australian items). Nothing claimable.
 *  - "input_taxed" : GST may be in the price but is NOT claimable.
 */
export type GstTreatment = "gst" | "gst_free" | "input_taxed";

export const GST_TREATMENTS: { value: GstTreatment; label: string }[] = [
  { value: "gst", label: "GST included (claimable)" },
  { value: "gst_free", label: "GST-free / no GST" },
  { value: "input_taxed", label: "Input taxed / not claimable" },
];

export function isGstTreatment(v: unknown): v is GstTreatment {
  return v === "gst" || v === "gst_free" || v === "input_taxed";
}

/** Default treatment: AUD purchases default to GST-claimable, foreign to no-GST (overridable). */
export function defaultTreatmentForCurrency(currency: string): GstTreatment {
  return currency.toUpperCase() === "AUD" ? "gst" : "gst_free";
}

/** Default GST for a treatment: 1/11 of the GST-inclusive AUD amount, else 0. */
export function defaultGstCents(treatment: GstTreatment, audAmountCents: number): number {
  return treatment === "gst" ? divRound(audAmountCents, 11) : 0;
}

/** The claimable portion of GST after business-use apportionment (BAS label 1B). */
export function claimableGstCents(treatment: GstTreatment, gstAmountCents: number, businessUseBp: number): number {
  if (treatment !== "gst") return 0;
  return applyBp(gstAmountCents, businessUseBp);
}

/**
 * A valid tax invoice is required to claim a GST credit on purchases over
 * $82.50 (GST inclusive). Returns true when the record should be flagged.
 */
export function gstReceiptFlag(opts: {
  treatment: GstTreatment;
  audAmountCents: number;
  hasReceipt: boolean;
  thresholdCents: number; // configurable, default 8250
}): boolean {
  return opts.treatment === "gst" && opts.audAmountCents > opts.thresholdCents && !opts.hasReceipt;
}
