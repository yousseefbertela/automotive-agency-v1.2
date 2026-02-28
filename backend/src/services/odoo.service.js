'use strict';

const axios = require('axios');
const { withRetry } = require('../utils/retry');
const logger = require('../utils/logger');
const integrationLog = require('./integrationLog.service');
const trace = require('./trace.service');

/**
 * Odoo JSON-RPC client.
 * - SaaS: pass odooConfig from Tenant (odoo_url, odoo_db, odoo_username, odoo_password) to use that client's Odoo.
 * - Single-tenant: omit odooConfig to use env ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD.
 */

const _uidByKey = {};

function cfg(odooConfig) {
  if (odooConfig && odooConfig.odoo_url && odooConfig.odoo_db && odooConfig.odoo_username != null && odooConfig.odoo_password != null) {
    return {
      url: odooConfig.odoo_url,
      db: odooConfig.odoo_db,
      username: String(odooConfig.odoo_username),
      password: String(odooConfig.odoo_password),
    };
  }
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const password = process.env.ODOO_PASSWORD;
  if (!url || !db || !username || !password) {
    logger.warn('Odoo not configured: set Tenant odoo_* fields (SaaS) or env ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD');
  }
  return { url: url || '', db: db || '', username: username || '', password: password || '' };
}

function configKey(c) {
  if (!c || !c.url) return 'env';
  return `${c.url}|${c.db}|${c.username}`;
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

async function authenticate(correlationId, odooConfig) {
  const c = cfg(odooConfig);
  const key = configKey(c);
  if (_uidByKey[key] != null) return _uidByKey[key];
  // Only trace when making an actual network call (cache miss)
  return trace.step('odoo_auth', async () => {
    if (!c.url) {
      logger.child(correlationId).warn('Odoo not configured — returning mock uid=1');
      _uidByKey[key] = 1;
      return 1;
    }
    const uid = await jsonRpc(c.url, 'common', 'authenticate', [c.db, c.username, c.password, {}]);
    if (!uid) throw new Error('Odoo authentication failed');
    logger.child(correlationId).info('Odoo authenticated', { uid, key: key === 'env' ? 'env' : 'tenant' });
    _uidByKey[key] = uid;
    return uid;
  }, { domain: 'odoo', input: { key: key === 'env' ? 'env' : 'tenant' }, replaySafe: true });
}

async function execute(model, method, args, kwargs = {}, correlationId, odooConfig) {
  return trace.step(`odoo_${model}_${method}`, async () => {
    const c = cfg(odooConfig);
    const start = Date.now();
    const operation = `${model}.${method}`;
    if (!c.url) {
      logger.child(correlationId).warn(`Odoo not configured — mock execute ${operation}`, { args });
      return method === 'create' ? Math.floor(Math.random() * 100000) : [];
    }
    try {
      const uid = await authenticate(correlationId, odooConfig);
      const result = await withRetry(
        () => jsonRpc(c.url, 'object', 'execute_kw', [c.db, uid, c.password, model, method, args, kwargs]),
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
  }, { domain: 'odoo', input: { model, method, argsLength: args?.length }, replaySafe: false });
}

async function searchCar(vin, correlationId, odooConfig) {
  return execute(
    'x_car',
    'search_read',
    [[['x_studio_car_chasis', 'like', vin]]],
    { fields: ['id', 'x_name', 'x_studio_car_chasis', 'x_studio_partner_id', 'x_studio_partner_phone'] },
    correlationId,
    odooConfig
  );
}

async function createCar(data, correlationId, odooConfig) {
  const id = await execute('x_car', 'create', [data], {}, correlationId, odooConfig);
  return { id };
}

async function updateCarPartner(carId, partnerId, correlationId, odooConfig) {
  await execute('x_car', 'write', [[carId], { x_studio_partner_id: partnerId }], {}, correlationId, odooConfig);
}

async function searchContact(mobile, correlationId, odooConfig) {
  return execute(
    'res.partner',
    'search_read',
    [[['mobile', 'like', mobile]]],
    { fields: ['id', 'name', 'mobile'], limit: 1 },
    correlationId,
    odooConfig
  );
}

async function createCustomer(name, mobile, correlationId, odooConfig) {
  const id = await execute('res.partner', 'create', [{ name, mobile }], {}, correlationId, odooConfig);
  return { id };
}

async function createQuotation(data, correlationId, odooConfig) {
  const id = await execute('sale.order', 'create', [data], {}, correlationId, odooConfig);
  return { id };
}

async function searchProduct(partNumber, correlationId, odooConfig) {
  return execute(
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
    correlationId,
    odooConfig
  );
}

async function createOrderLine(params, correlationId, odooConfig) {
  const log = logger.child(correlationId);
  const { orderId, productId, name, priceUnit, qty = 1 } = params;
  log.info('odoo.createOrderLine', { orderId, productId, name, priceUnit, qty });
  const data = {
    customer_lead: 1,
    name: name || 'Part',
    order_id: orderId,
    price_unit: priceUnit || 0,
    product_uom_qty: qty,
    product_id: productId || 12,
    product_uom: 1,
  };
  const id = await execute('sale.order.line', 'create', [data], {}, correlationId, odooConfig);
  log.info('odoo.createOrderLine: created', { lineId: id });
  return { id };
}

module.exports = {
  cfg,
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
