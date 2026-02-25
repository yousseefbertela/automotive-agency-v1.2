'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const stateRepo = require('../db/state.repo');
const { classifyWithFallback } = require('../services/agentService');
const { getPendingAction } = require('../services/stateMachine');
const { handleResume } = require('./resumeHandlers');
const { routeScenario } = require('./router');
const { handleVin } = require('../domain/vin.flow');
const { handlePart } = require('../domain/part.flow');
const { handleKit } = require('../domain/kit.flow');
const { handleFinalize } = require('../domain/finalize.flow');

async function processUserMessage(chatId, userMessage, correlationId, sender) {
  const corrId = correlationId || uuidv4();
  const log = logger.child(corrId);

  const noop = { sendMessage: () => Promise.resolve(), sendPhotoBuffer: () => Promise.resolve() };
  const s = sender || noop;

  const state = await stateRepo.getState(chatId, corrId);

  if (state._blocked) {
    log.warn('processUserMessage: user blocked', { reason: state.reason });
    await s.sendMessage('Your Device is not registered. Please contact your administrator.');
    return;
  }

  if (userMessage === null || userMessage === undefined ||
      (typeof userMessage === 'string' && !userMessage.trim())) {
    await s.sendMessage('من فضلك ابعت نص أو صورة.');
    return;
  }

  const userText = typeof userMessage === 'string' ? userMessage.trim() : userMessage;

  const pending = await getPendingAction(chatId, corrId);
  if (pending) {
    log.info('processUserMessage: resuming pending action', { action: pending.action });
    await handleResume(chatId, pending.action, pending.payload, userText, state, s, corrId);
    await stateRepo.saveState(chatId, {
      history: [
        ...(state.history || []).slice(-18),
        { role: 'user', content: typeof userText === 'string' ? userText : JSON.stringify(userText) },
        { role: 'system', content: `resumed: ${pending.action}` },
      ],
    }, corrId).catch(() => {});
    return;
  }

  const textForAI = typeof userText === 'string' ? userText : JSON.stringify(userText);
  log.info('processUserMessage: calling AI agent');
  const { items: aiItems, fallbackReply } = await classifyWithFallback(
    textForAI,
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
    if (item.human_text) await s.sendMessage(item.human_text);
    const scenario = routeScenario(item);
    log.info('processUserMessage: routing', { scenario, vin: item.vin, partNames: item.part_name });

    switch (scenario) {
      case 'vin':    await handleVin(chatId, item, state, corrId, s); break;
      case 'part':   await handlePart(chatId, item, state, corrId, s); break;
      case 'kit':    await handleKit(chatId, item, state, corrId, s); break;
      case 'finalize': await handleFinalize(chatId, item, state, corrId, s); break;
      default: log.info('processUserMessage: unrecognized scenario'); break;
    }
  }

  await stateRepo.saveState(chatId, {
    history: [
      ...(state.history || []).slice(-18),
      { role: 'user', content: textForAI },
      { role: 'assistant', content: JSON.stringify(aiItems) },
    ],
  }, corrId).catch(() => {});
  log.info('processUserMessage: complete');
}

module.exports = { processUserMessage };
