'use strict';

const sheets = require('../integrations/sheets.client');
const ai = require('../ai/agent');
const quotesRepo = require('../db/quotes.repo');
const { setPendingAction, PENDING_ACTIONS } = require('../services/stateMachine');
const logger = require('../utils/logger');

/**
 * Kit flow — sets CONFIRM_KIT wait state instead of auto-proceeding.
 */
async function handleKit(chatId, item, state, correlationId, sender) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: () => Promise.resolve(), sendPhotoBuffer: () => Promise.resolve() };
  const kitText = (item.part_name && item.part_name[0]) || '';

  log.info('kit.flow: start', { chatId, kitText });

  if (!kitText) {
    await s.sendMessage('من فضلك حدد نوع الطقم المطلوب.');
    return;
  }

  const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId).catch(() => null);

  let kits = [];
  try { kits = await sheets.getAllKits(correlationId); } catch (err) {
    log.error('kit.flow: kits sheet failed', { error: err.message });
    await s.sendMessage('حصل مشكلة في تحميل بيانات الطقم. حاول تاني.');
    return;
  }

  if (!kits.length) {
    await s.sendMessage('مفيش بيانات طقم متاحة حالياً.');
    return;
  }

  const matchResult = await ai.matchKit(kitText, kits, correlationId);

  if (!matchResult.matched) {
    log.info('kit.flow: no match, setting AWAIT_KIT_CLARIFICATION');
    await setPendingAction(chatId, PENDING_ACTIONS.AWAIT_KIT_CLARIFICATION, {
      quote_id: quote?._id || null,
    }, 60, correlationId);
    const suggestions = matchResult.suggestions?.length ? matchResult.suggestions.join(', ') : '';
    const msg = matchResult.clarify_message ||
      `من فضلك وضح نوع الطقم المطلوب.${suggestions ? ` هل تقصد: ${suggestions}` : ''}`;
    await s.sendMessage(msg);
    return;
  }

  const partsArray = matchResult.parts_array || [];
  log.info('kit.flow: matched', { kit_code: matchResult.kit_code, partsCount: partsArray.length });

  if (!partsArray.length) {
    await s.sendMessage('الطقم موجود بس مفيش قطع مسجلة فيه.');
    return;
  }

  // Set CONFIRM_KIT wait
  await setPendingAction(chatId, PENDING_ACTIONS.CONFIRM_KIT, {
    kit_code: matchResult.kit_code,
    kit_name: kitText,
    parts_list: partsArray,
    quote_id: quote?._id || null,
  }, 60, correlationId);

  await s.sendMessage(
    `لقيت الطقم "${matchResult.kit_code}".\n\nالقطع:\n${partsArray.join('\n')}\n\nهل دي القطع المطلوبة؟ (نعم / لا)`
  );
  log.info('kit.flow: waiting for kit confirmation');
}

module.exports = { handleKit };
