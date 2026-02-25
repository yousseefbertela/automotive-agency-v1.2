'use strict';

/**
 * resumeHandlers.js
 *
 * Handles all pending_action resume scenarios. Called from processMessage.js
 * when a session has an active pending_action.
 *
 * Routing:
 *   CONFIRM_PART_MATCH      → resumeConfirmPartMatch
 *   CONFIRM_KIT             → resumeConfirmKit
 *   AWAIT_KIT_CLARIFICATION → resumeAwaitKitClarification
 *   COLLECT_CUSTOMER_DATA   → resumeCollectCustomerData
 *   CONFIRM_VIN_CHANGE      → resumeConfirmVinChange
 *   ADD_MORE_ITEMS          → resumeAddMoreItems
 *   AWAIT_NEXT_PART_NAME    → resumeAwaitNextPartName
 *   CHOOSE_PRODUCT          → handled via POST /api/chat/submit-form, not here
 */

const logger = require('../utils/logger');
const stateMachine = require('../services/stateMachine');
const { PENDING_ACTIONS, clearPendingAction, setPendingAction, parseYesNo } = stateMachine;
const stateRepo = require('../db/state.repo');
const quotesRepo = require('../db/quotes.repo');
const odoo = require('../services/odoo.service');
const ai = require('../ai/agent');
const sheets = require('../integrations/sheets.client');

// Lazy import to avoid circular dependency at module load time
function getPartFlow() { return require('../domain/part.flow'); }
function getFinalizeFlow() { return require('../domain/finalize.flow'); }

/**
 * Main entry point. Dispatch to the appropriate resume handler.
 */
async function handleResume(chatId, pendingAction, payload, userMessage, state, sender, correlationId) {
  const log = logger.child(correlationId);
  log.info('resumeHandlers.handleResume', { chatId, action: pendingAction });

  switch (pendingAction) {
    case PENDING_ACTIONS.CONFIRM_PART_MATCH:
      return resumeConfirmPartMatch(chatId, payload, userMessage, state, sender, correlationId);
    case PENDING_ACTIONS.CONFIRM_KIT:
      return resumeConfirmKit(chatId, payload, userMessage, state, sender, correlationId);
    case PENDING_ACTIONS.AWAIT_KIT_CLARIFICATION:
      return resumeAwaitKitClarification(chatId, payload, userMessage, state, sender, correlationId);
    case PENDING_ACTIONS.COLLECT_CUSTOMER_DATA:
      return resumeCollectCustomerData(chatId, payload, userMessage, state, sender, correlationId);
    case PENDING_ACTIONS.CONFIRM_VIN_CHANGE:
      return resumeConfirmVinChange(chatId, payload, userMessage, state, sender, correlationId);
    case PENDING_ACTIONS.ADD_MORE_ITEMS:
      return resumeAddMoreItems(chatId, payload, userMessage, state, sender, correlationId);
    case PENDING_ACTIONS.AWAIT_NEXT_PART_NAME:
      return resumeAwaitNextPartName(chatId, payload, userMessage, state, sender, correlationId);
    case PENDING_ACTIONS.CHOOSE_PRODUCT:
      // This is handled by POST /api/chat/submit-form — not via chat message
      await sender.sendMessage('من فضلك استخدم نموذج اختيار المنتجات لإكمال العملية.');
      return;
    default:
      log.warn('resumeHandlers: unknown pending_action', { action: pendingAction });
      await clearPendingAction(chatId, correlationId);
  }
}

// ─── CONFIRM_PART_MATCH ─────────────────────────────────────────────────────

async function resumeConfirmPartMatch(chatId, payload, userMessage, state, sender, correlationId) {
  const log = logger.child(correlationId);
  const { best_match, second_match, quote_id, part_name, vin, remaining_parts, tenant_id } = payload;
  const decision = parseYesNo(userMessage);

  log.info('resumeConfirmPartMatch', { chatId, decision, part_name });

  if (decision === 'yes') {
    await clearPendingAction(chatId, correlationId);

    const tenant = tenant_id ? await stateRepo.getTenant(tenant_id, correlationId) : null;
    let products = [];
    try {
      products = await odoo.searchProduct(best_match.part_number, correlationId, tenant);
    } catch (err) {
      log.warn('resumeConfirmPartMatch: odoo searchProduct failed', { error: err.message });
    }

    if (!products.length) {
      await sender.sendMessage(`آسف، القطعة "${part_name}" مش متوفرة حالياً في المخزون.`);
    } else {
      try {
        await quotesRepo.addToBasket(quote_id, { part_number: best_match.part_number, products }, correlationId);
        log.info('resumeConfirmPartMatch: added to basket', { part_number: best_match.part_number });
        await sender.sendMessage(`✅ تم إضافة "${part_name}" للسلة.`);
      } catch (err) {
        log.warn('resumeConfirmPartMatch: addToBasket failed', { error: err.message });
        await sender.sendMessage(`حصل مشكلة في الإضافة للسلة.`);
      }
    }

    // Process remaining parts or ask about more
    const remaining = Array.isArray(remaining_parts) ? remaining_parts : [];
    if (remaining.length > 0) {
      const freshState = await stateRepo.getState(chatId, correlationId);
      const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId);
      if (quote) {
        await getPartFlow().processOnePart(chatId, remaining[0], vin || quote.vin, quote, freshState, correlationId, sender, remaining.slice(1));
      }
    } else {
      await setPendingAction(chatId, PENDING_ACTIONS.ADD_MORE_ITEMS, { quote_id }, 60, correlationId);
      await sender.sendMessage('هل تريد إضافة قطعة أخرى؟\n\nرد بـ *نعم* أو *لا*');
    }

  } else if (decision === 'no') {
    if (second_match && second_match.part_number) {
      // Show second match and stay in CONFIRM_PART_MATCH
      const newPayload = {
        best_match: second_match,
        second_match: null,
        quote_id, part_name, vin, remaining_parts, tenant_id,
      };
      await setPendingAction(chatId, PENDING_ACTIONS.CONFIRM_PART_MATCH, newPayload, 60, correlationId);
      const msg = [
        'تمام، آسف جداً. من فضلك حاول توصف القطعة المطلوبة تاني بكلمات أوضح، أو باسم مختلف، وهحاول أبحث مرة تانية.',
        '',
        'لقيت بديل تاني:',
        `*القطعة:* ${second_match.description || ''}`,
        `*رقم القطعة:* ${second_match.part_number || ''}`,
        '',
        'هل ده المطلوب؟ (نعم / لا)',
      ].join('\n');
      await sender.sendMessage(msg);
    } else {
      await clearPendingAction(chatId, correlationId);
      await sender.sendMessage('تمام، آسف جداً. من فضلك حاول توصف القطعة المطلوبة تاني بكلمات أوضح، أو باسم مختلف، وهحاول أبحث مرة تانية.');
    }

  } else {
    // UNCLEAR — treat as new part search description
    await clearPendingAction(chatId, correlationId);
    const freshState = await stateRepo.getState(chatId, correlationId);
    const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId);
    if (quote) {
      await getPartFlow().processOnePart(
        chatId, userMessage,
        vin || quote.vin, quote, freshState, correlationId, sender,
        Array.isArray(remaining_parts) ? remaining_parts : []
      );
    } else {
      await sender.sendMessage('مفيش عرض سعر مفتوح. ابعت الـ VIN الأول.');
    }
  }
}

// ─── CONFIRM_KIT ─────────────────────────────────────────────────────────────

async function resumeConfirmKit(chatId, payload, userMessage, state, sender, correlationId) {
  const log = logger.child(correlationId);
  const { kit_code, kit_name, parts_list, quote_id } = payload;
  const decision = parseYesNo(userMessage);

  log.info('resumeConfirmKit', { chatId, decision, kit_name });

  if (decision === 'yes') {
    await clearPendingAction(chatId, correlationId);

    if (!parts_list || !parts_list.length) {
      await sender.sendMessage('الطقم موجود بس مفيش قطع مسجلة فيه.');
      return;
    }

    await sender.sendMessage(`تمام! بدأ في البحث عن قطع الطقم...`);

    const freshState = await stateRepo.getState(chatId, correlationId);
    const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId);
    if (!quote) {
      await sender.sendMessage('مفيش عرض سعر مفتوح. ابعت الـ VIN الأول.');
      return;
    }
    // Process first part; remaining parts flow through the CONFIRM_PART_MATCH chain
    await getPartFlow().processOnePart(
      chatId, parts_list[0],
      quote.vin || freshState.vin, quote, freshState, correlationId, sender,
      parts_list.slice(1)
    );

  } else if (decision === 'no') {
    // Keep AWAIT_KIT_CLARIFICATION
    await setPendingAction(chatId, PENDING_ACTIONS.AWAIT_KIT_CLARIFICATION, payload, 60, correlationId);
    await sender.sendMessage('من فضلك وضح نوع الطقم المطلوب بكلمات أوضح، أو اكتب القطع بشكل منفرد.');

  } else {
    // Any other text → treat as clarification of kit
    await clearPendingAction(chatId, correlationId);
    const kits = await sheets.getAllKits(correlationId).catch(() => []);
    if (kits.length) {
      const matchResult = await ai.matchKit(userMessage, kits, correlationId);
      if (matchResult.matched) {
        await setPendingAction(chatId, PENDING_ACTIONS.CONFIRM_KIT, {
          kit_code: matchResult.kit_code,
          kit_name: matchResult.kit_code,
          parts_list: matchResult.parts_array,
          quote_id,
        }, 60, correlationId);
        const partsText = matchResult.parts_array.join(', ');
        await sender.sendMessage(`لقيت الطقم: هل دي القطع اللي تحتاجها؟\n${partsText}\n\nرد بـ *نعم* أو *لا*`);
      } else {
        await setPendingAction(chatId, PENDING_ACTIONS.AWAIT_KIT_CLARIFICATION, { quote_id }, 60, correlationId);
        const suggestions = matchResult.suggestions?.join(', ') || '';
        await sender.sendMessage(`مش لاقي الطقم. ${suggestions ? `هل تقصد: ${suggestions}` : ''}\n\nمن فضلك وضح أكتر.`);
      }
    } else {
      await sender.sendMessage('من فضلك وضح نوع الطقم المطلوب.');
    }
  }
}

// ─── AWAIT_KIT_CLARIFICATION ─────────────────────────────────────────────────

async function resumeAwaitKitClarification(chatId, payload, userMessage, state, sender, correlationId) {
  const log = logger.child(correlationId);
  const { quote_id } = payload;
  log.info('resumeAwaitKitClarification', { chatId });

  await clearPendingAction(chatId, correlationId);

  const kits = await sheets.getAllKits(correlationId).catch(() => []);
  if (!kits.length) {
    await sender.sendMessage('مفيش بيانات طقم متاحة حالياً.');
    return;
  }

  const matchResult = await ai.matchKit(userMessage, kits, correlationId);
  if (matchResult.matched) {
    await setPendingAction(chatId, PENDING_ACTIONS.CONFIRM_KIT, {
      kit_code: matchResult.kit_code,
      kit_name: matchResult.kit_code,
      parts_list: matchResult.parts_array,
      quote_id,
    }, 60, correlationId);
    const partsText = matchResult.parts_array.join(', ');
    await sender.sendMessage(
      `لقيت الطقم "${matchResult.kit_code}".\nالقطع: ${partsText}\n\nهل دي القطع المطلوبة؟ (نعم / لا)`
    );
  } else {
    // Keep waiting
    await setPendingAction(chatId, PENDING_ACTIONS.AWAIT_KIT_CLARIFICATION, payload, 60, correlationId);
    const suggestions = matchResult.suggestions?.join(', ') || '';
    const clarifyMsg = matchResult.clarify_message ||
      `مش لاقي. ${suggestions ? `هل تقصد: ${suggestions}` : 'حاول اكتب اسم الطقم بشكل مختلف.'}`;
    await sender.sendMessage(clarifyMsg);
  }
}

// ─── COLLECT_CUSTOMER_DATA ────────────────────────────────────────────────────

async function resumeCollectCustomerData(chatId, payload, userMessage, state, sender, correlationId) {
  const log = logger.child(correlationId);
  const { vin, car_id, car_details, partner_id: existingPartnerId, tenant_id } = payload;
  log.info('resumeCollectCustomerData', { chatId });

  // Try to parse structured JSON (from /api/chat/submit-form)
  let customerName = null;
  let customerPhone = null;

  if (typeof userMessage === 'object' && userMessage !== null) {
    customerName = userMessage.customer_name || null;
    customerPhone = userMessage.customer_phone || null;
  } else {
    // Try to parse as JSON string
    try {
      const parsed = JSON.parse(userMessage);
      customerName = parsed.customer_name || null;
      customerPhone = parsed.customer_phone || null;
    } catch {
      // Try free-text: "Name / Phone" or "Name: X, Phone: Y"
      const freeText = String(userMessage);
      const phoneMatch = freeText.match(/(?:phone|tel|رقم|هاتف)[:\s]*([+\d\s-]{7,20})/i);
      const nameMatch = freeText.match(/^([^/\n,]+)/);
      if (phoneMatch) customerPhone = phoneMatch[1].trim().replace(/\s/g, '');
      if (nameMatch && nameMatch[1].trim().length < 100) customerName = nameMatch[1].trim();
    }
  }

  if (!customerName || !customerPhone) {
    // Invalid input — send form again
    await sender.sendMessage(JSON.stringify({
      type: 'form',
      action: 'COLLECT_CUSTOMER_DATA',
      message: 'من فضلك أدخل اسم العميل ورقم الهاتف.',
      fields: [
        { name: 'customer_name', label: 'اسم العميل', type: 'text', required: true },
        { name: 'customer_phone', label: 'رقم الهاتف', type: 'tel', required: true },
      ],
      submit_to: '/api/chat/submit-form',
    }));
    return;
  }

  await clearPendingAction(chatId, correlationId);

  const tenant = tenant_id ? await stateRepo.getTenant(tenant_id, correlationId) : null;

  // Search or create Odoo partner
  let partnerId = existingPartnerId || 3;
  try {
    const contacts = await odoo.searchContact(customerPhone, correlationId, tenant);
    if (contacts && contacts.length > 0) {
      partnerId = contacts[0].id;
      log.info('resumeCollectCustomerData: existing contact found', { partnerId });
    } else {
      const newCustomer = await odoo.createCustomer(customerName, customerPhone, correlationId, tenant);
      partnerId = newCustomer?.id || 3;
      log.info('resumeCollectCustomerData: customer created', { partnerId });
    }
    // Link car to partner
    if (car_id && partnerId) {
      await odoo.updateCarPartner(car_id, partnerId, correlationId, tenant).catch(() => {});
    }
  } catch (err) {
    log.warn('resumeCollectCustomerData: odoo customer create/search failed', { error: err.message });
  }

  // Create Odoo quotation
  let quotationId = null;
  try {
    const saleOrderData = {
      partner_id: partnerId,
      partner_invoice_id: partnerId,
      partner_shipping_id: partnerId,
    };
    if (car_id) saleOrderData.x_studio_car = car_id;
    const quotation = await odoo.createQuotation(saleOrderData, correlationId, tenant);
    quotationId = quotation.id;
    log.info('resumeCollectCustomerData: Odoo quotation created', { quotationId });
  } catch (err) {
    log.warn('resumeCollectCustomerData: Odoo createQuotation failed', { error: err.message });
  }

  // Create DB quote
  try {
    await quotesRepo.createQuote({
      quotation_id: quotationId,
      customer_name: customerName,
      customer_phone: customerPhone,
      vin,
      vehicle_details: car_details,
      x_car_id: car_id,
      chat_id: String(chatId),
      status: 'open',
    }, correlationId);
  } catch (err) {
    log.warn('resumeCollectCustomerData: createQuote failed', { error: err.message });
  }

  // Update session state
  try {
    await stateRepo.saveState(chatId, {
      vin,
      quotation_id: quotationId,
      vehicle_details: car_details,
      x_car_id: car_id,
      customer_name: customerName,
      customer_phone: customerPhone,
      status: 'open',
    }, correlationId);
  } catch (err) {
    log.warn('resumeCollectCustomerData: saveState failed', { error: err.message });
  }

  // Reply with vehicle summary
  const replyText = [
    `✅ تم تسجيل بيانات العميل وإنشاء عرض السعر!`,
    ``,
    `🧾 عرض السعر رقم: ${quotationId || 'N/A'}`,
    `👤 العميل: ${customerName}`,
    `📱 الهاتف: ${customerPhone}`,
    `VIN: ${vin}`,
    ``,
    `تفاصيل السيارة:`,
    `🚗 ${car_details?.series || ''} ${car_details?.model || ''}`,
    `🚙 الهيكل: ${car_details?.body || ''}`,
    `⚙️ المحرك: ${car_details?.engine || ''}`,
    ``,
    `الآن ابعت اسم القطعة اللي تحتاجها.`,
  ].join('\n');

  await sender.sendMessage(replyText);
  log.info('resumeCollectCustomerData: complete');
}

// ─── CONFIRM_VIN_CHANGE ──────────────────────────────────────────────────────

async function resumeConfirmVinChange(chatId, payload, userMessage, state, sender, correlationId) {
  const log = logger.child(correlationId);
  const { old_vin, new_vin, old_quote_id, new_car_details, tenant_id } = payload;
  const decision = parseYesNo(userMessage);

  log.info('resumeConfirmVinChange', { chatId, decision, old_vin, new_vin });

  if (decision === 'yes') {
    await clearPendingAction(chatId, correlationId);

    // Close old quote
    if (old_quote_id) {
      await quotesRepo.closeQuote(old_quote_id, correlationId).catch(() => {});
    }

    // Proceed with VIN flow for new VIN — check if customer data already exists
    const freshState = await stateRepo.getState(chatId, correlationId);
    const hasCustomerData = freshState.customer_name && freshState.customer_phone;

    if (!hasCustomerData) {
      // Set COLLECT_CUSTOMER_DATA
      const tenant = tenant_id ? await stateRepo.getTenant(tenant_id, correlationId) : null;
      let car_id = null;
      try {
        const { odoo: odooService } = require('../services/odoo.service');
        car_id = null; // Will be handled in collect customer data
      } catch { /* ignore */ }

      await setPendingAction(chatId, PENDING_ACTIONS.COLLECT_CUSTOMER_DATA, {
        vin: new_vin,
        car_id: new_car_details?.car_id || null,
        car_details: new_car_details,
        partner_id: null,
        tenant_id,
      }, 60, correlationId);

      await sender.sendMessage(JSON.stringify({
        type: 'form',
        action: 'COLLECT_CUSTOMER_DATA',
        message: `تم تغيير الـ VIN إلى ${new_vin}. من فضلك أدخل بيانات العميل:`,
        fields: [
          { name: 'customer_name', label: 'اسم العميل', type: 'text', required: true },
          { name: 'customer_phone', label: 'رقم الهاتف', type: 'tel', required: true },
        ],
        submit_to: '/api/chat/submit-form',
      }));
    } else {
      // Customer data exists, create quotation directly
      const fakeUserMessage = {
        customer_name: freshState.customer_name,
        customer_phone: freshState.customer_phone,
      };
      await resumeCollectCustomerData(chatId, {
        vin: new_vin,
        car_id: new_car_details?.car_id || null,
        car_details: new_car_details,
        partner_id: null,
        tenant_id,
      }, fakeUserMessage, freshState, sender, correlationId);
    }

  } else {
    // NO or unclear → keep current VIN
    await clearPendingAction(chatId, correlationId);
    await sender.sendMessage(`تم الاحتفاظ بالـ VIN الحالي: ${old_vin}`);
  }
}

// ─── ADD_MORE_ITEMS ──────────────────────────────────────────────────────────

async function resumeAddMoreItems(chatId, payload, userMessage, state, sender, correlationId) {
  const log = logger.child(correlationId);
  const { quote_id } = payload;
  const decision = parseYesNo(userMessage);

  log.info('resumeAddMoreItems', { chatId, decision });

  if (decision === 'yes') {
    await clearPendingAction(chatId, correlationId);
    await setPendingAction(chatId, PENDING_ACTIONS.AWAIT_NEXT_PART_NAME, { quote_id }, 60, correlationId);
    await sender.sendMessage('تمام! اكتب اسم القطعة الجديدة:');
  } else if (decision === 'no') {
    await clearPendingAction(chatId, correlationId);
    // Trigger finalize
    const freshState = await stateRepo.getState(chatId, correlationId);
    await getFinalizeFlow().handleFinalize(chatId, {}, freshState, correlationId, sender);
  } else {
    // Unclear — ask again
    await sender.sendMessage('هل تريد إضافة قطعة أخرى؟ رد بـ *نعم* أو *لا*');
  }
}

// ─── AWAIT_NEXT_PART_NAME ─────────────────────────────────────────────────────

async function resumeAwaitNextPartName(chatId, payload, userMessage, state, sender, correlationId) {
  const log = logger.child(correlationId);
  log.info('resumeAwaitNextPartName', { chatId, partName: userMessage });

  await clearPendingAction(chatId, correlationId);

  const freshState = await stateRepo.getState(chatId, correlationId);
  const quote = await quotesRepo.getLatestOpenQuote(chatId, correlationId);
  if (!quote) {
    await sender.sendMessage('مفيش عرض سعر مفتوح. ابعت الـ VIN الأول.');
    return;
  }

  await getPartFlow().processOnePart(
    chatId, String(userMessage).trim(),
    quote.vin || freshState.vin,
    quote, freshState, correlationId, sender, []
  );
}

module.exports = { handleResume };
