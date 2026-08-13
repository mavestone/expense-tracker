"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiSend, ApiError } from "@/lib/client";
import { currencySymbol } from "@/lib/money";

export type NewClient = {
  id: string;
  name: string;
  invoicePrefix: string;
  defaultCurrency: string;
  defaultGstTreatment: "gst" | "gst_free";
  paymentTermsDays: number;
};

/**
 * Add a client without leaving the invoice you are in the middle of writing.
 *
 * Only the fields that change the invoice itself — everything else (address,
 * tax numbers, contact) can be filled in later on the Clients page and will
 * appear on the next invoice printed. Blocking a new job on a postal address
 * is how a tool stops getting used.
 */
export default function ClientQuickAdd({
  onCreated,
  onCancel,
}: {
  onCreated: (c: NewClient) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [currency, setCurrency] = useState("AUD");
  const [gst, setGst] = useState<"gst" | "gst_free">("gst");
  const [terms, setTerms] = useState(14);
  const [country, setCountry] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Suggest a prefix from the name until the owner types their own — the
  // initials of a business are what the refs almost always use anyway.
  useEffect(() => {
    if (prefixTouched) return;
    const words = name.trim().split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w));
    const skip = /^(pty|ltd|llc|inc|limited|the|and|co|group|studios?)$/i;
    const meaningful = words.filter((w) => !skip.test(w));
    const guess =
      meaningful.length >= 2
        ? meaningful.slice(0, 3).map((w) => w[0]).join("")
        : (meaningful[0] ?? "").slice(0, 5);
    setPrefix(guess.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12));
  }, [name, prefixTouched]);

  // An overseas client is an export of services, which is GST-free. Track the
  // currency until GST is set by hand, so the common case needs no thought.
  const [gstTouched, setGstTouched] = useState(false);
  useEffect(() => {
    if (!gstTouched) setGst(currency === "AUD" ? "gst" : "gst_free");
  }, [currency, gstTouched]);

  async function save() {
    setSaving(true);
    setErrors([]);
    try {
      const res = await apiSend<{ client: NewClient }>("/api/clients", "POST", {
        name,
        invoicePrefix: prefix,
        defaultCurrency: currency,
        defaultGstTreatment: gst,
        paymentTermsDays: terms,
        country: country || null,
        email: email || null,
      });
      onCreated(res.client);
    } catch (e) {
      setErrors(e instanceof ApiError && e.errors?.length ? e.errors : [(e as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="quickadd">
      <div className="section-head" style={{ margin: "0 0 10px" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>New client</h3>
        <span className="muted small">Address and tax numbers can wait — add them on Clients later.</span>
      </div>

      {errors.length > 0 && <div className="alert danger">{errors.join(" ")}</div>}

      <div className="grid2">
        <label>
          Business name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kirin Consulting LLC"
          />
        </label>
        <label>
          Invoice prefix
          <input
            value={prefix}
            onChange={(e) => {
              setPrefixTouched(true);
              setPrefix(e.target.value.toUpperCase());
            }}
            placeholder="KC"
          />
          <span className="hint">Numbers run {prefix || "KC"}_01, {prefix || "KC"}_02 …</span>
        </label>
      </div>

      <div className="grid3">
        <label>
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="AUD">AUD — {currencySymbol("AUD")}</option>
            <option value="USD">USD — {currencySymbol("USD")}</option>
            <option value="GBP">GBP — {currencySymbol("GBP")}</option>
          </select>
        </label>
        <label>
          GST
          <select
            value={gst}
            onChange={(e) => {
              setGstTouched(true);
              setGst(e.target.value as "gst" | "gst_free");
            }}
          >
            <option value="gst">Add 10% — Australian client</option>
            <option value="gst_free">GST-free — export of services</option>
          </select>
        </label>
        <label>
          Payment terms
          <input
            type="number"
            min={0}
            max={180}
            value={terms}
            onChange={(e) => setTerms(parseInt(e.target.value || "0", 10))}
          />
          <span className="hint">Days</span>
        </label>
      </div>

      <div className="grid2">
        <label>
          Country <span className="muted small">optional</span>
          <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United States" />
        </label>
        <label>
          Email <span className="muted small">optional</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>

      <div className="btnrow">
        <button className="btn small" onClick={save} disabled={saving || !name.trim() || !prefix.trim()}>
          {saving ? "Saving…" : "Add client & use it"}
        </button>
        <button className="btn ghost small" onClick={onCancel} disabled={saving}>Cancel</button>
        <Link href="/clients" className="muted small" style={{ marginLeft: "auto" }}>
          Full client details →
        </Link>
      </div>
    </div>
  );
}
