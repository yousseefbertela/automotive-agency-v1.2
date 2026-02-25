# Environment variables to provide

Fill in the values in **backend/.env** and **frontend/.env**. The files are already created with placeholders.

---

## Backend (backend/.env)

**Required for the web chat to work:**

| Variable | Example / description |
|----------|------------------------|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgresql://user:password@localhost:5432/mydb?schema=public` |
| `OPENAI_API_KEY` | Your OpenAI API key, e.g. `sk-...` |
| `OCR_SPACE_API_KEY` | Your OCR.space API key (for photo uploads) |
| `WEB_DEFAULT_TENANT_ID` | Run `cd backend && node scripts/seed-web-tenant.js` — it prints this (usually `web-tenant`) |
| `WEB_DEFAULT_USER_ID` | Same script prints this (a long ID) — paste it here |

**Optional (for full features):**

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (if using Telegram) |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook validation |
| `WEBHOOK_BASE_URL` | Your public URL for Telegram webhook |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Business API token |
| `META_WEBHOOK_VERIFY_TOKEN` | Meta webhook verify token |
| `META_APP_SECRET` | Meta app secret |
| `SCRAPER_BASE_URL` | Already set to a default; change if you have your own |
| `SCRAPER_API_COM_KEY` | ScraperAPI.com key for diagram images |
| `SHEETS_*` | Google Sheets IDs if you use Sheets |
| `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` | Odoo ERP credentials |

---

## Frontend (frontend/.env)

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | Backend URL. Use `http://localhost:4000` for local. No trailing slash. |

---

**After you provide the values**, paste them here (you can redact secrets partially, e.g. `sk-abc...xyz`) and I’ll put them into the .env files. Or edit **backend/.env** and **frontend/.env** directly in your editor.
