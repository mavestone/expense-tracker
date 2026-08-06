"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/client";
import { formatAUD, parseMoneyToCents } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";

type FyDoc = {
  id: string;
  title: string;
  kind: string;
  description: string | null;
  originalFilename: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
};

type Closure = {
  finalisedAt: string;
  lodgedDate: string | null;
  atoReceipt: string | null;
  taxableIncomeCents: number | null;
  taxPayableCents: number | null;
  note: string | null;
  reopenedAt: string | null;
  reopenedReason: string | null;
};

type State = { fy: string; closure: Closure | null; finalised: boolean; documents: FyDoc[] };

const KINDS = [
  { value: "file_note", label: "File note" },
  { value: "lodgement", label: "Lodgement receipt" },
  { value: "working_paper", label: "Working paper" },
  { value: "correspondence", label: "Correspondence" },
  { value: "other", label: "Other" },
];

function kb(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

/**
 * Year status and its working papers.
 *
 * Finalising records that a return was lodged and what it was lodged as. It
 * deliberately does not lock the year — an amended return is a normal thing to
 * need, and a hard lock would only be worked around. It warns instead.
 */
export default function FyClosePanel({ fy }: { fy: string }) {
  const [s, setS] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState({ lodgedDate: "", atoReceipt: "", taxableIncome: "", taxPayable: "", note: "" });
  const [meta, setMeta] = useState({ title: "", kind: "working_paper", description: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    apiGet<State>(`/api/fy/${fy}`).then(setS).catch((e) => setErrors([e.message]));
  }
  useEffect(() => {
    setS(null);
    setOpen(false);
    setErrors([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy]);

  async function finalise() {
    setBusy(true);
    setErrors([]);
    try {
      await apiSend(`/api/fy/${fy}`, "POST", {
        action: "finalise",
        lodgedDate: form.lodgedDate || null,
        atoReceipt: form.atoReceipt || null,
        taxableIncomeCents: form.taxableIncome ? parseMoneyToCents(form.taxableIncome) : null,
        taxPayableCents: form.taxPayable ? parseMoneyToCents(form.taxPayable) : null,
        note: form.note || null,
      });
      setOpen(false);
      load();
    } catch (e) {
      setErrors(e instanceof ApiError && e.errors?.length ? e.errors : [(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    const reason = prompt(`Why is FY ${fy} being reopened? This is recorded in the audit trail.`);
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await apiSend(`/api/fy/${fy}`, "POST", { action: "reopen", reason });
      load();
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setErrors([]);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("title", meta.title || file.name);
      fd.append("kind", meta.kind);
      fd.append("description", meta.description);
      const res = await fetch(`/api/fy/${fy}/documents`, { method: "POST", body: fd });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(b?.error || `Upload failed (${res.status})`);
      }
      setMeta({ title: "", kind: "working_paper", description: "" });
      load();
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  const c = s.closure;

  return (
    <div className={`card mb2${s.finalised ? " finalised" : ""}`}>
      <div className="section-head" style={{ margin: 0 }}>
        <h2 style={{ margin: 0 }}>
          FY {fy}{" "}
          {s.finalised ? (
            <span className="pill paid">finalised</span>
          ) : c?.reopenedAt ? (
            <span className="pill overdue">reopened</span>
          ) : (
            <span className="pill draft">open</span>
          )}
        </h2>
        <span className="btnrow">
          {s.finalised ? (
            <button className="btn ghost small" onClick={reopen} disabled={busy}>Reopen</button>
          ) : (
            <button className="btn small" onClick={() => setOpen((o) => !o)}>
              {c?.reopenedAt ? "Finalise again" : "Mark finalised"}
            </button>
          )}
        </span>
      </div>

      {errors.length > 0 && <div className="alert danger mt1">{errors.join(" ")}</div>}

      {s.finalised && c && (
        <div className="alert ok mt1" style={{ marginBottom: 0 }}>
          <b>Return lodged{c.lodgedDate ? ` ${formatDateAU(c.lodgedDate)}` : ""}.</b>
          {c.atoReceipt && <> ATO receipt <b>{c.atoReceipt}</b>.</>}
          {c.taxableIncomeCents != null && <> Taxable income <b>{formatAUD(c.taxableIncomeCents)}</b>.</>}
          {c.taxPayableCents != null && <> Tax <b>{c.taxPayableCents === 0 ? "nil" : formatAUD(c.taxPayableCents)}</b>.</>}
          {c.note && <div className="small mt1" style={{ whiteSpace: "pre-wrap" }}>{c.note}</div>}
          <div className="small mt1">
            Changing a record dated in this year now means an amended return — the year is not locked, but nothing here
            should move without that in mind.
          </div>
        </div>
      )}

      {c?.reopenedAt && (
        <div className="alert warn mt1" style={{ marginBottom: 0 }}>
          Reopened {formatDateAU(c.reopenedAt.slice(0, 10))} — {c.reopenedReason}
        </div>
      )}

      {open && !s.finalised && (
        <div className="mt2">
          <div className="grid2">
            <label>
              Date lodged
              <input type="date" value={form.lodgedDate} onChange={(e) => setForm({ ...form, lodgedDate: e.target.value })} />
            </label>
            <label>
              ATO receipt number
              <input value={form.atoReceipt} onChange={(e) => setForm({ ...form, atoReceipt: e.target.value })} placeholder="24112 4813 6673" />
            </label>
            <label>
              Taxable income
              <input value={form.taxableIncome} inputMode="decimal" onChange={(e) => setForm({ ...form, taxableIncome: e.target.value })} placeholder="14820.00" />
            </label>
            <label>
              Tax payable
              <input value={form.taxPayable} inputMode="decimal" onChange={(e) => setForm({ ...form, taxPayable: e.target.value })} placeholder="0.00" />
            </label>
          </div>
          <label>
            Note
            <textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Basis used, anything an amendment would need to reconcile to." />
          </label>
          <div className="btnrow">
            <button className="btn" onClick={finalise} disabled={busy}>{busy ? "Saving…" : "Finalise year"}</button>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      <h3 className="mt2" style={{ fontSize: 14 }}>Working papers</h3>
      {s.documents.length === 0 ? (
        <p className="muted small">
          Nothing attached yet. File notes, lodgement receipts and anything else supporting the return belong here.
        </p>
      ) : (
        <table className="lines-table">
          <tbody>
            {s.documents.map((d) => (
              <tr key={d.id}>
                <td>
                  <a href={`/api/fy/documents/${d.id}`} target="_blank" rel="noreferrer"><b>{d.title}</b></a>
                  {d.description && <div className="small muted">{d.description}</div>}
                </td>
                <td className="small muted">{KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}</td>
                <td className="small muted nowrap">{kb(d.sizeBytes)}</td>
                <td className="small muted nowrap">{formatDateAU(d.uploadedAt.slice(0, 10))}</td>
                <td className="r nowrap">
                  <a className="btn ghost small" href={`/api/fy/documents/${d.id}?download=1`}>Download</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="grid3 mt1">
        <label>
          Title
          <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="Defaults to the filename" />
        </label>
        <label>
          Kind
          <select value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label>
          Description
          <input value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
        </label>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*,text/plain,text/markdown,text/csv,.md"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      <div className="btnrow">
        <button className="btn ghost small" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "+ Attach document"}
        </button>
        <span className="muted small">PDF, image or text. Up to 15 MB. Stored immutably alongside the receipts.</span>
      </div>
    </div>
  );
}
