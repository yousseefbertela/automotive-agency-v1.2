'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const stateRepo = require('../db/state.repo');
const telegram = require('../services/telegram.service');
const ocr = require('../services/ocr.service');
const { processUserMessage } = require('./processMessage');

/**
 * Main update handler — processes a single Telegram update.
 * Replicates the entire n8n flow from Telegram Trigger to response.
 */
async function handleUpdate(update) {
  const correlationId = uuidv4();
  const log = logger.child(correlationId);

  const message = update.message;
  if (!message) {
    log.debug('handleUpdate: no message in update, skipping');
    return;
  }

  const chatId = message.chat?.id;
  if (!chatId) {
    log.warn('handleUpdate: no chat.id in message');
    return;
  }

  log.info('handleUpdate: start', {
    chatId,
    from: message.from?.first_name,
    hasPhoto: Boolean(message.photo?.length),
    textPreview: (message.text || '').slice(0, 100),
  });

  try {
    const state = await stateRepo.getState(chatId, correlationId);

    if (state._blocked) {
      log.warn('handleUpdate: user blocked', { reason: state.reason });
      await telegram.sendMessage(
        chatId,
        'Your Device is not registered Please Contact your administrator'
      );
      return;
    }

    let userMessage = '';

    if (message.photo && message.photo.length > 0) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      log.info('handleUpdate: photo detected, downloading', { fileId });

      try {
        const imageBuffer = await telegram.downloadFile(fileId);
        userMessage = await ocr.extractText(imageBuffer, correlationId);
        log.info('handleUpdate: OCR text extracted', { textLength: userMessage.length });
      } catch (err) {
        log.error('handleUpdate: OCR failed', { error: err.message });
        await telegram.sendMessage(chatId, 'مش قادر أقرا الصورة. حاول تبعتها تاني أو اكتب النص.');
        return;
      }
    } else {
      userMessage = message.text || '';
    }

    await processUserMessage(chatId, userMessage, correlationId);
  } catch (err) {
    log.error('handleUpdate: unhandled error', {
      error: err.message,
      stack: err.stack,
    });
    try {
      await telegram.sendMessage(
        chatId,
        'عذراً، حصل مشكلة. حاول تاني بعد شوية.'
      );
    } catch (replyErr) {
      log.error('handleUpdate: failed to send error reply', { error: replyErr.message });
    }
  }
}

module.exports = { handleUpdate };
