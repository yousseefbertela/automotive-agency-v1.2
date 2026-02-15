'use strict';

require('dotenv').config();

const app = require('./app');
const logger = require('./utils/logger');

const PORT = parseInt(process.env.PORT, 10) || 3001;

const server = app.listen(PORT, () => {
  logger.info(`WA Response webhook started on port ${PORT}`, {
    env: process.env.NODE_ENV || 'development',
    node: process.version,
  });

  const configured = [];
  const missing = [];
  const check = (name) => (process.env[name] ? configured.push(name) : missing.push(name));

  check('WHATSAPP_ACCESS_TOKEN');
  check('META_WEBHOOK_VERIFY_TOKEN');
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) configured.push('GOOGLE_SERVICE_ACCOUNT_JSON');
  else check('GOOGLE_APPLICATION_CREDENTIALS');
  check('FIRESTORE_PROJECT_ID');
  check('ODOO_URL');
  check('TELEGRAM_BOT_TOKEN');

  logger.info('Configuration status', { configured, missing });
  if (missing.length) {
    logger.warn(`Missing ${missing.length} env var(s) — some features will use fallbacks`);
  }
});

process.on('SIGTERM', () => { logger.info('SIGTERM'); server.close(() => process.exit(0)); });
process.on('SIGINT', () => { logger.info('SIGINT'); server.close(() => process.exit(0)); });
process.on('unhandledRejection', (r) => logger.error('Unhandled rejection', { reason: String(r) }));
process.on('uncaughtException', (err) => logger.error('Uncaught exception', { error: err.message }));
