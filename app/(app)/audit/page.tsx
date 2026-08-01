"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { formatAUD } from "@/lib/money";
import { formatDateAU } from "@/lib/fy";
import type { AuditDto, ExpenseDto } from "@/lib/types";

type AuditResponse = { audit: AuditDto[]; voided: ExpenseDto[] };

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"voided" | "log">("voided");

  useEffect(() => {
    apiGet<AuditResponse>("/api/audit").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert danger">{error}</div>;
  if (!data) return <div className="empty"><span className="spin" /> Loading…</div>;

  return (
    <div>
      <div className="section-head"><h1>Audit</h1></div>
      <p className="muted small" style={{ marginTop: -6 }}>
        Nothing in this system is ever deleted. Voided records stay here with their reason, and every change to every record is logged with old and new values.
      </p>

      <div className="steps">
        <button className={`step ${tab === "voided" ? "active" : ""}`} style={{ border: "none", cursor: "pointer", font: "inherit" }} onClick={() => setTab("voided")}>
          Voided records ({data.voided.length})
        </button>
        <button className={`step ${tab === "log" ? "active" : ""}`} style={{ border: "none", cursor: "pointer", font: "inherit" }} onClick={() => setTab("log")}>
          Change log
        </button>
      </div>

      {tab === "voided" && (
        <div className="card">
          {data.voided.length === 0 && <div className="empty">No voided records.</div>}
          {data.voided.length > 0 && (
            <div className="tablewrap">
              <table className="data">
                <thead><tr><th>Date</th><th>Supplier</th><th>Description</th><th className="r">AUD</th><th>Voided</th><th>Reason</th></tr></thead>
                <tbody>
                  {data.voided.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap"><Link href={`/expenses/${e.id}`}>{formatDateAU(e.dateIncurred)}</Link></td>
                      <td>{e.supplierName}</td>
                      <td>{e.description}</td>
                      <td className="r">{formatAUD(e.audAmountCents)}</td>
                      <td className="nowrap">{e.voidedAt ? formatDateAU(e.voidedAt.slice(0, 10)) : ""}</td>
                      <td>{e.voidReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "log" && (
        <div className="card">
          <div className="auditlist">
            {data.audit.map((a) => (
              <div className="entry" key={a.id}>
                <div className="when">
                  {new Date(a.at).toLocaleString("en-AU")} · <b>{a.entityType}</b> · {a.action}
                  {a.entityType === "expense" && <> · <Link href={`/expenses/${a.entityId}`}>open record</Link></>}
                </div>
                {a.field && (
                  <div className="change">
                    {a.field}: {a.oldValue != null && <span className="old">{a.oldValue}</span>} {a.newValue != null && <span className="new">{a.newValue}</span>}
                  </div>
                )}
                {!a.field && a.newValue && <div className="change">{a.newValue}</div>}
                {a.note && <div className="muted small">note: {a.note}</div>}
              </div>
            ))}
            {data.audit.length === 0 && <div className="empty">No activity yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
