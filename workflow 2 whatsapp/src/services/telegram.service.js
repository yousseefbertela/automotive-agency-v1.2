'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Send a text message to a Telegram chat.
 * Matches n8n: "Send a text message1" and "Send a text message2" nodes.
 */
async function sendMessage(chatId, text, correlationId) {
  const log = logger.child(correlationId);
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    log.warn('telegram.sendMessage: TELEGRAM_BOT_TOKEN not set — skipping');
    return { skipped: true };
  }

  log.info('telegram.sendMessage', { chatId, textPreview: text.slice(0, 80) });

  try {
    const res = await axios.post(
      `${BASE()}/sendMessage`,
      { chat_id: chatId, text },
      { timeout: 15000 }
    );
    return res.data;
  } catch (err) {
    log.error('telegram.sendMessage failed', {
      chatId,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}

module.exports = { sendMessage };
