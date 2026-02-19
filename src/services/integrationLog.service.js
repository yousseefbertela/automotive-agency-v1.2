'use strict';

const { getPrisma } = require('./prisma.service');
const logger = require('../utils/logger');

/**
 * Best-effort log an integration call. Never throws; never breaks the main flow.
 */
async function logCall(options, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  try {
    const prisma = getPrisma();
    await prisma.integrationCall.create({
      data: {
        tenant_id: options.tenant_id ?? null,
        user_id: options.user_id ?? null,
        quote_id: options.quote_id ?? null,
        service: options.service,
        operation: options.operation ?? 'unknown',
        request_meta: options.request_meta ?? null,
        response_meta: options.response_meta ?? null,
        status: options.status,
        duration_ms: options.duration_ms ?? null,
      },
    });
  } catch (err) {
    log.warn('integrationLog: insert failed (best-effort)', { error: err.message });
  }
}

module.exports = { logCall };
