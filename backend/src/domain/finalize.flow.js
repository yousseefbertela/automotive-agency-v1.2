'use strict';

const quotesRepo = require('../db/quotes.repo');
const messageRepo = require('../db/message.repo');
const stateRepo = require('../db/state.repo');
const odoo = require('../services/odoo.service');
const whatsapp = require('../services/whatsapp.service');
const { setPendingAction, clearPendingAction, PENDING_ACTIONS } = require('../services/stateMachine');
const { pushToTenant } = require('../services/sseNotifications');
const logger = require('../utils/logger');
const trace = require('../services/trace.service');

/**
 * Finalize flow — triggered when user says NO to "add more items".
 *
 * n8n parity:
 *  1. Load basket, de-duplicate by part_number
 *  2. Search Odoo products for each part (searchProduct)
 *  3. Build CHOOSE_PRODUCT structured form (select per part + labor_cost)
 *  4. Set CHOOSE_PRODUCT pending action
 *  5. Send form JSON to agent (Frontend only, NOT WhatsApp)
 *
 * After form submission (POST /api/chat/submit-form → handleChooseProductSubmit):
 *  6. Update basket items with chosen product IDs + prices
 *  7. Send WA quote request template (car_quot_request|ar_EG) to customer
 *  8. Create Message doc (WA message id → quoteId)
 *  9. SSE notify agent (quote_sent event)
 * 10. Send summary to agent
 */
async function handleFinalize(chatId, item, state, correlationId, sender) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: () => Promise.resolve(), sendPhotoBuffer: () => Promise.resolve() };

  log.info('finalize.flow: start', { chatId });

  const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId);
  if (!quote) {
    await s.sendMessage('مفيش عرض سعر مفتوح حالياً.');
    return;
  }

  const basketItems = await trace.step('finalize_basket_load', async () =>
    quotesRepo.getBasketItems(quote._id, correlationId),
    { domain: 'general', input: { quote_id: String(quote._id) }, replaySafe: true }
  );

  if (!basketItems.length) {
    await s.sendMessage('السلة فاضية. ابعت اسم القطعة اللي عايزها.');
    return;
  }

  // De-duplicate by part_number
  const seenParts = new Set();
  const uniqueItems = [];
  for (const bi of basketItems) {
    const pn = bi.part_number || '';
    if (!pn || seenParts.has(pn)) continue;
    seenParts.add(pn);
    uniqueItems.push(bi);
  }

  if (!uniqueItems.length) {
    await s.sendMessage('السلة فاضية. ابعت اسم القطعة اللي عايزها.');
    return;
  }

  const tenant = state.tenant_id
    ? await stateRepo.getTenant(state.tenant_id, correlationId).catch(() => null)
    : null;

  // Search Odoo products for each part and build form fields
  const formFields = [];
  const basketMeta = [];

  for (let i = 0; i < uniqueItems.length; i++) {
    const bi = uniqueItems[i];
    let products = [];
    try {
      products = await odoo.searchProduct(bi.part_number, correlationId, tenant) || [];
    } catch (err) {
      log.warn('finalize.flow: searchProduct failed', { part_number: bi.part_number, error: err.message });
    }

    const options = products.map((p) => ({
      value: p.id,
      label: `${p.name || bi.part_number} | ${p.standard_price ?? 'N/A'} EGP`,
    }));

    if (!options.length) {
      options.push({ value: 0, label: `${bi.part_number} (غير متوفر في النظام)` });
    }

    formFields.push({
      name: `item_${i}_product`,
      label: `اختر المنتج لـ: ${bi.part_number}`,
      type: 'select',
      options,
      required: true,
    });

    basketMeta.push({
      index: i,
      basket_item_id: bi._id,
      part_number: bi.part_number,
      products,
    });
  }

  formFields.push({
    name: 'labor_cost',
    label: 'تكلفة العمالة (EGP)',
    type: 'number',
    required: true,
  });

  // Set CHOOSE_PRODUCT pending action
  await setPendingAction(chatId, PENDING_ACTIONS.CHOOSE_PRODUCT, {
    quote_id: quote._id,
    basket_meta: basketMeta,
    tenant_id: state.tenant_id,
  }, 60, correlationId);

  // Send structured form to Frontend agent
  await s.sendMessage(JSON.stringify({
    type: 'form',
    action: 'CHOOSE_PRODUCT',
    message: 'اختر المنتج المناسب لكل قطعة وأدخل تكلفة العمالة:',
    fields: formFields,
    submit_to: '/api/chat/submit-form',
  }));

  log.info('finalize.flow: CHOOSE_PRODUCT form sent', { partCount: uniqueItems.length });
}

/**
 * Called from POST /api/chat/submit-form when action === CHOOSE_PRODUCT.
 * Completes the finalize pipeline: update basket → WA template → Message doc → SSE notify.
 *
 * @param {string} chatId
 * @param {object} formData   - { item_0_product, item_1_product, ..., labor_cost }
 * @param {object} payload    - pending_action payload { quote_id, basket_meta, tenant_id }
 * @param {string} correlationId
 * @param {object} sender     - { sendMessage }
 */
async function handleChooseProductSubmit(chatId, formData, payload, correlationId, sender) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: () => Promise.resolve() };
  const { quote_id, basket_meta, tenant_id } = payload;

  log.info('finalize.flow.handleChooseProductSubmit', { quote_id });

  const quote = await quotesRepo.getQuote(quote_id, correlationId);
  if (!quote) {
    await s.sendMessage('مفيش عرض سعر. حاول تاني.');
    return;
  }

  const laborCost = parseFloat(formData.labor_cost) || 0;

  // Process basket selections and update DB records
  const { partsTotalCost, chosenLines, basketText } = await trace.step('finalize_choose_product', async () => {
    let _partsTotalCost = 0;
    const _chosenLines = [];

    for (const meta of basket_meta) {
      const chosenProductId = formData[`item_${meta.index}_product`];
      const products = Array.isArray(meta.products) ? meta.products : [];
      const chosenProduct =
        products.find((p) => String(p.id) === String(chosenProductId)) ||
        products[0] ||
        null;
      const price = Number(chosenProduct?.standard_price) || 0;
      _partsTotalCost += price;

      // Update basket item with chosen product
      await quotesRepo.addToBasket(quote_id, {
        part_number: meta.part_number,
        products,
        chosen_product_id: chosenProductId ? String(chosenProductId) : null,
        total_cost: price,
      }, correlationId).catch((err) => {
        log.warn('finalize.flow: addToBasket update failed', { error: err.message });
      });

      _chosenLines.push(
        `${meta.part_number}: ${chosenProduct?.name || meta.part_number} | ${price} EGP`
      );
    }

    return {
      partsTotalCost: _partsTotalCost,
      chosenLines: _chosenLines,
      basketText: _chosenLines.join('\n'),
    };
  }, { domain: 'finalize', input: { quote_id, itemCount: basket_meta.length, laborCost }, replaySafe: false });

  const totalCost = partsTotalCost + laborCost;

  const tenant = tenant_id
    ? await stateRepo.getTenant(tenant_id, correlationId).catch(() => null)
    : null;
  const tenantName = tenant?.name || '';

  // Send WA quote request template to customer's phone
  const recipientPhone = quote.customer_phone;
  let waMessageId = null;

  if (recipientPhone) {
    try {
      const carDetails = quote.vehicle_details || {};
      const template = process.env.WA_TEMPLATE_QUOTE_REQUEST || 'car_quot_request|ar_EG';
      const params = [
        quote.customer_name || '',
        `${carDetails.series || ''} ${carDetails.model || ''}`.trim(),
        quote.vin || '',
        basketText,
        String(totalCost),
        tenantName,
        String(laborCost),
      ];
      const waResp = await whatsapp.sendTemplate(recipientPhone, template, params, correlationId);
      waMessageId = waResp?.messages?.[0]?.id || null;
      log.info('finalize.flow: WA template sent', { waMessageId });
    } catch (err) {
      log.error('finalize.flow: WA send failed', { error: err.message });
    }
  } else {
    log.warn('finalize.flow: no customer phone — skipping WA template');
  }

  // Save Message document (WA msg id → quoteId) for button tracking
  if (waMessageId) {
    await messageRepo.createMessage(waMessageId, { quote_id }, correlationId).catch((err) => {
      log.warn('finalize.flow: createMessage failed', { error: err.message });
    });
  }

  // SSE notify agent
  await pushToTenant(tenant_id, 'quote_sent', {
    quote_id,
    chat_id: quote.chat_id,
    vin: quote.vin,
    customer_name: quote.customer_name,
    total_cost: totalCost,
    labor_cost: laborCost,
    basket_text: basketText,
  }, correlationId);

  // Clear CHOOSE_PRODUCT pending action
  await clearPendingAction(chatId, correlationId);

  // Send summary to agent
  await s.sendMessage([
    '✅ تم إرسال عرض السعر للعميل على واتساب.',
    '',
    `الإجمالي: ${totalCost} EGP`,
    `  • قطع الغيار: ${partsTotalCost} EGP`,
    `  • عمالة: ${laborCost} EGP`,
    '',
    'انتظر رد العميل على واتساب (تأكيد / إلغاء).',
  ].join('\n'));

  log.info('finalize.flow: complete', { quote_id, totalCost });
}

module.exports = { handleFinalize, handleChooseProductSubmit };
