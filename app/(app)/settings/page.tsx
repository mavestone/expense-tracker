"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { parseMoneyToCents, centsToDecimalString } from "@/lib/money";
import { currentFy, fyLabel } from "@/lib/fy";
import type { CategoryDto, PaymentMethodDto, SettingsDto, ThresholdDto } from "@/lib/types";

type SettingsResponse = { settings: SettingsDto; thresholds: ThresholdDto[] };

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [payments, setPayments] = useState<PaymentMethodDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // local edit state
  const [bizName, setBizName] = useState("");
  const [receiptThresh, setReceiptThresh] = useState("");
  const [gstThresh, setGstThresh] = useState("");
  const [staleDays, setStaleDays] = useState("");
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [gstRegistered, setGstRegistered] = useState(false);
  const [thresholdEdits, setThresholdEdits] = useState<Record<string, string>>({});
  const [newFy, setNewFy] = useState("");
  const [newFyAmount, setNewFyAmount] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newCatEquip, setNewCatEquip] = useState(false);
  const [newPay, setNewPay] = useState("");

  async function load() {
    try {
      const [s, c, p] = await Promise.all([
        apiGet<SettingsResponse>("/api/settings"),
        apiGet<{ categories: CategoryDto[] }>("/api/categories"),
        apiGet<{ paymentMethods: PaymentMethodDto[] }>("/api/payment-methods"),
      ]);
      setData(s);
      setCategories(c.categories);
      setPayments(p.paymentMethods);
      setBizName(s.settings.business_name || "");
      setReceiptThresh(centsToDecimalString(s.settings.receipt_required_over_cents));
      setGstThresh(centsToDecimalString(s.settings.gst_receipt_flag_cents));
      setStaleDays(String(s.settings.subscription_stale_days));
      setOcrEnabled(s.settings.ocr_enabled);
      setGstRegistered(!!s.settings.gst_registered);
      const edits: Record<string, string> = {};
      for (const t of s.thresholds) edits[t.fyLabel] = t.instantWriteoffCents != null ? centsToDecimalString(t.instantWriteoffCents) : "";
      setThresholdEdits(edits);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  async function saveGeneral(e: React.FormEvent) {
    e.preventDefault();
    const r = parseMoneyToCents(receiptThresh);
    const g = parseMoneyToCents(gstThresh);
    const sd = parseInt(staleDays, 10);
    if (r == null || g == null || !Number.isInteger(sd) || sd < 1) return setError("Check the threshold values.");
    setError(null);
    await apiSend("/api/settings", "PATCH", {
      settings: {
        business_name: bizName,
        receipt_required_over_cents: r,
        gst_receipt_flag_cents: g,
        subscription_stale_days: sd,
        ocr_enabled: ocrEnabled,
        gst_registered: gstRegistered,
      },
    });
    flash("Settings saved");
    await load();
  }

  async function saveThreshold(fyLabelStr: string) {
    const v = thresholdEdits[fyLabelStr] ?? "";
    const cents = v.trim() === "" ? null : parseMoneyToCents(v);
    if (v.trim() !== "" && cents == null) return setError(`Invalid amount for FY ${fyLabelStr}.`);
    setError(null);
    await apiSend("/api/settings", "PATCH", { thresholds: [{ fyLabel: fyLabelStr, instantWriteoffCents: cents }] });
    flash(`FY ${fyLabelStr} threshold saved`);
    await load();
  }

  async function addFyRow(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(newFy)) return setError('FY label must look like "2024-25".');
    const cents = newFyAmount.trim() === "" ? null : parseMoneyToCents(newFyAmount);
    if (newFyAmount.trim() !== "" && cents == null) return setError("Invalid threshold amount.");
    setError(null);
    await apiSend("/api/settings", "PATCH", { thresholds: [{ fyLabel: newFy, instantWriteoffCents: cents }] });
    setNewFy("");
    setNewFyAmount("");
    flash("FY threshold added");
    await load();
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCat.trim()) return;
    try {
      await apiSend("/api/categories", "POST", { name: newCat.trim(), isEquipment: newCatEquip });
      setNewCat("");
      setNewCatEquip(false);
      flash("Category added");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function patchCategory(c: CategoryDto, patch: Partial<CategoryDto>) {
    await apiSend(`/api/categories/${c.id}`, "PATCH", patch);
    await load();
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!newPay.trim()) return;
    try {
      await apiSend("/api/payment-methods", "POST", { name: newPay.trim() });
      setNewPay("");
      flash("Payment method added");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!data) return <div className="empty"><span className="spin" /> Loading…</div>;

  const fyNow = currentFy();
  const nextFySuggestion = fyLabel(Number(fyNow.slice(0, 4)) + 1);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="section-head"><h1>Settings</h1></div>
      {error && <div className="alert danger">{error}</div>}

      <form className="card" onSubmit={saveGeneral}>
        <h2>General</h2>
        <div className="field">
          <label>Business name <span className="muted">(appears on exports)</span></label>
          <input type="text" value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Your Company Pty Ltd" />
        </div>
        <div className="grid3">
          <div className="field">
            <label>Receipt required over (AUD)</label>
            <input type="text" inputMode="decimal" value={receiptThresh} onChange={(e) => setReceiptThresh(e.target.value)} />
            <span className="hint">Warns and requires acknowledgment when saving without one</span>
          </div>
          <div className="field">
            <label>GST tax-invoice threshold (AUD)</label>
            <input type="text" inputMode="decimal" value={gstThresh} onChange={(e) => setGstThresh(e.target.value)} />
            <span className="hint">ATO rule: $82.50 — credits over this need a tax invoice</span>
          </div>
          <div className="field">
            <label>Subscription stale after (days)</label>
            <input type="text" inputMode="numeric" value={staleDays} onChange={(e) => setStaleDays(e.target.value)} />
            <span className="hint">Flags subs with unconfirmed renewals older than this</span>
          </div>
        </div>
        <label className="checkline">
          <input type="checkbox" checked={ocrEnabled} onChange={(e) => setOcrEnabled(e.target.checked)} />
          <span>Enable receipt scanning (OCR runs on your device; only ever suggests values)</span>
        </label>
        <label className="checkline">
          <input type="checkbox" checked={gstRegistered} onChange={(e) => setGstRegistered(e.target.checked)} />
          <span>
            <b>Registered for GST</b> — enables GST on sales (BAS 1A) on income records
            <div className="hint">
              Confirm with your accountant. Registration is what allows GST credits on purchases (1B) to be claimed at all — if you are not registered, the GST shown on supplier invoices is simply part of the cost.
            </div>
          </span>
        </label>
        <div className="btnrow mt1"><button className="btn">Save general settings</button></div>
      </form>

      <div className="card">
        <h2>Instant asset write-off thresholds</h2>
        <p className="small muted mt0">
          Set per financial year — <b>confirm the current figure with your accountant</b> (it changes year to year and this app deliberately doesn't assume one). Equipment purchases at or above the threshold get a capital-asset suggestion.
        </p>
        {data.thresholds.map((t) => (
          <div className="grid3" key={t.id} style={{ alignItems: "end" }}>
            <div className="field">
              <label>FY {t.fyLabel}{t.fyLabel === fyNow ? " (current)" : ""}</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="not set"
                value={thresholdEdits[t.fyLabel] ?? ""}
                onChange={(e) => setThresholdEdits((m) => ({ ...m, [t.fyLabel]: e.target.value }))}
              />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>&nbsp;</label>
              <div className="btnrow">
                <button type="button" className="btn ghost" onClick={() => saveThreshold(t.fyLabel)}>Save</button>
                {t.instantWriteoffCents == null && <span className="badge warn">not set — capital suggestions off for this FY</span>}
              </div>
            </div>
          </div>
        ))}
        <hr className="sep" />
        <form onSubmit={addFyRow}>
          <h3>Add another financial year</h3>
          <div className="grid3 mt1" style={{ alignItems: "end" }}>
            <div className="field">
              <label>FY label</label>
              <input type="text" value={newFy} onChange={(e) => setNewFy(e.target.value)} placeholder={nextFySuggestion} />
            </div>
            <div className="field">
              <label>Threshold (AUD, optional)</label>
              <input type="text" inputMode="decimal" value={newFyAmount} onChange={(e) => setNewFyAmount(e.target.value)} placeholder="e.g. 20000.00" />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="btn ghost">Add FY</button>
            </div>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Categories</h2>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>Name</th><th>Equipment</th><th /></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} style={c.archived ? { opacity: 0.5 } : undefined}>
                  <td>
                    {c.name} {c.archived && <span className="badge neutral">archived</span>}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={c.isEquipment}
                      onChange={(e) => patchCategory(c, { isEquipment: e.target.checked })}
                      title="Equipment categories trigger capital-asset suggestions"
                    />
                  </td>
                  <td className="r">
                    <button className="btn ghost small" onClick={() => {
                      const name = prompt("Rename category:", c.name);
                      if (name && name.trim() && name !== c.name) patchCategory(c, { name: name.trim() });
                    }}>Rename</button>{" "}
                    <button className="btn ghost small" onClick={() => patchCategory(c, { archived: !c.archived })}>
                      {c.archived ? "Restore" : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={addCategory} className="mt2">
          <div className="grid3" style={{ alignItems: "end" }}>
            <div className="field">
              <label>New category</label>
              <input type="text" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <label className="checkline" style={{ margin: 0 }}>
                <input type="checkbox" checked={newCatEquip} onChange={(e) => setNewCatEquip(e.target.checked)} />
                <span>Equipment</span>
              </label>
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="btn ghost" disabled={!newCat.trim()}>Add category</button>
            </div>
          </div>
        </form>
        <p className="small muted">Archiving hides a category from new entries; historical records keep it. Renames apply everywhere and are audited.</p>
      </div>

      <div className="card">
        <h2>Payment methods</h2>
        <div className="tablewrap">
          <table className="data">
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} style={p.archived ? { opacity: 0.5 } : undefined}>
                  <td>{p.name} {p.archived && <span className="badge neutral">archived</span>}</td>
                  <td className="r">
                    <button className="btn ghost small" onClick={async () => { await apiSend(`/api/payment-methods/${p.id}`, "PATCH", { archived: !p.archived }); await load(); }}>
                      {p.archived ? "Restore" : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={addPayment} className="mt2">
          <div className="grid3" style={{ alignItems: "end" }}>
            <div className="field">
              <label>New payment method</label>
              <input type="text" value={newPay} onChange={(e) => setNewPay(e.target.value)} placeholder="e.g. Amex Business" />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="btn ghost" disabled={!newPay.trim()}>Add</button>
            </div>
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Backups</h2>
        <p className="small muted mt0">
          A full backup contains every record as plain JSON plus every receipt file version — readable in 20 years without this app. Australian record-keeping requires 5 years (this app is built for 7+); keep an offline copy after each quarter.
        </p>
        <div className="btnrow">
          <a className="btn" href="/api/export/backup?fy=all">⬇ Download full backup (zip)</a>
          <a className="btn ghost" href={`/api/export/backup?fy=${fyNow}`}>⬇ This FY only</a>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
