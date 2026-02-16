'use strict';

const whatsapp = require('../services/whatsapp.service');
const telegram = require('../services/telegram.service');
const logger = require('../utils/logger');

/**
 * Cancellation flow — "تعديل / إلغاء" button.
 *
 * Matches n8n Switch case 0:
 * 1. Send WhatsApp cancellation template to customer
 * 2. Notify Telegram user: "order has been cancelled by car owner"
 *
 * Note: Quote status was already updated to "cancelled" and then "closed"
 * in the shared pre-switch pipeline (see handleWebhook).
 *
 * @param {object} ctx - { recipientPhone, quote, tenantName, chatId, correlationId }
 */
async function run(ctx) {
  const { recipientPhone, quote, tenantName, chatId, correlationId } = ctx;
  const log = logger.child(correlationId);

  log.info('cancellation.flow: start', { quoteId: quote._id });

  // Step 1: Send WhatsApp cancellation template
  try {
    await whatsapp.sendCancellationTemplate(recipientPhone, quote, tenantName, correlationId);
  } catch (err) {
    log.error('cancellation.flow: WhatsApp send failed', { error: err.message });
    // Continue — still notify Telegram
  }

  // Step 2: Notify Telegram
  try {
    await telegram.sendMessage(chatId, 'order has been cancelled by car owner', correlationId);
  } catch (err) {
    log.error('cancellation.flow: Telegram send failed', { error: err.message });
  }

  log.info('cancellation.flow: complete');
}

module.exports = { run };
