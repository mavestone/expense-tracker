# Deploying to Vercel with your own domain

The app runs fully on Vercel's free/hobby tier for single-user use:
**Vercel** (hosting) + **Turso** (SQLite-compatible database) + **Vercel Blob** (receipt files).

> ⚠️ These are financial records. Two non-negotiables before you rely on it:
> set a strong password + `SESSION_SECRET`, and download a backup zip regularly
> (Settings → Backups). The backup is your independence from every provider.

## 1. Push the code to a Git repository

Create a private GitHub repo and push this folder (`.gitignore` already excludes
`data/`, `.env`, `node_modules/`).

```bash
git init && git add -A && git commit -m "Expense tracker"
git remote add origin git@github.com:you/expense-tracker.git
git push -u origin main
```

## 2. Create the Turso database

Either via the [Vercel Marketplace → Turso](https://vercel.com/marketplace/tursocloud)
(connects env vars automatically), or manually:

```bash
# https://docs.turso.tech — install the CLI, then:
turso db create expenses --location syd     # Sydney region
turso db show expenses --url                # → libsql://expenses-<you>.turso.io
turso db tokens create expenses             # → auth token
```

Run the schema migration once from your machine:

```bash
DATABASE_URL="libsql://expenses-<you>.turso.io" \
DATABASE_AUTH_TOKEN="<token>" \
npm run db:migrate
```

(The app also migrates automatically on first start, but doing it explicitly is cleaner.)

## 3. Import the project into Vercel

1. **Add New → Project** → import your repo. Framework auto-detects as Next.js.
2. Before deploying, add **Environment Variables** (Production):

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | `libsql://expenses-<you>.turso.io` |
   | `DATABASE_AUTH_TOKEN` | your Turso token |
   | `STORAGE_DRIVER` | `vercel-blob` |
   | `APP_PASSWORD_HASH` | output of `npm run hash-password` |
   | `SESSION_SECRET` | `openssl rand -hex 32` |
   | `APP_TIMEZONE` | `Australia/Sydney` |
   | `CRON_SECRET` | `openssl rand -hex 16` |
   | `AGENT_API_KEY` | optional — `openssl rand -hex 24`; enables AI-assistant invoice ingestion (`/api/agent/*`) |

3. Deploy.

## 4. Attach Blob storage (receipts)

Project → **Storage** → **Create → Blob** → connect it to the project.
Vercel injects `BLOB_READ_WRITE_TOKEN` automatically. Redeploy after connecting.

Receipt files are stored content-addressed under `receipts/` in the Blob store and are
only ever served through the app's authenticated `/api/receipts/...` routes.

## 5. Your custom domain

Project → **Settings → Domains** → add e.g. `expenses.yourdomain.com`, then create the
CNAME record it shows you at your DNS provider (or transfer nameservers to Vercel).
HTTPS is automatic. If your DNS is elsewhere, the record is:

```
expenses  CNAME  cname.vercel-dns.com
```

## 6. Daily renewal cron

`vercel.json` already schedules `GET /api/cron/renewals` daily (06:30 Sydney time,
20:30 UTC). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically — no
further setup beyond having set `CRON_SECRET`. (Even without the cron, drafts are
generated whenever you open the app — the cron just keeps things current on days
you don't.)

## 7. First login checklist

1. Open your domain, log in with your password.
2. **Settings** → set your business name, and enter the **instant asset write-off
   threshold** for the current FY *after confirming it with your accountant*.
3. Add your subscriptions so renewals start generating drafts.
4. Download a backup zip and store it somewhere safe. Repeat quarterly (or monthly).

## Limits worth knowing (hobby tier)

- **Upload size**: receipt uploads pass through a serverless function (4.5 MB body limit).
  The app compresses photos client-side (~1–2 MB typical), so phone receipts are fine.
  For a huge multi-page scanned PDF, split or compress it first.
- **Backup duration**: the backup endpoint streams the zip (up to 300 s). With years of
  receipts, prefer the per-FY backup buttons, or run the full backup from a local/Docker
  instance pointed at the same Turso DB.
- **Turso free tier**: ~9 GB storage — decades of expense rows; receipts live in Blob,
  not the DB.

## Moving off Vercel later

Nothing is locked in: run the Docker image anywhere, set `DATABASE_URL=file:./data/app.db`
and `STORAGE_DRIVER=local`, and restore from a backup zip (`data.json` + `receipts/`).
The backup format is plain JSON + original files precisely so a future you (or accountant)
can read records without any of these services existing.
