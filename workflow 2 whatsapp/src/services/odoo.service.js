'use strict';

const axios = require('axios');
const { withRetry } = require('../utils/retry');
const logger = require('../utils/logger');

/**
 * Minimal Odoo JSON-RPC client for creating sale.order.line records.
 * Matches n8n: "Create an item" node.
 */

let _uid = null;

function cfg() {
  return {
    url: process.env.ODOO_URL,
    db: process.env.ODOO_DB,
    username: process.env.ODOO_USERNAME,
    password: process.env.ODOO_PASSWORD,
  };
}

async function jsonRpc(url, service, method, args) {
  const res = await axios.post(
    `${url}/jsonrpc`,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Date.now(),
    },
    { timeout: 30000 }
  );
  if (res.data.error) {
    throw new Error(`Odoo RPC error: ${JSON.stringify(res.data.error)}`);
  }
  return res.data.result;
}

async function authenticate(correlationId) {
  if (_uid) return _uid;
  const { url, db, username, password } = cfg();
  if (!url) {
    logger.child(correlationId).warn('Odoo not configured — returning mock uid=1');
    _uid = 1;
    return _uid;
  }
  _uid = await jsonRpc(url, 'common', 'authenticate', [db, username, password, {}]);
  if (!_uid) throw new Error('Odoo authentication failed');
  return _uid;
}

async function execute(model, method, args, kwargs = {}, correlationId) {
  const { url, db, password } = cfg();
  if (!url) {
    logger.child(correlationId).warn(`Odoo not configured — mock execute ${model}.${method}`);
    return method === 'create' ? Math.floor(Math.random() * 100000) : [];
  }
  const uid = await authenticate(correlationId);
  return withRetry(
    () => jsonRpc(url, 'object', 'execute_kw', [db, uid, password, model, method, args, kwargs]),
    { retries: 1, label: `odoo.${model}.${method}`, correlationId }
  );
}

/**
 * Create a sale.order.line in Odoo.
 * Matches n8n: "Create an item" node fields.
 *
 * @param {object} params
 * @param {number} params.orderId        - sale.order ID (from quote.quotation_id)
 * @param {number} params.productId      - product.product ID (from basket chosen_product_id)
 * @param {string} params.name           - line description
 * @param {number} params.priceUnit      - unit price
 * @param {number} [params.qty]          - quantity (default 1)
 * @param {string} correlationId
 */
async function createOrderLine(params, correlationId) {
  const log = logger.child(correlationId);
  const {
    orderId,
    productId,
    name,
    priceUnit,
    qty = 1,
  } = params;

  log.info('odoo.createOrderLine', { orderId, productId, name, priceUnit, qty });

  const data = {
    customer_lead: 1,
    name: name || 'Part',
    order_id: orderId,
    price_unit: priceUnit || 0,
    product_uom_qty: qty,
    product_id: productId || 12, // fallback from n8n JSON
    product_uom: 1,
  };

  const id = await execute('sale.order.line', 'create', [data], {}, correlationId);
  log.info('odoo.createOrderLine: created', { lineId: id });
  return { id };
}

module.exports = { authenticate, execute, createOrderLine };
