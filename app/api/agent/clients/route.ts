import { api, json } from "@/lib/api";
import { checkAgentAuth, agentApiEnabled } from "@/lib/agent-auth";
import { listClients, createClient, type ClientInput } from "@/lib/clients";
import { ValidationError } from "@/lib/expenses";

export const runtime = "nodejs";

function guard(req: Request): Response | null {
  if (!agentApiEnabled()) return json({ error: "Agent API not configured." }, { status: 503 });
  if (!checkAgentAuth(req)) return json({ error: "Invalid agent API key." }, { status: 401 });
  return null;
}

export const GET = api(
  async (req) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    const clients = await listClients({ includeArchived: new URL(req.url).searchParams.get("archived") === "1" });
    return json({
      count: clients.length,
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        invoicePrefix: c.invoicePrefix,
        defaultCurrency: c.defaultCurrency,
        defaultGstTreatment: c.defaultGstTreatment,
        paymentTermsDays: c.paymentTermsDays,
        country: c.country,
        invoiceCount: c.invoiceCount,
        archived: c.archived,
      })),
    });
  },
  { auth: false }
);

export const POST = api(
  async (req) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    const b = (await req.json()) as Partial<ClientInput>;
    if (b.defaultGstTreatment && b.defaultGstTreatment !== "gst" && b.defaultGstTreatment !== "gst_free")
      throw new ValidationError(["defaultGstTreatment must be 'gst' or 'gst_free'."]);
    const client = await createClient({
      name: b.name ?? "",
      contactName: b.contactName ?? null,
      email: b.email ?? null,
      addressLines: b.addressLines ?? null,
      country: b.country ?? null,
      abn: b.abn ?? null,
      taxLabel: b.taxLabel ?? null,
      taxId: b.taxId ?? null,
      invoicePrefix: b.invoicePrefix ?? "",
      defaultCurrency: b.defaultCurrency ?? "AUD",
      defaultGstTreatment: b.defaultGstTreatment ?? "gst_free",
      paymentTermsDays: b.paymentTermsDays ?? 14,
      notes: b.notes ?? null,
    });
    return json({ id: client.id, name: client.name, invoicePrefix: client.invoicePrefix }, { status: 201 });
  },
  { auth: false }
);
