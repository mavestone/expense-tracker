import { api, json } from "@/lib/api";
import { createSubscription, ensureRenewalDrafts, subscriptionOverview, type SubscriptionInput } from "@/lib/subscriptions";

export const runtime = "nodejs";

export const GET = api(async () => {
  // Lazy renewal generation: any visit to the subscriptions view catches up
  // on due renewals (Vercel Cron does the same daily when deployed).
  const { generated } = await ensureRenewalDrafts();
  const overview = await subscriptionOverview();
  return json({ ...overview, draftsGenerated: generated });
});

export const POST = api(async (req) => {
  const body = (await req.json()) as { input: SubscriptionInput };
  const subscription = await createSubscription(body.input);
  return json({ subscription }, { status: 201 });
});
