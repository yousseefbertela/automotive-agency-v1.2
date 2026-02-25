'use strict';

const { getPrisma } = require('../services/prisma.service');
const logger = require('../utils/logger');

const MAX_PAYLOAD_SIZE = 45000;

function trimPayload(payload) {
  if (payload === null || payload === undefined) return {};
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (str.length <= MAX_PAYLOAD_SIZE) return payload;
  return { _trimmed: true, originalLength: str.length, preview: str.slice(0, 1000) };
}

/**
 * Best-effort insert InboundEvent. Never throws; logs and returns on failure.
 */
async function logInboundEvent(options, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  try {
    const prisma = getPrisma();
    const payload = trimPayload(options.payload ?? {});
    await prisma.inboundEvent.create({
      data: {
        channel: options.channel,
        external_id: options.external_id ?? null,
        chat_id: options.chat_id ?? '',
        tenant_id: options.tenant_id ?? null,
        user_id: options.user_id ?? null,
        quote_id: options.quote_id ?? null,
        event_type: options.event_type ?? 'unknown',
        payload,
      },
    });
  } catch (err) {
    log.warn('inboundEvent: insert failed (best-effort)', { error: err.message });
  }
}

module.exports = { logInboundEvent };
