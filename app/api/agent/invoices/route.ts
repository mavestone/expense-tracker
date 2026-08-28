import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { createInvoice, listInvoices, markInvoiceSent, deleteDraftInvoice, INVOICE_KINDS, type InvoiceKind, type InvoiceStatus } from "@/lib/invoices";
import { parseMoneyToCents } from "@/lib/money";
import { ValidationError } from "@/lib/expenses";

export const runtime = "nodejs";

type LinePayload = { description: string; quantity?: number; amount?: string; amountCents?: number; expenseId?: string };

function guard(req: Request): Response | null {
  if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
  if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
  return null;
}

export const GET = api(
  async (req) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    const p = new URL(req.url).searchParams;
    const status = p.get("status")?.split(",").filter(Boolean) as InvoiceStatus[] | undefined;
    const { invoices, byCurrency } = await listInvoices({
      status: status?.length ? status : undefined,
      clientId: p.get("clientId") || undefined,
      fy: p.get("fy") || undefined,
      kind: (INVOICE_KINDS as readonly string[]).includes(p.get("kind") ?? "")
        ? (p.get("kind") as InvoiceKind)
        : undefined,
    });
    const origin = new URL(req.url).origin;
    return json({
      count: invoices.length,
      byCurrency: byCurrency.map((c) => ({
        currency: c.currency,
        total: (c.totalCents / 100).toFixed(2),
        outstanding: (c.outstandingCents / 100).toFixed(2),
      })),
      invoices: invoices.map((i) => ({
        id: i.id,
        url: `${origin}/invoices/${i.id}`,
        number: i.number,
        kind: i.kind,
        client: i.clientName,
        status: i.status,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        currency: i.currency,
        total: (i.totalCents / 100).toFixed(2),
        inLedger: Boolean(i.incomeId),
      })),
    });
  },
  { auth: false }
);

/**
 * Raise an invoice. Creates a draft by default — `send: true` also posts it to
 * the income ledger, which is the point it becomes a tax record.
 */
export const POST = api(
  async (req) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    const b = (await req.json()) as {
      clientId: string;
      issueDate: string;
      kind?: InvoiceKind;
      number?: string;
      dueDate?: string;
      currency?: string;
      gstTreatment?: "gst" | "gst_free";
      purchaseOrder?: string;
      terms?: string;
      notes?: string;
      lines: LinePayload[];
      send?: boolean;
    };
    if (!Array.isArray(b.lines) || b.lines.length === 0) throw new ValidationError(["At least one line is required."]);

    const lines = b.lines.map((l, i) => {
      const cents = l.amountCents ?? (l.amount != null ? parseMoneyToCents(l.amount) : null);
      if (cents == null) throw new ValidationError([`Line ${i + 1}: amount could not be read.`]);
      return {
        description: l.description ?? "",
        quantityMilli: Math.round((l.quantity ?? 1) * 1000),
        unitAmountCents: cents,
        expenseId: l.expenseId ?? null,
      };
    });

    let invoice = await createInvoice({
      clientId: b.clientId,
      number: b.number ?? null,
      kind: b.kind ?? "services",
      issueDate: b.issueDate,
      dueDate: b.dueDate ?? null,
      currency: b.currency ?? "AUD",
      gstTreatment: b.gstTreatment ?? "gst_free",
      purchaseOrder: b.purchaseOrder ?? null,
      terms: b.terms ?? null,
      notes: b.notes ?? null,
      lines,
    });
    if (b.send) invoice = await markInvoiceSent(invoice.id);

    const origin = new URL(req.url).origin;
    return json(
      {
        id: invoice.id,
        url: `${origin}/invoices/${invoice.id}`,
        printUrl: `${origin}/invoices/${invoice.id}/print`,
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
        subtotal: (invoice.subtotalCents / 100).toFixed(2),
        gst: (invoice.gstCents / 100).toFixed(2),
        total: (invoice.totalCents / 100).toFixed(2),
        incomeId: invoice.incomeId,
      },
      { status: 201 }
    );
  },
  { auth: false }
);

/** Discard a draft that was never issued. */
export const DELETE = api(
  async (req) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new ValidationError(["id is required."]);
    return json(await deleteDraftInvoice(id));
  },
  { auth: false }
);
