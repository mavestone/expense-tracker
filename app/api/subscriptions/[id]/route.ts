import { api, json } from "@/lib/api";
import { updateSubscription, setSubscriptionActive, type SubscriptionInput } from "@/lib/subscriptions";

export const runtime = "nodejs";

export const PATCH = api(async (req, ctx) => {
  const { id } = await ctx.params;
  const body = (await req.json()) as { input?: SubscriptionInput; active?: boolean };
  if (typeof body.active === "boolean") {
    const subscription = await setSubscriptionActive(id, body.active);
    return json({ subscription });
  }
  if (!body.input) return json({ error: "Nothing to update" }, { status: 400 });
  const subscription = await updateSubscription(id, body.input);
  return json({ subscription });
});
