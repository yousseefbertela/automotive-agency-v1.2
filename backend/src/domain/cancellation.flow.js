'use strict';

const whatsapp = require('../services/whatsapp.service');
const { pushToTenant } = require('../services/sseNotifications');
const logger = require('../utils/logger');

/**
 * Cancellation flow — "تعديل / إلغاء" button (WhatsApp interactive reply).
 *
 * Matches n8n Switch case 0:
 *  1. Send WhatsApp cancellation template to customer
 *  2. SSE-notify the Frontend agent (replaces Telegram notification)
 *
 * Note: Quote status was already updated to "cancelled" then "closed"
 * in the shared pre-switch pipeline (waba.js handleWebhook).
 *
 * @param {object} ctx - {
 *   recipientPhone, quote, tenantName, chatId, correlationId, tenantId, tenant
 * }
 */
async function run(ctx) {
  const { recipientPhone, quote, tenantName, chatId, correlationId, tenantId, tenant } = ctx;
  const log = logger.child(correlationId);

  log.info('cancellation.flow: start', { quoteId: quote._id });

  // Step 1: Send WhatsApp cancellation template to customer
  try {
    await whatsapp.sendCancellationTemplate(recipientPhone, quote, tenantName, correlationId);
  } catch (err) {
    log.error('cancellation.flow: WhatsApp send failed', { error: err.message });
    // Continue — still notify agent
  }

  // Step 2: SSE-notify the Frontend agent (replaces Telegram)
  const tid = tenantId || tenant?.id || null;
  try {
    await pushToTenant(
      tid,
      'order_cancelled',
      {
        quote_id: quote._id,
        customer_chat_id: chatId,
        status: 'cancelled',
        customer_name: quote.customer_name,
        vin: quote.vin,
      },
      correlationId
    );
  } catch (err) {
    log.error('cancellation.flow: SSE push failed', { error: err.message });
  }

  log.info('cancellation.flow: complete', { quoteId: quote._id });
}

module.exports = { run };
