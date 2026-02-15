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

async function getSession(chatId) {
  const doc = await getDb().collection('sessions').doc(String(chatId)).get();
  return doc.exists ? { _id: doc.id, ...doc.data() } : null;
}

async function upsertSession(chatId, data) {
  await getDb()
    .collection('sessions')
    .doc(String(chatId))
    .set(data, { merge: true });
}

/* ───────── users ───────── */

async function queryUserByChatId(chatId) {
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

async function getTenant(tenantId) {
  const doc = await getDb().collection('tenants').doc(tenantId).get();
  return doc.exists ? { _id: doc.id, ...doc.data() } : null;
}

/* ───────── quotes ───────── */

async function createQuote(data) {
  const ref = await getDb().collection('quotes').add(data);
  return { _id: ref.id, ...data };
}

async function queryOpenQuotesByChatId(chatId) {
  const snap = await getDb()
    .collection('quotes')
    .where('status', '==', 'open')
    .where('chat_id', '==', Number(chatId) || String(chatId))
    .get();
  return snap.docs.map((d) => ({ _id: d.id, ...d.data(), _createTime: d.createTime?.toDate?.()?.toISOString() }));
}

async function queryOpenQuotesByChatIdAndVin(chatId, vin) {
  const snap = await getDb()
    .collection('quotes')
    .where('status', '==', 'open')
    .where('chat_id', '==', Number(chatId) || String(chatId))
    .where('vin', '==', vin)
    .get();
  return snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
}

/* ───────── basket (sub-collection of quotes) ───────── */

async function addToBasket(quoteId, data) {
  const ref = await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .add(data);
  return { _id: ref.id, ...data };
}

async function getBasketItems(quoteId) {
  const snap = await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .get();
  return snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
}

async function deleteBasketItem(quoteId, itemId) {
  await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .doc(itemId)
    .delete();
}

async function setBasketItem(quoteId, itemId, data) {
  await getDb()
    .collection('quotes')
    .doc(quoteId)
    .collection('basket')
    .doc(itemId)
    .set(data);
}

/* ───────── catalogResults ───────── */

async function queryCatalogResults(groupName, typeCode) {
  const snap = await getDb()
    .collection('catalogResults')
    .where('group_name', '==', groupName)
    .where('type_code', '==', typeCode)
    .get();
  return snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
}

async function saveCatalogResult(data) {
  await getDb().collection('catalogResults').add(data);
}

/* ───────── messages ───────── */

async function createMessage(messageId, data) {
  await getDb().collection('messages').doc(messageId).set(data);
}

module.exports = {
  getDb,
  getSession,
  upsertSession,
  queryUserByChatId,
  getTenant,
  createQuote,
  queryOpenQuotesByChatId,
  queryOpenQuotesByChatIdAndVin,
  addToBasket,
  getBasketItems,
  deleteBasketItem,
  setBasketItem,
  queryCatalogResults,
  saveCatalogResult,
  createMessage,
};
