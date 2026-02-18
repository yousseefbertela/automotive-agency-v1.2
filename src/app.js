'use strict';

const express = require('express');
const logger = require('./utils/logger');
const telegramRoutes = require('./routes/telegram');
const wabaRoutes = require('./routes/waba');

const app = express();

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
  if (req.path !== '/health') {
    logger.debug('HTTP request', { method: req.method, path: req.path });
  }
  next();
});

// ── Routes ──
// Root: simple response so "/" returns something (helps verify app is reachable on Railway)
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'PartPilot', endpoints: { health: 'GET /health', telegram: 'POST /webhook/telegram', whatsapp: 'POST /webhooks/waba' } });
});

// Telegram webhook
app.use('/webhook', telegramRoutes);

// WhatsApp Business API webhook
app.use('/webhooks/waba', wabaRoutes);

// Health check
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
