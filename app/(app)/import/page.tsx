"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { apiGet, apiSend } from "@/lib/client";
import { formatAUD } from "@/lib/money";
import { useEffect } from "react";
import type { MetaDto } from "@/lib/types";

type Step = 1 | 2 | 3 | 4;

type TargetField = { key: string; label: string; required?: boolean };
const TARGETS: TargetField[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "supplier", label: "Supplier" },
  { key: "currency", label: "Currency code" },
  { key: "abn", label: "Supplier ABN" },
  { key: "notes", label: "Notes" },
  { key: "gstTreatment", label: "GST treatment (gst / gst_free / input_taxed)" },
  { key: "businessUsePct", label: "Business use %" },
];

type ValidatedRow = {
  index: number;
  status: "ok" | "warning" | "error" | "skip";
  messages: string[];
  audPreviewCents?: number | null;
  input?: { dateIncurred: string; supplierName: string; description: string; originalCurrency: string };
};

export default function ImportPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [dateFormat, setDateFormat] = useState<"DMY" | "YMD" | "MDY">("DMY");
  const [defaultCurrency, setDefaultCurrency] = useState("AUD");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [defaultPayment, setDefaultPayment] = useState("");
  const [validated, setValidated] = useState<{ rows: ValidatedRow[]; summary: { ok: number; warning: number; error: number; skip: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<MetaDto>("/api/meta").then((m) => {
      setMeta(m);
      setDefaultCategoryId(m.categories.find((c) => c.name === "Other")?.id ?? m.categories[0]?.id ?? "");
    }).catch((e) => setError(e.message));
  }, []);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFilename(f.name);
    setError(null);
    Papa.parse(f, {
      skipEmptyLines: "greedy",
      complete: (res) => {
        const all = (res.data as string[][]).map((r) => r.map((c) => String(c ?? "")));
        if (all.length === 0) return setError("The file appears to be empty.");
        setHeaders(all[0]);
        setRows(all);
        // Auto-guess column mapping from header names.
        const guess: Record<string, number> = {};
        all[0].forEach((h, i) => {
          const l = h.toLowerCase();
          if (guess.date == null && /date/.test(l)) guess.date = i;
          if (guess.description == null && /(desc|narrat|detail|memo|particular)/.test(l)) guess.description = i;
          if (guess.amount == null && /(amount|debit|value|total)/.test(l)) guess.amount = i;
          if (guess.supplier == null && /(supplier|merchant|payee|vendor|name)/.test(l)) guess.supplier = i;
          if (guess.currency == null && /currenc|ccy/.test(l)) guess.currency = i;
        });
        setMapping(guess);
        setStep(2);
      },
      error: () => setError("Could not parse that file as CSV."),
    });
  }

  const dataRows = useMemo(() => (hasHeader ? rows.slice(1) : rows), [rows, hasHeader]);

  const defaults = useMemo(
    () => ({
      dateFormat,
      defaultCurrency: defaultCurrency.toUpperCase() || "AUD",
      defaultCategoryId,
      defaultPaymentMethod: defaultPayment || null,
      defaultBusinessUseBp: 10000,
    }),
    [dateFormat, defaultCurrency, defaultCategoryId, defaultPayment]
  );

  async function validate() {
    if (mapping.date == null || mapping.description == null || mapping.amount == null) {
      return setError("Map the Date, Description and Amount columns first.");
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<typeof validated>("/api/import/validate", "POST", { rows: dataRows, mapping, defaults });
      setValidated(res);
      setStep(3);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ imported: number; skipped: number; errors: number }>("/api/import/commit", "POST", {
        filename,
        rows: dataRows,
        mapping,
        defaults,
      });
      setResult(res);
      setStep(4);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!meta) return <div className="empty"><span className="spin" /> Loading…</div>;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="section-head"><h1>Bulk CSV import</h1></div>
      <div className="steps">
        <span className={`step ${step === 1 ? "active" : step > 1 ? "done" : ""}`}>1 · Upload</span>
        <span className={`step ${step === 2 ? "active" : step > 2 ? "done" : ""}`}>2 · Map columns</span>
        <span className={`step ${step === 3 ? "active" : step > 3 ? "done" : ""}`}>3 · Review</span>
        <span className={`step ${step === 4 ? "active" : ""}`}>4 · Done</span>
      </div>

      {error && <div className="alert danger">{error}</div>}

      {step === 1 && (
        <div className="card">
          <h2>Upload a bank or card statement CSV</h2>
          <p className="small muted mt0">For backfilling a past financial year. Up to 2,000 rows per import. Negative amounts (refunds/credits) are skipped automatically. Foreign-currency rows get the historical rate for each transaction date.</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={pickFile} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Choose CSV file</button>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h2>Map columns — {filename}</h2>
          <label className="checkline">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            <span>First row is a header row</span>
          </label>
          <div className="tablewrap mb2">
            <table className="data">
              <thead>
                <tr>{headers.map((h, i) => <th key={i}>{hasHeader ? h || `Col ${i + 1}` : `Col ${i + 1}`}</th>)}</tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 3).map((r, ri) => (
                  <tr key={ri}>{headers.map((_, ci) => <td key={ci} className="small">{r[ci]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid3">
            {TARGETS.map((t) => (
              <div className="field" key={t.key}>
                <label>{t.label}{t.required && " *"}</label>
                <select
                  value={mapping[t.key] ?? -1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setMapping((m) => {
                      const next = { ...m };
                      if (v < 0) delete next[t.key];
                      else next[t.key] = v;
                      return next;
                    });
                  }}
                >
                  <option value={-1}>— not in file —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <hr className="sep" />
          <h3>Defaults for unmapped fields</h3>
          <div className="grid3 mt1">
            <div className="field">
              <label>Date format in file</label>
              <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as "DMY" | "YMD" | "MDY")}>
                <option value="DMY">DD/MM/YYYY (Australian)</option>
                <option value="YMD">YYYY-MM-DD</option>
                <option value="MDY">MM/DD/YYYY (US)</option>
              </select>
            </div>
            <div className="field">
              <label>Default currency</label>
              <input type="text" value={defaultCurrency} maxLength={3} style={{ textTransform: "uppercase" }} onChange={(e) => setDefaultCurrency(e.target.value)} />
            </div>
            <div className="field">
              <label>Default category</label>
              <select value={defaultCategoryId} onChange={(e) => setDefaultCategoryId(e.target.value)}>
                {meta.categories.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Default payment method</label>
              <select value={defaultPayment} onChange={(e) => setDefaultPayment(e.target.value)}>
                <option value="">—</option>
                {meta.paymentMethods.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <p className="small muted">GST treatment defaults by currency: AUD → GST included, anything else → no GST. Map a GST column or edit records after import to override. You can re-categorise records individually later.</p>
          <div className="btnrow">
            <button className="btn" onClick={validate} disabled={busy}>{busy ? "Checking rows + fetching FX…" : "Validate rows"}</button>
            <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
          </div>
        </div>
      )}

      {step === 3 && validated && (
        <div className="card">
          <h2>Review — {filename}</h2>
          <div className="btnrow mb2">
            <span className="badge ok">{validated.summary.ok} ready</span>
            <span className="badge warn">{validated.summary.warning} with warnings</span>
            <span className="badge danger">{validated.summary.error} errors (won't import)</span>
            <span className="badge neutral">{validated.summary.skip} skipped</span>
          </div>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>#</th><th>Status</th><th>Date</th><th>Supplier</th><th className="r">AUD est.</th><th>Notes</th></tr></thead>
              <tbody>
                {validated.rows.filter((r) => r.status !== "skip" || r.messages[0] !== "Empty row").slice(0, 300).map((r) => (
                  <tr key={r.index}>
                    <td className="muted">{r.index + 1}</td>
                    <td>
                      {r.status === "ok" && <span className="badge ok">ok</span>}
                      {r.status === "warning" && <span className="badge warn">warn</span>}
                      {r.status === "error" && <span className="badge danger">error</span>}
                      {r.status === "skip" && <span className="badge neutral">skip</span>}
                    </td>
                    <td className="nowrap">{r.input?.dateIncurred ?? ""}</td>
                    <td>{r.input?.supplierName ?? ""}</td>
                    <td className="r">{r.audPreviewCents != null ? formatAUD(r.audPreviewCents) : r.input && r.input.originalCurrency !== "AUD" ? "FX pending" : ""}</td>
                    <td className="small muted">{r.messages.join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btnrow mt2">
            <button className="btn" onClick={commit} disabled={busy || validated.summary.ok + validated.summary.warning === 0}>
              {busy ? "Importing…" : `Import ${validated.summary.ok + validated.summary.warning} records`}
            </button>
            <button className="btn ghost" onClick={() => setStep(2)}>Back to mapping</button>
          </div>
        </div>
      )}

      {step === 4 && result && (
        <div className="card">
          <h2>Import complete</h2>
          <div className="alert ok">✓ {result.imported} records imported{result.skipped ? ` · ${result.skipped} skipped` : ""}{result.errors ? ` · ${result.errors} errors left out` : ""}. Every imported record carries an audit entry naming this file.</div>
          <div className="btnrow">
            <button className="btn" onClick={() => router.push("/expenses")}>View expenses</button>
            <button className="btn ghost" onClick={() => { setStep(1); setValidated(null); setResult(null); }}>Import another file</button>
          </div>
        </div>
      )}
    </div>
  );
}
