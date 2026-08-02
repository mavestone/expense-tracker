import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { createIncome, isIncomeGst, listIncome, voidIncome, type IncomeInput } from "@/lib/income";
import { addIncomeDocument } from "@/lib/income-documents";
import { parseMoneyToCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { ALLOWED_RECEIPT_MIMES } from "@/lib/storage";

export const runtime = "nodejs";

type Payload = {
  dateEarned: string;
  datePaid?: string | null;
  clientName: string;
  clientAbn?: string | null;
  invoiceRef?: string | null;
  description: string;
  incomeType?: string;
  amount?: string;
  amountCents?: number;
  currency: string;
  gstTreatment?: string;
  paymentAccount?: string | null;
  notes?: string | null;
  /** Optional invoice document attached in the same call. */
  invoice?: { filename: string; mime: string; base64: string };
};

/**
 * Minimal search for automation: find income records (dedupe checks, locating
 * a record id to attach an invoice to or mark paid). Read-only.
 */
export const GET = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const url = new URL(req.url);
    const q = url.searchParams.get("q") || undefined;
    const fy = url.searchParams.get("fy") || undefined;
    const statusParam = url.searchParams.get("status");
    const status = statusParam
      ? (statusParam.split(",") as ("active" | "void")[])
      : (["active", "void"] as ("active" | "void")[]);
    const outstandingOnly = url.searchParams.get("outstanding") === "true";

    const { income, totals, outstanding } = await listIncome({ search: q, fy, status, outstandingOnly, limit: 25 });
    const origin = url.origin;
    let rows = income.map((i) => ({
      id: i.id,
      url: `${origin}/income/${i.id}`,
      dateEarned: i.dateEarned,
      datePaid: i.datePaid ?? "outstanding",
      client: i.clientName,
      invoiceRef: i.invoiceRef,
      description: i.description,
      originalAmount: `${i.originalCurrency} ${(i.originalAmountCents / 100).toFixed(2)}`,
      audAmount: (i.audAmountCents / 100).toFixed(2),
      gstTreatment: i.gstTreatment,
      status: i.status,
      financialYear: i.financialYear,
    }));
    const date = url.searchParams.get("date");
    if (date) rows = rows.filter((r) => r.dateEarned === date);
    return json({
      income: rows,
      totals: {
        count: totals.count,
        audTotal: (totals.audTotal / 100).toFixed(2),
        gstOnSalesAud: (totals.gstTotal / 100).toFixed(2),
      },
      outstanding: { count: outstanding.count, audTotal: (outstanding.audTotal / 100).toFixed(2) },
    });
  },
  { auth: false }
);

/** Log business income (invoiced work or other) from an AI assistant. */
export const POST = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const p = (await req.json()) as Payload;
    const amountCents =
      p.amountCents != null && Number.isInteger(p.amountCents) && p.amountCents > 0
        ? p.amountCents
        : p.amount != null
          ? parseMoneyToCents(String(p.amount))
          : null;
    if (amountCents == null || amountCents <= 0) return json({ error: "Invalid amount." }, { status: 400 });

    const settings = await getSettings();
    const currency = String(p.currency || "").toUpperCase();
    const treatment = p.gstTreatment && isIncomeGst(p.gstTreatment)
      ? p.gstTreatment
      : settings.gst_registered && currency === "AUD"
        ? "gst"
        : "no_gst";

    const input: IncomeInput = {
      dateEarned: p.dateEarned,
      datePaid: p.datePaid ?? null,
      clientName: p.clientName,
      clientAbn: p.clientAbn ?? null,
      invoiceRef: p.invoiceRef ?? null,
      description: p.description,
      incomeType: p.incomeType || "client_work",
      originalAmountCents: amountCents,
      originalCurrency: currency,
      gstTreatment: treatment,
      paymentAccount: p.paymentAccount ?? null,
      notes: p.notes ?? null,
    };

    // Validate any attached invoice before creating the record.
    let docBuf: Buffer | null = null;
    if (p.invoice) {
      if (!p.invoice.base64 || p.invoice.base64.length > 8 * 1024 * 1024)
        return json({ error: "Invoice document too large (max ~6MB)." }, { status: 413 });
      if (!ALLOWED_RECEIPT_MIMES.has(p.invoice.mime))
        return json({ error: `Unsupported document type ${p.invoice.mime}. Use JPEG, PNG, WebP, HEIC or PDF.` }, { status: 400 });
      try {
        docBuf = Buffer.from(p.invoice.base64, "base64");
      } catch {
        return json({ error: "Invoice base64 could not be decoded." }, { status: 400 });
      }
      if (docBuf.length === 0) return json({ error: "Invoice document is empty." }, { status: 400 });
    }

    const rec = await createIncome(input, { source: "agent", resolveFx: true, auditNote: "Created via Hyperagent agent API" });

    let attached = false;
    if (docBuf && p.invoice) {
      try {
        await addIncomeDocument(rec.id, { buffer: docBuf, filename: p.invoice.filename || "invoice", mime: p.invoice.mime });
        attached = true;
      } catch (e) {
        // Keep ingestion atomic: void the record so a retry can't double-post.
        await voidIncome(rec.id, "Invoice storage failed during agent ingestion — voided for clean retry").catch(() => {});
        return json(
          { error: `Invoice storage failed: ${(e as Error).message} — the income record was voided so you can safely retry.`, cleanRetry: true },
          { status: 502 }
        );
      }
    }

    const origin = new URL(req.url).origin;
    return json(
      {
        id: rec.id,
        url: `${origin}/income/${rec.id}`,
        invoiceAttached: attached,
        summary: {
          date: rec.dateEarned,
          paid: rec.datePaid ?? "outstanding",
          client: rec.clientName,
          original: `${rec.originalCurrency} ${(rec.originalAmountCents / 100).toFixed(2)}`,
          audAmount: (rec.audAmountCents / 100).toFixed(2),
          fx: rec.fxRate ? { rate: rec.fxRate, source: rec.fxRateSource, rateDate: rec.fxRateDate } : rec.fxStatus,
          gstTreatment: rec.gstTreatment,
          gstOnSalesAud: (rec.gstAmountCents / 100).toFixed(2),
          financialYear: rec.financialYear,
        },
      },
      { status: 201 }
    );
  },
  { auth: false }
);
