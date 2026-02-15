'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Send a text message to a chat.
 */
async function sendMessage(chatId, text, opts = {}) {
  try {
    const res = await axios.post(`${BASE()}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode || undefined,
      reply_markup: opts.replyMarkup || undefined,
    }, { timeout: 15000 });
    return res.data;
  } catch (err) {
    logger.error('telegram.sendMessage failed', {
      chatId,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}

/**
 * Send a photo (by URL or file_id) to a chat.
 */
async function sendPhoto(chatId, photo, opts = {}) {
  try {
    const res = await axios.post(`${BASE()}/sendPhoto`, {
      chat_id: chatId,
      photo,
      caption: opts.caption || undefined,
      parse_mode: opts.parseMode || undefined,
    }, { timeout: 30000 });
    return res.data;
  } catch (err) {
    logger.error('telegram.sendPhoto failed', {
      chatId,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}

/**
 * Send a photo from a buffer.
 */
async function sendPhotoBuffer(chatId, buffer, caption) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', buffer, { filename: 'diagram.png', contentType: 'image/png' });
  if (caption) form.append('caption', caption);

  try {
    const res = await axios.post(`${BASE()}/sendPhoto`, form, {
      headers: form.getHeaders(),
      timeout: 30000,
    });
    return res.data;
  } catch (err) {
    logger.error('telegram.sendPhotoBuffer failed', {
      chatId,
      error: err.response?.data || err.message,
    });
    throw err;
  }
}

/**
 * Download a file from Telegram by file_id.
 * Returns a Buffer.
 */
async function downloadFile(fileId) {
  // Step 1: getFile to get file_path
  const fileRes = await axios.post(`${BASE()}/getFile`, { file_id: fileId }, { timeout: 15000 });
  const filePath = fileRes.data?.result?.file_path;
  if (!filePath) throw new Error(`Could not get file_path for file_id=${fileId}`);

  // Step 2: download
  const downloadUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const dlRes = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(dlRes.data);
}

/**
 * Set the webhook URL for the bot.
 */
async function setWebhook(url, secret) {
  const payload = { url };
  if (secret) payload.secret_token = secret;
  const res = await axios.post(`${BASE()}/setWebhook`, payload, { timeout: 15000 });
  logger.info('telegram.setWebhook', { url, result: res.data });
  return res.data;
}

module.exports = { sendMessage, sendPhoto, sendPhotoBuffer, downloadFile, setWebhook };
