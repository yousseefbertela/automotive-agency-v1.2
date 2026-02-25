'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const stateRepo = require('../db/state.repo');
const telegram = require('../services/telegram.service');
const ocr = require('../services/ocr.service');
const { classifyWithFallback } = require('../services/agentService');
const { routeScenario } = require('./router');
const { handleVin } = require('../domain/vin.flow');
const { handlePart } = require('../domain/part.flow');
const { handleKit } = require('../domain/kit.flow');
const { handleFinalize } = require('../domain/finalize.flow');

/**
 * Process a user message and optionally photo (OCR text).
 * Uses sender for all replies (sendMessage(text), sendPhotoBuffer(buffer, caption)).
 * If sender is omitted, uses Telegram with the given chatId.
 */
async function processUserMessage(chatId, userMessage, correlationId, sender) {
  const corrId = correlationId || uuidv4();
  const log = logger.child(corrId);

  const defaultSender = {
    sendMessage: (text) => telegram.sendMessage(chatId, text),
    sendPhotoBuffer: (buffer, caption) => telegram.sendPhotoBuffer(chatId, buffer, caption),
  };
  const s = sender || defaultSender;

  const state = await stateRepo.getState(chatId, corrId);

  if (state._blocked) {
    log.warn('processUserMessage: user blocked', { reason: state.reason });
    await s.sendMessage('Your Device is not registered Please Contact your administrator');
    return;
  }

  if (!userMessage || !String(userMessage).trim()) {
    await s.sendMessage('من فضلك ابعت نص أو صورة.');
    return;
  }

  const userText = String(userMessage).trim();

  log.info('processUserMessage: calling AI agent');
  const { items: aiItems, fallbackReply } = await classifyWithFallback(
    userText,
    state.history || [],
    corrId
  );

  if (fallbackReply) {
    await s.sendMessage(fallbackReply);
    return;
  }
  if (!aiItems || !aiItems.length) {
    await s.sendMessage('مش فاهم الرسالة. حاول تكتبها بشكل أوضح.');
    return;
  }

  for (const item of aiItems) {
    if (item.human_text) {
      await s.sendMessage(item.human_text);
    }
    const scenario = routeScenario(item);
    log.info('processUserMessage: routing', { scenario, vin: item.vin, partNames: item.part_name });

    switch (scenario) {
      case 'vin':
        await handleVin(chatId, item, state, corrId, s);
        break;
      case 'part':
        await handlePart(chatId, item, state, corrId, s);
        break;
      case 'kit':
        await handleKit(chatId, item, state, corrId, s);
        break;
      case 'finalize':
        await handleFinalize(chatId, item, state, corrId, s);
        break;
      default:
        log.info('processUserMessage: unrecognized scenario');
        break;
    }
  }

  const updatedHistory = [
    ...(state.history || []).slice(-20),
    { role: 'user', content: userText },
    { role: 'assistant', content: JSON.stringify(aiItems) },
  ];
  await stateRepo.saveState(chatId, { history: updatedHistory }, corrId);
  log.info('processUserMessage: complete');
}

module.exports = { processUserMessage };
