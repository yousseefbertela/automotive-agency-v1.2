'use strict';

const scraper = require('../integrations/scraper.client');
const odoo = require('../services/odoo.service');
const quotesRepo = require('../db/quotes.repo');
const stateRepo = require('../db/state.repo');
const { normalizeVin } = require('../workflows/router');
const { setPendingAction, PENDING_ACTIONS } = require('../services/stateMachine');
const logger = require('../utils/logger');
const trace = require('../services/trace.service');

async function handleVin(chatId, item, state, correlationId, sender) {
  const log = logger.child(correlationId);
  const s = sender || { sendMessage: () => Promise.resolve(), sendPhotoBuffer: () => Promise.resolve() };
  const rawVin = item.vin;
  const vin = normalizeVin(rawVin) || rawVin;
  log.info('vin.flow: start', { chatId, rawVin, normalizedVin: vin });

  if (!vin) {
    await s.sendMessage('لم يتم العثور على VIN صالح. من فضلك أدخل VIN صحيح.');
    return;
  }

  // Check VIN collision: existing OPEN quote with a DIFFERENT vin
  let existingQuote = null;
  try { existingQuote = await quotesRepo.getLatestOpenQuote(chatId, correlationId); } catch {}

  if (existingQuote && existingQuote.vin && existingQuote.vin !== vin) {
    log.info('vin.flow: VIN collision', { old: existingQuote.vin, new: vin });
    let newCarDetails = null;
    try {
      const d = await trace.step('vin_scrape_collision', async () =>
        scraper.getCarDetails(vin, correlationId),
        { domain: 'scraper', input: { vin }, replaySafe: true }
      );
      if (d && !d.error && !(d.status >= 400)) newCarDetails = d;
    } catch {}
    await setPendingAction(chatId, PENDING_ACTIONS.CONFIRM_VIN_CHANGE, {
      old_vin: existingQuote.vin,
      new_vin: vin,
      old_quote_id: existingQuote._id,
      new_car_details: newCarDetails || { vin },
      tenant_id: state.tenant_id,
    }, 60, correlationId);
    await s.sendMessage(
      `الـ VIN الحالي هو: *${existingQuote.vin}*\n\nهل تريد تغييره إلى: *${vin}*؟\n\nرد بـ *نعم* للتغيير أو *لا* للاحتفاظ بالحالي.`
    );
    return;
  }

  if (existingQuote && existingQuote.vin === vin) {
    await s.sendMessage(`يوجد عرض سعر مفتوح بالفعل للـ VIN: ${vin}. يمكنك إضافة قطع عليه.`);
    return;
  }

  // Scrape car details
  let carDetails;
  try {
    carDetails = await trace.step('vin_scrape', async () =>
      scraper.getCarDetails(vin, correlationId),
      { domain: 'scraper', input: { vin }, replaySafe: true }
    );
  } catch (err) {
    log.error('vin.flow: scraper failed', { error: err.message });
    await s.sendMessage('من فضلك أدخل VIN صحيح.');
    return;
  }
  if (!carDetails || carDetails.error || carDetails.status >= 400) {
    await s.sendMessage('من فضلك أدخل VIN صحيح.');
    return;
  }
  log.info('vin.flow: car details ok', { series: carDetails.series, model: carDetails.model });

  const tenant = state.tenant_id ? await stateRepo.getTenant(state.tenant_id, correlationId) : null;

  // Search/create car in Odoo
  let carId = null, partnerId = null;
  try {
    await trace.step('vin_odoo_car_lookup', async () => {
      const cars = await odoo.searchCar(vin, correlationId, tenant);
      if (cars && cars.length > 0) {
        carId = cars[0].id;
        partnerId = (cars[0].x_studio_partner_id || [])[0] || null;
      } else {
        const nc = await odoo.createCar({
          x_name: `${carDetails.series || 'Car'} ${carDetails.model || ''}`.trim(),
          x_studio_car_chasis: vin,
          x_studio_car_year: carDetails.prod_month || '',
          x_studio_specs: `body:${carDetails.body || ''},model:${carDetails.model || ''},engine:${carDetails.engine || ''}`,
        }, correlationId, tenant);
        if (nc && nc.id) carId = nc.id;
      }
    }, { domain: 'odoo', input: { vin }, replaySafe: false });
  } catch (err) { log.warn('vin.flow: Odoo car failed', { error: err.message }); }

  // Check if customer data already in session
  const hasCustomerData = !!(state.customer_name && state.customer_phone);
  if (!hasCustomerData) {
    await setPendingAction(chatId, PENDING_ACTIONS.COLLECT_CUSTOMER_DATA, {
      vin, car_id: carId, car_details: carDetails, partner_id: partnerId, tenant_id: state.tenant_id,
    }, 60, correlationId);
    await s.sendMessage(JSON.stringify({
      type: 'form',
      action: 'COLLECT_CUSTOMER_DATA',
      message: `تم التعرف على السيارة: ${carDetails.series || ''} ${carDetails.model || ''}\nمن فضلك أدخل بيانات العميل:`,
      fields: [
        { name: 'customer_name', label: 'اسم العميل', type: 'text', required: true },
        { name: 'customer_phone', label: 'رقم الهاتف', type: 'tel', required: true },
      ],
      submit_to: '/api/chat/submit-form',
    }));
  } else {
    await _createQuotation(
      chatId,
      { vin, car_id: carId, car_details: carDetails, partner_id: partnerId, tenant_id: state.tenant_id },
      state.customer_name, state.customer_phone, s, correlationId
    );
  }
}

/** Create Odoo quotation + DB quote when customer data is already known. */
async function _createQuotation(chatId, payload, customerName, customerPhone, sender, correlationId) {
  const log = logger.child(correlationId);
  const { vin, car_id, car_details, partner_id, tenant_id } = payload;
  const tenant = tenant_id ? await stateRepo.getTenant(tenant_id, correlationId) : null;

  let partnerId = partner_id || 3;
  try {
    await trace.step('vin_odoo_contact_lookup', async () => {
      const contacts = await odoo.searchContact(customerPhone, correlationId, tenant);
      if (contacts && contacts.length > 0) {
        partnerId = contacts[0].id;
      } else {
        const nc = await odoo.createCustomer(customerName, customerPhone, correlationId, tenant);
        if (nc && nc.id) partnerId = nc.id;
      }
      if (car_id && partnerId) {
        await odoo.updateCarPartner(car_id, partnerId, correlationId, tenant).catch(() => {});
      }
    }, { domain: 'odoo', input: { phone_suffix: customerPhone?.slice(-4), chatId }, replaySafe: false });
  } catch (err) { log.warn('_createQuotation: contact failed', { error: err.message }); }

  let quotationId = null;
  try {
    await trace.step('vin_odoo_create_quotation', async () => {
      const sod = { partner_id: partnerId, partner_invoice_id: partnerId, partner_shipping_id: partnerId };
      if (car_id) sod.x_studio_car = car_id;
      const q = await odoo.createQuotation(sod, correlationId, tenant);
      if (q && q.id) quotationId = q.id;
    }, { domain: 'odoo', input: { vin, chatId }, replaySafe: false });
  } catch (err) { log.warn('_createQuotation: Odoo quotation failed', { error: err.message }); }

  try {
    await quotesRepo.createQuote({
      quotation_id: quotationId, customer_name: customerName, customer_phone: customerPhone,
      vin, vehicle_details: car_details, x_car_id: car_id, chat_id: String(chatId), status: 'open',
    }, correlationId);
  } catch (err) { log.warn('_createQuotation: createQuote failed', { error: err.message }); }

  try {
    await stateRepo.saveState(chatId, {
      vin, quotation_id: quotationId, vehicle_details: car_details, x_car_id: car_id,
      customer_name: customerName, customer_phone: customerPhone, status: 'open',
    }, correlationId);
  } catch (err) { log.warn('_createQuotation: saveState failed', { error: err.message }); }

  await sender.sendMessage([
    `🧾 تم إنشاء عرض السعر رقم: ${quotationId || 'N/A'}`,
    `VIN: ${vin}`,
    `🚗 ${car_details?.series || ''} ${car_details?.model || ''}`,
    `⚙️ ${car_details?.engine || ''}`,
    '',
    'الآن ابعت اسم القطعة اللي تحتاجها.',
  ].join('\n'));
  log.info('vin.flow: complete', { quotationId });
}

module.exports = { handleVin, _createQuotation };
