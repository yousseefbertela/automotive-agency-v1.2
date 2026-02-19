# Automotive Workflows - Unified Monorepo

> **Production-ready Node.js application** combining two n8n workflows into a single, unified codebase.

## 📋 Overview

This project consolidates two previously separate n8n workflows into one clean, maintainable monorepo:

1. **Telegram Automotive Assistant** (Workflow 1)
   - AI-powered automotive parts assistant
   - VIN lookup and vehicle information
   - Part search with OCR support
   - Kit matching and quotation management
   - Integration with Odoo, Google Sheets, RealOEM scraper

2. **WhatsApp Confirmation/Cancellation Handler** (Workflow 2)
   - WhatsApp Business API webhook
   - Order confirmation and cancellation flows
   - Telegram notifications
   - Odoo order line creation

Both workflows share:
- Single Express server
- Unified configuration and environment variables
- PostgreSQL via Prisma (sessions, quotes, basket, messages, catalog cache)
- Shared services (Odoo, Telegram, WhatsApp)
- Common logging and error handling
- Single installation and deployment process

---

## 🏗️ Architecture

### Project Structure

```
.
├── src/
│   ├── server.js                 # Server bootstrap (entry point)
│   ├── app.js                    # Express app configuration
│   │
│   ├── routes/                   # HTTP route handlers
│   │   ├── telegram.js           # POST /webhook/telegram
│   │   └── waba.js               # POST /webhooks/waba (WhatsApp)
│   │
│   ├── workflows/                # Workflow orchestration
│   │   ├── handleUpdate.js       # Telegram update handler
│   │   └── router.js             # Scenario routing logic
│   │
│   ├── domain/                   # Business logic flows
│   │   ├── vin.flow.js           # VIN lookup flow
│   │   ├── part.flow.js          # Part search flow
│   │   ├── kit.flow.js           # Kit matching flow
│   │   ├── finalize.flow.js      # Quotation finalization
│   │   ├── confirmation.flow.js  # WhatsApp confirmation
│   │   └── cancellation.flow.js  # WhatsApp cancellation
│   │
│   ├── services/                 # External service integrations
│   │   ├── telegram.service.js   # Telegram Bot API
│   │   ├── whatsapp.service.js   # WhatsApp Business API
│   │   ├── prisma.service.js     # Prisma client (PostgreSQL)
│   │   ├── odoo.service.js       # Odoo ERP JSON-RPC
│   │   └── ocr.service.js        # OCR.space API
│   │
│   ├── integrations/             # Additional integrations
│   │   ├── scraper.client.js     # RealOEM scraper API
│   │   └── sheets.client.js      # Google Sheets API
│   │
│   ├── ai/                       # AI/LLM components
│   │   ├── agent.js              # OpenAI chat completions
│   │   ├── prompts.js            # System prompts
│   │   └── parseFirstJson.js     # JSON extraction utilities
│   │
│   ├── db/                       # Data access layer
│   │   ├── state.repo.js         # Session state management
│   │   └── quotes.repo.js        # Quotation operations
│   │
│   └── utils/                    # Shared utilities
│       ├── logger.js             # Structured JSON logger
│       ├── retry.js              # Exponential backoff retry
│       ├── errors.js             # Custom error classes
│       └── verifyMetaSignature.js # WhatsApp webhook verification
│
├── scripts/
│   └── set-webhook.js            # Telegram webhook setup script
│
├── package.json                  # Dependencies and scripts
├── .env.example                  # Environment variable template
├── .gitignore                    # Git ignore rules
└── README.md                     # This file
```

### Key Design Decisions

#### 1. **Single Server, Multiple Endpoints**
- One Express server handles both Telegram and WhatsApp webhooks
- Telegram: `POST /webhook/telegram`
- WhatsApp: `POST /webhooks/waba` (+ `GET` for verification)
- Health check: `GET /health`

#### 2. **Shared Service Layer**
All external integrations are consolidated into reusable services:
- `telegram.service.js` - Used by both workflows
- `prisma.service.js` - Prisma client for PostgreSQL (all app data)
- `odoo.service.js` - Merged Odoo client with all methods

#### 3. **Unified Configuration**
- Single `.env` file at root
- All env vars grouped by service
- Shared credentials (Firebase, Odoo) used by both workflows

#### 4. **Preserved Behavior**
- All business logic from both n8n workflows preserved 1:1
- No simplifications or removed features
- State management, session handling, and flow logic unchanged

---

## 🚀 Setup

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** (comes with Node.js)
- **PostgreSQL** (local or hosted, e.g. Railway)
- Odoo instance (optional, can run in mock mode)
- Telegram Bot Token
- WhatsApp Business API credentials
- OpenAI API key
- OCR.space API key

### Installation

1. **Clone and navigate to the project:**
   ```bash
   cd path/to/n8nworklows2code
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set at least:
   - **`DATABASE_URL`** — PostgreSQL connection string (required). Example: `postgresql://user:password@localhost:5432/mydb?schema=public`
   - Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
   - WhatsApp: `WHATSAPP_ACCESS_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`
   - OpenAI: `OPENAI_API_KEY`
   - OCR: `OCR_SPACE_API_KEY`
   - Odoo: `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`
   - Scrapers: `SCRAPER_BASE_URL`, `SCRAPER_API_COM_KEY`
   - Google Sheets: `SHEETS_HOT_ITEMS_SPREADSHEET_ID`, `SHEETS_ALIAS_MAP_SPREADSHEET_ID`, `SHEETS_KITS_SPREADSHEET_ID`

4. **Create the database and run migrations:**
   ```bash
   # Generate Prisma client (after schema or dependency changes)
   npm run prisma:generate

   # Create DB tables (run against your PostgreSQL)
   npx prisma migrate deploy
   ```
   For local development with a fresh DB you can use:
   ```bash
   npx prisma migrate dev --name init
   ```
   This applies the migration in `prisma/migrations/` and generates the client.

5. **Start the server:**
   ```bash
   # Development (with auto-reload)
   npm run dev

   # Production
   npm start
   ```
   The server listens on `http://localhost:3000` (or `PORT` in `.env`).

---

## 🧪 Testing

### Local Testing

#### 1. Health Check
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "uptime": 123.456,
  "services": {
    "telegram": "automotive-telegram-agent",
    "whatsapp": "wa-response-webhook"
  }
}
```

#### 2. Telegram Webhook

**Test with curl:**
```bash
curl -X POST http://localhost:3000/webhook/telegram \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: your-secret-from-env" \
  -d '{
    "update_id": 123456789,
    "message": {
      "message_id": 1,
      "from": {"id": 123456, "first_name": "Test"},
      "chat": {"id": 123456, "type": "private"},
      "date": 1234567890,
      "text": "WBA1234567"
    }
  }'
```

**Set Telegram webhook (for production):**
```bash
# Update WEBHOOK_BASE_URL in .env first
npm run set-webhook
```

#### 3. WhatsApp Webhook

**GET verification (Meta challenge):**
```bash
curl "http://localhost:3000/webhooks/waba?hub.mode=subscribe&hub.verify_token=your-verify-token&hub.challenge=test123"
```

Expected: Returns `test123` as plain text.

**POST button reply:**
```bash
curl -X POST http://localhost:3000/webhooks/waba \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "value": {
          "messages": [{
            "button": {"payload": "تأكيد العمل"},
            "context": {"id": "wamid.test123"}
          }],
          "contacts": [{"wa_id": "201001202986"}]
        }
      }]
    }]
  }'
```

---

## 📡 Deployment

### Environment Variables (Production)

Ensure all required variables are set:

**Critical (both workflows):**
- `DATABASE_URL` — PostgreSQL connection string (e.g. Railway Postgres provides this)
- `TELEGRAM_BOT_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `META_WEBHOOK_VERIFY_TOKEN`
- `OPENAI_API_KEY`
- `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`

**Telegram-specific:**
- `OCR_SPACE_API_KEY`
- `SCRAPER_BASE_URL`
- `SCRAPER_API_COM_KEY`
- Google Sheets IDs

**WhatsApp-specific:**
- `META_APP_SECRET` (for signature verification)
- `WA_TEMPLATE_CANCELLATION`, `WA_TEMPLATE_CONFIRMATION`

### Deployment Platforms

#### Railway (recommended)

1. Create a new project and add **PostgreSQL** from the Railway dashboard (or use an existing Postgres service).
2. Copy the `DATABASE_URL` from the Postgres service variables into your app’s environment variables.
3. Connect your Git repository and set all other env vars (Telegram, WhatsApp, OpenAI, Odoo, etc.).
4. Build command: leave default or `npm install`. Start command: `npm start` (or `npx prisma migrate deploy && npm start` if you want to run migrations on deploy).
5. Set `PORT` if required (Railway often sets it automatically).
6. Set webhook URLs:
   - Telegram: `https://your-app.up.railway.app/webhook/telegram`
   - WhatsApp: `https://your-app.up.railway.app/webhooks/waba`

#### Render / Heroku

1. Attach a PostgreSQL add-on and set `DATABASE_URL`.
2. Set all other environment variables.
3. Deploy command: `npm start`. Run migrations once (e.g. `npx prisma migrate deploy`) in a release phase or manually.
4. Set webhook URLs to your app domain.

#### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

Build and run:
```bash
docker build -t automotive-workflows .
docker run -p 3000:3000 --env-file .env automotive-workflows
```

---

## 🔄 Integration Process

### What Was Merged

#### **Entrypoints**
- **Before:** Two separate `server.js` files (one per workflow)
- **After:** Single `src/server.js` that boots one Express app with both route handlers

#### **Routes**
- **Before:**
  - Workflow 1: `POST /webhook/telegram` in `workflow 1 main/src/routes/telegram.js`
  - Workflow 2: `POST /webhooks/waba` in `workflow 2 whatsapp/src/routes/waba.js`
- **After:** Both routes mounted in `src/app.js`, no path conflicts

#### **Services**
- **Telegram:** Merged `telegram.client.js` (workflow 1) and `telegram.service.js` (workflow 2) → `src/services/telegram.service.js`
- **Database:** Migrated from Firestore to **PostgreSQL with Prisma**. All data (sessions, users, tenants, quotes, basket, catalog cache, messages) is in Postgres. See `prisma/schema.prisma`, `src/db/*.repo.js`, and `src/services/prisma.service.js`.
- **Odoo:** Merged `odoo.client.js` (workflow 1) and `odoo.service.js` (workflow 2) → `src/services/odoo.service.js`
  - Unified JSON-RPC client with all methods (car search, quotation, order lines)
- **WhatsApp:** Kept as-is from workflow 2 → `src/services/whatsapp.service.js`
- **OCR:** Kept as-is from workflow 1 → `src/services/ocr.service.js`

#### **Utilities**
- **Logger:** Identical in both projects → Single `src/utils/logger.js`
- **Retry:** Merged (workflow 2 had better timeout cleanup) → `src/utils/retry.js`
- **Errors:** Kept from workflow 1 → `src/utils/errors.js`
- **verifyMetaSignature:** Kept from workflow 2 → `src/utils/verifyMetaSignature.js`

#### **Environment Variables**
- **Before:** Two separate `.env` files with overlapping vars (Firebase, Odoo, Telegram)
- **After:** Single `.env` at root with all vars grouped by service
- **Deduplication:** Shared credentials (Firebase, Odoo) now used by both workflows

#### **Dependencies**
- **Before:** Two `package.json` files with mostly identical deps
- **After:** Single `package.json` with merged dependencies
  - `express`, `axios`, `dotenv`, `@prisma/client`, `prisma`, `uuid` (common)
  - `openai`, `googleapis`, `form-data` (workflow 1)
  - No conflicts, all versions aligned

#### **State/Session Handling**
- **Workflow 1:** Uses `state.repo.js` for session management (Prisma/Postgres)
- **Workflow 2:** Uses same Prisma repos for session/quote lookups
- **After:** Single Postgres DB for all app data

---

## 🛠️ Troubleshooting

### Common Issues

**1. `TELEGRAM_BOT_TOKEN not set`**
- Check `.env` file exists and has `TELEGRAM_BOT_TOKEN=...`
- Restart server after changing `.env`

**2. `Database connection` / Prisma errors**
- Ensure `DATABASE_URL` is set and correct (PostgreSQL URL with user, password, host, port, database name).
- Run `npx prisma migrate deploy` to create/update tables.

**3. `Odoo authentication failed`**
- Verify `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`
- Test Odoo connection manually: `curl -X POST https://your-odoo.com/jsonrpc`

**4. `WhatsApp signature verification failed`**
- Ensure `META_APP_SECRET` matches your Meta app settings
- Check webhook payload is sent with `X-Hub-Signature-256` header

**5. `OCR.space returns empty text`**
- Verify `OCR_SPACE_API_KEY` is valid
- Check image format (JPEG/PNG supported)
- Review OCR.space API limits

---

## 📊 Monitoring

### Logs

All logs are structured JSON written to stdout/stderr:

```json
{
  "ts": "2026-02-16T12:00:00.000Z",
  "level": "info",
  "correlationId": "uuid-here",
  "msg": "handleUpdate: start",
  "chatId": 123456,
  "from": "Test User"
}
```

Set `LOG_LEVEL` in `.env` to control verbosity:
- `debug` - All logs (default in development)
- `info` - Info, warn, error
- `warn` - Warn and error only
- `error` - Errors only

### Health Endpoint

Monitor server health:
```bash
curl http://localhost:3000/health
```

Returns:
- `200 OK` if server is running
- `uptime` in seconds
- Service names

---

## 🤝 Contributing

This project was converted from n8n workflows. To maintain behavior parity:

1. **Do not simplify** business logic without testing against original n8n workflows
2. **Preserve all integrations** (even if they seem redundant)
3. **Keep error handling** consistent with n8n behavior
4. **Test both workflows** after any changes

---

## 📄 License

[Your License Here]

---

## 🙏 Acknowledgments

- Converted from n8n workflows by senior engineer
- Original workflows designed for automotive parts quotation system
- Integrates with: Telegram, WhatsApp, OpenAI, Odoo, PostgreSQL (Prisma), Google Sheets, RealOEM

---

## 📞 Support

For issues or questions:
1. Check logs for `correlationId` and error messages
2. Verify all environment variables are set correctly
3. Test individual endpoints with curl
4. Review n8n workflow JSON for original behavior reference

---

**Built with ❤️ for automotive professionals**
