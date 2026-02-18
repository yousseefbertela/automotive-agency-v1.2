'use strict';

const scraper = require('../integrations/scraper.client');
const odoo = require('../services/odoo.service');
const firestore = require('../services/firestore.service');
const quotesRepo = require('../db/quotes.repo');
const stateRepo = require('../db/state.repo');
const telegram = require('../services/telegram.service');
const { normalizeVin } = require('../workflows/router');
const logger = require('../utils/logger');

/**
 * VIN flow — replicated from the n8n VIN branch.
 *
 * Steps:
 * 1. Normalize VIN (last 7 chars if 17)
 * 2. Call scraper get-car-details
 * 3. Search Odoo x_car by chassis
 * 4. If car exists: check if customer exists → check if quotation exists
 * 5. If car doesn't exist: create car → open customer form (simplified: create with defaults)
 * 6. Create quotation in Odoo (sale.order)
 * 7. Create quotation in Firestore
 * 8. Update session state
 * 9. Reply to Telegram with vehicle summary
 */
async function handleVin(chatId, item, state, correlationId) {
  const log = logger.child(correlationId);
  const rawVin = item.vin;
  const vin = normalizeVin(rawVin) || rawVin;

  log.info('vin.flow: start', { chatId, rawVin, normalizedVin: vin });

  if (!vin) {
    await telegram.sendMessage(chatId, 'لم يتم العثور على VIN صالح. من فضلك أدخل VIN صحيح.');
    return;
  }

  // Step 1: Call scraper for car details
  let carDetails;
  try {
    carDetails = await scraper.getCarDetails(vin, correlationId);
  } catch (err) {
    log.error('vin.flow: scraper failed', { error: err.message });
    await telegram.sendMessage(chatId, 'please enter a correct vin');
    return;
  }

  // Validate scraper response
  if (!carDetails || carDetails.error || carDetails.status >= 400) {
    log.warn('vin.flow: scraper returned error', { carDetails });
    await telegram.sendMessage(chatId, 'please enter a correct vin');
    return;
  }

  log.info('vin.flow: car details retrieved', {
    series: carDetails.series,
    model: carDetails.model,
  });

  // Step 2: Search Odoo for existing car
  let cars = [];
  try {
    cars = await odoo.searchCar(vin, correlationId);
  } catch (err) {
    log.warn('vin.flow: Odoo searchCar failed, continuing', { error: err.message });
  }

  let carId = null;
  let partnerId = null;
  let existingCar = cars.length > 0 ? cars[0] : null;

  if (existingCar) {
    carId = existingCar.id;
    partnerId = existingCar.x_studio_partner_id?.[0] || null;
    log.info('vin.flow: existing car found in Odoo', { carId, partnerId });
  } else {
    // Create a new car in Odoo
    log.info('vin.flow: creating new car in Odoo');
    try {
      const newCar = await odoo.createCar(
        {
          x_name: `BMW ${carDetails.series || ''}`,
          x_studio_car_chasis: vin,
          x_studio_car_year: carDetails.prod_month || '',
          x_studio_specs: `body:${carDetails.body || ''}, model:${carDetails.model || ''}, market:${carDetails.market || ''}, engine:${carDetails.engine || ''}`,
        },
        correlationId
      );
      carId = newCar.id;
    } catch (err) {
      log.warn('vin.flow: Odoo createCar failed, continuing', { error: err.message });
      carId = null;
    }
  }

  // Step 3: Check if quotation already exists for this VIN + chat_id
  let existingQuote = null;
  try {
    existingQuote = await quotesRepo.quoteExistsForVin(chatId, vin, correlationId);
  } catch (err) {
    log.warn('vin.flow: quote check failed', { error: err.message });
  }

  if (existingQuote) {
    log.info('vin.flow: quotation already exists', { quoteId: existingQuote._id });
    await telegram.sendMessage(
      chatId,
      'فيه عرض سعر موجود فعلاً بالبيانات دي وحالته لسه مفتوحة.'
    );
    return;
  }

  // Step 4: Create Odoo quotation (sale.order)
  let quotationId = null;
  try {
    // Determine partner_id: from existing car's partner, or default
    const saleOrderData = {
      partner_id: partnerId || 3, // 3 is fallback from n8n
      partner_invoice_id: 3,
      partner_shipping_id: 3,
    };
    if (carId) saleOrderData.x_studio_car = carId;

    const quotation = await odoo.createQuotation(saleOrderData, correlationId);
    quotationId = quotation.id;
    log.info('vin.flow: Odoo quotation created', { quotationId });
  } catch (err) {
    log.warn('vin.flow: Odoo createQuotation failed, continuing', { error: err.message });
  }

  // Step 5: Prepare updated state
  const updatedState = {
    ...state,
    chat_id: String(chatId),
    vin,
    quotation_id: quotationId,
    vehicle_details: carDetails,
    x_car_id: carId,
    status: 'open',
  };

  // Step 6: Create Firestore quotation document
  try {
    await quotesRepo.createQuote(
      {
        quotation_id: quotationId,
        customer_name: updatedState.customer_name || null,
        customer_phone: updatedState.customer_phone || null,
        vin,
        vehicle_details: carDetails,
        x_car_id: carId,
        chat_id: Number(chatId) || chatId,
        status: 'open',
      },
      correlationId
    );
  } catch (err) {
    log.warn('vin.flow: Firestore createQuote failed', { error: err.message });
  }

  // Step 7: Save session state
  try {
    await stateRepo.saveState(chatId, updatedState, correlationId);
  } catch (err) {
    log.warn('vin.flow: saveState failed', { error: err.message });
  }

  // Step 8: Reply to Telegram with vehicle summary
  const replyText = [
    `🧾 تم إنشاء عرض السعر رقم: ${quotationId || 'N/A'}`,
    `VIN: ${vin}`,
    `تفاصيل السيارة:`,
    `🚗 الموديل: ${carDetails.series || ''} ${carDetails.model || ''}`,
    `🚙 الهيكل: ${carDetails.body || ''}`,
    `🌍 السوق: ${carDetails.market || ''}`,
    `📅 سنة الإنتاج: ${carDetails.prod_month || ''}`,
    `⚙️ المحرك: ${carDetails.engine || ''}`,
  ].join('\n');

  await telegram.sendMessage(chatId, replyText);
  log.info('vin.flow: complete');
}

module.exports = { handleVin };
