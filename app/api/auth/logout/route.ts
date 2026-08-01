import { api, json } from "@/lib/api";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export const POST = api(
  async () => {
    const session = await getSession();
    session.destroy();
    return json({ ok: true });
  },
  { auth: false }
);
