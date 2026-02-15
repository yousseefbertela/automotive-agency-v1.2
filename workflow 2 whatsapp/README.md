# WA Response Webhook

WhatsApp Business webhook service that handles quotation confirmation/cancellation events.  
Converted 1:1 from the **AA WA Response** n8n workflow.

---

## File Tree

```
workflow 2 whatsapp/
├── package.json
├── .env                 # your local config (create from .env.example, do not commit)
├── .env.example         # template (committed)
├── .gitignore
├── README.md
├── src/
│   ├── server.js              # Entry point — starts Express, logs config
│   ├── app.js                 # Express app setup, middleware, routes
│   ├── routes/
│   │   └── waba.js            # GET /webhooks/waba (verify) + POST /webhooks/waba (events)
│   ├── services/
│   │   ├── firestore.service.js   # Firestore reads/writes (messages, quotes, basket, sessions, tenants)
│   │   ├── whatsapp.service.js    # WhatsApp Cloud API template sender
│   │   ├── odoo.service.js        # Odoo JSON-RPC client (sale.order.line creation)
│   │   └── telegram.service.js    # Telegram Bot API notifications
│   ├── domain/
│   │   ├── cancellation.flow.js   # "تعديل / إلغاء" → cancel template + Telegram notify
│   │   └── confirmation.flow.js   # "تأكيد العمل"  → Odoo lines + confirm template + Telegram notify
│   └── utils/
│       ├── logger.js              # Structured JSON logger with correlationId
│       ├── retry.js               # Exponential back-off retry wrapper
│       └── verifyMetaSignature.js # X-Hub-Signature-256 validator
└── tests/
    ├── waba.route.test.js         # Integration tests for the full webhook pipeline
    ├── verifyMetaSignature.test.js
    └── retry.test.js
```

---

## Role of every file

| File | Role |
|------|------|
| **server.js** | Entry point. Loads `.env`, starts Express on `PORT`, logs which env vars are set or missing, registers graceful shutdown (SIGTERM/SIGINT) and unhandled rejection/exception handlers. |
| **app.js** | Creates the Express app: captures raw body for Meta signature verification, JSON body parser, request logging, mounts `/webhooks/waba` routes, `GET /health`, 404 handler, and global error handler. |
| **routes/waba.js** | **GET** `/webhooks/waba`: Meta webhook verification — checks `hub.mode` and `hub.verify_token`, returns `hub.challenge`. **POST** `/webhooks/waba`: receives the button event, validates signature if `META_APP_SECRET` set, parses payload, runs Firestore lookups (message → quote → basket → session → tenant), updates and closes quote, then calls cancellation or confirmation flow based on button payload. |
| **services/firestore.service.js** | Firestore client. Uses `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS` for auth. Exposes: getMessageDocument(messageId), getQuote(quoteId), updateQuoteStatus(quoteId, status), closeQuote(quoteId), getBasketItems(quoteId), getSession(chatId), getTenant(tenantId). All used by the webhook to resolve quote and tenant data. |
| **services/whatsapp.service.js** | WhatsApp Cloud API (Graph API). sendTemplate(recipient, templateName\|lang, bodyParams); sendCancellationTemplate(recipient, quote, tenantName); sendConfirmationTemplate(recipient, quote, totalCost, tenantName). Uses `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`. |
| **services/odoo.service.js** | Odoo JSON-RPC client. authenticate(), execute(model, method, args), createOrderLine({ orderId, productId, name, priceUnit, qty }). Used in confirmation flow to create sale.order.line for each basket item. Uses `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`. |
| **services/telegram.service.js** | Telegram Bot API. sendMessage(chatId, text). Used to notify the agent when the customer cancels or confirms. Uses `TELEGRAM_BOT_TOKEN`. |
| **domain/cancellation.flow.js** | Cancellation path for payload **"تعديل / إلغاء"**. Sends WhatsApp cancellation template to the customer, then sends Telegram message *"order has been cancelled by car owner"* to the session chat_id. |
| **domain/confirmation.flow.js** | Confirmation path for payload **"تأكيد العمل"**. Creates one Odoo sale.order.line per basket item (using quote.quotation_id and basket product/price data), sends WhatsApp confirmation template to the customer, then sends Telegram message *"order has been confirmed by car owner"* to the session chat_id. |
| **utils/logger.js** | Structured JSON logger (debug, info, warn, error) with optional correlationId. Used for request and flow logging. |
| **utils/retry.js** | Wraps async calls with exponential backoff and timeout. Used by WhatsApp and Odoo services for resilience. |
| **utils/verifyMetaSignature.js** | Verifies Meta’s `X-Hub-Signature-256` using `META_APP_SECRET` and the raw request body. Used in the POST webhook handler to reject forged requests. |
| **tests/waba.route.test.js** | Integration-style tests for GET verification and POST cancellation/confirmation/edge cases; mocks Firestore, WhatsApp, Odoo, Telegram. |
| **tests/verifyMetaSignature.test.js** | Unit tests for signature verification (valid, invalid, missing secret). |
| **tests/retry.test.js** | Unit tests for retry logic (success, retry then success, exhaust retries). |

---

## How the whole workflow 2 works

1. **Customer gets a WhatsApp message** (from workflow 1 or your system) with two buttons: **"تعديل / إلغاء"** (edit/cancel) and **"تأكيد العمل"** (confirm order). The message was sent from your WhatsApp Business number and has a message ID.

2. **When the customer taps a button**, Meta (WhatsApp) sends a **POST** request to your server at `POST /webhooks/waba`. The body contains the button payload, the customer’s phone number (`wa_id`), and the **context.id** of the original message (the template message that had the buttons).

3. **Express** receives the request. The app responds with **200** immediately (Meta requires a fast response). The real work runs in the background so the webhook doesn’t time out.

4. **Optional: signature check.** If `META_APP_SECRET` is set, the app verifies the `X-Hub-Signature-256` header against the raw body. If it doesn’t match, the request is ignored.

5. **Payload is parsed.** The code reads `body.entry[0].changes[0].value`: the **button payload** (e.g. `"تأكيد العمل"` or `"تعديل / إلغاء"`), the **context.id** (original message ID), and the customer **wa_id** (phone). If there are no messages or no button/context, the handler exits (e.g. for status updates).

6. **Firestore: get the message document.** The app loads `messages/{context.id}`. That document was created when the template was sent (e.g. by workflow 1 or your backend) and stores the **quoteId** linked to that WhatsApp message. Without it, the webhook can’t know which quote the button refers to.

7. **Update quote status and load basket.** In parallel the app (a) updates `quotes/{quoteId}` with status `confirmed` or `cancelled` (depending on the button), and (b) reads all documents from `quotes/{quoteId}/basket` to get the basket items. Both use the **quoteId** from the message document.

8. **Firestore: get the quote.** The app loads `quotes/{quoteId}` to get `customer_name`, `vehicle_details`, `chat_id` (Telegram chat of the agent/dealer), and `quotation_id` (Odoo sale order ID). These are needed for WhatsApp templates and for Odoo.

9. **Close the quote and get session.** In parallel the app (a) sets the quote status to **closed** in Firestore, and (b) loads `sessions/{chat_id}` to get **tenant_id** (and the session doc id, which is the Telegram chat_id). The same Firestore project and collections are shared with workflow 1.

10. **Firestore: get tenant.** The app loads `tenants/{tenant_id}` to get the tenant **name**. It’s used in the WhatsApp template body (e.g. dealer/company name).

11. **Switch on button payload.**  
    - **"تعديل / إلغاء"** → **Cancellation flow:** Send a WhatsApp template to the customer (cancellation template with customer name, vehicle, tenant name). Then send a Telegram message to the agent’s chat: *"order has been cancelled by car owner"*. No Odoo calls.  
    - **"تأكيد العمل"** → **Confirmation flow:** For each basket item, create a **sale.order.line** in Odoo (order_id = quote’s quotation_id, product_id, name, price_unit, qty). Then send the WhatsApp confirmation template to the customer (e.g. customer name, vehicle, total cost, tenant name). Then send a Telegram message to the agent’s chat: *"order has been confirmed by car owner"*.  
    - Any other payload is logged and ignored.

12. **Outcomes.** The customer sees the right WhatsApp message (cancelled or confirmed). The agent sees the Telegram notification. If they confirmed, the Odoo quotation has new order lines and the quote in Firestore is closed. All config (templates, tokens, Firestore project, Odoo, Telegram) comes from **.env**; no code change needed to plug in credentials.

So end-to-end: **WhatsApp button click → Meta POST → your webhook → Firestore (message → quote → basket → session → tenant) → status to closed → if cancel: WhatsApp + Telegram; if confirm: Odoo lines + WhatsApp + Telegram.**

---

## What you need to make workflow 2 work

- **Environment variables** in a `.env` file (see table below).
- **Google/Firebase**: either paste the full service account JSON in `GOOGLE_SERVICE_ACCOUNT_JSON` (one line) or put the JSON file on disk and set `GOOGLE_APPLICATION_CREDENTIALS` to its path.
- **Meta webhook**: register your server URL in the Meta Developer Portal (Callback URL = `https://your-host/webhooks/waba`, Verify token = `META_WEBHOOK_VERIFY_TOKEN`) and subscribe to **messages**.

Firestore must already contain the data produced by workflow 1 (e.g. `messages`, `quotes`, `sessions`, `tenants`) so that when a user clicks a button, the webhook can resolve `context.id` → message → quote → session → tenant.

---

## Config: .env and .env.example

- **.env.example** is the template. It is committed to Git. It has no real secrets, only placeholders.
- **.env** is your local config. Create it (e.g. copy from .env.example), put your real values in it, and do not commit it. The repo’s `.gitignore` excludes `.env`, so it will not be pushed.

Keep `.env.example` as-is in the repo. Locally, create `.env`, copy the contents of `.env.example` into it, then replace every placeholder with your real values. Only `.env` is loaded at runtime.

---

## Environment variables (all you need + where to get them)

| Variable | Where to get it | Required for |
|----------|-----------------|--------------|
| **WHATSAPP_PHONE_NUMBER_ID** | Meta Developer Portal → WhatsApp → your phone number ID (e.g. `804877562714688`). | Sending WhatsApp templates. |
| **WHATSAPP_ACCESS_TOKEN** | Meta Developer Portal → WhatsApp → API setup; create a permanent token. | Sending WhatsApp templates. |
| **META_WEBHOOK_VERIFY_TOKEN** | You choose any random string. You enter the same value when registering the webhook in Meta. | GET webhook verification. |
| **META_APP_SECRET** | Meta Developer Portal → App settings → Basic → App secret. | Optional; verifies POST webhook signature. |
| **WA_TEMPLATE_CANCELLATION** | Name of your WhatsApp template for cancellation (e.g. `partpilot_order_cancelled\|en`). | Cancellation flow. |
| **WA_TEMPLATE_CONFIRMATION** | Name of your WhatsApp template for confirmation (e.g. `partpilot_order_cancelled\|en`). | Confirmation flow. |
| **GOOGLE_SERVICE_ACCOUNT_JSON** | Paste the entire Firebase/Google service account JSON in one line (minified). Use this **or** the path below; no file needed. | Firestore. |
| **GOOGLE_APPLICATION_CREDENTIALS** | Path to service account JSON file (e.g. `./service-account.json`). Use this **or** the JSON above. | Firestore. |
| **FIRESTORE_PROJECT_ID** | Firebase Console → Project settings → your project ID (e.g. `automotiveagent-83ade`). | Which Firestore project to use. |
| **ODOO_URL** | Your Odoo instance URL (e.g. `https://yourcompany.odoo.com`), no trailing slash. | Creating sale.order.line on confirmation. |
| **ODOO_DB** | Odoo database name. | Same. |
| **ODOO_USERNAME** | Odoo login email. | Same. |
| **ODOO_PASSWORD** | Odoo password or API key. | Same. |
| **TELEGRAM_BOT_TOKEN** | [@BotFather](https://t.me/BotFather) on Telegram: create a bot, copy the token. | Notifying Telegram when user confirms/cancels. |
| **PORT** | You choose (default `3001`). | Server port. |
| **NODE_ENV** | `development` or `production`. | Logging/behavior. |
| **LOG_LEVEL** | `debug` or `info` (etc.). | Log verbosity. |

Use **either** `GOOGLE_SERVICE_ACCOUNT_JSON` (paste full JSON in one line) **or** `GOOGLE_APPLICATION_CREDENTIALS` (path to file). The service account must have Firestore access for the same project used by workflow 1.

---

## Quick start

```bash
cd "workflow 2 whatsapp"
npm install
# Create .env from .env.example and fill every value (see table above).
npm run dev
```

Expose the server (e.g. `ngrok http 3001`) and in the [Meta Developer Portal](https://developers.facebook.com/) set the webhook:

- **Callback URL**: `https://<your-base>/webhooks/waba`
- **Verify token**: value of `META_WEBHOOK_VERIFY_TOKEN`
- Subscribe to **messages**

---

## Running Tests

```bash
npm test
```

All external services are mocked. Tests cover:
- GET verification (valid + invalid token)
- POST cancellation flow (status update, WhatsApp send, Telegram notify)
- POST confirmation flow (Odoo order lines, WhatsApp send, Telegram notify)
- Edge cases (status updates, unknown payloads)
- Meta signature verification
- Retry with exponential back-off

---

## Sample Webhook Payload

This is what Meta sends when a user clicks a button reply:

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "BUSINESS_ACCOUNT_ID",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "contacts": [
              {
                "wa_id": "201001234567",
                "profile": { "name": "Customer Name" }
              }
            ],
            "messages": [
              {
                "from": "201001234567",
                "id": "wamid.INCOMING_MSG_ID",
                "timestamp": "1700000000",
                "type": "button",
                "button": {
                  "payload": "تأكيد العمل",
                  "text": "تأكيد العمل"
                },
                "context": {
                  "from": "804877562714688",
                  "id": "wamid.ORIGINAL_TEMPLATE_MSG_ID"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `waba.verify: failed` | Check `META_WEBHOOK_VERIFY_TOKEN` matches what you set in Meta portal |
| `Unterminated string in JSON` | Ensure Content-Type is `application/json` and body is valid JSON |
| `firestore.getMessageDocument: not found` | The `context.id` from WhatsApp must match a document in `messages` collection |
| `quote has no quotation_id` | The Firestore quote document needs a `quotation_id` field (set by workflow 1) |
| `Odoo not configured — mock execute` | Set `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` in `.env` |
| `WHATSAPP_ACCESS_TOKEN not set` | Get a permanent token from Meta Business settings |
| `TELEGRAM_BOT_TOKEN not set` | Create a bot via @BotFather and set the token |
