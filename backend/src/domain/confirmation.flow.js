'use strict';

const odoo = require('../services/odoo.service');
const whatsapp = require('../services/whatsapp.service');
const { pushToTenant } = require('../services/sseNotifications');
const logger = require('../utils/logger');

/**
 * Confirmation flow — "تأكيد العمل" button (WhatsApp interactive reply).
 *
 * Matches n8n Switch case 1:
 *  1. Create sale.order.line in Odoo for each basket item
 *  2. Send WhatsApp confirmation template to customer
 *  3. SSE-notify the Frontend agent (replaces Telegram notification)
 *
 * @param {object} ctx - {
 *   recipientPhone, quote, basketItems, tenant, tenantName,
 *   chatId, correlationId, tenantId
 * }
 */
async function run(ctx) {
  const {
    recipientPhone,
    quote,
    basketItems,
    tenant,
    tenantName,
    chatId,
    correlationId,
    tenantId,
  } = ctx;
  const log = logger.child(correlationId);

  log.info('confirmation.flow: start', {
    quoteId: quote._id,
    basketCount: basketItems.length,
  });

  // Step 1: Create Odoo sale.order.line for each basket item
  const orderId = quote.quotation_id;
  if (!orderId) {
    log.warn('confirmation.flow: quote has no quotation_id — skipping Odoo lines');
  } else {
    for (const item of basketItems) {
      try {
        const chosenProductId = item.chosen_product_id || null;
        const products = Array.isArray(item.products) ? item.products : [];

        let chosenProduct = null;
        if (chosenProductId && products.length) {
          chosenProduct = products.find((p) => String(p.id) === String(chosenProductId));
        }
        if (!chosenProduct && products.length) {
          chosenProduct = products[0];
        }

        const name = chosenProduct?.name || item.part_number || 'Part';
        const priceUnit = chosenProduct?.standard_price || 0;
        const productId = chosenProduct?.id || chosenProductId || 12;

        await odoo.createOrderLine(
          {
            orderId: Number(orderId),
            productId: Number(productId),
            name,
            priceUnit: Number(priceUnit),
            qty: 1,
          },
          correlationId,
          tenant
        );
      } catch (err) {
        log.error('confirmation.flow: Odoo createOrderLine failed', {
          partNumber: item.part_number,
          error: err.message,
        });
        // Continue with next item
      }
    }
  }

  // Step 2: Calculate total cost from basket
  let totalCost = 0;
  for (const item of basketItems) {
    totalCost = item.total_cost || totalCost;
  }
  if (!totalCost) {
    for (const item of basketItems) {
      const products = Array.isArray(item.products) ? item.products : [];
      const chosen = products.find((p) => String(p.id) === String(item.chosen_product_id));
      totalCost += chosen?.standard_price || 0;
    }
  }

  // Step 3: Send WhatsApp confirmation template to customer
  try {
    await whatsapp.sendConfirmationTemplate(
      recipientPhone,
      quote,
      totalCost,
      tenantName,
      correlationId
    );
  } catch (err) {
    log.error('confirmation.flow: WhatsApp send failed', { error: err.message });
  }

  // Step 4: SSE-notify the Frontend agent (replaces Telegram)
  const tid = tenantId || tenant?.id || null;
  try {
    await pushToTenant(
      tid,
      'order_confirmed',
      {
        quote_id: quote._id,
        customer_chat_id: chatId,
        status: 'confirmed',
        total_cost: totalCost,
        customer_name: quote.customer_name,
        vin: quote.vin,
      },
      correlationId
    );
  } catch (err) {
    log.error('confirmation.flow: SSE push failed', { error: err.message });
  }

  log.info('confirmation.flow: complete', { quoteId: quote._id, totalCost });
}

module.exports = { run };
