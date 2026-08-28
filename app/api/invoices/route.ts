import { api, json } from "@/lib/api";
import { listInvoices, createInvoice, INVOICE_KINDS, type InvoiceInput, type InvoiceKind, type InvoiceStatus } from "@/lib/invoices";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const p = new URL(req.url).searchParams;
  const status = p.get("status")?.split(",").filter(Boolean) as InvoiceStatus[] | undefined;
  return json(
    await listInvoices({
      status: status?.length ? status : undefined,
      clientId: p.get("clientId") || undefined,
      fy: p.get("fy") || undefined,
      kind: (INVOICE_KINDS as readonly string[]).includes(p.get("kind") ?? "")
        ? (p.get("kind") as InvoiceKind)
        : undefined,
    })
  );
});

export const POST = api(async (req) => {
  const body = (await req.json()) as InvoiceInput;
  return json({ invoice: await createInvoice(body) }, { status: 201 });
});
