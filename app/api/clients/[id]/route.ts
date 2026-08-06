import { api, json } from "@/lib/api";
import { getClient, updateClient, setClientArchived, type ClientInput } from "@/lib/clients";
import { NotFoundError } from "@/lib/expenses";

export const runtime = "nodejs";

export const GET = api(async (_req, ctx) => {
  const { id } = await ctx.params;
  const client = await getClient(id);
  if (!client) throw new NotFoundError("Client not found");
  return json({ client });
});

export const PUT = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as ClientInput & { archived?: boolean };
  // Archiving is a one-field toggle and must not require a full valid payload.
  if (typeof body.archived === "boolean" && !body.name) {
    return json({ client: await setClientArchived(id, body.archived) });
  }
  return json({ client: await updateClient(id, body) });
});
