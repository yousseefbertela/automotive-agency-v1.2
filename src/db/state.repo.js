'use strict';

const firestore = require('../services/firestore.service');
const logger = require('../utils/logger');

/**
 * Get or initialize session state for a chat_id.
 * Matches n8n flow: Query ChatID → State Exists? → Parse State / Create Initial State
 */
async function getState(chatId, correlationId) {
  const log = logger.child(correlationId);
  log.debug('state.getState', { chatId });

  const session = await firestore.getSession(chatId, correlationId);
  if (session && session._id) {
    log.debug('state: existing session found');
    return safeParse(session);
  }

  // No session — check if user exists in users collection
  log.debug('state: no session, checking users collection');
  const user = await firestore.queryUserByChatId(chatId, correlationId);

  if (!user) {
    log.warn('state: user not registered', { chatId });
    return { _exists: false, _blocked: true, reason: 'not_registered' };
  }

  // Check tenant
  const tenant = await firestore.getTenant(user.tenantID, correlationId);
  if (!tenant || tenant.status !== 'active') {
    log.warn('state: tenant inactive', { chatId, tenantID: user.tenantID });
    return { _exists: false, _blocked: true, reason: 'tenant_inactive' };
  }

  // Create initial state
  const initialState = {
    chat_id: String(chatId),
    tenant_id: tenant._id,
    user_id: user._id,
  };

  await firestore.upsertSession(chatId, initialState, correlationId);
  log.info('state: created initial session', { chatId });

  return {
    _exists: true,
    _blocked: false,
    chat_id: String(chatId),
    tenant_id: tenant._id,
    user_id: user._id,
    vin: null,
    vehicle_info: null,
    quotation_id: null,
    basket: [],
    history: [],
  };
}

/**
 * Save / update state for a chat_id.
 */
async function saveState(chatId, data, correlationId) {
  const log = logger.child(correlationId);
  log.debug('state.saveState', { chatId });
  await firestore.upsertSession(chatId, data, correlationId);
}

function safeParse(session) {
  const s = { ...session };
  s._exists = true;
  s._blocked = false;
  // Ensure fields exist with safe defaults
  s.chat_id = s.chat_id ?? s['Chat ID'] ?? null;
  s.vin = s.vin ?? null;
  s.vehicle_info = s.vehicle_info ?? null;
  s.quotation_id = s.quotation_id ?? null;
  s.basket = s.basket ?? [];
  s.history = s.history ?? [];
  s.tenant_id = s.tenant_id ?? null;
  s.user_id = s.user_id ?? null;
  return s;
}

module.exports = { getState, saveState };
