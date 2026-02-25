'use strict';

const express = require('express');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /webhook/telegram — DISABLED
 *
 * The Telegram agent channel has been replaced by the Frontend + SSE channel.
 * This route is kept alive so existing webhook registrations don't 404,
 * but all incoming updates are immediately acknowledged and dropped.
 */
router.post('/telegram', (req, res) => {
  logger.debug('telegram webhook: received but disabled');
  res.json({ status: 'disabled', message: 'Telegram channel migrated to Frontend/SSE' });
});

/**
 * GET /webhook/telegram — health check (still active)
 */
router.get('/telegram', (_req, res) => {
  res.json({ status: 'disabled', service: 'automotive-agent', channel: 'frontend-sse' });
});

module.exports = router;
