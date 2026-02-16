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
- Shared services (Firestore, Odoo, Telegram)
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
│   │   ├── firestore.service.js  # Firebase/Firestore
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
- `firestore.service.js` - Unified Firestore operations
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
- Firebase/Firestore project
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
   Edit `.env` and fill in your credentials:
   - Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
   - WhatsApp: `WHATSAPP_ACCESS_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`
   - OpenAI: `OPENAI_API_KEY`
   - OCR: `OCR_SPACE_API_KEY`
   - Firebase: `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`
   - Firestore: `FIRESTORE_PROJECT_ID`
   - Odoo: `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`
   - Scrapers: `SCRAPER_BASE_URL`, `SCRAPER_API_COM_KEY`
   - Google Sheets: `SHEETS_HOT_ITEMS_SPREADSHEET_ID`, `SHEETS_ALIAS_MAP_SPREADSHEET_ID`, `SHEETS_KITS_SPREADSHEET_ID`

4. **Start the server:**
   ```bash
   # Development (with auto-reload)
   npm run dev

   # Production
   npm start
   ```

   The server will start on `http://localhost:3000` (or the port specified in `.env`).

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
- `TELEGRAM_BOT_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `META_WEBHOOK_VERIFY_TOKEN`
- `OPENAI_API_KEY`
- `FIRESTORE_PROJECT_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS`)
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

#### Railway / Render / Heroku

1. Connect your Git repository
2. Set environment variables in the dashboard
3. Deploy command: `npm start`
4. Set webhook URLs:
   - Telegram: `https://your-domain.com/webhook/telegram`
   - WhatsApp: `https://your-domain.com/webhooks/waba`

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
- **Firestore:** Merged `firestore.client.js` (workflow 1) and `firestore.service.js` (workflow 2) → `src/services/firestore.service.js`
  - Combined all Firestore operations (sessions, quotes, basket, messages, tenants)
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
  - `express`, `axios`, `dotenv`, `firebase-admin`, `uuid` (common)
  - `openai`, `googleapis`, `form-data` (workflow 1)
  - No conflicts, all versions aligned

#### **State/Session Handling**
- **Workflow 1:** Uses `state.repo.js` for session management
- **Workflow 2:** Directly calls Firestore for session/quote lookups
- **After:** Both approaches preserved, no conflicts (different use cases)

---

## 🛠️ Troubleshooting

### Common Issues

**1. `TELEGRAM_BOT_TOKEN not set`**
- Check `.env` file exists and has `TELEGRAM_BOT_TOKEN=...`
- Restart server after changing `.env`

**2. `Firestore permission denied`**
- Verify `GOOGLE_SERVICE_ACCOUNT_JSON` is valid JSON (no newlines if inline)
- Or ensure `GOOGLE_APPLICATION_CREDENTIALS` points to valid file
- Check Firestore rules allow read/write

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
- Integrates with: Telegram, WhatsApp, OpenAI, Odoo, Firebase, Google Sheets, RealOEM

---

## 📞 Support

For issues or questions:
1. Check logs for `correlationId` and error messages
2. Verify all environment variables are set correctly
3. Test individual endpoints with curl
4. Review n8n workflow JSON for original behavior reference

---

**Built with ❤️ for automotive professionals**
