'use strict';

const admin = require('firebase-admin');
const logger = require('../utils/logger');

let db = null;

function getCredential() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim()) {
    try {
      const key = typeof json === 'string' ? JSON.parse(json) : json;
      return admin.credential.cert(key);
    } catch (e) {
      logger.warn('firestore: invalid GOOGLE_SERVICE_ACCOUNT_JSON, falling back to file path');
    }
  }
  return admin.credential.applicationDefault();
}

function getDb() {
  if (db) return db;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: getCredential(),
      projectId: process.env.FIRESTORE_PROJECT_ID || 'automotiveagent-83ade',
    });
  }
  db = admin.firestore();
  return db;
}

/* ─── messages ─── */

/**
 * GET messages/{messageId}
 * Matches n8n: "Get message document"
 * Returns: { quoteId, ... }
 */
async function getMessageDocument(messageId, correlationId) {
  const log = logger.child(correlationId);
  log.info('firestore.getMessageDocument', { messageId });

  const doc = await getDb().collection('messages').doc(messageId).get();
  if (!doc.exists) {
    log.warn('firestore.getMessageDocument: not found', { messageId });
    return null;
  }
  return { _id: doc.id, ...doc.data() };
}

/* ─── quotes ─── */

/**
 * GET quotes/{quoteId}
 * Matches n8n: "Get a quote"
 * Returns: { customer_name, vehicle_details, chat_id, quotation_id, status, ... }
 */
async function getQuote(quoteId, correlationId) {
  const log = logger.child(correlationId);
  log.info('firestore.getQuote', { quoteId });

  const doc = await getDb().collection('quotes').doc(quoteId).get();
  if (!doc.exists) {
    log.warn('firestore.getQuote: not found', { quoteId });
    return null;
  }
  return { _id: doc.id, ...doc.data() };
}

/**
 * UPSERT quotes/{quoteId} with status.
 * Matches n8n: "change status to confirmed/cancelled"
 */
async function updateQuoteStatus(quoteId, status, correlationId) {
  const log = logger.child(correlationId);
  log.info('firestore.updateQuoteStatus', { quoteId, status });

  await getDb().collection('quotes').doc(quoteId).set(
    { status },
    { merge: true }
  );
}

/**
 * PATCH quotes/{quoteId} status to "closed".
 * Matches n8n: "change status" HTTP PATCH node.
 */
async function closeQuote(quoteId, correlationId) {
  const log = logger.child(correlationId);
  log.info('firestore.closeQuote', { quoteId });

  await getDb().collection('quotes').doc(quoteId).update({ status: 'closed' });
}

/* ─── basket ─── */

/**
 * GET ALL quotes/{quoteId}/basket
 * Matches n8n: "Get basket in quote"
 * Returns array of basket items.
 */
async function getBasketItems(quoteId, correlationId) {
  const log = logger.child(correlationId);
  log.info('firestore.getBasketItems', { quoteId });

  const snap = await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .get();

  const items = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  log.info('firestore.getBasketItems: found', { count: items.length });
  return items;
}

/* ─── sessions ─── */

/**
 * GET sessions/{chatId}
 * Matches n8n: "Get session info"
 * Returns: { _id (=chatId), tenant_id, ... }
 */
async function getSession(chatId, correlationId) {
  const log = logger.child(correlationId);
  log.info('firestore.getSession', { chatId });

  const doc = await getDb().collection('sessions').doc(String(chatId)).get();
  if (!doc.exists) {
    log.warn('firestore.getSession: not found', { chatId });
    return null;
  }
  return { _id: doc.id, ...doc.data() };
}

/* ─── tenants ─── */

/**
 * GET tenants/{tenantId}
 * Matches n8n: "Get tenant info"
 * Returns: { name, ... }
 */
async function getTenant(tenantId, correlationId) {
  const log = logger.child(correlationId);
  log.info('firestore.getTenant', { tenantId });

  const doc = await getDb().collection('tenants').doc(tenantId).get();
  if (!doc.exists) {
    log.warn('firestore.getTenant: not found', { tenantId });
    return null;
  }
  return { _id: doc.id, ...doc.data() };
}

module.exports = {
  getDb,
  getMessageDocument,
  getQuote,
  updateQuoteStatus,
  closeQuote,
  getBasketItems,
  getSession,
  getTenant,
};
