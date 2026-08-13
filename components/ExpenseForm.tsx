"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend, apiUpload, recall, remember, ApiError } from "@/lib/client";
import { parseMoneyToCents, centsToDecimalString, applyRate, divRound, applyBp, percentToBp, bpToPercentString, formatAUD, isValidRate } from "@/lib/money";
import { financialYear, formatDateAU } from "@/lib/fy";
import { GST_TREATMENTS, defaultTreatmentForCurrency, type GstTreatment } from "@/lib/gst";
import { isValidAbn } from "@/lib/abn";
import { COMMON_CURRENCIES, type ExpenseDto, type MetaDto } from "@/lib/types";
import ReceiptUploader, { type StagedReceipt } from "./ReceiptUploader";
import type { OcrSuggestion } from "@/lib/ocr";
import { useToast } from "@/components/Toast";

type FxState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; rate: string; source: string; rateDate: string }
  | { status: "error"; message: string };

export default function ExpenseForm({ mode, initial }: { mode: "create" | "edit"; initial?: ExpenseDto }) {
  const { toast } = useToast();
  const router = useRouter();
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Core fields ──────────────────────────────────────────────────────────
  const [date, setDate] = useState(initial?.dateIncurred ?? "");
  const [supplier, setSupplier] = useState(initial?.supplierName ?? "");
  const [abn, setAbn] = useState(initial?.supplierAbn ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [amountStr, setAmountStr] = useState(initial ? centsToDecimalString(initial.originalAmountCents) : "");
  const [currency, setCurrency] = useState(initial?.originalCurrency ?? "AUD");
  const [treatment, setTreatment] = useState<GstTreatment>(initial?.gstTreatment ?? "gst");
  const treatmentTouched = useRef(mode === "edit");
  const [gstStr, setGstStr] = useState(initial ? centsToDecimalString(initial.gstAmountCents) : "");
  const [gstTouched, setGstTouched] = useState(mode === "edit");
  const [buPct, setBuPct] = useState(initial ? bpToPercentString(initial.businessUseBp) : "100");
  const [capital, setCapital] = useState(initial?.isCapital ?? false);
  const [assetName, setAssetName] = useState(initial?.assetName ?? "");
  const [effLife, setEffLife] = useState(initial?.effectiveLifeYears ?? "");
  const [payment, setPayment] = useState(initial?.paymentMethod ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [editNote, setEditNote] = useState("");
  const [ack, setAck] = useState(initial?.missingReceiptAck ?? false);

  // ── FX state ─────────────────────────────────────────────────────────────
  const initialFx: FxState =
    initial && initial.originalCurrency !== "AUD" && initial.fxRate && initial.fxStatus !== "manual"
      ? { status: "ok", rate: initial.fxRate, source: initial.fxRateSource ?? "", rateDate: initial.fxRateDate ?? "" }
      : { status: "idle" };
  const [fx, setFx] = useState<FxState>(initialFx);
  const [manualFx, setManualFx] = useState(initial?.fxStatus === "manual");
  const [manualRate, setManualRate] = useState(initial?.fxStatus === "manual" ? (initial.fxRate ?? "") : "");
  const [manualNote, setManualNote] = useState(initial?.fxOverrideNote ?? "");
  const [audOverride, setAudOverride] = useState(initial?.audIsOverridden ?? false);
  const [audStr, setAudStr] = useState(initial?.audIsOverridden ? centsToDecimalString(initial.audAmountCents) : "");
  const [audNote, setAudNote] = useState(initial?.audOverrideNote ?? "");

  const [staged, setStaged] = useState<StagedReceipt | null>(null);
  const [ocr, setOcr] = useState<OcrSuggestion | null>(null);

  // ── Meta bootstrap + remembered defaults ─────────────────────────────────
  useEffect(() => {
    apiGet<MetaDto>("/api/meta").then((m) => {
      setMeta(m);
      if (mode === "create") {
        setDate((d) => d || m.today);
        setSupplier((s) => s || recall("lastSupplier") || "");
        setCategoryId((c) => c || recall("lastCategory") || m.categories[0]?.id || "");
        setPayment((p) => p || recall("lastPayment") || "");
        const lastCur = recall("lastCurrency");
        if (lastCur && !initial) {
          setCurrency(lastCur);
          if (!treatmentTouched.current) setTreatment(defaultTreatmentForCurrency(lastCur));
        }
      }
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── FX auto-fetch on date/currency change ────────────────────────────────
  const ccy = currency.trim().toUpperCase();
  useEffect(() => {
    if (ccy === "AUD" || !/^[A-Z]{3}$/.test(ccy) || !date || manualFx) {
      if (ccy === "AUD") setFx({ status: "idle" });
      return;
    }
    // Keep the frozen rate when editing unless date/currency actually changed.
    if (mode === "edit" && initial && initial.originalCurrency === ccy && initial.dateIncurred === date && initial.fxRate && fx.status === "ok") {
      return;
    }
    let cancelled = false;
    setFx({ status: "loading" });
    const t = setTimeout(async () => {
      try {
        const r = await apiGet<{ rateAudPerUnit: string; source: string; rateDate: string }>(
          `/api/fx?date=${date}&currency=${ccy}`
        );
        if (!cancelled) setFx({ status: "ok", rate: r.rateAudPerUnit, source: r.source, rateDate: r.rateDate });
      } catch (e) {
        if (!cancelled)
          setFx({ status: "error", message: e instanceof ApiError && e.code === "fx_unavailable" ? e.message : "Rate lookup failed." });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, ccy, manualFx]);

  // Default GST treatment follows currency until the user chooses one.
  function onCurrencyChange(v: string) {
    setCurrency(v.toUpperCase());
    if (!treatmentTouched.current) setTreatment(defaultTreatmentForCurrency(v));
  }

  // ── Derived values (client mirror of server math) ────────────────────────
  const amountCents = parseMoneyToCents(amountStr);
  const bp = percentToBp(buPct);
  const audCents = useMemo(() => {
    if (amountCents == null) return null;
    if (ccy === "AUD") return amountCents;
    if (audOverride) return parseMoneyToCents(audStr);
    if (manualFx) return isValidRate(manualRate) ? applyRate(amountCents, manualRate) : null;
    if (fx.status === "ok") return applyRate(amountCents, fx.rate);
    return null; // pending
  }, [amountCents, ccy, audOverride, audStr, manualFx, manualRate, fx]);

  const gstDefaultCents = treatment === "gst" && audCents != null ? divRound(audCents, 11) : 0;
  const gstCents = treatment !== "gst" ? 0 : gstTouched ? (parseMoneyToCents(gstStr) ?? 0) : gstDefaultCents;
  const deductibleCents = audCents != null && bp != null ? applyBp(audCents, bp) : null;
  const fy = date ? financialYear(date) : null;

  const category = meta?.categories.find((c) => c.id === categoryId);
  const threshold = meta?.thresholds.find((t) => t.fyLabel === fy);
  const capitalSuggested =
    !capital &&
    !!category?.isEquipment &&
    audCents != null &&
    threshold?.instantWriteoffCents != null &&
    audCents >= threshold.instantWriteoffCents;
  const thresholdMissing = !!category?.isEquipment && audCents != null && audCents >= 100000 && threshold?.instantWriteoffCents == null;

  const settings = meta?.settings;
  const receiptRequired = !!settings && audCents != null && audCents > settings.receipt_required_over_cents;
  const gstInvoiceWarn =
    !!settings && treatment === "gst" && audCents != null && audCents > settings.gst_receipt_flag_cents;
  const hasReceipt = mode === "edit" ? (initial?.receiptCount ?? 0) > 0 : !!staged;
  const abnInvalid = abn.trim().length > 0 && !isValidAbn(abn);
  const fxPendingSave = ccy !== "AUD" && !manualFx && !audOverride && fx.status === "error";

  // ── OCR suggestions ──────────────────────────────────────────────────────
  function applyOcr(field: "supplier" | "date" | "amount") {
    if (!ocr) return;
    if (field === "supplier" && ocr.supplier) setSupplier(ocr.supplier);
    if (field === "date" && ocr.dateISO) setDate(ocr.dateISO);
    if (field === "amount" && ocr.amountStr) setAmountStr(ocr.amountStr);
  }

  // ── Supplier autofill from history ───────────────────────────────────────
  function onSupplierBlur() {
    const s = meta?.suppliers.find((x) => x.name.toLowerCase() === supplier.trim().toLowerCase());
    if (!s) return;
    if (!abn && s.abn) setAbn(s.abn);
    if (s.categoryId && meta?.categories.some((c) => c.id === s.categoryId) && mode === "create") setCategoryId(s.categoryId);
    if (!payment && s.paymentMethod) setPayment(s.paymentMethod);
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (amountCents == null) return setError("Enter a valid amount (e.g. 129.99).");
    if (bp == null) return setError("Business use must be between 0 and 100.");
    if (receiptRequired && !hasReceipt && !ack) {
      return setError("A receipt is required over " + formatAUD(settings!.receipt_required_over_cents) + ". Attach one, or tick “save without receipt”.");
    }

    const input = {
      dateIncurred: date,
      supplierName: supplier,
      supplierAbn: abn || null,
      description,
      categoryId,
      originalAmountCents: amountCents,
      originalCurrency: ccy,
      fxMode: ccy === "AUD" ? undefined : manualFx ? "manual" : fx.status === "ok" ? "auto" : "pending",
      fxRate: ccy === "AUD" ? null : manualFx ? manualRate : fx.status === "ok" ? fx.rate : null,
      fxRateSource: !manualFx && fx.status === "ok" ? fx.source : null,
      fxRateDate: !manualFx && fx.status === "ok" ? fx.rateDate : null,
      fxOverrideNote: manualFx ? manualNote : null,
      audOverrideCents: ccy !== "AUD" && audOverride ? parseMoneyToCents(audStr) : null,
      audOverrideNote: ccy !== "AUD" && audOverride ? audNote : null,
      gstTreatment: treatment,
      gstAmountCents: treatment === "gst" ? gstCents : null,
      businessUseBp: bp,
      isCapital: capital,
      assetName: capital ? assetName || description : null,
      effectiveLifeYears: capital ? effLife || null : null,
      paymentMethod: payment || null,
      notes: notes || null,
      missingReceiptAck: ack,
    };

    setBusy(true);
    try {
      let id: string;
      if (mode === "create") {
        const res = await apiSend<{ expense: ExpenseDto }>("/api/expenses", "POST", { input });
        id = res.expense.id;
        if (staged) {
          toast("Uploading receipt…");
          await apiUpload(`/api/expenses/${id}/receipts`, staged.file, staged.filename);
        }
        remember("lastSupplier", supplier);
        remember("lastCategory", categoryId);
        remember("lastPayment", payment);
        remember("lastCurrency", ccy);
      } else {
        const res = await apiSend<{ expense: ExpenseDto }>(`/api/expenses/${initial!.id}`, "PATCH", { input, editNote: editNote || null });
        id = res.expense.id;
      }
      router.push(`/expenses/${id}${mode === "create" ? "?created=1" : "?updated=1"}`);
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.join(" ") ?? e.message) : (e as Error).message);
      setBusy(false);
    }
  }

  if (!meta) return <div className="empty"><span className="spin" /> Loading…</div>;

  const categories = meta.categories.filter((c) => !c.archived || c.id === categoryId);
  const paymentOptions = meta.paymentMethods.filter((p) => !p.archived);

  return (
    <form onSubmit={submit}>
      {mode === "edit" && initial?.status === "draft" && (
        <div className="alert info">This is a subscription-generated draft — review and confirm it on the record page after saving.</div>
      )}

      <div className="card">
        <h2>{mode === "create" ? "New expense" : "Edit expense"}</h2>

        <div className="grid2">
          <div className="field">
            <label htmlFor="f-date">Date incurred</label>
            <input id="f-date" type="date" value={date} max="2099-12-31" onChange={(e) => setDate(e.target.value)} required />
            {fy && <span className="hint">FY {fy}</span>}
          </div>
          <div className="field">
            <label htmlFor="f-payment">Payment method</label>
            <select id="f-payment" value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="">—</option>
              {paymentOptions.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
              {payment && !paymentOptions.some((p) => p.name === payment) && <option value={payment}>{payment}</option>}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="f-supplier">Supplier</label>
          <input
            id="f-supplier"
            type="text"
            list="supplier-list"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            onBlur={onSupplierBlur}
            required
            autoComplete="off"
          />
          <datalist id="supplier-list">
            {meta.suppliers.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <label htmlFor="f-abn">Supplier ABN <span className="muted">(optional, Australian suppliers)</span></label>
          <input id="f-abn" type="text" inputMode="numeric" value={abn} onChange={(e) => setAbn(e.target.value)} placeholder="11 digits" />
          {abnInvalid && <span className="hint" style={{ color: "var(--warn)" }}>⚠ ABN fails the checksum — check for a typo.</span>}
        </div>

        <div className="field">
          <label htmlFor="f-desc">Description</label>
          <input id="f-desc" type="text" value={description} onChange={(e) => setDescription(e.target.value)} required placeholder="What was purchased" />
        </div>

        <div className="field">
          <label htmlFor="f-cat">Category</label>
          <select id="f-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h2>Amount</h2>
        <div className="grid2">
          <div className="field">
            <label htmlFor="f-amount">Amount</label>
            <input id="f-amount" type="text" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="0.00" required />
          </div>
          <div className="field">
            <label htmlFor="f-ccy">Currency</label>
            <input id="f-ccy" type="text" list="ccy-list" value={currency} onChange={(e) => onCurrencyChange(e.target.value)} maxLength={3} style={{ textTransform: "uppercase" }} required />
            <datalist id="ccy-list">
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>

        {ccy !== "AUD" && /^[A-Z]{3}$/.test(ccy) && (
          <div className="fxpanel">
            {!manualFx && fx.status === "loading" && (
              <span><span className="spin" /> Fetching {ccy} rate for {date ? formatDateAU(date) : "…"}…</span>
            )}
            {!manualFx && fx.status === "ok" && (
              <div>
                <span className="rate">1 {ccy} = {Number(fx.rate).toFixed(6)} AUD</span>
                <div className="muted small">{fx.source} · rate date {formatDateAU(fx.rateDate)}{fx.rateDate !== date ? " (nearest published day)" : ""}</div>
              </div>
            )}
            {!manualFx && fx.status === "error" && (
              <div>
                <span style={{ color: "var(--warn)" }}>⚠ {fx.message}</span>
                <div className="muted small">You can save with FX pending and resolve it later, or enter a rate manually.</div>
              </div>
            )}
            <div className="btnrow mt1">
              <label className="checkline" style={{ margin: 0 }}>
                <input type="checkbox" checked={manualFx} onChange={(e) => setManualFx(e.target.checked)} />
                <span>Enter rate manually</span>
              </label>
              <label className="checkline" style={{ margin: 0 }}>
                <input type="checkbox" checked={audOverride} onChange={(e) => setAudOverride(e.target.checked)} />
                <span>Override AUD amount</span>
              </label>
            </div>
            {manualFx && (
              <div className="grid2 mt1">
                <div className="field">
                  <label>Rate (AUD per 1 {ccy})</label>
                  <input type="text" inputMode="decimal" value={manualRate} onChange={(e) => setManualRate(e.target.value)} placeholder="e.g. 1.5342" />
                </div>
                <div className="field">
                  <label>Reason / source (required)</label>
                  <input type="text" value={manualNote} onChange={(e) => setManualNote(e.target.value)} placeholder="e.g. card statement rate" />
                </div>
              </div>
            )}
            {audOverride && (
              <div className="grid2 mt1">
                <div className="field">
                  <label>AUD amount (actual charged)</label>
                  <input type="text" inputMode="decimal" value={audStr} onChange={(e) => setAudStr(e.target.value)} placeholder="0.00" />
                </div>
                <div className="field">
                  <label>Reason (required)</label>
                  <input type="text" value={audNote} onChange={(e) => setAudNote(e.target.value)} placeholder="e.g. exact AUD from bank statement" />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid2">
          <div className="field">
            <label htmlFor="f-bu">Business use %</label>
            <input id="f-bu" type="text" inputMode="decimal" value={buPct} onChange={(e) => setBuPct(e.target.value)} required />
          </div>
          <div className="field">
            <label>AUD amount</label>
            <input type="text" value={audCents != null ? centsToDecimalString(audCents) : "pending FX"} disabled />
            {deductibleCents != null && bp !== 10000 && (
              <span className="hint">Deductible ({buPct}%): {formatAUD(deductibleCents)}</span>
            )}
          </div>
        </div>
        {fxPendingSave && (
          <div className="alert warn">No rate available right now — the record will be saved with <b>FX pending</b> and flagged until a rate is applied.</div>
        )}
      </div>

      <div className="card">
        <h2>GST</h2>
        <div className="field">
          <label htmlFor="f-gstt">GST treatment</label>
          <select
            id="f-gstt"
            value={treatment}
            onChange={(e) => {
              treatmentTouched.current = true;
              setTreatment(e.target.value as GstTreatment);
              setGstTouched(false);
            }}
          >
            {GST_TREATMENTS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          {ccy !== "AUD" && treatment === "gst" && (
            <span className="hint">Foreign-currency purchase marked GST-claimable — only valid if the vendor charges Australian GST (some digital services do).</span>
          )}
        </div>
        {treatment === "gst" && (
          <div className="grid2">
            <div className="field">
              <label htmlFor="f-gst">GST amount (AUD)</label>
              <input
                id="f-gst"
                type="text"
                inputMode="decimal"
                value={gstTouched ? gstStr : centsToDecimalString(gstDefaultCents)}
                onChange={(e) => {
                  setGstTouched(true);
                  setGstStr(e.target.value);
                }}
              />
              {gstTouched && (
                <span className="hint">
                  <a href="#" onClick={(e) => { e.preventDefault(); setGstTouched(false); }}>Reset to 1/11 ({centsToDecimalString(gstDefaultCents)})</a>
                </span>
              )}
              {!gstTouched && <span className="hint">Default: 1/11 of the GST-inclusive total</span>}
            </div>
          </div>
        )}
        {gstInvoiceWarn && !hasReceipt && (
          <div className="alert warn">
            Over {formatAUD(settings!.gst_receipt_flag_cents)} and GST-claimable — a valid <b>tax invoice</b> must be attached to claim the credit. This record will be flagged until one is.
          </div>
        )}
      </div>

      <div className="card">
        <h2>Capital asset</h2>
        {capitalSuggested && (
          <div className="alert info">
            This {category?.name} purchase{audCents != null ? ` of ${formatAUD(audCents)}` : ""} meets or exceeds the FY {fy} instant asset write-off threshold ({formatAUD(threshold!.instantWriteoffCents!)}) — consider marking it as a capital asset.
          </div>
        )}
        {thresholdMissing && (
          <div className="alert warn">
            No instant asset write-off threshold is set for FY {fy}. Set it in Settings (confirm the figure with your accountant) to get capital-asset suggestions.
          </div>
        )}
        <label className="checkline">
          <input type="checkbox" checked={capital} onChange={(e) => setCapital(e.target.checked)} />
          <span>Capital asset (goes to the depreciation schedule for the accountant)</span>
        </label>
        {capital && (
          <div className="grid2">
            <div className="field">
              <label>Asset name</label>
              <input type="text" value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder={description || "e.g. Sony FX6"} />
            </div>
            <div className="field">
              <label>Effective life (years) <span className="muted">(optional — accountant can confirm)</span></label>
              <input type="text" inputMode="decimal" value={effLife} onChange={(e) => setEffLife(e.target.value)} placeholder="e.g. 5" />
            </div>
          </div>
        )}
      </div>

      {mode === "create" && (
        <div className="card">
          <h2>Receipt {receiptRequired && <span className="badge warn">required over {formatAUD(settings!.receipt_required_over_cents)}</span>}</h2>
          <ReceiptUploader staged={staged} onStage={setStaged} ocrEnabled={settings?.ocr_enabled} onOcrSuggestion={setOcr} />
          {ocr && (ocr.supplier || ocr.dateISO || ocr.amountStr) && (
            <div className="alert info mt1">
              <b>Scanned suggestions</b> — tap to apply (nothing is applied automatically):
              <div className="btnrow mt1">
                {ocr.supplier && (
                  <button type="button" className="btn ghost small" onClick={() => applyOcr("supplier")}>Supplier: {ocr.supplier}</button>
                )}
                {ocr.dateISO && (
                  <button type="button" className="btn ghost small" onClick={() => applyOcr("date")}>Date: {formatDateAU(ocr.dateISO)}</button>
                )}
                {ocr.amountStr && (
                  <button type="button" className="btn ghost small" onClick={() => applyOcr("amount")}>Amount: {ocr.amountStr}</button>
                )}
              </div>
            </div>
          )}
          {receiptRequired && !staged && (
            <label className="checkline mt1">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>Save without a receipt for now — it will appear in the missing-receipts report until one is attached.</span>
            </label>
          )}
        </div>
      )}

      <div className="card">
        <div className="field">
          <label htmlFor="f-notes">Notes</label>
          <textarea id="f-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything your accountant should know" />
        </div>
        {mode === "edit" && (
          <div className="field">
            <label htmlFor="f-editnote">Reason for this edit <span className="muted">(recorded in the audit history)</span></label>
            <input id="f-editnote" type="text" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="e.g. corrected amount from receipt" />
          </div>
        )}
        {error && <div className="alert danger">{error}</div>}
        <div className="btnrow">
          <button className="btn" disabled={busy}>
            {busy ? "Saving…" : mode === "create" ? "Save expense" : "Save changes"}
          </button>
          <button type="button" className="btn ghost" onClick={() => router.back()} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
