'use strict';

const express = require('express');
const logger = require('./utils/logger');
const telegramRoutes = require('./routes/telegram');

const app = express();

// ── Middleware ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  if (req.path !== '/health') {
    logger.debug('HTTP request', { method: req.method, path: req.path });
  }
  next();
});

// ── Routes ──
app.use('/webhook', telegramRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
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
