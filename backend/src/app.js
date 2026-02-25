'use strict';

const express = require('express');
const logger = require('./utils/logger');
const telegramRoutes = require('./routes/telegram');
const wabaRoutes = require('./routes/waba');
const healthRoutes = require('./routes/healthRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();

// ── CORS ──
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Middleware ──
// For WhatsApp webhook, we need raw body for signature verification
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      // Only capture raw body for waba routes
      if (req.path.startsWith('/webhooks/waba')) {
        req.rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  if (req.path !== '/health' && !req.path.startsWith('/api/health')) {
    logger.debug('HTTP request', { method: req.method, path: req.path });
  }
  next();
});

// ── Routes ──
// Root: simple response so "/" returns something (helps verify app is reachable on Railway)
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'PartPilot', endpoints: { health: 'GET /health', apiHealth: 'GET /api/health', chat: 'POST /api/chat/message', photo: 'POST /api/chat/photo', telegram: 'POST /webhook/telegram', whatsapp: 'POST /webhooks/waba' } });
});

// API (web frontend)
app.use('/api/health', healthRoutes);
app.use('/api/chat', chatRoutes);

// Telegram webhook
app.use('/webhook', telegramRoutes);

// WhatsApp Business API webhook
app.use('/webhooks/waba', wabaRoutes);

// Health check (legacy)
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    services: {
      telegram: 'automotive-telegram-agent',
      whatsapp: 'wa-response-webhook',
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
