'use strict';

const { getPrisma } = require('../services/prisma.service');
const logger = require('../utils/logger');

const QuoteStatus = {
  open: 'OPEN',
  confirmed: 'CONFIRMED',
  cancelled: 'CANCELLED',
  closed: 'CLOSED',
};

function normalizeChatId(chatId) {
  return chatId == null ? '' : String(chatId);
}

function statusToEnum(status) {
  if (!status) return QuoteStatus.open;
  const s = String(status).toLowerCase();
  if (s === 'confirmed') return 'CONFIRMED';
  if (s === 'cancelled') return 'CANCELLED';
  if (s === 'closed') return 'CLOSED';
  return 'OPEN';
}

function quoteToShape(row) {
  if (!row) return null;
  return {
    _id: row.id,
    quotation_id: row.quotation_id,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    vin: row.vin,
    vehicle_details: row.vehicle_details,
    x_car_id: row.x_car_id,
    chat_id: normalizeChatId(row.chat_id),
    status: row.status?.toLowerCase() ?? 'open',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function basketItemToShape(row) {
  if (!row) return null;
  return {
    _id: row.id,
    part_number: row.part_number,
    products: row.products ?? [],
    chosen_product_id: row.chosen_product_id ?? undefined,
    total_cost: row.total_cost ?? undefined,
  };
}

async function insertQuoteStatusHistory(prisma, quoteId, fromStatus, toStatus, channel, reason, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  try {
    await prisma.quoteStatusHistory.create({
      data: {
        quote_id: quoteId,
        from_status: fromStatus,
        to_status: toStatus,
        channel,
        reason: reason ?? null,
      },
    });
  } catch (err) {
    log.warn('quotes: QuoteStatusHistory insert failed (best-effort)', { error: err.message });
  }
}

async function getLatestOpenQuote(chatId, correlationId) {
  const log = logger.child(correlationId);
  const prisma = getPrisma();
  const chatIdStr = normalizeChatId(chatId);
  const row = await prisma.quote.findFirst({
    where: { status: 'OPEN', chat_id: chatIdStr },
    orderBy: { created_at: 'desc' },
  });
  if (!row) {
    log.debug('quotes: no open quotes found', { chatId: chatIdStr });
    return null;
  }
  return quoteToShape(row);
}

async function quoteExistsForVin(chatId, vin, correlationId) {
  const prisma = getPrisma();
  const chatIdStr = normalizeChatId(chatId);
  const row = await prisma.quote.findFirst({
    where: { status: 'OPEN', chat_id: chatIdStr, vin },
  });
  return row ? quoteToShape(row) : null;
}

async function createQuote(data, correlationId) {
  const log = logger.child(correlationId);
  log.info('quotes.createQuote', { quotation_id: data.quotation_id, vin: data.vin });
  const prisma = getPrisma();
  const created = await prisma.quote.create({
    data: {
      quotation_id: data.quotation_id ?? null,
      customer_name: data.customer_name ?? null,
      customer_phone: data.customer_phone ?? null,
      vin: data.vin ?? '',
      vehicle_details: data.vehicle_details ?? null,
      x_car_id: data.x_car_id ?? null,
      chat_id: normalizeChatId(data.chat_id),
      status: statusToEnum(data.status),
    },
  });
  return quoteToShape(created);
}

async function getQuote(quoteId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('quotes.getQuote', { quoteId });
  const prisma = getPrisma();
  const row = await prisma.quote.findUnique({
    where: { id: quoteId },
  });
  if (!row) {
    log.debug('quotes.getQuote: not found', { quoteId });
    return null;
  }
  return quoteToShape(row);
}

async function updateQuoteStatus(quoteId, status, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('quotes.updateQuoteStatus', { quoteId, status });
  const prisma = getPrisma();
  const existing = await prisma.quote.findUnique({ where: { id: quoteId } });
  const toStatus = statusToEnum(status);
  await prisma.quote.update({
    where: { id: quoteId },
    data: { status: toStatus },
  });
  await insertQuoteStatusHistory(
    prisma,
    quoteId,
    existing?.status ?? null,
    toStatus,
    'WHATSAPP',
    status === 'confirmed' ? 'user_confirmed' : status === 'cancelled' ? 'user_cancelled' : null,
    correlationId
  );
}

async function closeQuote(quoteId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('quotes.closeQuote', { quoteId });
  const prisma = getPrisma();
  const existing = await prisma.quote.findUnique({ where: { id: quoteId } });
  await prisma.quote.update({
    where: { id: quoteId },
    data: { status: 'CLOSED' },
  });
  await insertQuoteStatusHistory(
    prisma,
    quoteId,
    existing?.status ?? null,
    'CLOSED',
    'WHATSAPP',
    'closed_after_button',
    correlationId
  );
}

async function addToBasket(quoteId, data, correlationId) {
  const log = logger.child(correlationId);
  const prisma = getPrisma();
  const partNumber = data.part_number ?? '';
  const products = Array.isArray(data.products) ? data.products : [];

  const existing = await prisma.basketItem.findUnique({
    where: {
      quote_id_part_number: { quote_id: quoteId, part_number: partNumber },
    },
  });
  if (existing) {
    log.info('quotes.addToBasket: already in basket, updating products', { part_number: partNumber });
    const updated = await prisma.basketItem.update({
      where: { id: existing.id },
      data: { products, chosen_product_id: data.chosen_product_id ?? null, total_cost: data.total_cost ?? null },
    });
    return { _id: updated.id, ...data, alreadyExists: true };
  }

  const created = await prisma.basketItem.create({
    data: {
      quote_id: quoteId,
      part_number: partNumber,
      products,
      chosen_product_id: data.chosen_product_id ?? null,
      total_cost: data.total_cost ?? null,
    },
  });
  return { _id: created.id, part_number: partNumber, products, chosen_product_id: created.chosen_product_id, total_cost: created.total_cost };
}

async function getBasketItems(quoteId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  const prisma = getPrisma();
  const items = await prisma.basketItem.findMany({
    where: { quote_id: quoteId },
    orderBy: { created_at: 'asc' },
  });
  log.debug('quotes.getBasketItems: found', { count: items.length });
  return items.map(basketItemToShape);
}

module.exports = {
  getLatestOpenQuote,
  quoteExistsForVin,
  createQuote,
  getQuote,
  updateQuoteStatus,
  closeQuote,
  addToBasket,
  getBasketItems,
};
