'use strict';

const express = require('express');
const { handleUpdate } = require('../orchestration/handleUpdate');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /webhook/telegram
 * Receives Telegram webhook updates.
 * Validates the secret_token header if TELEGRAM_WEBHOOK_SECRET is set.
 */
router.post('/telegram', async (req, res) => {
  // Validate webhook secret
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (headerSecret !== expectedSecret) {
      logger.warn('telegram webhook: invalid secret token');
      return res.sendStatus(403);
    }
  }

  // Respond 200 immediately to Telegram (avoid timeouts)
  res.sendStatus(200);

  // Process update asynchronously
  const update = req.body;
  if (!update) return;

  // Fire and forget — errors are caught inside handleUpdate
  handleUpdate(update).catch((err) => {
    logger.error('telegram webhook: unhandled error in handleUpdate', {
      error: err.message,
    });
  });
});

/**
 * GET /webhook/telegram — health check
 */
router.get('/telegram', (_req, res) => {
  res.json({ status: 'ok', service: 'automotive-telegram-agent' });
});

module.exports = router;
