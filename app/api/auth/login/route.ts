import { api, json } from "@/lib/api";
import { getSession, verifyPassword, loginRateLimited, recordLoginAttempt } from "@/lib/auth";

export const runtime = "nodejs";

export const POST = api(
  async (req) => {
    if (await loginRateLimited()) {
      return json({ error: "Too many failed attempts. Try again in 15 minutes." }, { status: 429 });
    }
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    const ok = typeof body.password === "string" && verifyPassword(body.password);
    await recordLoginAttempt(ok);
    if (!ok) return json({ error: "Incorrect password." }, { status: 401 });
    const session = await getSession();
    session.authed = true;
    await session.save();
    return json({ ok: true });
  },
  { auth: false }
);
