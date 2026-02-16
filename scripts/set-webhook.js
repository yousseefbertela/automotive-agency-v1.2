#!/usr/bin/env node
'use strict';

/**
 * Set Telegram webhook URL for the bot.
 * Run from project root: node scripts/set-webhook.js
 *
 * Reads from .env:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_WEBHOOK_SECRET
 *   WEBHOOK_BASE_URL  (e.g. https://abc123.ngrok.io or https://yourdomain.com)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = (process.env.WEBHOOK_BASE_URL || '').replace(/\/$/, '');

if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}
if (!base) {
  console.error('Missing WEBHOOK_BASE_URL in .env (e.g. https://abc123.ngrok.io)');
  process.exit(1);
}

const url = `${base}/webhook/telegram`;
const payload = { url };
if (secret) payload.secret_token = secret;

axios
  .post(`https://api.telegram.org/bot${token}/setWebhook`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  })
  .then((res) => {
    console.log('Webhook set:', url);
    console.log('Response:', JSON.stringify(res.data, null, 2));
    if (!res.data.ok) process.exit(1);
  })
  .catch((err) => {
    console.error('Failed:', err.response?.data || err.message);
    process.exit(1);
  });
