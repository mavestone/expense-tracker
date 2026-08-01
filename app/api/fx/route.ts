import { api, json } from "@/lib/api";
import { getRateForDate } from "@/lib/fx";
import { isValidIsoDate } from "@/lib/fy";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || "";
  const currency = (url.searchParams.get("currency") || "").toUpperCase();
  if (!isValidIsoDate(date)) return json({ error: "Invalid date" }, { status: 400 });
  if (!/^[A-Z]{3}$/.test(currency)) return json({ error: "Invalid currency" }, { status: 400 });
  const rate = await getRateForDate(date, currency); // FxUnavailableError -> 422 via api()
  return json(rate);
});
