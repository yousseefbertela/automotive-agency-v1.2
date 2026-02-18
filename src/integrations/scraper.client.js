'use strict';

const axios = require('axios');
const { withRetry } = require('../utils/retry');
const logger = require('../utils/logger');

// RealOEM scraper (Cloud Run). Base URL for all v2 endpoints.
const REALOEM_BASE = () =>
  process.env.SCRAPER_BASE_URL ||
  'https://scraper-api-207722784991.europe-west3.run.app';

function base(path) {
  const url = process.env.SCRAPER_BASE_URL || REALOEM_BASE();
  return `${url.replace(/\/$/, '')}${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * GET /realoem/v2-get-car-details/:vin
 * Returns: { series, model, body, market, prod_month, engine, type_code, ... }
 */
async function getCarDetails(vin, correlationId) {
  const url = base(`/realoem/v2-get-car-details/${encodeURIComponent(vin)}`);
  const log = logger.child(correlationId);
  log.info('scraper.getCarDetails', { vin, url });

  const res = await withRetry(
    () => axios.get(url, { timeout: 30000 }),
    { retries: 2, label: 'scraper.getCarDetails', correlationId }
  );
  return res.data;
}

/**
 * POST /realoem/v2-find-part
 * Accepts two forms of input:
 *   Form 1: vin + partName  → body: { vin, part }
 *   Form 2: vin + groupName + partName  → body: { vin, group, part }
 * Returns: part result object
 */
async function findPart(vin, part, correlationId, groupName = null) {
  const url = base('/realoem/v2-find-part');
  const log = logger.child(correlationId);
  const body = groupName ? { vin, group: groupName, part } : { vin, part };
  log.info('scraper.findPart', { vin, part, group: groupName || '(none)' });

  const res = await withRetry(
    () => axios.post(url, body, { timeout: 30000 }),
    { retries: 1, label: 'scraper.findPart', correlationId }
  );
  return res.data;
}

/**
 * POST /realoem/v2-query-group
 * Body: { vin, group }
 * Returns: { subgroups: [{ subgroup, diagram_image, parts: [...] }] } (or similar)
 */
async function queryGroup(vin, group, correlationId) {
  const url = base('/realoem/v2-query-group');
  const log = logger.child(correlationId);
  log.info('scraper.queryGroup', { vin, group });

  const res = await withRetry(
    () => axios.post(url, { vin, group }, { timeout: 60000 }),
    { retries: 1, baseDelay: 2000, label: 'scraper.queryGroup', correlationId }
  );
  return res.data;
}

/**
 * POST /realoem/v2-get-subgroups
 * Body: { vin, group }
 * Returns: { subgroups: ["subgroup1", "subgroup2", ...] } or array of subgroup identifiers
 */
async function getSubgroups(vin, group, correlationId) {
  const url = base('/realoem/v2-get-subgroups');
  const log = logger.child(correlationId);
  log.info('scraper.getSubgroups', { vin, group });

  const res = await withRetry(
    () => axios.post(url, { vin, group }, { timeout: 60000 }),
    { retries: 1, baseDelay: 2000, label: 'scraper.getSubgroups', correlationId }
  );
  return res.data;
}

/**
 * POST /realoem/v2-query-subgroup
 * Body: { vin, group, subgroup }
 * Returns: { subgroup, diagram_image, parts: [...] } for one subgroup
 */
async function querySubgroup(vin, group, subgroup, correlationId) {
  const url = base('/realoem/v2-query-subgroup');
  const log = logger.child(correlationId);
  log.info('scraper.querySubgroup', { vin, group, subgroup });

  const res = await withRetry(
    () => axios.post(url, { vin, group, subgroup }, { timeout: 60000 }),
    { retries: 1, baseDelay: 2000, label: 'scraper.querySubgroup', correlationId }
  );
  return res.data;
}

/**
 * Download a diagram image via ScraperAPI proxy.
 * Returns: { data: Buffer, contentType: string }
 */
async function downloadDiagramImage(diagramUrl, correlationId) {
  const apiKey = process.env.SCRAPER_API_COM_KEY;
  if (!apiKey) {
    logger.child(correlationId).warn('SCRAPER_API_COM_KEY not set, skipping diagram download');
    return null;
  }
  const safeUrl = (diagramUrl || '').replace('http://', 'https://');
  const proxyUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(safeUrl)}`;

  const res = await axios.get(proxyUrl, {
    timeout: 30000,
    responseType: 'arraybuffer',
  });
  return {
    data: Buffer.from(res.data),
    contentType: res.headers['content-type'] || 'image/png',
  };
}

module.exports = {
  getCarDetails,
  findPart,
  queryGroup,
  getSubgroups,
  querySubgroup,
  downloadDiagramImage,
};
