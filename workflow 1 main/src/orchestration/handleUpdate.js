'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const stateRepo = require('../db/state.repo');
const telegram = require('../integrations/telegram.client');
const ocr = require('../ocr/ocrspace.client');
const ai = require('../ai/agent');
const { routeScenario } = require('./router');
const { handleVin } = require('../domain/vin.flow');
const { handlePart } = require('../domain/part.flow');
const { handleKit } = require('../domain/kit.flow');
const { handleFinalize } = require('../domain/finalize.flow');

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
    // ── Step 1: Load / initialize state ──
    const state = await stateRepo.getState(chatId, correlationId);

    if (state._blocked) {
      log.warn('handleUpdate: user blocked', { reason: state.reason });
      await telegram.sendMessage(
        chatId,
        'Your Device is not registered Please Contact your administrator'
      );
      return;
    }

    // ── Step 2: Determine user message (photo OCR or plain text) ──
    let userMessage = '';

    if (message.photo && message.photo.length > 0) {
      // Photo path: download → OCR → text
      const fileId = message.photo[message.photo.length - 1].file_id; // highest resolution
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

    if (!userMessage.trim()) {
      await telegram.sendMessage(chatId, 'من فضلك ابعت نص أو صورة.');
      return;
    }

    // ── Step 3: AI Agent — classify message ──
    log.info('handleUpdate: calling AI agent');
    let aiItems;
    try {
      aiItems = await ai.classifyMessage(userMessage, state.history || [], correlationId);
    } catch (err) {
      log.error('handleUpdate: AI agent failed', { error: err.message });
      await telegram.sendMessage(chatId, 'حصل مشكلة في تحليل رسالتك. حاول تاني.');
      return;
    }

    if (!aiItems || !aiItems.length) {
      await telegram.sendMessage(chatId, 'مش فاهم الرسالة. حاول تكتبها بشكل أوضح.');
      return;
    }

    // ── Step 4: Process each AI output item ──
    for (const item of aiItems) {
      // Send human_text to user (matches "Send a text message4" node)
      if (item.human_text) {
        await telegram.sendMessage(chatId, item.human_text);
      }

      // Route to appropriate flow
      const scenario = routeScenario(item);
      log.info('handleUpdate: routing', { scenario, vin: item.vin, partNames: item.part_name });

      switch (scenario) {
        case 'vin':
          await handleVin(chatId, item, state, correlationId);
          break;
        case 'part':
          await handlePart(chatId, item, state, correlationId);
          break;
        case 'kit':
          await handleKit(chatId, item, state, correlationId);
          break;
        case 'finalize':
          await handleFinalize(chatId, item, state, correlationId);
          break;
        case 'unrecognized':
        default:
          // For unrecognized, the human_text already sent above should contain
          // the clarification message. No additional action needed.
          log.info('handleUpdate: unrecognized scenario, human_text sent');
          break;
      }
    }

    // ── Step 5: Update conversation history ──
    const updatedHistory = [
      ...(state.history || []).slice(-20),
      { role: 'user', content: userMessage },
      {
        role: 'assistant',
        content: JSON.stringify(aiItems),
      },
    ];

    await stateRepo.saveState(chatId, { history: updatedHistory }, correlationId);
    log.info('handleUpdate: complete');
  } catch (err) {
    log.error('handleUpdate: unhandled error', {
      error: err.message,
      stack: err.stack,
    });
    // Always try to reply to the user
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
