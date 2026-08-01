import { api, json } from "@/lib/api";
import { missingReceipts } from "@/lib/reports";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const fy = new URL(req.url).searchParams.get("fy") || undefined;
  return json({ records: await missingReceipts(fy === "all" ? undefined : fy) });
});
