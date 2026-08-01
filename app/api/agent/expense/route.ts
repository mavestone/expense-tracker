import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { db, schema } from "@/lib/db";
import { createExpense, expenseFlags, type ExpenseInput } from "@/lib/expenses";
import { addReceipt } from "@/lib/receipts";
import { defaultTreatmentForCurrency, isGstTreatment } from "@/lib/gst";
import { parseMoneyToCents, percentToBp } from "@/lib/money";
import { ALLOWED_RECEIPT_MIMES } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

type AgentExpensePayload = {
  dateIncurred: string;
  supplierName: string;
  supplierAbn?: string | null;
  description: string;
  /** Category id OR exact/case-insensitive name (e.g. "Software & Subscriptions") */
  category: string;
  /** Decimal string like "129.99" (preferred) */
  amount?: string;
  amountCents?: number;
  currency: string;
  gstTreatment?: string;
  /** 0–100, default 100 */
  businessUsePct?: number | string;
  isCapital?: boolean;
  assetName?: string | null;
  effectiveLifeYears?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  /** "active" (default) or "draft" for in-app review */
  status?: "active" | "draft";
  receipt?: { filename: string; mime: string; base64: string };
};

const MAX_RECEIPT_B64 = 8 * 1024 * 1024; // ~6MB decoded

/**
 * Automation ingestion endpoint (used by the Hyperagent skill): creates a
 * fully derived expense record (FX resolved for the incurred date, GST
 * defaults applied) and optionally attaches a receipt in the same call.
 * Same audit trail and integrity rules as manual entry.
 */
export const POST = api(
  async (req) => {
    if (!agentApiEnabled()) return json({ error: "Agent API not configured (set AGENT_API_KEY)." }, { status: 503 });
    if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });

    const p = (await req.json()) as AgentExpensePayload;

    // Resolve category by id or name.
    const d = await db();
    const cats = await d.select().from(schema.categories);
    const cat =
      cats.find((c) => c.id === p.category) ??
      cats.find((c) => c.name.toLowerCase() === String(p.category ?? "").trim().toLowerCase());
    if (!cat) {
      return json(
        { error: `Unknown category "${p.category}". Valid: ${cats.filter((c) => !c.archived).map((c) => c.name).join(", ")}` },
        { status: 400 }
      );
    }

    const amountCents =
      p.amountCents != null && Number.isInteger(p.amountCents) && p.amountCents > 0
        ? p.amountCents
        : p.amount != null
          ? parseMoneyToCents(String(p.amount))
          : null;
    if (amountCents == null || amountCents <= 0) return json({ error: "Invalid amount." }, { status: 400 });

    const currency = String(p.currency || "").toUpperCase();
    const treatment =
      p.gstTreatment && isGstTreatment(p.gstTreatment) ? p.gstTreatment : defaultTreatmentForCurrency(currency);

    let businessUseBp = 10000;
    if (p.businessUsePct != null) {
      const bp = percentToBp(String(p.businessUsePct));
      if (bp == null) return json({ error: "businessUsePct must be 0–100." }, { status: 400 });
      businessUseBp = bp;
    }

    // Validate receipt before creating anything.
    let receiptBuf: Buffer | null = null;
    if (p.receipt) {
      if (!p.receipt.base64 || p.receipt.base64.length > MAX_RECEIPT_B64)
        return json({ error: "Receipt too large (max ~6MB). Compress it first." }, { status: 413 });
      if (!ALLOWED_RECEIPT_MIMES.has(p.receipt.mime))
        return json({ error: `Unsupported receipt type ${p.receipt.mime}. Use JPEG, PNG, WebP, HEIC or PDF.` }, { status: 400 });
      try {
        receiptBuf = Buffer.from(p.receipt.base64, "base64");
      } catch {
        return json({ error: "Receipt base64 could not be decoded." }, { status: 400 });
      }
      if (receiptBuf.length === 0) return json({ error: "Receipt is empty." }, { status: 400 });
    }

    const input: ExpenseInput = {
      dateIncurred: p.dateIncurred,
      supplierName: p.supplierName,
      supplierAbn: p.supplierAbn ?? null,
      description: p.description,
      categoryId: cat.id,
      originalAmountCents: amountCents,
      originalCurrency: currency,
      gstTreatment: treatment,
      businessUseBp,
      isCapital: !!p.isCapital,
      assetName: p.assetName ?? null,
      effectiveLifeYears: p.effectiveLifeYears ?? null,
      paymentMethod: p.paymentMethod ?? null,
      notes: p.notes ?? null,
    };

    const expense = await createExpense(input, {
      status: p.status === "draft" ? "draft" : "active",
      source: "agent",
      resolveFx: true,
      auditNote: "Created via Hyperagent agent API",
    });

    let receipt = null;
    if (receiptBuf && p.receipt) {
      receipt = await addReceipt(expense.id, { buffer: receiptBuf, filename: p.receipt.filename || "receipt", mime: p.receipt.mime });
    }

    const flags = await expenseFlags(expense, receipt ? 1 : 0);
    const origin = new URL(req.url).origin;
    return json(
      {
        id: expense.id,
        url: `${origin}/expenses/${expense.id}`,
        status: expense.status,
        summary: {
          date: expense.dateIncurred,
          supplier: expense.supplierName,
          category: cat.name,
          original: `${expense.originalCurrency} ${(expense.originalAmountCents / 100).toFixed(2)}`,
          audAmount: (expense.audAmountCents / 100).toFixed(2),
          fx: expense.fxRate ? { rate: expense.fxRate, source: expense.fxRateSource, rateDate: expense.fxRateDate } : expense.fxStatus,
          gstTreatment: expense.gstTreatment,
          gstAud: (expense.gstAmountCents / 100).toFixed(2),
          deductibleAud: (expense.deductibleAudCents / 100).toFixed(2),
          financialYear: expense.financialYear,
          isCapital: expense.isCapital,
          receiptAttached: !!receipt,
        },
        flags,
      },
      { status: 201 }
    );
  },
  { auth: false }
);
