'use strict';

const express = require('express');
const logger = require('./utils/logger');
const wabaRoutes = require('./routes/waba');
const healthRoutes = require('./routes/healthRoutes');
const chatRoutes = require('./routes/chatRoutes');
const debugRoutes = require('./routes/debugRoutes');

const app = express();

// ── CORS ──
// Build allowed origins list from env + dev defaults
const buildAllowedOrigins = () => {
  const origins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  // Allow production frontend URL via env (Railway, Vercel, etc.)
  if (process.env.FRONTEND_URL) {
    origins.push(process.env.FRONTEND_URL.replace(/\/$/, ''));
  }
  return origins;
};

app.use((req, res, next) => {
  const allowedOrigins = buildAllowedOrigins();
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // Cache-Control and Last-Event-ID are required for SSE streams
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Cache-Control, Last-Event-ID, x-debug-api-key'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Middleware ──
// For WhatsApp webhook, capture raw body for Meta signature verification
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      if (req.path.startsWith('/webhooks/waba')) {
        req.rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Request logging (skip noisy health + SSE)
app.use((req, _res, next) => {
  if (
    req.path !== '/health' &&
    !req.path.startsWith('/api/health') &&
    !req.path.startsWith('/api/chat/events')
  ) {
    logger.debug('HTTP request', { method: req.method, path: req.path });
  }
  next();
});

// ── Routes ──
// Root: simple response (helps verify app is reachable on Railway)
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'PartPilot',
    endpoints: {
      health: 'GET /health',
      apiHealth: 'GET /api/health',
      chat: 'POST /api/chat/message',
      photo: 'POST /api/chat/photo',
      events: 'GET /api/chat/events',
      notifications: 'GET /api/chat/notifications',
      submitForm: 'POST /api/chat/submit-form',
      debug: 'GET /api/chat/debug/session/:chatId',
      whatsapp: 'POST /webhooks/waba',
    },
  });
});

// API (web frontend)
app.use('/api/health', healthRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/debug', debugRoutes);

// WhatsApp Business API webhook (customer channel only)
app.use('/webhooks/waba', wabaRoutes);

// Health check (legacy path)
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    services: {
      whatsapp: 'wa-response-webhook',
      frontend: 'sse-agent-channel',
    },
  });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled express error', { error: err.message, stack: err.stack });
  res.status(err.statusCode || 500).json({ error: 'Internal Server Error' });
});

module.exports = app;
