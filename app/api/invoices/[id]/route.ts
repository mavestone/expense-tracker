import { api, json } from "@/lib/api";
import { getInvoice, updateInvoice, markInvoiceSent, markInvoicePaid, voidInvoice, deleteDraftInvoice, type InvoiceInput } from "@/lib/invoices";
import { NotFoundError, ValidationError } from "@/lib/expenses";

export const runtime = "nodejs";

export const GET = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const invoice = await getInvoice(id);
  if (!invoice) throw new NotFoundError("Invoice not found");
  return json({ invoice });
});

export const PUT = api(async (req, ctx) => {
  const { id } = await ctx.params;
  return json({ invoice: await updateInvoice(id, (await req.json()) as InvoiceInput) });
});

/** State changes: send (posts to income), mark paid, void. */
export const POST = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { action: string; datePaid?: string; reason?: string; postToIncome?: boolean };
  switch (body.action) {
    case "send":
      return json({ invoice: await markInvoiceSent(id, { postToIncome: body.postToIncome }) });
    case "paid":
      return json({ invoice: await markInvoicePaid(id, body.datePaid ?? "") });
    case "void":
      return json({ invoice: await voidInvoice(id, body.reason ?? "") });
    default:
      throw new ValidationError([`Unknown action '${body.action}'.`]);
  }
});

/** Drafts only — an issued invoice is voided, never removed. */
export const DELETE = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  return json(await deleteDraftInvoice(id));
});
