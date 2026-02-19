'use strict';

const odoo = require('../services/odoo.service');
const whatsapp = require('../services/whatsapp.service');
const telegram = require('../services/telegram.service');
const logger = require('../utils/logger');

/**
 * Confirmation flow — "تأكيد العمل" button.
 *
 * Matches n8n Switch case 1:
 * 1. Create sale.order.line in Odoo for each basket item
 * 2. Send WhatsApp confirmation template to customer
 * 3. Notify Telegram user: "order has been confirmed by car owner"
 *
 * @param {object} ctx - { recipientPhone, quote, basketItems, tenantName, chatId, correlationId }
 */
async function run(ctx) {
  const { recipientPhone, quote, basketItems, tenant, tenantName, chatId, correlationId } = ctx;
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
        // Determine product info from basket item
        const chosenProductId = item.chosen_product_id || null;
        const products = Array.isArray(item.products) ? item.products : [];

        // Find the chosen product in the products array
        let chosenProduct = null;
        if (chosenProductId && products.length) {
          chosenProduct = products.find((p) => String(p.id) === String(chosenProductId));
        }
        if (!chosenProduct && products.length) {
          chosenProduct = products[0]; // fallback to first product
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
    totalCost = item.total_cost || totalCost; // use last available total_cost
  }
  if (!totalCost) {
    // Fallback: sum standard_price from chosen products
    for (const item of basketItems) {
      const products = Array.isArray(item.products) ? item.products : [];
      const chosen = products.find((p) => String(p.id) === String(item.chosen_product_id));
      totalCost += chosen?.standard_price || 0;
    }
  }

  // Step 3: Send WhatsApp confirmation template
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

  // Step 4: Notify Telegram
  try {
    await telegram.sendMessage(chatId, 'order has been confirmed by car owner', correlationId);
  } catch (err) {
    log.error('confirmation.flow: Telegram send failed', { error: err.message });
  }

  log.info('confirmation.flow: complete');
}

module.exports = { run };
