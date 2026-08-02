# Connecting the tracker to Claude

Your app exposes a small, authenticated agent API. This repo ships an **MCP
server** that turns that API into tools Claude can call directly — so you can
drop an invoice into a Claude chat and have it read, categorised and filed,
exactly as before.

Pick the path that matches how you use Claude.

---

## Option A — Claude Desktop (recommended)

Best for the "drag an invoice in and say *log this*" workflow.

### 1. Get the code on your machine

```bash
git clone https://github.com/mavestone/expense-tracker.git
cd expense-tracker
node --version   # needs Node 20 or newer
```

No `npm install` is required — the MCP server has **zero dependencies**.

### 2. Add it to Claude Desktop

Open **Claude Desktop → Settings → Developer → Edit Config**. That opens
`claude_desktop_config.json`. Add:

```json
{
  "mcpServers": {
    "expenses": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/expense-tracker/mcp/server.mjs"],
      "env": {
        "EXPENSE_APP_URL": "https://expense-tracker-mavestones-projects.vercel.app",
        "EXPENSE_APP_API_KEY": "your-AGENT_API_KEY-from-Vercel"
      }
    }
  }
}
```

Use the **absolute** path (`/Users/you/code/expense-tracker/mcp/server.mjs`), and
the same `AGENT_API_KEY` value you set in Vercel.

### 3. Restart Claude Desktop

You should see a tools icon in the chat box listing eight expense tools. If not,
check **Settings → Developer** for the server's error output.

### 4. Give Claude the brief

Create a **Project** called *Bookkeeping*, and paste
[`docs/EXPENSE-CLERK.md`](./EXPENSE-CLERK.md) into its custom instructions. That
carries the GST rules, the FX policy, the bank-statement gotchas and the list of
open items.

Then just work as before: drop in a PDF and say *"log this"*.

---

## Option B — Claude Code (terminal)

```bash
cd expense-tracker
claude mcp add expenses \
  --env EXPENSE_APP_URL=https://expense-tracker-mavestones-projects.vercel.app \
  --env EXPENSE_APP_API_KEY=your-agent-api-key \
  -- node ./mcp/server.mjs
```

Copy `docs/EXPENSE-CLERK.md` to `CLAUDE.md` in the repo root and Claude Code
picks it up automatically:

```bash
cp docs/EXPENSE-CLERK.md CLAUDE.md
```

---

## Option C — claude.ai in the browser (no tools)

If you are on the web or mobile without a connector, Claude cannot call your API
directly — but it can still do the hard part (reading and classifying the
invoice) and hand you something to paste.

Create a Project with `docs/EXPENSE-CLERK.md` as the instructions, plus this line:

> You have no direct API access in this conversation. For each document, output
> a filled JSON payload for `POST /api/agent/expense` or `/api/agent/income`,
> and I will run it.

Then post the payload yourself:

```bash
curl -X POST https://YOUR-APP.vercel.app/api/agent/expense \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "content-type: application/json" \
  -d @payload.json
```

Or simply type the values into the app's own form — it does the FX and GST
maths regardless of how the record is created.

---

## The tools Claude gets

| Tool | What it does |
|---|---|
| `get_meta` | Live categories, payment methods, thresholds, today's date and FY |
| `find_records` | Search existing records — dedupe before posting |
| `add_expense` | Create an expense, optionally attaching the receipt in one call |
| `add_income` | Record invoiced work or other income, optionally with the invoice |
| `attach_receipt` | Attach/version a receipt on an existing expense |
| `attach_invoice` | Attach/version an invoice on an existing income record |
| `mark_income_paid` | Reconcile an invoice against a bank payment |
| `get_settings` | Read settings, including GST registration |

Attachments take a **local file path** — Claude reads the file and uploads it.
Max ~6 MB; jpg, png, webp, heic, pdf.

---

## Testing the connection

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_meta","arguments":{}}}' \
 | EXPENSE_APP_URL="https://YOUR-APP.vercel.app" \
   EXPENSE_APP_API_KEY="your-key" \
   node mcp/server.mjs
```

You should see your category list come back as JSON.

### If something is wrong

| Symptom | Cause |
|---|---|
| `HTTP 401` | `EXPENSE_APP_API_KEY` does not match `AGENT_API_KEY` in Vercel |
| `HTTP 503` | `AGENT_API_KEY` is not set in Vercel (add it, then redeploy) |
| HTML instead of JSON | Vercel Deployment Protection is on — disable Vercel Authentication |
| Tools missing in Claude | Path in the config is not absolute, or Claude was not restarted |
| `Unsupported file type` | Convert to jpg/png/webp/heic/pdf first |

---

## A note on cost

The tracker itself costs nothing to run: Vercel Hobby, Turso free tier and
Vercel Blob free tier comfortably cover a single-user business. The only spend
is whatever AI you point at it — and the app works perfectly well without any AI
at all. Every record can be created by hand in the UI, and the FX, GST, BAS and
depreciation logic runs exactly the same.
