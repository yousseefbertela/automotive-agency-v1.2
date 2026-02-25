# Automotive Workflows - Unified Monorepo

> **Production-ready** backend + web frontend. Backend consolidates Telegram automotive assistant and WhatsApp confirmation/cancellation handler (converted from n8n).

## 📋 Overview

- **Backend** (`/backend`): Express server with Telegram webhook, WhatsApp webhook, and **HTTP API for web chat** (session state, LLM agent, OCR, scrapers, Odoo, Prisma/PostgreSQL).
- **Frontend** (`/frontend`): React + Vite chat UI (replaces Telegram as the UI for the same assistant).

## 🏗️ Structure

```
/
├── backend/
│   ├── src/
│   │   ├── server.js           # Entry point (PORT=4000)
│   │   ├── app.js              # Express + CORS + routes
│   │   ├── routes/             # telegram, waba, healthRoutes, chatRoutes
│   │   ├── services/           # chatService, agentService, ocrService, sessionStore, …
│   │   ├── workflows/          # handleUpdate, processMessage, router
│   │   ├── domain/             # vin, part, kit, finalize flows
│   │   ├── ai/, db/, integrations/, utils/
│   │   └── …
│   ├── prisma/
│   ├── scripts/                # set-webhook.js, seed-web-tenant.js
│   ├── package.json
│   ├── .env.example
│   └── .env                    # (gitignored)
├── frontend/
│   ├── src/
│   │   ├── lib/                # api.js, session.js, theme.js
│   │   ├── pages/              # ChatPage.jsx
│   │   ├── components/         # ChatHeader, MessageList, MessageBubble, ChatInput, UploadButton, SettingsPanel, ThemeToggle, BrandLogos
│   │   └── …
│   ├── package.json
│   ├── .env.example
│   └── .env                    # (gitignored)
├── package.json                # Convenience: dev, dev:backend, dev:frontend
├── README.md
└── INTEGRATION_SUMMARY.md
```

## 🚀 Run locally — connect backend + frontend

### One-time setup

**1. Backend**

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` and set at least:

- `DATABASE_URL` — your PostgreSQL connection string
- `OPENAI_API_KEY` — for the chat agent
- For **web chat**: run `node scripts/seed-web-tenant.js`, then set `WEB_DEFAULT_TENANT_ID` and `WEB_DEFAULT_USER_ID` in `.env` (the script prints the values).

Create the database schema:

```bash
npx prisma migrate deploy
# or for a fresh DB:  npx prisma migrate dev
```

**2. Frontend**

```bash
cd frontend
npm install
cp .env.example .env
```

Optional: in `frontend/.env` set `VITE_API_BASE_URL=http://localhost:4000` (this is the default).

### Start both and test

**Option A — one command (from repo root)**

```bash
npm install
npm run dev
```

This starts the backend on **http://localhost:4000** and the frontend on **http://localhost:5173** at the same time.

**Option B — two terminals**

- **Terminal 1 (backend):** `cd backend && npm run dev`
- **Terminal 2 (frontend):** `cd frontend && npm run dev`

Then open **http://localhost:5173** in your browser.

### Quick test

1. In the browser you should see the chat UI (and “Connected” in the status bar if the backend is up).
2. Type a message and click **Send** — you should get a reply from the backend.
3. Click **Photo**, choose an image, and send — you should get OCR text and a reply.
4. Use **Settings** (⚙️) to see or reset your session ID.

If the backend is not running, the frontend will show “Disconnected” and messages will fail until you start the backend.

## 📡 HTTP API (web chat)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ ok: true, time: string, version? }` |
| POST | `/api/chat/message` | Body: `{ session_id?: string, message: string }` → `{ session_id, reply, meta? }` |
| POST | `/api/chat/photo` | multipart: field `photo` (file), optional `session_id` → `{ session_id, ocr_text, reply, meta? }` |

- **Session**: If `session_id` is omitted, the backend generates one and returns it. Store it in the client (e.g. localStorage) and send it on subsequent requests.
- **Web sessions**: Backend uses the same Prisma session/state as Telegram. For anonymous web users, run `node backend/scripts/seed-web-tenant.js` and set `WEB_DEFAULT_TENANT_ID` and `WEB_DEFAULT_USER_ID` in `backend/.env`.

## 🔧 Env variables

- **Backend**: All variables live in `backend/.env`. See `backend/.env.example` for the full list (DB, Telegram, WhatsApp, OpenAI, OCR, scrapers, Odoo, Google Sheets, web chat tenant/user).
- **Frontend**: `frontend/.env` only needs `VITE_API_BASE_URL` (default `http://localhost:4000`). See `frontend/.env.example`.

## 📄 Other endpoints (unchanged)

- **Telegram**: `POST /webhook/telegram`
- **WhatsApp**: `GET` / `POST /webhooks/waba`
- **Legacy health**: `GET /health`

---

**Built for automotive professionals.**
