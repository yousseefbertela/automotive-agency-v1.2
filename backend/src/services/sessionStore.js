'use strict';

/**
 * Session persistence wrapper for web chat.
 * Uses session_id as chat_id; ensures web sessions exist with default tenant/user.
 */
const { v4: uuidv4 } = require('uuid');
const stateRepo = require('../db/state.repo');
const logger = require('../utils/logger');

function getWebIds() {
  return {
    tenantId: process.env.WEB_DEFAULT_TENANT_ID || '',
    userId: process.env.WEB_DEFAULT_USER_ID || '',
  };
}

/**
 * Ensure a session exists for the given session_id (web chat).
 * If no session and no User exists, create one using WEB_DEFAULT_TENANT_ID / WEB_DEFAULT_USER_ID.
 * Returns session_id (same as input or generated).
 */
async function ensureWebSession(sessionId, correlationId) {
  const log = logger.child(correlationId);
  const id = sessionId && String(sessionId).trim() ? String(sessionId).trim() : uuidv4();

  const existing = await stateRepo.getSession(id, correlationId);
  if (existing) {
    return id;
  }

  const user = await stateRepo.queryUserByChatId(id, correlationId);
  if (user) {
    return id;
  }

  const { tenantId, userId } = getWebIds();
  if (!tenantId || !userId) {
    log.warn('sessionStore: WEB_DEFAULT_TENANT_ID or WEB_DEFAULT_USER_ID not set; web sessions will be blocked until seed run');
    return id;
  }

  try {
    await stateRepo.upsertSession(id, {
      tenant_id: tenantId,
      user_id: userId,
    }, correlationId);
    log.info('sessionStore: created web session', { session_id: id });
  } catch (err) {
    log.warn('sessionStore: failed to create web session', { error: err.message });
  }
  return id;
}

/**
 * Get state for web chat. Uses ensureWebSession then getState.
 */
async function getStateForWeb(sessionId, correlationId) {
  const id = await ensureWebSession(sessionId, correlationId);
  const state = await stateRepo.getState(id, correlationId);
  return { state, session_id: id };
}

module.exports = { ensureWebSession, getStateForWeb };
