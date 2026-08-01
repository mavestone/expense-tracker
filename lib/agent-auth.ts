import { timingSafeEqual } from "crypto";

/**
 * Auth for the agent ingestion API (/api/agent/*): a single bearer key set
 * via AGENT_API_KEY. The feature is disabled entirely when the env var is
 * absent. Session auth is not used here — this surface is for automation
 * (e.g. a Hyperagent skill posting analysed invoices).
 */
export function agentApiEnabled(): boolean {
  const key = process.env.AGENT_API_KEY;
  return !!key && key.length >= 16;
}

export function checkAgentAuth(req: Request): boolean {
  if (!agentApiEnabled()) return false;
  const key = process.env.AGENT_API_KEY!;
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
