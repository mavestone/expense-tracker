"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, apiSend, apiUpload, ApiError } from "@/lib/client";

type Settings = Record<string, string | number | boolean>;

const TEXT_FIELDS: { key: string; label: string; hint?: string; rows?: number; placeholder?: string }[] = [
  { key: "owner_name", label: "Your first name", hint: "Used for the greeting on the overview page." },
  { key: "business_name", label: "Business name", placeholder: "Mavestone" },
  { key: "business_abn", label: "ABN", placeholder: "97 834 141 404" },
  { key: "business_email", label: "Email" },
  { key: "business_website", label: "Website" },
  { key: "business_address", label: "Address", rows: 3 },
];

const PAY_FIELDS: { key: string; label: string; placeholder: string }[] = [
  {
    key: "pay_to_aud",
    label: "AUD",
    placeholder: "Account name: …\nBSB: 774-001\nAccount: 226229212",
  },
  {
    key: "pay_to_usd",
    label: "USD",
    placeholder: "Wise US Inc\nAccount: 606513478323413\nRouting: 084009519\nSWIFT: TRWIUS35XXX",
  },
  { key: "pay_to_gbp", label: "GBP", placeholder: "Account name: …\nSort code: …\nAccount: …" },
];

export default function BrandingPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [logoVersion, setLogoVersion] = useState(0);
  const [hasLogo, setHasLogo] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiGet<{ settings: Settings }>("/api/settings")
      .then((r) => {
        setS(r.settings);
        setHasLogo(Boolean(r.settings.invoice_logo));
      })
      .catch((e) => setErrors([e.message]));
  }, []);

  function set(key: string, value: string) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    setErrors([]);
    setStatus(null);
    try {
      const keys = [...TEXT_FIELDS, ...PAY_FIELDS].map((f) => f.key).concat("invoice_terms_default", "invoice_footer");
      await apiSend("/api/settings", "PATCH", { settings: Object.fromEntries(keys.map((k) => [k, s[k] ?? ""])) });
      setStatus("Saved.");
    } catch (e) {
      setErrors(e instanceof ApiError && e.errors?.length ? e.errors : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    setErrors([]);
    setStatus(null);
    try {
      await apiUpload("/api/branding/logo", file, file.name);
      setHasLogo(true);
      setLogoVersion((v) => v + 1);
      setStatus("Logo uploaded.");
    } catch (e) {
      setErrors(e instanceof ApiError && e.errors?.length ? e.errors : [(e as Error).message]);
    }
  }

  async function removeLogo() {
    await apiSend("/api/branding/logo", "DELETE");
    setHasLogo(false);
    setLogoVersion((v) => v + 1);
  }

  if (!s) return <div className="empty"><span className="spin" /> Loading…</div>;

  return (
    <div>
      <div className="section-head">
        <h1>Branding</h1>
        <span className="muted small">Everything here prints on your invoices.</span>
      </div>

      {errors.length > 0 && <div className="alert danger">{errors.join(" ")}</div>}
      {status && <div className="alert ok">{status}</div>}

      <div className="card">
        <h2>Logo</h2>
        <p className="muted small mb2">
          Prints in the top-left corner of every invoice. PNG, JPEG or WebP, under 2 MB. A transparent PNG around
          600 px wide gives the cleanest result in print.
        </p>
        {hasLogo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/branding/logo?v=${logoVersion}`} alt="Current logo" className="logo-preview mb2" />
        )}
        <div className="btnrow">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <button className="btn ghost small" onClick={() => fileRef.current?.click()}>
            {hasLogo ? "Replace logo" : "Upload logo"}
          </button>
          {hasLogo && <button className="btn danger small" onClick={removeLogo}>Remove</button>}
        </div>
      </div>

      <div className="card mt2">
        <h2>Your details</h2>
        <div className="grid2">
          {TEXT_FIELDS.filter((f) => !f.rows).map((f) => (
            <label key={f.key}>
              {f.label}
              <input value={String(s[f.key] ?? "")} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              {f.hint && <span className="hint">{f.hint}</span>}
            </label>
          ))}
        </div>
        {TEXT_FIELDS.filter((f) => f.rows).map((f) => (
          <label key={f.key}>
            {f.label}
            <textarea rows={f.rows} value={String(s[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
          </label>
        ))}
      </div>

      <div className="card mt2">
        <h2>Payment details</h2>
        <p className="muted small mb2">
          One block per currency. The invoice prints only the block matching the currency it was issued in, so an
          overseas client never sees a BSB they cannot use.
        </p>
        <div className="grid3">
          {PAY_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <textarea rows={5} value={String(s[f.key] ?? "")} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            </label>
          ))}
        </div>
      </div>

      <div className="card mt2">
        <h2>Default wording</h2>
        <label>
          Payment terms
          <input value={String(s.invoice_terms_default ?? "")} onChange={(e) => set("invoice_terms_default", e.target.value)} />
          <span className="hint">Used on any invoice that does not set its own terms.</span>
        </label>
        <label>
          Footer
          <textarea rows={2} value={String(s.invoice_footer ?? "")} onChange={(e) => set("invoice_footer", e.target.value)} placeholder="Thank you for your business." />
        </label>
      </div>

      <div className="btnrow mt2">
        <button className="btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
