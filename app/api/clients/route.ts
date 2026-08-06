import { api, json } from "@/lib/api";
import { listClients, createClient, type ClientInput } from "@/lib/clients";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  return json({ clients: await listClients({ includeArchived }) });
});

export const POST = api(async (req) => {
  const body = (await req.json()) as ClientInput;
  return json({ client: await createClient(body) }, { status: 201 });
});
