'use strict';

const sheets = require('../integrations/sheets.client');
const ai = require('../ai/agent');
const telegram = require('../services/telegram.service');
const logger = require('../utils/logger');
const { handlePart } = require('./part.flow');

/**
 * Kit flow — replicated from the n8n Kit branch.
 *
 * Steps:
 * 1. Load kits from Google Sheets
 * 2. Use LLM to match user input against kits
 * 3. If matched: show parts list for confirmation, then process each part via Part flow
 * 4. If not matched: ask user to clarify with suggestions
 */
async function handleKit(chatId, item, state, correlationId, sender) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: (t) => telegram.sendMessage(chatId, t), sendPhotoBuffer: () => Promise.resolve() };

  const kitText = (item.part_name && item.part_name[0]) || '';

  log.info('kit.flow: start', { chatId, kitText });

  if (!kitText) {
    await s.sendMessage('من فضلك حدد نوع الطقم المطلوب.');
    return;
  }

  // Step 1: Load kits from Google Sheets
  let kits = [];
  try {
    kits = await sheets.getAllKits(correlationId);
  } catch (err) {
    log.error('kit.flow: failed to load kits sheet', { error: err.message });
    await s.sendMessage('حصل مشكلة في تحميل بيانات الطقم. حاول تاني.');
    return;
  }

  if (!kits.length) {
    log.warn('kit.flow: kits sheet is empty');
    await s.sendMessage('مفيش بيانات طقم متاحة حالياً.');
    return;
  }

  // Step 2: LLM match kit
  const matchResult = await ai.matchKit(kitText, kits, correlationId);

  if (!matchResult.matched) {
    // Not matched — ask for clarification
    log.info('kit.flow: no match found, asking for clarification');
    const suggestions = matchResult.suggestions.length
      ? matchResult.suggestions.join(', ')
      : '';
    const clarifyMsg = matchResult.clarify_message ||
      `please clarify the type of kit you need.${suggestions ? ` might these be one of them: ${suggestions}` : ''}`;
    await s.sendMessage(clarifyMsg);
    return;
  }

  // Step 3: Matched — show parts list for confirmation
  const partsArray = matchResult.parts_array;
  log.info('kit.flow: matched kit', {
    kit_code: matchResult.kit_code,
    partsCount: partsArray.length,
  });

  if (!partsArray.length) {
    await s.sendMessage('الطقم موجود بس مفيش قطع مسجلة فيه.');
    return;
  }

  // Send confirmation message
  const partsListText = partsArray.join(', ');
  await s.sendMessage(
    `are these the parts for ${kitText}: ${partsListText}`
  );

  // In the n8n flow, this waits for user approval. In our code flow,
  // we auto-process each part through the Part flow since we can't do
  // Telegram send-and-wait in a single HTTP request context.
  // The user can reject individual parts during the Part flow.

  log.info('kit.flow: processing kit parts through part flow', { parts: partsArray });

  // Process each part through the Part flow
  for (const part of partsArray) {
    const syntheticItem = {
      scenario: 'part',
      vin: state.vin || '',
      part_name: [part],
      human_text: '',
    };
    try {
      await handlePart(chatId, syntheticItem, state, correlationId, s);
    } catch (err) {
      log.error('kit.flow: error processing kit part', { part, error: err.message });
    }
  }

  log.info('kit.flow: complete');
}

module.exports = { handleKit };
