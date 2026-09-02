import { api, json } from "@/lib/api";
import { listTransactions, reviewProgress, transactionMonths, type TxnStatus } from "@/lib/statements";

export const runtime = "nodejs";

export const GET = api(async (req) => {
  const p = new URL(req.url).searchParams;
  const statusParam = p.get("status");
  const { transactions, totals, hasMore } = await listTransactions({
    fy: p.get("fy") || undefined,
    month: p.get("month") || undefined,
    accountId: p.get("accountId") || undefined,
    status: statusParam ? (statusParam.split(",") as TxnStatus[]) : undefined,
    direction: (p.get("direction") as "in" | "out") || undefined,
    q: p.get("q") || undefined,
    minCents: p.get("min") ? Number(p.get("min")) : undefined,
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    offset: p.get("offset") ? Number(p.get("offset")) : undefined,
  });
  return json({
    transactions,
    totals,
    hasMore,
    months: await transactionMonths(p.get("fy") || undefined, p.get("accountId") || undefined),
    progress: await reviewProgress({
      fy: p.get("fy") || undefined,
      month: p.get("month") || undefined,
      accountId: p.get("accountId") || undefined,
    }),
  });
});
