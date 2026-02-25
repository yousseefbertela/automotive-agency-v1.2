'use strict';

const { getPrisma } = require('../services/prisma.service');
const logger = require('../utils/logger');

/**
 * Get message by id (WhatsApp message id). Returns { _id, quoteId } for backward compat.
 */
async function getMessageDocument(messageId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('message.getMessageDocument', { messageId });
  const prisma = getPrisma();
  const row = await prisma.message.findUnique({
    where: { id: messageId },
  });
  if (!row) {
    log.debug('message.getMessageDocument: not found', { messageId });
    return null;
  }
  return { _id: row.id, quoteId: row.quote_id };
}

/**
 * Create or overwrite message document (e.g. when sending WhatsApp template with buttons).
 */
async function createMessage(messageId, data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('message.createMessage', { messageId });
  const prisma = getPrisma();
  await prisma.message.upsert({
    where: { id: messageId },
    create: {
      id: messageId,
      quote_id: data.quoteId ?? data.quote_id ?? '',
    },
    update: {
      quote_id: data.quoteId ?? data.quote_id ?? undefined,
    },
  });
}

module.exports = { getMessageDocument, createMessage };
