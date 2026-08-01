# Expense Tracker

A single-user expense tracking web app for an Australian media production business.
Built for **ATO-compliant record keeping**: GST/BAS tracking, capital asset separation,
foreign-currency handling with frozen historical rates, immutable receipts, a full audit
trail, and accountant-ready exports. **Record-keeping and reporting only** — no invoicing,
income tracking or BAS lodgement.

## What it does

- **Expenses** — date incurred, supplier (+ optional ABN with checksum check), description,
  category, original amount + ISO 4217 currency, FX rate/source/date (frozen on the record),
  AUD amount (overridable with a logged reason), GST treatment + amount, business use %,
  deductible amount, payment method, receipt, notes, auto-derived financial year (1 Jul – 30 Jun).
- **GST** — three treatments: *GST included (claimable)*, *GST-free / no GST*, *input taxed*.
  Defaults: 1/11 of the GST-inclusive total for AUD purchases; foreign currency defaults to
  no GST (overridable — some overseas vendors charge Australian GST on digital services).
  Records claiming GST over $82.50 with no receipt are flagged and **excluded from the 1B
  total** until a tax invoice is attached (shown separately, nothing hidden).
- **BAS summary** — per quarter (Jul–Sep, Oct–Dec, Jan–Mar, Apr–Jun): **G10** capital
  purchases, **G11** non-capital purchases, **1B** GST credits, with a by-treatment
  breakdown and a stated methodology for your accountant.
- **Capital assets** — flagged manually or auto-suggested when an equipment-category purchase
  meets the **instant asset write-off threshold for that FY** (set per-year in Settings —
  never hardcoded; confirm the figure with your accountant). The depreciation schedule lists
  asset, date, AUD cost, business use % and your manually entered effective life.
  **No depreciation is calculated** — that's the accountant's job, by design.
- **FX** — rate fetched for the **date incurred**: RBA daily rates first (the ATO's canonical
  source), ECB reference rates (via Frankfurter) as fallback. Weekends/holidays use the most
  recent published rate, with the actual rate date recorded. The rate, source and date are
  **frozen on the record** — reopening an entry never silently changes it. Manual override
  requires a note. If no rate is available (rare currency, offline), the record saves with
  **FX pending** and is flagged until resolved.
- **Subscriptions** — register recurring vendors (monthly/annual). Each renewal generates a
  **draft** expense you confirm or edit — nothing posts silently. Shows estimated annual AUD
  spend and flags subscriptions with no confirmed payment in 60+ days (catch the ones you
  forgot to cancel).
- **Record integrity** — no hard deletes anywhere. Voiding keeps the record visible in the
  audit view with a reason. Every edit is logged field-by-field with old/new values and
  timestamps. Receipt files are immutable and content-addressed (SHA-256); replacing one
  creates a new version and keeps the old forever.
- **Inputs** — fast mobile entry form (date defaults to today, last supplier/category/payment
  remembered), camera receipt capture with client-side compression, optional on-device OCR
  (suggestions only, never auto-saved), and a bulk CSV import wizard with column mapping and
  per-date historical FX for backfilling a past year from statements.
- **Exports** — accountant CSV (one row per expense, every field, AUD as plain decimals,
  DD/MM/YYYY dates, UTF-8 BOM — imports cleanly into Excel/Xero/MYOB workflows), and a
  one-click **full backup zip**: `data.json` (every table), `manifest.json` (hashes/counts)
  and every receipt file version. Plain formats readable without this app — that's the
  7-year retention story.

## Tech

- **Next.js 15** (App Router, TypeScript) — deploys to Vercel or runs anywhere Node 20+ runs
- **SQLite via libSQL + Drizzle ORM** — a plain local file for dev/self-hosting; **Turso**
  (hosted libSQL) in production on Vercel. Same engine everywhere.
- **Receipt storage** — local disk (`DATA_DIR/receipts`) or **Vercel Blob** in production.
  Files are only ever served through authenticated routes.
- **Money** — integer cents everywhere; FX applied with BigInt arithmetic; half-up rounding.
- **Auth** — single user, password + encrypted session cookie, login rate limiting.

## Run locally

```bash
npm install
cp .env.example .env        # set APP_PASSWORD (and SESSION_SECRET)
npm run dev                 # http://localhost:3000
```

The database and receipt files live under `./data/` (created automatically).
Optional: `npm run sample-data` loads demo data into an **empty** database so you can
explore; delete `./data` to start fresh.

```bash
npm test                    # 48 unit + integration tests (GST, FX, FY, audit, reports…)
npm run build && npm start  # production mode
npm run hash-password       # generate APP_PASSWORD_HASH (preferred over plain password)
```

## Run with Docker (self-hosting)

```bash
docker build -t expense-tracker .
docker run -d --name expenses \
  -p 3000:3000 \
  -v /srv/expenses-data:/app/data \
  -e APP_PASSWORD_HASH='scrypt$…' \
  -e SESSION_SECRET='<openssl rand -hex 32>' \
  -e APP_TIMEZONE='Australia/Sydney' \
  expense-tracker
```

Everything that matters lives in the mounted `/app/data` volume (SQLite DB + receipts).
Back that directory up, and/or use the in-app backup zip.

## Deploy to Vercel (with your domain)

See **[docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md)** for the full step-by-step
(Turso database, Vercel Blob storage, environment variables, custom domain, daily cron).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | `file:./data/app.db` locally, `libsql://…turso.io` on Vercel |
| `DATABASE_AUTH_TOKEN` | Turso auth token (hosted DB only) |
| `STORAGE_DRIVER` | `local` (default) or `vercel-blob` |
| `DATA_DIR` | Local data directory (default `./data`) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token (auto-set by Vercel when connected) |
| `APP_PASSWORD_HASH` | Preferred: output of `npm run hash-password` |
| `APP_PASSWORD` | Fallback plain password (fine for local installs) |
| `SESSION_SECRET` | 32+ random chars — required in production |
| `APP_TIMEZONE` | For "today" in renewals/staleness (default `Australia/Sydney`) |
| `CRON_SECRET` | Protects `/api/cron/renewals` when using Vercel Cron |
| `AGENT_API_KEY` | Optional: enables the `/api/agent/*` ingestion API for AI assistants |

## Agent ingestion API (optional)

Set `AGENT_API_KEY` (16+ random chars) to enable two bearer-authenticated endpoints
so an AI assistant (e.g. a Hyperagent skill) can post analysed invoices for you:

- `GET /api/agent/meta` — categories, payment methods, thresholds (for mapping)
- `POST /api/agent/expense` — create a fully derived expense (FX resolved for the
  incurred date, GST defaults applied) with an optional base64 receipt attached in
  the same call. Accepts `status: "draft"` if you want in-app review before it counts.

Records created this way are marked **source: agent** with an audit note, and follow
every integrity rule manual entries do. The API never deletes or edits anything.

## Data & compliance notes (for you and your accountant)

- Amounts are stored as **integer cents**; the CSV/backup exports render plain decimals.
- FY label `2025-26` = 1 July 2025 – 30 June 2026. BAS quarters: Q1 Jul–Sep … Q4 Apr–Jun.
- GST claimable portion (1B) = GST × business-use %. G10/G11 show the GST-inclusive
  business-use portion of capital/non-capital purchases across **all** treatments (matching
  the ATO calculation worksheet flow), with a by-treatment breakdown so your accountant can
  adjust (e.g. G14 for purchases without GST).
- Voided records are excluded from every report and the default CSV, but remain in the
  audit view, in `data.json` backups, and can be included in CSV with `includeVoid=1`.
- Nothing in the schema or code deletes expense rows, audit rows or receipt files.
- The app never contacts anything except the RBA and Frankfurter (ECB) rate endpoints.

## What this deliberately doesn't do

Invoicing, income tracking, BAS lodgement, depreciation calculation, ATO filings,
multi-user access, or bank-account linking. It keeps records and produces reports.
