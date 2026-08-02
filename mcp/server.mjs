#!/usr/bin/env node
/**
 * Expense Tracker MCP server (stdio transport).
 *
 * Gives Claude Desktop / Claude Code direct tool access to your expense
 * tracker's agent API. No dependencies — plain JSON-RPC over stdin/stdout.
 *
 * Environment:
 *   EXPENSE_APP_URL      https://your-app.vercel.app   (no trailing slash)
 *   EXPENSE_APP_API_KEY  must match AGENT_API_KEY in the app
 *
 * Claude Desktop config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "expenses": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/expense-tracker/mcp/server.mjs"],
 *         "env": {
 *           "EXPENSE_APP_URL": "https://your-app.vercel.app",
 *           "EXPENSE_APP_API_KEY": "your-agent-api-key"
 *         }
 *       }
 *     }
 *   }
 */

import fs from "fs";
import path from "path";

const BASE = (process.env.EXPENSE_APP_URL || "").trim().replace(/\/+$/, "");
const KEY = (process.env.EXPENSE_APP_API_KEY || "").trim();

const MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".heic": "image/heic", ".pdf": "application/pdf",
};

async function callApi(pathname, { method = "GET", body } = {}) {
  if (!BASE || !KEY) throw new Error("EXPENSE_APP_URL and EXPENSE_APP_API_KEY must be set in the MCP server env.");
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 400) }; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof parsed === "object" ? JSON.stringify(parsed).slice(0, 400) : text.slice(0, 400)}`);
  return parsed;
}

/** Read a local file into { filename, mime, base64 } for attachment fields. */
function readAttachment(filePath) {
  const abs = path.resolve(filePath.replace(/^~/, process.env.HOME || "~"));
  const buf = fs.readFileSync(abs);
  if (buf.length > 6 * 1024 * 1024) throw new Error(`File is ${(buf.length / 1048576).toFixed(1)}MB — over the ~6MB limit. Compress it first.`);
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) throw new Error(`Unsupported file type "${path.extname(abs)}". Use jpg, png, webp, heic or pdf.`);
  return { filename: path.basename(abs), mime, base64: buf.toString("base64") };
}

const TOOLS = [
  {
    name: "get_meta",
    description:
      "Fetch the tracker's live reference data: expense categories (with which count as equipment), payment methods, per-financial-year instant asset write-off thresholds, receipt thresholds, and today's date in the business timezone. Call this once before creating records so category names are exact.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_records",
    description:
      "Search existing expense records — use this BEFORE creating anything to avoid duplicates (same supplier + date + amount), or to find a record id to attach a receipt to.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Supplier or description text" },
        date: { type: "string", description: "Exact date filter, YYYY-MM-DD" },
        status: { type: "string", description: "Comma list: active,draft,void (default all)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "add_expense",
    description:
      "Create an expense record. The app resolves the historical FX rate for dateIncurred (RBA, ECB fallback) and freezes it, applies GST defaults, derives the financial year, and writes an audit entry. Never convert currency yourself. Optionally attach the receipt in the same call via receiptPath.",
    inputSchema: {
      type: "object",
      properties: {
        dateIncurred: { type: "string", description: "Invoice/purchase date, YYYY-MM-DD — NOT today" },
        supplierName: { type: "string" },
        supplierAbn: { type: "string", description: "11 digits, Australian suppliers only" },
        description: { type: "string" },
        category: { type: "string", description: "Category NAME (case-insensitive) from get_meta" },
        amount: { type: "string", description: 'Decimal string, e.g. "129.99"' },
        currency: { type: "string", description: "ISO 4217, e.g. AUD, USD" },
        gstTreatment: { type: "string", enum: ["gst", "gst_free", "input_taxed"], description: "Omit to use the app default (AUD→gst, other→gst_free)" },
        businessUsePct: { type: "number", description: "0-100, default 100" },
        isCapital: { type: "boolean" },
        assetName: { type: "string" },
        effectiveLifeYears: { type: "string" },
        paymentMethod: { type: "string" },
        notes: { type: "string" },
        status: { type: "string", enum: ["active", "draft"], description: "draft = review in-app before it counts" },
        receiptPath: { type: "string", description: "Local path to the receipt PDF/image to attach" },
      },
      required: ["dateIncurred", "supplierName", "description", "category", "amount", "currency"],
      additionalProperties: false,
    },
  },
  {
    name: "add_income",
    description:
      "Record business income (invoiced client work or other income) in the separate income ledger. FX for dateEarned is resolved and frozen; GST on sales applies when the business is GST-registered. Omit datePaid while the invoice is still outstanding. Optionally attach the invoice via invoicePath.",
    inputSchema: {
      type: "object",
      properties: {
        dateEarned: { type: "string", description: "Invoice / earned date, YYYY-MM-DD" },
        datePaid: { type: "string", description: "Omit if unpaid" },
        clientName: { type: "string" },
        clientAbn: { type: "string" },
        invoiceRef: { type: "string" },
        description: { type: "string" },
        incomeType: { type: "string", enum: ["client_work", "licensing", "grant", "interest", "other"] },
        amount: { type: "string" },
        currency: { type: "string" },
        gstTreatment: { type: "string", enum: ["gst", "gst_free", "no_gst"] },
        paymentAccount: { type: "string" },
        notes: { type: "string" },
        invoicePath: { type: "string", description: "Local path to the invoice PDF/image to attach" },
      },
      required: ["dateEarned", "clientName", "description", "amount", "currency"],
      additionalProperties: false,
    },
  },
  {
    name: "attach_receipt",
    description: "Attach (or version-replace) a receipt on an existing EXPENSE record. Old versions are kept forever.",
    inputSchema: {
      type: "object",
      properties: { expenseId: { type: "string" }, filePath: { type: "string" } },
      required: ["expenseId", "filePath"],
      additionalProperties: false,
    },
  },
  {
    name: "attach_invoice",
    description: "Attach (or version-replace) an invoice document on an existing INCOME record.",
    inputSchema: {
      type: "object",
      properties: { incomeId: { type: "string" }, filePath: { type: "string" } },
      required: ["incomeId", "filePath"],
      additionalProperties: false,
    },
  },
  {
    name: "mark_income_paid",
    description: "Mark an income record paid (bank reconciliation), or clear the paid date by passing null.",
    inputSchema: {
      type: "object",
      properties: { incomeId: { type: "string" }, datePaid: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear" } },
      required: ["incomeId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_settings",
    description: "Read app settings, including whether the business is registered for GST.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

async function runTool(name, args = {}) {
  switch (name) {
    case "get_meta":
      return callApi("/api/agent/meta");

    case "get_settings":
      return callApi("/api/agent/settings");

    case "find_records": {
      const p = new URLSearchParams();
      if (args.query) p.set("q", args.query);
      if (args.date) p.set("date", args.date);
      if (args.status) p.set("status", args.status);
      return callApi(`/api/agent/expenses?${p}`);
    }

    case "add_expense": {
      const { receiptPath, ...rest } = args;
      const body = { ...rest };
      if (receiptPath) body.receipt = readAttachment(receiptPath);
      return callApi("/api/agent/expense", { method: "POST", body });
    }

    case "add_income": {
      const { invoicePath, ...rest } = args;
      const body = { ...rest };
      if (invoicePath) body.invoice = readAttachment(invoicePath);
      return callApi("/api/agent/income", { method: "POST", body });
    }

    case "attach_receipt":
      return callApi(`/api/agent/expense/${encodeURIComponent(args.expenseId)}/receipt`, {
        method: "POST",
        body: readAttachment(args.filePath),
      });

    case "attach_invoice":
      return callApi(`/api/agent/income/${encodeURIComponent(args.incomeId)}/invoice`, {
        method: "POST",
        body: readAttachment(args.filePath),
      });

    case "mark_income_paid":
      return callApi(`/api/agent/income/${encodeURIComponent(args.incomeId)}/paid`, {
        method: "POST",
        body: { datePaid: args.datePaid ?? null },
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC over stdio ────────────────────────────────────────────────────
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    switch (method) {
      case "initialize":
        return reply({
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "expense-tracker", version: "1.0.0" },
        });
      case "notifications/initialized":
        return; // notification, no response
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        const out = await runTool(params?.name, params?.arguments || {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      }
      default:
        if (id === undefined) return; // unknown notification
        return fail(-32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (id === undefined) return;
    // Report tool failures as content so Claude can read and react to them.
    if (method === "tools/call") {
      return reply({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
    }
    return fail(-32603, e.message);
  }
}

let buf = "";
let inFlight = 0;
let stdinClosed = false;
const maybeExit = () => {
  if (stdinClosed && inFlight === 0) process.exit(0);
};

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    // Track in-flight work so a closing stdin never kills a pending API call.
    inFlight++;
    handle(msg).finally(() => {
      inFlight--;
      maybeExit();
    });
  }
});
process.stdin.on("end", () => {
  stdinClosed = true;
  maybeExit();
});
