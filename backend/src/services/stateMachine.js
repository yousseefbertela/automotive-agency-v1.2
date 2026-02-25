'use strict';

const { getPrisma } = require('./prisma.service');
const logger = require('../utils/logger');

/** All pending_action values */
const PENDING_ACTIONS = {
  CONFIRM_PART_MATCH:      'CONFIRM_PART_MATCH',
  CONFIRM_KIT:             'CONFIRM_KIT',
  AWAIT_KIT_CLARIFICATION: 'AWAIT_KIT_CLARIFICATION',
  COLLECT_CUSTOMER_DATA:   'COLLECT_CUSTOMER_DATA',
  CONFIRM_VIN_CHANGE:      'CONFIRM_VIN_CHANGE',
  ADD_MORE_ITEMS:          'ADD_MORE_ITEMS',
  AWAIT_NEXT_PART_NAME:    'AWAIT_NEXT_PART_NAME',
  CHOOSE_PRODUCT:          'CHOOSE_PRODUCT',
};

/**
 * Set a pending action on the session.
 * @param {string} chatId
 * @param {string} action - one of PENDING_ACTIONS
 * @param {object} payload - data needed when resuming
 * @param {number} ttlMinutes - 0 = no expiry
 */
async function setPendingAction(chatId, action, payload, ttlMinutes = 60, correlationId) {
  const log = logger.child(correlationId);
  const prisma = getPrisma();
  const expires_at = ttlMinutes > 0
    ? new Date(Date.now() + ttlMinutes * 60 * 1000)
    : null;
  try {
    await prisma.session.update({
      where: { chat_id: String(chatId) },
      data: {
        pending_action: action,
        pending_payload: payload,
        expires_at,
        last_step: action,
        updated_at: new Date(),
      },
    });
    log.info('stateMachine.setPendingAction', { chatId, action, expires_at });
  } catch (err) {
    log.warn('stateMachine.setPendingAction: failed to update session', { chatId, action, error: err.message });
  }
}

/**
 * Clear the pending action from the session.
 */
async function clearPendingAction(chatId, correlationId) {
  const log = logger.child(correlationId);
  const prisma = getPrisma();
  try {
    await prisma.session.update({
      where: { chat_id: String(chatId) },
      data: {
        pending_action: null,
        pending_payload: null,
        expires_at: null,
        updated_at: new Date(),
      },
    });
    log.info('stateMachine.clearPendingAction', { chatId });
  } catch (err) {
    log.warn('stateMachine.clearPendingAction: failed', { chatId, error: err.message });
  }
}

/**
 * Get the current pending action for a session.
 * Returns null if none or if expired.
 */
async function getPendingAction(chatId, correlationId) {
  const log = logger.child(correlationId);
  const prisma = getPrisma();
  try {
    const session = await prisma.session.findUnique({
      where: { chat_id: String(chatId) },
      select: { pending_action: true, pending_payload: true, expires_at: true },
    });
    if (!session || !session.pending_action) return null;
    if (session.expires_at && session.expires_at < new Date()) {
      log.warn('stateMachine.getPendingAction: expired', { chatId, action: session.pending_action });
      await clearPendingAction(chatId, correlationId);
      return null;
    }
    return {
      action: session.pending_action,
      payload: session.pending_payload || {},
    };
  } catch (err) {
    log.warn('stateMachine.getPendingAction: failed', { chatId, error: err.message });
    return null;
  }
}

/**
 * Check if a text message is a "yes" response.
 * Rules: message must be short (<= 25 chars) and match known Arabic/English yes variants.
 */
function acceptsYes(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length > 25) return false;
  const lower = t.toLowerCase();
  // Match the yes word at start, with optional trailing polite words / punctuation
  // e.g. "نعم شكراً" "ok thanks" "يلا بينا" are all yes
  const yesPatterns = [
    /^(yes|ok|okay|اوك|يلا|اه|نعم|ايوه|موافق|تمام|أيوه|آيوه|اوكي|ايوة|اِيوَه|ارسل|يرسل|ابعت|ابعث|اكمل|اعمل|بالظبط|صح|صحيح)(\s[\s\S]*)?$/i,
  ];
  return yesPatterns.some(p => p.test(lower));
}

/**
 * Check if a text message is a "no" response.
 * Rules: message must be short (<= 25 chars) and match known Arabic/English no variants.
 * "مش" alone is NOT treated as no.
 */
function acceptsNo(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length > 25) return false;
  const lower = t.toLowerCase();
  const noPatterns = [
    /^(no|لا|لأ|لاء|كلا|cancel|رفض|مش عايز|مش كده|مش صح|مش هو|مش هي|مش هتا|غلط|مش موافق|مش صحيح)$/i,
  ];
  return noPatterns.some(p => p.test(lower));
}

/**
 * Determine if the text is a clear yes or no.
 * Returns 'yes', 'no', or 'unclear'.
 */
function parseYesNo(text) {
  if (acceptsYes(text)) return 'yes';
  if (acceptsNo(text)) return 'no';
  return 'unclear';
}

module.exports = {
  PENDING_ACTIONS,
  setPendingAction,
  clearPendingAction,
  getPendingAction,
  acceptsYes,
  acceptsNo,
  parseYesNo,
};
