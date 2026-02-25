'use strict';

require('dotenv').config();

// Use public DB URL when set (for local dev; railway.internal is only reachable on Railway)
if (process.env.DATABASE_URL_PUBLIC) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PUBLIC;
}

const logger = require('./utils/logger');
const { ensureWebUser } = require('./ensureWebUser');

const PORT = parseInt(process.env.PORT, 10) || 4000;

async function start() {
  if (!process.env.WEB_DEFAULT_USER_ID && process.env.DATABASE_URL) {
    await ensureWebUser();
  }
  const app = require('./app');
  return new Promise((resolve) => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Unified automotive workflows server started on port ${PORT}`, {
        env: process.env.NODE_ENV || 'development',
        node: process.version,
      });

      const configured = [];
      const missing = [];
      const check = (name) => (process.env[name] ? configured.push(name) : missing.push(name));
      check('OPENAI_API_KEY');
      check('OCR_SPACE_API_KEY');
      check('SCRAPER_BASE_URL');
      check('WHATSAPP_ACCESS_TOKEN');
      check('META_WEBHOOK_VERIFY_TOKEN');
      check('DATABASE_URL');

      logger.info('Configuration status', {
        configured: configured.map((c) => c.replace(/KEY|TOKEN|PASSWORD|SECRET/g, '***')),
        missing,
      });
      if (missing.length) {
        logger.warn(`Missing ${missing.length} env var(s) — some features will use fallbacks`);
      }
      logger.info('Available endpoints', {
        whatsapp: 'POST /webhooks/waba',
        health: 'GET /health',
        apiHealth: 'GET /api/health',
        chatMessage: 'POST /api/chat/message',
        chatPhoto: 'POST /api/chat/photo',
        chatEvents: 'GET /api/chat/events',
        submitForm: 'POST /api/chat/submit-form',
      });
      resolve(server);
    });
  });
}

let server;
start()
  .then((s) => { server = s; })
  .catch((err) => {
    logger.error('Startup failed', { error: err.message, stack: err.stack });
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  if (server) server.close(() => { logger.info('Server closed'); process.exit(0); });
  else process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  if (server) server.close(() => { logger.info('Server closed'); process.exit(0); });
  else process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  // Don't exit — the server should stay up
});
