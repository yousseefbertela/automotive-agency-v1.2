'use strict';

const axios = require('axios');
const { withRetry } = require('../utils/retry');
const logger = require('../utils/logger');
const integrationLog = require('./integrationLog.service');

/**
 * Unified Odoo JSON-RPC client.
 * Uses /jsonrpc endpoint (Odoo external API).
 *
 * ENV: ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD
 */

let _uid = null;

function cfg() {
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const password = process.env.ODOO_PASSWORD;
  if (!url || !db || !username || !password) {
    logger.warn('Odoo env vars not fully configured (ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD)');
  }
  return { url, db, username, password };
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
  logger.child(correlationId).info('Odoo authenticated', { uid: _uid });
  return _uid;
}

async function execute(model, method, args, kwargs = {}, correlationId) {
  const { url, db, password } = cfg();
  const start = Date.now();
  const operation = `${model}.${method}`;
  if (!url) {
    logger.child(correlationId).warn(`Odoo not configured — mock execute ${operation}`, { args });
    return method === 'create' ? Math.floor(Math.random() * 100000) : [];
  }
  try {
    const uid = await authenticate(correlationId);
    const result = await withRetry(
      () => jsonRpc(url, 'object', 'execute_kw', [db, uid, password, model, method, args, kwargs]),
      { retries: 1, label: `odoo.${operation}`, correlationId }
    );
    integrationLog.logCall(
      { service: 'ODOO', operation, status: 'SUCCESS', duration_ms: Date.now() - start },
      correlationId
    ).catch(() => {});
    return result;
  } catch (err) {
    integrationLog.logCall(
      { service: 'ODOO', operation, status: 'ERROR', duration_ms: Date.now() - start, response_meta: { error: err.message } },
      correlationId
    ).catch(() => {});
    throw err;
  }
}

/* ─── High-level helpers matching n8n nodes ─── */

/**
 * Search x_car by chassis (VIN).
 * Returns array of records.
 */
async function searchCar(vin, correlationId) {
  const ids = await execute(
    'x_car',
    'search_read',
    [[['x_studio_car_chasis', 'like', vin]]],
    { fields: ['id', 'x_name', 'x_studio_car_chasis', 'x_studio_partner_id', 'x_studio_partner_phone'] },
    correlationId
  );
  return ids;
}

/**
 * Create a new x_car.
 */
async function createCar(data, correlationId) {
  const id = await execute('x_car', 'create', [data], {}, correlationId);
  return { id };
}

/**
 * Update x_car partner_id.
 */
async function updateCarPartner(carId, partnerId, correlationId) {
  await execute('x_car', 'write', [[carId], { x_studio_partner_id: partnerId }], {}, correlationId);
}

/**
 * Search res.partner by mobile.
 */
async function searchContact(mobile, correlationId) {
  const ids = await execute(
    'res.partner',
    'search_read',
    [[['mobile', 'like', mobile]]],
    { fields: ['id', 'name', 'mobile'], limit: 1 },
    correlationId
  );
  return ids;
}

/**
 * Create res.partner (customer).
 */
async function createCustomer(name, mobile, correlationId) {
  const id = await execute('res.partner', 'create', [{ name, mobile }], {}, correlationId);
  return { id };
}

/**
 * Create sale.order (quotation).
 */
async function createQuotation(data, correlationId) {
  // data should contain: partner_id, partner_invoice_id, partner_shipping_id, x_studio_car
  const id = await execute('sale.order', 'create', [data], {}, correlationId);
  return { id };
}

/**
 * Search product.template by OEN (part number).
 */
async function searchProduct(partNumber, correlationId) {
  const products = await execute(
    'product.template',
    'search_read',
    [[['x_studio_oen', 'like', partNumber]]],
    {
      fields: [
        'id', 'active', 'name', 'standard_price',
        'x_studio_product_brand', 'qty_available',
        'categ_id', 'x_studio_internal_reference', 'x_studio_oen',
      ],
    },
    correlationId
  );
  return products;
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

module.exports = {
  authenticate,
  execute,
  searchCar,
  createCar,
  updateCarPartner,
  searchContact,
  createCustomer,
  createQuotation,
  searchProduct,
  createOrderLine,
};
