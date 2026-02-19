'use strict';

require('dotenv').config();

const app = require('./app');
const logger = require('./utils/logger');

const PORT = parseInt(process.env.PORT, 10) || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Unified automotive workflows server started on port ${PORT}`, {
    env: process.env.NODE_ENV || 'development',
    node: process.version,
  });

  // Log configuration status
  const configured = [];
  const missing = [];
  const check = (name) => (process.env[name] ? configured.push(name) : missing.push(name));

  // Telegram workflow
  check('TELEGRAM_BOT_TOKEN');
  check('OPENAI_API_KEY');
  check('OCR_SPACE_API_KEY');
  check('SCRAPER_BASE_URL');

  // WhatsApp workflow
  check('WHATSAPP_ACCESS_TOKEN');
  check('META_WEBHOOK_VERIFY_TOKEN');

  // Shared
  check('DATABASE_URL');
  check('ODOO_URL');

  logger.info('Configuration status', {
    configured: configured.map((c) => c.replace(/KEY|TOKEN|PASSWORD|SECRET/g, '***')),
    missing,
  });

  if (missing.length) {
    logger.warn(`Missing ${missing.length} env var(s) — some features will use fallbacks`);
  }

  logger.info('Available endpoints', {
    telegram: 'POST /webhook/telegram',
    whatsapp: 'POST /webhooks/waba',
    health: 'GET /health',
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  // Don't exit — the server should stay up
});
