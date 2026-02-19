'use strict';

const { getPrisma } = require('../services/prisma.service');
const logger = require('../utils/logger');

function normalizeChatId(chatId) {
  return chatId == null ? '' : String(chatId);
}

/**
 * Get session by chat_id. Returns same shape as Firestore: { _id, ...data }.
 */
async function getSession(chatId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('state.getSession', { chatId });
  const prisma = getPrisma();
  const chatIdStr = normalizeChatId(chatId);
  const session = await prisma.session.findUnique({
    where: { chat_id: chatIdStr },
  });
  if (!session) {
    log.debug('state.getSession: not found', { chatId: chatIdStr });
    return null;
  }
  return { _id: session.chat_id, ...session };
}

/**
 * Upsert session by chat_id. Merges data (partial updates supported).
 */
async function upsertSession(chatId, data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('state.upsertSession', { chatId });
  const prisma = getPrisma();
  const chatIdStr = normalizeChatId(chatId);
  const existing = await prisma.session.findUnique({ where: { chat_id: chatIdStr } });
  if (existing) {
    const updateData = {};
    if (data.tenant_id != null) updateData.tenant_id = data.tenant_id;
    if (data.user_id != null) updateData.user_id = data.user_id;
    if (data.vin !== undefined) updateData.vin = data.vin;
    if (data.vehicle_info !== undefined) updateData.vehicle_info = data.vehicle_info;
    if (data.quotation_id !== undefined) updateData.quotation_id = data.quotation_id;
    if (data.basket !== undefined) updateData.basket = data.basket;
    if (data.history !== undefined) updateData.history = data.history;
    await prisma.session.update({
      where: { chat_id: chatIdStr },
      data: updateData,
    });
  } else {
    const tenantId = data.tenant_id ?? null;
    const userId = data.user_id ?? null;
    if (tenantId == null || userId == null) {
      log.warn('state.upsertSession: missing tenant_id or user_id for new session');
    }
    await prisma.session.create({
      data: {
        chat_id: chatIdStr,
        tenant_id: tenantId,
        user_id: userId,
        vin: data.vin ?? null,
        vehicle_info: data.vehicle_info ?? null,
        quotation_id: data.quotation_id ?? null,
        basket: data.basket ?? null,
        history: data.history ?? null,
      },
    });
  }
}

/**
 * Find user by chat_id. Returns same shape as Firestore: { _id, chatID, tenantID }.
 */
async function queryUserByChatId(chatId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('state.queryUserByChatId', { chatId });
  const prisma = getPrisma();
  const chatIdStr = normalizeChatId(chatId);
  const user = await prisma.user.findUnique({
    where: { chat_id: chatIdStr },
  });
  if (!user) return null;
  return { _id: user.id, chatID: user.chat_id, tenantID: user.tenant_id };
}

/**
 * Get tenant by id. Returns { _id, ...data }.
 */
async function getTenant(tenantId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('state.getTenant', { tenantId });
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });
  if (!tenant) {
    log.debug('state.getTenant: not found', { tenantId });
    return null;
  }
  return { _id: tenant.id, ...tenant };
}

/**
 * Get or initialize session state for a chat_id.
 */
async function getState(chatId, correlationId) {
  const log = logger.child(correlationId);
  log.debug('state.getState', { chatId });

  const session = await getSession(chatId, correlationId);
  if (session && session._id) {
    log.debug('state: existing session found');
    return safeParse(session);
  }

  log.debug('state: no session, checking users collection');
  const user = await queryUserByChatId(chatId, correlationId);

  if (!user) {
    log.warn('state: user not registered', { chatId });
    return { _exists: false, _blocked: true, reason: 'not_registered' };
  }

  const tenant = await getTenant(user.tenantID, correlationId);
  if (!tenant || tenant.status !== 'active') {
    log.warn('state: tenant inactive', { chatId, tenantID: user.tenantID });
    return { _exists: false, _blocked: true, reason: 'tenant_inactive' };
  }

  const initialState = {
    chat_id: normalizeChatId(chatId),
    tenant_id: tenant._id,
    user_id: user._id,
  };

  await upsertSession(chatId, initialState, correlationId);
  log.info('state: created initial session', { chatId });

  return {
    _exists: true,
    _blocked: false,
    chat_id: normalizeChatId(chatId),
    tenant_id: tenant._id,
    user_id: user._id,
    vin: null,
    vehicle_info: null,
    quotation_id: null,
    basket: [],
    history: [],
  };
}

async function saveState(chatId, data, correlationId) {
  const log = logger.child(correlationId);
  log.debug('state.saveState', { chatId });
  await upsertSession(chatId, data, correlationId);
}

function safeParse(session) {
  const s = { ...session };
  s._exists = true;
  s._blocked = false;
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

module.exports = {
  getState,
  saveState,
  getSession,
  upsertSession,
  queryUserByChatId,
  getTenant,
};
