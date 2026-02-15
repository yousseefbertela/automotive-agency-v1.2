# Automotive Telegram Agent (Workflow 1)

A Node.js backend that replicates the n8n Telegram automotive assistant. The bot receives text and photo messages on Telegram, classifies them with OpenAI, and runs VIN lookup, part search, kit handling, or quotation finalization.

---

## How workflow 1 works

1. **Telegram sends an update** to your server at `POST /webhook/telegram` (you register this URL with Telegram).
2. **Express** receives the request and forwards the body to `handleUpdate()`.
3. **handleUpdate** (orchestration):
   - Reads **session state** from Firestore (or creates it if the user is registered in `users` + has an active **tenant**).
   - If the message is a **photo**: downloads it from Telegram → sends it to **OCR.space** → uses the extracted text as the user message.
   - Sends the user message to **OpenAI** (AI Agent). The agent returns **JSON**: scenario (`vin` / `part` / `kit` / `finalize` / `unrecognized`), optional VIN, part names, and a short human reply.
   - Parses that JSON (handles code fences and extra text), then **routes** by scenario.
4. **Per scenario:**
   - **vin**: Normalizes VIN → calls **Scraper API** for car details → creates/updates car and quotation in **Odoo** → saves quote and session in **Firestore** → replies on Telegram with vehicle summary.
   - **part**: Checks **Google Sheets** (Hot Items, Alias Map) → uses OpenAI to categorize part → calls Scraper (query-group / find-part) → scores results (Levenshtein, token set) → optional OpenAI tie-breaker → finds product in Odoo → adds to **basket** in Firestore → replies with chosen part (and optional diagram image via ScraperAPI.com).
   - **kit**: Loads **Kits** from Sheets → OpenAI matches user text to a kit → each kit part is run through the part flow → replies on Telegram.
   - **finalize**: Loads open quote and basket from Firestore → builds a summary (parts, prices) → sends it on Telegram.
   - **unrecognized**: The AI already sent a clarification in `human_text`; the bot just sends that to Telegram.
5. All **replies** go back to the user via the **Telegram** client (sendMessage, sendPhoto, etc.).

So: **Telegram → Express → handleUpdate → state + OCR + AI → router → domain flows (scraper, sheets, Odoo, Firestore) → Telegram.**

---

## Role of every file

| File | Role |
|------|------|
| **server.js** | Entry point. Loads `.env`, starts Express on `PORT`, logs which env vars are set/missing, handles SIGTERM/SIGINT and unhandled errors. |
| **app.js** | Creates Express app: JSON/urlencoded middleware, request logging, mounts `/webhook` routes, `/health`, 404, and global error handler. |
| **routes/telegram.js** | `POST /webhook/telegram`: checks optional `TELEGRAM_WEBHOOK_SECRET` header, returns 200 immediately, then runs `handleUpdate(req.body)` in the background. `GET /webhook/telegram`: simple OK for health. |
| **orchestration/handleUpdate.js** | Main flow: get state (or block if not registered), get text (from message or OCR), call AI agent, parse JSON, send human_text, then for each item call the router and the right domain flow. |
| **orchestration/router.js** | Maps AI `scenario` string to flow name; normalizes VIN (17→7 chars, O/I/Q rules, cleanup). |
| **ai/agent.js** | Calls OpenAI with prompts from `prompts.js`: classify message, categorize part, evaluate scraper results, match kit. Returns raw text; parsing is in parseFirstJson. |
| **ai/prompts.js** | All system prompts (from n8n): main agent, part categorization, evaluate results, kit matching. |
| **ai/parseFirstJson.js** | Strips code fences, finds first JSON object/array in a string, parses it, normalizes to items with scenario/vin/part_name/human_text. |
| **ocr/ocrspace.client.js** | Sends image buffer to ocr.space API; returns extracted text. |
| **integrations/telegram.client.js** | Telegram Bot API: sendMessage, sendPhoto, sendPhotoBuffer, downloadFile, setWebhook. |
| **integrations/scraper.client.js** | HTTP client for Cloud Run scraper: getCarDetails(vin), queryGroup(vin, group), findPart(vin, part), downloadDiagramImage (optionally via ScraperAPI.com). |
| **integrations/odoo.client.js** | Odoo JSON-RPC: search/create car, search/create contact, create quotation, search product. Used by VIN and part flows. |
| **integrations/sheets.client.js** | Google Sheets API: Hot Items lookup, Alias Map lookup, Kits list. Uses same service account as Firestore. |
| **integrations/firestore.client.js** | Firestore: sessions (get/upsert), users (query by chatID), tenants (get), quotes (create, query open), basket (add, get, delete, set), catalogResults, messages. |
| **db/state.repo.js** | Loads or creates session: if no session, checks `users` by chatID and `tenants` by tenantID; if user missing or tenant not active, returns blocked; otherwise creates initial session in Firestore. |
| **db/quotes.repo.js** | Wraps firestore: get latest open quote, check quote for VIN, create quote, add to basket (with dedupe), get basket items. |
| **domain/vin.flow.js** | VIN scenario: normalize VIN, scraper get-car-details, Odoo car + quotation, save quote and session, reply with vehicle summary. |
| **domain/part.flow.js** | Part scenario: hot items, alias map, AI categorization, scraper query-group/find-part, scoring, optional AI tie-breaker, Odoo product search, add to basket, reply (with optional diagram). |
| **domain/kit.flow.js** | Kit scenario: load kits from Sheets, AI match, then run each matched part through part flow and reply. |
| **domain/finalize.flow.js** | Finalize scenario: get open quote and basket, build summary text, send to Telegram. |
| **utils/logger.js** | Structured JSON logger (debug/info/warn/error) with optional correlationId. |
| **utils/retry.js** | Wraps async calls with exponential backoff and timeout. |
| **utils/errors.js** | Custom error classes (AppError, ExternalServiceError, etc.) for consistent handling. |
| **scripts/set-webhook.js** | One-off script: reads `.env` and calls Telegram setWebhook with `WEBHOOK_BASE_URL/webhook/telegram` and optional secret. |

Tests in `tests/` cover JSON parsing, scenario routing, and VIN normalization.

---

## What you need to make workflow 1 work

- **Environment variables** in a `.env` file (see below).
- **Service account JSON** file (e.g. `service-account.json`) for Firebase + Google Sheets, path set in `GOOGLE_APPLICATION_CREDENTIALS`.
- **Firestore**: at least one **tenant** document with `status: "active"`, and one **user** document with `chatID` = your Telegram chat ID and `tenantID` = that tenant’s document ID. Without this, the bot replies “Your Device is not registered”.
- **Telegram webhook** set to your server URL (e.g. `https://your-host/webhook/telegram`) so Telegram can send updates to this app.

---

## Config: .env and .env.example

- **.env.example** is the template. It is committed to Git (e.g. GitHub). It has no real secrets, only placeholder names.
- **.env** is your local config. You create it yourself (e.g. copy from .env.example), put your real keys and values in it, and **do not** commit it. The repo’s `.gitignore` already excludes `.env`, so it will not be pushed to GitHub.

So: keep `.env.example` as-is in the repo. Locally, create a new file named `.env` next to `.env.example`, copy the contents of `.env.example` into `.env`, then replace every placeholder with your real values. Only `.env` is loaded at runtime; `.env.example` is for documentation and for others (or you on another machine) to know which variables exist.

---

## Environment variables (all you need + where to get them)

| Variable | Where to get it | Required for |
|----------|-----------------|--------------|
| **TELEGRAM_BOT_TOKEN** | [@BotFather](https://t.me/BotFather) on Telegram: create a bot, copy the token (e.g. `123456:ABC-...`). | Receiving updates and sending replies. |
| **TELEGRAM_WEBHOOK_SECRET** | You choose any random string (e.g. `mySecret123`). Used as `secret_token` when calling setWebhook; Telegram sends it in `X-Telegram-Bot-Api-Secret-Token`. | Optional; recommended so only Telegram can hit your webhook. |
| **WEBHOOK_BASE_URL** | Your server’s public URL (e.g. `https://abc.ngrok.io` or `https://yourdomain.com`), no trailing slash. | Optional; only used by `scripts/set-webhook.js` to build the webhook URL. |
| **OPENAI_API_KEY** | [OpenAI API keys](https://platform.openai.com/api-keys): create a key. | AI classification, part categorization, kit matching. |
| **OPENAI_MODEL** | Same place; e.g. `gpt-4o-mini`. Default in code if omitted. | Which model the agent uses. |
| **OCR_SPACE_API_KEY** | [ocr.space](https://ocr.space/ocrapi): sign up, get API key. | Extracting text from photos; omit if you don’t need photo support. |
| **SCRAPER_BASE_URL** | RealOEM (Cloud Run) base URL (e.g. `https://scraper-xxx.run.app`), no trailing slash. Used for get-car-details, query-group, find-part. | VIN and part lookups. |
| **SCRAPER_GET_CAR_DETAILS_URL** | Optional. Override URL base for get-car-details (without `/{vin}`). | If you use a different scraper for this call. |
| **SCRAPER_QUERY_GROUP_URL** | Optional. Full URL for query-group endpoint. | If you use a different scraper for this call. |
| **SCRAPER_FIND_PART_URL** | Optional. Full URL for find-part endpoint. | If you use a different scraper for this call. |
| **SCRAPER_API_COM_KEY** | [ScraperAPI.com](https://www.scraperapi.com/): sign up, get key. Second scraper: diagram image download only. | Optional; used when sending diagram images to the user. |
| **GOOGLE_SERVICE_ACCOUNT_JSON** | Paste the **entire** service account JSON in one line (minified). Use this **or** the path below; no file needed. | Firestore and Sheets. |
| **GOOGLE_APPLICATION_CREDENTIALS** | Path to service account JSON file (e.g. `./service-account.json`). Use this **or** the JSON above. | Firestore and Sheets. |
| **FIRESTORE_PROJECT_ID** | Firebase Console → Project settings → your project ID (e.g. `automotiveagent-83ade`). | Which Firestore project to use. |
| **SHEETS_HOT_ITEMS_SPREADSHEET_ID** | Open the Hot Items Google Sheet; URL is `.../d/SPREADSHEET_ID/edit`. Copy that ID. | Hot Items lookup. |
| **SHEETS_HOT_ITEMS_SHEET_NAME** | Tab name in that sheet (often `Sheet1`). | Same. |
| **SHEETS_ALIAS_MAP_SPREADSHEET_ID** | Same as above for the Alias Map sheet. | Alias Map lookup. |
| **SHEETS_ALIAS_MAP_SHEET_NAME** | Tab name (often `Sheet1`). | Same. |
| **SHEETS_KITS_SPREADSHEET_ID** | Same for the Kits sheet. | Kits list. |
| **SHEETS_KITS_SHEET_NAME** | Tab name (often `Sheet1`). | Same. |
| **ODOO_URL** | Your Odoo instance URL (e.g. `https://yourcompany.odoo.com`), no trailing slash. | Optional; car/quotation/product in Odoo. |
| **ODOO_DB** | Odoo database name (shown in Odoo or by your host). | Optional; with Odoo. |
| **ODOO_USERNAME** | Odoo login email. | Optional; with Odoo. |
| **ODOO_PASSWORD** | Odoo password or API key. | Optional; with Odoo. |
| **WHATSAPP_PHONE_NUMBER_ID** / **WHATSAPP_ACCESS_TOKEN** | Meta WhatsApp Business API. | Not used by workflow 1; only if you add WhatsApp later. |
| **PORT** | You choose (default `3000`). | Which port the server listens on. |
| **NODE_ENV** | `development` or `production`. | Logging/behavior. |
| **LOG_LEVEL** | `debug` or `info` (etc.). | How verbose logs are. |

Use **either** `GOOGLE_SERVICE_ACCOUNT_JSON` (paste full JSON in one line) **or** `GOOGLE_APPLICATION_CREDENTIALS` (path to file). The service account must have access to Firestore and to the Google Sheets you use; share each sheet with the service account email (e.g. `xxx@xxx.iam.gserviceaccount.com`).

---

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env and set every value (see table above).
# For Google: either paste full service account JSON in GOOGLE_SERVICE_ACCOUNT_JSON, or set GOOGLE_APPLICATION_CREDENTIALS to a JSON file path.
npm run dev
```

Then expose the server (e.g. ngrok on `PORT`) and set the Telegram webhook to `https://<your-base>/webhook/telegram` (e.g. with `node scripts/set-webhook.js` if you set `WEBHOOK_BASE_URL` in `.env`).

---

## Firestore collections (used by workflow 1)

| Collection | Document ID | Purpose |
|------------|-------------|---------|
| **sessions** | `{chat_id}` | Per-chat state: chat_id, tenant_id, user_id, vin, quotation_id, history. |
| **users** | any | One doc per allowed Telegram user: `chatID` (Telegram chat id), `tenantID` (ref to tenants). |
| **tenants** | `{tenantId}` | `name`, `status` (must be `active` for user to be allowed). |
| **quotes** | auto | Open/closed quotes: quotation_id, vin, vehicle_details, chat_id, status, customer_name, etc. |
| **quotes/{id}/basket** | auto | Basket lines: part_number, products, chosen product, etc. |
| **catalogResults** | auto | Cached scraper catalog data. |
| **messages** | optional | Used by workflow 2 (WhatsApp); not required for workflow 1. |

---

## Scenarios (short)

| Scenario | Trigger | What happens |
|----------|---------|----------------|
| **vin** | User sends a VIN | Scraper car details → Odoo car + quotation → Firestore quote/session → reply with vehicle summary. |
| **part** | User asks for a part | Hot Items / Alias Map → scraper → score → Odoo product → add to basket → reply (optional diagram). |
| **kit** | User says “kit” / “طقم” | Kits sheet + AI match → each part runs part flow → reply. |
| **finalize** | User wants to finalize | Load basket → build summary → send on Telegram. |
| **unrecognized** | Else | Send AI’s clarification message. |

---

## Troubleshooting

- **“Your Device is not registered”** — Firestore must have a **user** with `chatID` = this Telegram chat id and a **tenant** with `status: "active"` and that tenant’s ID in the user’s `tenantID`.
- **Odoo warnings** — Set `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` for real Odoo; otherwise the app uses mocks.
- **OCR empty** — Check `OCR_SPACE_API_KEY`; without it, photo messages won’t work.
- **VIN errors** — Scraper may be down or VIN invalid; check `SCRAPER_BASE_URL`.
- **Sheets empty** — Service account must have Sheets API and each sheet shared with the service account email.

---

## Testing

```bash
npm test
```

Covers JSON extraction, scenario routing, and VIN normalization.
