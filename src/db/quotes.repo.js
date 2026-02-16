'use strict';

const firestore = require('../services/firestore.service');
const logger = require('../utils/logger');

/**
 * Get the latest open quotation for a chat_id.
 * Matches n8n: "Query all quotations by chatId" → "choose last quotation"
 */
async function getLatestOpenQuote(chatId, correlationId) {
  const log = logger.child(correlationId);
  const quotes = await firestore.queryOpenQuotesByChatId(chatId, correlationId);
  if (!quotes.length) {
    log.debug('quotes: no open quotes found', { chatId });
    return null;
  }
  // Sort by _createTime ascending, pick last (newest)
  quotes.sort((a, b) => {
    const tA = new Date(a._createTime || 0).getTime();
    const tB = new Date(b._createTime || 0).getTime();
    return tA - tB;
  });
  return quotes[quotes.length - 1];
}

/**
 * Check if a quotation already exists for this chat_id + vin.
 */
async function quoteExistsForVin(chatId, vin, correlationId) {
  const quotes = await firestore.queryOpenQuotesByChatIdAndVin(chatId, vin, correlationId);
  return quotes.length > 0 ? quotes[0] : null;
}

/**
 * Create a new quote in Firestore.
 * Matches n8n: "Create Quotation" node.
 */
async function createQuote(data, correlationId) {
  const log = logger.child(correlationId);
  log.info('quotes.createQuote', { quotation_id: data.quotation_id, vin: data.vin });
  return firestore.createQuote(data, correlationId);
}

/**
 * Add item to basket (sub-collection).
 */
async function addToBasket(quoteId, data, correlationId) {
  const log = logger.child(correlationId);

  // Check if already in basket (dedup by part_number)
  const existing = await firestore.getBasketItems(quoteId, correlationId);
  const alreadyInBasket = existing.find((item) => item.part_number === data.part_number);
  if (alreadyInBasket) {
    log.info('quotes.addToBasket: already in basket, skipping', { part_number: data.part_number });
    return { _id: alreadyInBasket._id, ...alreadyInBasket, alreadyExists: true };
  }

  return firestore.addToBasket(quoteId, data, correlationId);
}

/**
 * Get all basket items for a quote.
 */
async function getBasketItems(quoteId, correlationId) {
  return firestore.getBasketItems(quoteId, correlationId);
}

module.exports = { getLatestOpenQuote, quoteExistsForVin, createQuote, addToBasket, getBasketItems };
