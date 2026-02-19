'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { handleUpdate } = require('../workflows/handleUpdate');
const logger = require('../utils/logger');
const { logInboundEvent } = require('../db/inboundEvent.repo');

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

  const update = req.body;
  if (!update) return;

  const correlationId = uuidv4();
  try {
    const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? '';
    const eventType = update.message?.photo ? 'photo' : update.message?.text ? 'text' : update.callback_query ? 'callback_query' : 'unknown';
    logInboundEvent(
      {
        channel: 'TELEGRAM',
        external_id: String(update.update_id ?? ''),
        chat_id: chatId ? String(chatId) : '',
        event_type: eventType,
        payload: update,
      },
      correlationId
    ).catch(() => {});
  } catch (_) {}

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
