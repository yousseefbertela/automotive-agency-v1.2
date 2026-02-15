'use strict';

const express = require('express');
const logger = require('./utils/logger');
const wabaRoutes = require('./routes/waba');

const app = express();

// ── Capture raw body for Meta signature verification ──
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Request logging
app.use((req, _res, next) => {
  if (req.path !== '/health') {
    logger.debug('HTTP request', { method: req.method, path: req.path });
  }
  next();
});

// ── Routes ──
app.use('/webhooks/waba', wabaRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'wa-response-webhook', uptime: process.uptime() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled express error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
