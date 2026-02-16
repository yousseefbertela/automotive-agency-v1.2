'use strict';

const quotesRepo = require('../db/quotes.repo');
const telegram = require('../services/telegram.service');
const logger = require('../utils/logger');

/**
 * Finalize flow — replicated from the n8n Finalize branch.
 *
 * In the n8n workflow, the finalize branch connection is empty (no nodes connected).
 * However, based on the broader workflow, finalize should:
 * 1. Load basket items
 * 2. Generate a summary
 * 3. Send to Telegram
 *
 * The full finalize path (product choosing, WhatsApp, labor costs) happens
 * after the "Will Add More Items?" → No branch, which is a separate flow
 * triggered by user interaction. We implement the summary here.
 */
async function handleFinalize(chatId, item, state, correlationId) {
  const log = logger.child(correlationId);
  log.info('finalize.flow: start', { chatId });

  // Get latest open quotation
  const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId);
  if (!quote) {
    await telegram.sendMessage(chatId, 'مفيش عرض سعر مفتوح حالياً.');
    return;
  }

  // Get basket items
  const basketItems = await quotesRepo.getBasketItems(quote._id, correlationId);

  if (!basketItems.length) {
    await telegram.sendMessage(chatId, 'السلة فاضية. ابعت اسم القطعة اللي عايزها.');
    return;
  }

  // Build summary
  const seenPartNumbers = new Set();
  const lines = [];
  let index = 1;

  for (const item of basketItems) {
    const partNumber = item.part_number || '';
    if (!partNumber || seenPartNumbers.has(partNumber)) continue;
    seenPartNumbers.add(partNumber);

    const product = Array.isArray(item.products) && item.products[0]
      ? item.products[0]
      : {};

    const name = product.name || partNumber;
    const brand = Array.isArray(product.x_studio_product_brand)
      ? product.x_studio_product_brand[1] || ''
      : '';
    const price = product.standard_price || 'N/A';

    lines.push(`${index}) ${name} | ${brand} | ${price} EGP`);
    index++;
  }

  const basketText = lines.join('\n');
  const summaryMsg = [
    '🧾 ملخص عرض السعر:',
    `VIN: ${quote.vin || state.vin || 'N/A'}`,
    '',
    basketText,
    '',
    `إجمالي القطع: ${lines.length}`,
    '',
    'هل تريد إرسال العرض للعميل؟',
  ].join('\n');

  await telegram.sendMessage(chatId, summaryMsg);
  log.info('finalize.flow: summary sent', { itemCount: lines.length });
}

module.exports = { handleFinalize };
