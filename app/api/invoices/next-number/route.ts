import { api, json } from "@/lib/api";
import { nextInvoiceNumber } from "@/lib/invoices";
import { ValidationError } from "@/lib/expenses";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) throw new ValidationError(["clientId is required."]);
  return json({ number: await nextInvoiceNumber(clientId) });
});
