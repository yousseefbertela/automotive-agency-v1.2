'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const stateRepo = require('../db/state.repo');
const { classifyWithFallback } = require('../services/agentService');
const { getPendingAction, clearPendingAction, PENDING_ACTIONS } = require('../services/stateMachine');
const { handleResume } = require('./resumeHandlers');
const { routeScenario, normalizeVin } = require('./router');
const { handleVin } = require('../domain/vin.flow');
const { handlePart } = require('../domain/part.flow');
const { handleKit } = require('../domain/kit.flow');
const { handleFinalize } = require('../domain/finalize.flow');
const trace = require('../services/trace.service');

/* ─── Greeting detection ─────────────────────────────────────────────────── */
const GREETING_REGEX = /^(hi|hello|hey|مرحبا|مرحبً|مرحبًا|السلام عليكم|اهلا|أهلا|اهلاً|هلو|صباح الخير|مساء الخير|كيف حالك|ازيك|ازيكم|هاي|سلام|الو|ألو|مرحب|ياسلام|يسلام|هاللو|ياهلا)(\s.*)?$/iu;

const WELCOME_MESSAGE = `أهلاً! أنا مساعدك الذكي لقطع غيار السيارات. 🚗\nHello! I'm your AI automotive parts assistant.\n\nابعتلي رقم الـ VIN عشان نبدأ عرض السعر.\nSend me the VIN number to start a quote.`;

async function processUserMessage(chatId, userMessage, correlationId, sender) {
  const corrId = correlationId || uuidv4();
  const log = logger.child(corrId);

  const noop = { sendMessage: () => Promise.resolve(), sendPhotoBuffer: () => Promise.resolve() };
  const s = sender || noop;

  // Fetch state first so we have tenantId for the TraceRun
  const state = await stateRepo.getState(chatId, corrId);

  // Start trace run — sessionId === chatId for web users
  const ctx = await trace.startRun(chatId, chatId, state?.tenant_id || null, corrId);

  return trace.bindRun(ctx, async () => {
    // `finalized` flag ensures endRun() is called exactly once
    let finalized = false;

    const finalizeRun = async (status) => {
      if (finalized) return;
      finalized = true;
      await trace.endRun(status);
    };

    try {
      if (state._blocked) {
        log.warn('processUserMessage: user blocked', { reason: state.reason });
        await s.sendMessage('Your Device is not registered. Please contact your administrator.');
        await finalizeRun('SUCCESS');
        return;
      }

      if (userMessage === null || userMessage === undefined ||
          (typeof userMessage === 'string' && !userMessage.trim())) {
        await s.sendMessage('من فضلك ابعت نص أو صورة.');
        await finalizeRun('SUCCESS');
        return;
      }

      const userText = typeof userMessage === 'string' ? userMessage.trim() : userMessage;

      const pending = await getPendingAction(chatId, corrId);
      if (pending) {
        // ── Kit escape hatch ────────────────────────────────────────────────────
        // If the user is stuck in CONFIRM_KIT or AWAIT_KIT_CLARIFICATION but sends
        // something clearly not kit-related (not "نعم/لا/yes/no/طقم/kit"), escape
        // the kit loop and re-process the message as a fresh request.
        const KIT_STATES = [PENDING_ACTIONS.CONFIRM_KIT, PENDING_ACTIONS.AWAIT_KIT_CLARIFICATION];
        const msgStr = typeof userText === 'string' ? userText.trim() : '';
        const isKitOrYesNo = /نعم|لا|yes|\bno\b|طقم|\bkit\b/i.test(msgStr);
        if (KIT_STATES.includes(pending.action) && !isKitOrYesNo) {
          log.info('processUserMessage: kit pending escape — re-routing as fresh message', {
            action: pending.action, msg: msgStr.slice(0, 60),
          });
          await clearPendingAction(chatId, corrId);
          // Fall through to greeting / VIN / kit-predetect / AI classification below
        } else {
          log.info('processUserMessage: resuming pending action', { action: pending.action });
          await trace.step('resume_pending_action', async () => {
            await handleResume(chatId, pending.action, pending.payload, userText, state, s, corrId);
          }, { domain: 'state', input: { action: pending.action, chatId }, replaySafe: false });
          await stateRepo.saveState(chatId, {
            history: [
              ...(state.history || []).slice(-18),
              { role: 'user', content: typeof userText === 'string' ? userText : JSON.stringify(userText) },
              { role: 'system', content: `resumed: ${pending.action}` },
            ],
          }, corrId).catch(() => {});
          await finalizeRun('SUCCESS');
          return;
        }
      }

      const textForAI = typeof userText === 'string' ? userText : JSON.stringify(userText);

      // ── Greeting short-circuit ────────────────────────────────────────────────
      if (typeof textForAI === 'string' && GREETING_REGEX.test(textForAI.trim())) {
        log.info('processUserMessage: greeting detected');
        await s.sendMessage(WELCOME_MESSAGE);
        await finalizeRun('SUCCESS');
        return;
      }

      // ── Standalone VIN pre-detection (bypass AI for 7/17-char inputs) ─────────
      // If the entire message (stripped of whitespace/punctuation) is exactly 7 or 17
      // chars, try to normalise it as a VIN before calling the LLM.
      if (typeof textForAI === 'string') {
        const strippedInput = textForAI.trim().replace(/[\W_]/g, '');
        if (strippedInput.length === 7 || strippedInput.length === 17) {
          const vinCandidate = normalizeVin(textForAI);
          if (vinCandidate) {
            log.info('processUserMessage: standalone VIN detected, routing direct', { vinCandidate });
            await handleVin(chatId, { scenario: 'vin', vin: vinCandidate, part_name: [], human_text: '' }, state, corrId, s);
            await stateRepo.saveState(chatId, {
              history: [
                ...(state.history || []).slice(-18),
                { role: 'user', content: textForAI },
                { role: 'system', content: `vin_direct: ${vinCandidate}` },
              ],
            }, corrId).catch(() => {});
            await finalizeRun('SUCCESS');
            return;
          }
        }
      }

      // ── Kit pre-detection (mirrors VIN pre-detection above) ──────────────────
      // "طقم" (Arabic) or "kit" (English whole-word) triggers kit flow directly,
      // bypassing the LLM classifier which doesn't reliably enforce the kit rule.
      if (typeof textForAI === 'string' && /طقم|\bkit\b/i.test(textForAI)) {
        log.info('processUserMessage: kit keyword detected, routing direct', { kitText: textForAI.slice(0, 100) });
        await trace.step('kit_predetect', async () => {
          await handleKit(
            chatId,
            { scenario: 'kit', vin: '', part_name: [textForAI], human_text: '' },
            state, corrId, s
          );
        }, { domain: 'routing', input: { kitText: textForAI.slice(0, 200) }, replaySafe: false });
        await stateRepo.saveState(chatId, {
          history: [
            ...(state.history || []).slice(-18),
            { role: 'user', content: textForAI },
            { role: 'system', content: `kit_predetect: ${textForAI.slice(0, 100)}` },
          ],
        }, corrId).catch(() => {});
        await finalizeRun('SUCCESS');
        return;
      }

      log.info('processUserMessage: calling AI agent');
      const { items: aiItems, fallbackReply } = await classifyWithFallback(
        textForAI,
        state.history || [],
        corrId
      );

      if (fallbackReply) {
        await s.sendMessage(fallbackReply);
        await finalizeRun('SUCCESS');
        return;
      }
      if (!aiItems || !aiItems.length) {
        await s.sendMessage('مش فاهم الرسالة. حاول تكتبها بشكل أوضح.');
        await finalizeRun('SUCCESS');
        return;
      }

      for (const item of aiItems) {
        if (item.human_text) await s.sendMessage(item.human_text);
        const scenario = routeScenario(item);
        log.info('processUserMessage: routing', { scenario, vin: item.vin, partNames: item.part_name });

        switch (scenario) {
          case 'vin':      await handleVin(chatId, item, state, corrId, s); break;
          case 'part':     await handlePart(chatId, item, state, corrId, s); break;
          case 'kit':      await handleKit(chatId, item, state, corrId, s); break;
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
      await finalizeRun('SUCCESS');
    } catch (err) {
      await trace.captureError('processMessage_error', err, { domain: 'general' });
      await finalizeRun('ERROR');
      throw err;
    }
  });
}

module.exports = { processUserMessage };
