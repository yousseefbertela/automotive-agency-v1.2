'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const sessionStore = require('./sessionStore');
const ocr = require('./ocr.service');
const { processUserMessage } = require('../workflows/processMessage');

/**
 * Orchestrates message/photo -> reply for the web API.
 * Uses session_id as chat_id; collects all reply segments into a single string.
 */
async function sendMessage(sessionId, message, correlationId) {
  const corrId = correlationId || uuidv4();
  const log = logger.child(corrId);

  const { state, session_id } = await sessionStore.getStateForWeb(sessionId, corrId);
  if (state._blocked) {
    return {
      session_id,
      reply: 'Your device is not registered. Please contact your administrator.',
      meta: { blocked: true, reason: state.reason },
    };
  }

  const replies = [];
  const sender = {
    sendMessage: (text) => {
      replies.push(String(text));
      return Promise.resolve();
    },
    sendPhotoBuffer: () => Promise.resolve(),
  };

  try {
    await processUserMessage(session_id, message || '', corrId, sender);
  } catch (err) {
    log.error('chatService.sendMessage error', { error: err.message, stack: err.stack });
    replies.push('عذراً، حصل مشكلة. حاول تاني بعد شوية.');
  }

  const reply = replies.length ? replies.join('\n\n') : '';
  return { session_id, reply, meta: {} };
}

/**
 * Run OCR on image buffer, then treat OCR text as user message.
 */
async function sendPhoto(sessionId, imageBuffer, correlationId) {
  const corrId = correlationId || uuidv4();
  const log = logger.child(corrId);

  let ocrText = '';
  try {
    ocrText = await ocr.extractText(imageBuffer, corrId);
  } catch (err) {
    log.error('chatService.sendPhoto OCR failed', { error: err.message });
    const { session_id } = await sessionStore.getStateForWeb(sessionId, corrId);
    return {
      session_id,
      ocr_text: '',
      reply: 'مش قادر أقرا الصورة. حاول تبعتها تاني أو اكتب النص.',
      meta: { ocr_error: err.message },
    };
  }

  const result = await sendMessage(sessionId, ocrText, corrId);
  return {
    session_id: result.session_id,
    ocr_text: ocrText,
    reply: result.reply,
    meta: result.meta,
  };
}

module.exports = { sendMessage, sendPhoto };
