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

/* ───────── sessions ───────── */

async function getSession(chatId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.getSession', { chatId });

  const doc = await getDb().collection('sessions').doc(String(chatId)).get();
  if (!doc.exists) {
    log.debug('firestore.getSession: not found', { chatId });
    return null;
  }
  return { _id: doc.id, ...doc.data() };
}

async function upsertSession(chatId, data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.upsertSession', { chatId });

  await getDb()
    .collection('sessions')
    .doc(String(chatId))
    .set(data, { merge: true });
}

/* ───────── users ───────── */

async function queryUserByChatId(chatId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.queryUserByChatId', { chatId });

  const snap = await getDb()
    .collection('users')
    .where('chatID', '==', String(chatId))
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { _id: doc.id, ...doc.data() };
}

/* ───────── tenants ───────── */

async function getTenant(tenantId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.getTenant', { tenantId });

  const doc = await getDb().collection('tenants').doc(tenantId).get();
  if (!doc.exists) {
    log.debug('firestore.getTenant: not found', { tenantId });
    return null;
  }
  return { _id: doc.id, ...doc.data() };
}

/* ───────── quotes ───────── */

async function createQuote(data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.createQuote');

  const ref = await getDb().collection('quotes').add(data);
  return { _id: ref.id, ...data };
}

async function getQuote(quoteId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.getQuote', { quoteId });

  const doc = await getDb().collection('quotes').doc(quoteId).get();
  if (!doc.exists) {
    log.debug('firestore.getQuote: not found', { quoteId });
    return null;
  }
  return { _id: doc.id, ...doc.data() };
}

async function queryOpenQuotesByChatId(chatId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.queryOpenQuotesByChatId', { chatId });

  const snap = await getDb()
    .collection('quotes')
    .where('status', '==', 'open')
    .where('chat_id', '==', Number(chatId) || String(chatId))
    .get();
  return snap.docs.map((d) => ({ _id: d.id, ...d.data(), _createTime: d.createTime?.toDate?.()?.toISOString() }));
}

async function queryOpenQuotesByChatIdAndVin(chatId, vin, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.queryOpenQuotesByChatIdAndVin', { chatId, vin });

  const snap = await getDb()
    .collection('quotes')
    .where('status', '==', 'open')
    .where('chat_id', '==', Number(chatId) || String(chatId))
    .where('vin', '==', vin)
    .get();
  return snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
}

async function updateQuoteStatus(quoteId, status, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.updateQuoteStatus', { quoteId, status });

  await getDb().collection('quotes').doc(quoteId).set(
    { status },
    { merge: true }
  );
}

async function closeQuote(quoteId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.closeQuote', { quoteId });

  await getDb().collection('quotes').doc(quoteId).update({ status: 'closed' });
}

/* ───────── basket (sub-collection of quotes) ───────── */

async function addToBasket(quoteId, data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.addToBasket', { quoteId });

  const ref = await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .add(data);
  return { _id: ref.id, ...data };
}

async function getBasketItems(quoteId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.getBasketItems', { quoteId });

  const snap = await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .get();

  const items = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  log.debug('firestore.getBasketItems: found', { count: items.length });
  return items;
}

async function deleteBasketItem(quoteId, itemId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.deleteBasketItem', { quoteId, itemId });

  await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .doc(itemId)
    .delete();
}

async function setBasketItem(quoteId, itemId, data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.setBasketItem', { quoteId, itemId });

  await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .doc(itemId)
    .set(data);
}

/* ───────── catalogResults ───────── */

async function queryCatalogResults(groupName, typeCode, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.queryCatalogResults', { groupName, typeCode });

  const snap = await getDb()
    .collection('catalogResults')
    .where('group_name', '==', groupName)
    .where('type_code', '==', typeCode)
    .get();
  return snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
}

async function saveCatalogResult(data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.saveCatalogResult');

  await getDb().collection('catalogResults').add(data);
}

/* ───────── messages ───────── */

async function createMessage(messageId, data, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.createMessage', { messageId });

  await getDb().collection('messages').doc(messageId).set(data);
}

async function getMessageDocument(messageId, correlationId) {
  const log = correlationId ? logger.child(correlationId) : logger;
  log.debug('firestore.getMessageDocument', { messageId });

  const doc = await getDb().collection('messages').doc(messageId).get();
  if (!doc.exists) {
    log.debug('firestore.getMessageDocument: not found', { messageId });
    return null;
  }
  return { _id: doc.id, ...doc.data() };
}

module.exports = {
  getDb,
  getSession,
  upsertSession,
  queryUserByChatId,
  getTenant,
  createQuote,
  getQuote,
  queryOpenQuotesByChatId,
  queryOpenQuotesByChatIdAndVin,
  updateQuoteStatus,
  closeQuote,
  addToBasket,
  getBasketItems,
  deleteBasketItem,
  setBasketItem,
  queryCatalogResults,
  saveCatalogResult,
  createMessage,
  getMessageDocument,
};
